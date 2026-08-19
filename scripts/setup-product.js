#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import {
  DEFAULT_API_BASE,
  PUBLIC_STAGING_ROOT,
  REPO_ROOT,
  SITE_DEFAULTS,
  apiRequest,
  assertContained,
  assertSimpleName,
  assertSiteKey,
  listHtmlFiles,
  parseArguments,
  projectConfigPath,
  requireExistingDirectory,
  sha256,
  stateDirectory,
  toUrlPath,
  writeJson
} from './runtime.js';
import { annotateEditableHtml, injectEditorBootstrap } from './html-tools.js';

const HELP = `
Live Edits product setup

Usage:
  node scripts/setup-product.js --site en --source /home/ec2-user/environment/wwwroot/en/my-product

Required:
  --site en|fr             Preview site and project namespace
  --source PATH            Product folder inside the site's web root

Options:
  --name NAME              Project name (defaults to source folder name)
  --web-root PATH          Override the selected site's document root
  --staging-root PATH      Override the shared version 4 staging root
  --origin URL             Override the selected site's public origin
  --api-base URL           API base (default: https://test.infobase-dev.com/live-edits)
  --files a.html,b.html    Stage only specific files
  --subfolders a,b         Stage only specific subfolders
  --force                  Replace an existing preview after making a private backup
  --no-register            Prepare preview files without calling the Azure API
  --list                   List candidate project folders in the selected web root
  --help                   Show this help

Set LIVE_EDITS_ADMIN_TOKEN in the environment before registration.
`;

const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.svn', '.live-edits', 'node_modules', '_live-edits', 'state', '_backups'
]);
const EXCLUDED_FILES = new Set([
  '.env', '.env.local', '.env.production', '.npmrc', '.htpasswd', 'web.config'
]);
const EXCLUDED_EXTENSIONS = new Set([
  '.bak', '.bat', '.cer', '.cgi', '.cmd', '.com', '.crt', '.db', '.dll', '.exe', '.key', '.log',
  '.p12', '.pem', '.pfx', '.php', '.pl', '.ps1', '.py', '.sh', '.sqlite', '.sqlite3'
]);

function splitList(value) {
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
}

function isSafeEntry(name, isDirectory) {
  const lower = name.toLowerCase();
  if (isDirectory) return !EXCLUDED_DIRECTORIES.has(lower);
  return !EXCLUDED_FILES.has(lower)
    && !lower.startsWith('.env.')
    && !EXCLUDED_EXTENSIONS.has(extname(lower));
}

function copyTree(source, destination) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not staged: ${source}`);
  if (!isSafeEntry(basename(source), stat.isDirectory())) return;
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      copyTree(resolve(source, entry), resolve(destination, entry));
    }
  } else if (stat.isFile()) {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

function copySelection(source, destination, files, subfolders) {
  if (!files.length && !subfolders.length) {
    copyTree(source, destination);
    return;
  }
  mkdirSync(destination, { recursive: true });
  for (const requested of [...subfolders, ...files]) {
    const sourceEntry = assertContained(source, resolve(source, requested), 'Selected path');
    if (!existsSync(sourceEntry)) throw new Error(`Selected path does not exist: ${requested}`);
    const destinationEntry = assertContained(destination, resolve(destination, requested), 'Destination path');
    copyTree(sourceEntry, destinationEntry);
  }
}

function listProjects(webRoot) {
  const projects = readdirSync(webRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isSafeEntry(entry.name, true))
    .map((entry) => entry.name)
    .sort();
  console.log(projects.length ? projects.join('\n') : '(no candidate folders found)');
}

async function main() {
  const args = parseArguments(process.argv.slice(2), {
    force: { type: 'boolean' },
    help: { type: 'boolean' },
    list: { type: 'boolean' },
    'no-register': { type: 'boolean' }
  });
  if (args.help) {
    console.log(HELP.trim());
    return;
  }

  const siteKey = assertSiteKey(args.site || process.env.LIVE_EDITS_SITE);
  const site = SITE_DEFAULTS[siteKey];
  const webRoot = requireExistingDirectory(args['web-root'] || process.env.LIVE_EDITS_WEB_ROOT || site.webRoot, 'Web root');
  if (args.list) {
    listProjects(webRoot);
    return;
  }

  const sourceValue = args.source || args._[0];
  if (!sourceValue) throw new Error('Provide --source PATH. Run with --help for examples.');
  const source = requireExistingDirectory(sourceValue, 'Source folder');
  assertContained(webRoot, source, 'Source folder');

  const projectName = assertSimpleName(args.name || basename(source), 'Project name');
  const origin = (args.origin || site.origin).replace(/\/$/, '');
  const apiBase = (args['api-base'] || process.env.LIVE_EDITS_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
  const sharedWebRoot = resolve(webRoot, '..');
  const stagingRoot = assertContained(
    sharedWebRoot,
    resolve(args['staging-root'] || process.env.LIVE_EDITS_STAGING_ROOT || site.stagingRoot),
    'Staging root'
  );
  mkdirSync(stagingRoot, { recursive: true });
  if (lstatSync(stagingRoot).isSymbolicLink() || !lstatSync(stagingRoot).isDirectory()) {
    throw new Error(`Staging root must be a real directory: ${stagingRoot}`);
  }
  const projectPath = toUrlPath(relative(webRoot, source));
  const previewPath = toUrlPath(PUBLIC_STAGING_ROOT, 'products', siteKey, projectName);
  const widgetPath = toUrlPath(PUBLIC_STAGING_ROOT, 'widget', 'editor.js');
  const target = assertContained(
    stagingRoot,
    resolve(stagingRoot, 'products', siteKey, projectName),
    'Preview target'
  );
  const buildingTarget = assertContained(
    dirname(target),
    resolve(dirname(target), `.${basename(target)}.building-${process.pid}`),
    'Temporary preview target'
  );

  if (existsSync(target) && !args.force) {
    throw new Error(`Preview already exists: ${target}. Re-run with --force to replace it safely.`);
  }
  if (existsSync(buildingTarget)) rmSync(buildingTarget, { recursive: true, force: true });

  console.log(`Staging ${siteKey}:${projectPath}`);
  copySelection(source, buildingTarget, splitList(args.files), splitList(args.subfolders));
  const htmlFiles = listHtmlFiles(buildingTarget);
  if (!htmlFiles.length) throw new Error('No HTML files were found in the staged selection.');

  let keyCount = 0;
  const sourceHashes = {};
  const pageManifests = [];
  for (const file of htmlFiles) {
    const relativeFile = relative(buildingTarget, file).replaceAll('\\', '/');
    const pagePath = toUrlPath(projectPath, relativeFile);
    const pageIdentity = `${siteKey}:${pagePath}`;
    const sourceHtml = readFileSync(file, 'utf8');
    sourceHashes[relativeFile] = sha256(sourceHtml);
    const annotated = annotateEditableHtml(sourceHtml, pageIdentity);
    pageManifests.push({ page_path: pagePath, element_keys: annotated.keys });
    const stagedHtml = injectEditorBootstrap(annotated.html, {
      apiBase,
      siteKey,
      projectPath,
      pagePath,
      widgetUrl: `${origin}${widgetPath}`
    });
    writeFileSync(file, stagedHtml, 'utf8');
    keyCount += annotated.keys.length;
  }

  const widgetDestination = assertContained(
    stagingRoot,
    resolve(stagingRoot, 'widget', 'editor.js'),
    'Widget destination'
  );
  mkdirSync(dirname(widgetDestination), { recursive: true });
  copyFileSync(resolve(REPO_ROOT, 'widget', 'editor.js'), widgetDestination);

  if (existsSync(target)) {
    const backup = resolve(
      stateDirectory(),
      'setup-backups',
      siteKey,
      `${projectName}-${new Date().toISOString().replaceAll(':', '-')}`
    );
    mkdirSync(dirname(backup), { recursive: true });
    cpSync(target, backup, { recursive: true, errorOnExist: true });
    rmSync(target, { recursive: true, force: true });
    console.log(`Previous preview backed up to ${backup}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  renameSync(buildingTarget, target);

  const config = {
    schema_version: 1,
    project_id: null,
    project_name: projectName,
    site_key: siteKey,
    source_path: source,
    web_root: webRoot,
    staging_root: stagingRoot,
    project_path: projectPath,
    preview_path: previewPath,
    preview_url: `${origin}${previewPath}/`,
    public_url: `${origin}${projectPath}/`,
    widget_path: widgetPath,
    api_base: apiBase,
    html_files: htmlFiles.map((file) => relative(buildingTarget, file).replaceAll('\\', '/')),
    source_hashes: sourceHashes,
    page_manifests: pageManifests,
    updated_at: new Date().toISOString()
  };
  writeJson(projectConfigPath(siteKey, projectName), config);

  let project = null;
  if (!args['no-register']) {
    const adminToken = process.env.LIVE_EDITS_ADMIN_TOKEN;
    if (!adminToken) {
      throw new Error('LIVE_EDITS_ADMIN_TOKEN is required for registration. The preview and private config were created; set the token and rerun with --force.');
    }
    project = await apiRequest(apiBase, '/api/v1/projects', {
      method: 'POST',
      token: adminToken,
      body: { site_key: siteKey, project_path: projectPath, name: projectName, origin }
    });
    await apiRequest(apiBase, `/api/v1/projects/${encodeURIComponent(project.id)}/pages/register`, {
      method: 'POST',
      token: adminToken,
      body: { pages: pageManifests }
    });
    config.project_id = project.id;
    writeJson(projectConfigPath(siteKey, projectName), config);
  }

  console.log(`Prepared ${htmlFiles.length} HTML files and ${keyCount} editable regions.`);
  console.log(`Preview: ${config.preview_url}`);
  console.log(project ? `Registered project: ${project.id}` : 'Registration skipped.');
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
