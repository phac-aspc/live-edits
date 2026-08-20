#!/usr/bin/env node

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync
} from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_API_BASE,
  REPO_ROOT,
  SITE_DEFAULTS,
  apiRequest,
  assertContained,
  assertSimpleName,
  assertSiteKey,
  projectConfigPath,
  readJson,
  sha256,
  stateDirectory,
  toUrlPath,
  writeJson
} from '../scripts/runtime.js';

const PUBLIC_DIRECTORY = resolve(REPO_ROOT, 'admin', 'public');
const COOKIE_NAME = 'live_edits_admin_session';
const ARCHIVE_SCHEMA_VERSION = 1;
const EXCLUDED_CANDIDATES = new Set([
  '.git', '.svn', '.live-edits', '_backups', '_live-edits', 'node_modules', 'state'
]);
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'application/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);

function required(name, value) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function integer(name, value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

export function loadAdminConfig(environment = process.env) {
  const adminUiToken = required('LIVE_EDITS_ADMIN_UI_TOKEN', environment.LIVE_EDITS_ADMIN_UI_TOKEN);
  const adminToken = required('LIVE_EDITS_ADMIN_TOKEN', environment.LIVE_EDITS_ADMIN_TOKEN);
  if (adminUiToken.length < 32 || adminToken.length < 32) {
    throw new Error('LIVE_EDITS_ADMIN_UI_TOKEN and LIVE_EDITS_ADMIN_TOKEN must each contain at least 32 characters.');
  }
  if (adminUiToken === adminToken) throw new Error('The admin console and Azure administrator tokens must be different.');
  const publicOrigin = new URL(environment.LIVE_EDITS_ADMIN_ORIGIN || 'https://en.infobase-dev.com');
  if (publicOrigin.protocol !== 'https:' || publicOrigin.origin !== publicOrigin.href.replace(/\/$/, '')) {
    throw new Error('LIVE_EDITS_ADMIN_ORIGIN must be an exact HTTPS origin.');
  }
  const host = environment.LIVE_EDITS_ADMIN_HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('The admin service must bind to loopback behind Apache.');
  }
  return Object.freeze({
    host,
    port: integer('LIVE_EDITS_ADMIN_PORT', environment.LIVE_EDITS_ADMIN_PORT, 3100, 1, 65535),
    apiBase: (environment.LIVE_EDITS_API_BASE || DEFAULT_API_BASE).replace(/\/$/, ''),
    adminToken,
    adminUiToken,
    publicOrigin: publicOrigin.origin,
    cookiePath: environment.LIVE_EDITS_ADMIN_COOKIE_PATH || '/_live-edits/v4/admin/',
    sessionMinutes: integer('LIVE_EDITS_ADMIN_SESSION_MINUTES', environment.LIVE_EDITS_ADMIN_SESSION_MINUTES, 60, 5, 480),
    commandTimeoutMs: integer('LIVE_EDITS_ADMIN_COMMAND_TIMEOUT_MS', environment.LIVE_EDITS_ADMIN_COMMAND_TIMEOUT_MS, 300_000, 10_000, 900_000),
    stateDirectory: resolve(environment.LIVE_EDITS_STATE_DIR || stateDirectory()),
    siteDefaults: {
      en: {
        ...SITE_DEFAULTS.en,
        webRoot: resolve(environment.LIVE_EDITS_EN_ROOT || SITE_DEFAULTS.en.webRoot),
        stagingRoot: resolve(environment.LIVE_EDITS_STAGING_ROOT || SITE_DEFAULTS.en.stagingRoot)
      },
      fr: {
        ...SITE_DEFAULTS.fr,
        webRoot: resolve(environment.LIVE_EDITS_FR_ROOT || SITE_DEFAULTS.fr.webRoot),
        stagingRoot: resolve(environment.LIVE_EDITS_STAGING_ROOT || SITE_DEFAULTS.fr.stagingRoot)
      }
    }
  });
}

function secureEqual(received, expected) {
  const a = createHash('sha256').update(received || '').digest();
  const b = createHash('sha256').update(expected || '').digest();
  return timingSafeEqual(a, b);
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function createSession(name, config) {
  const payload = encode(JSON.stringify({
    name,
    csrf: randomBytes(24).toString('base64url'),
    expires_at: Date.now() + (config.sessionMinutes * 60_000)
  }));
  return `${payload}.${sign(payload, config.adminUiToken)}`;
}

function readSession(request, config) {
  const cookies = Object.fromEntries((request.headers.cookie || '').split(';').map((entry) => {
    const index = entry.indexOf('=');
    return index < 0 ? ['', ''] : [entry.slice(0, index).trim(), entry.slice(index + 1).trim()];
  }));
  const token = cookies[COOKIE_NAME] || '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !secureEqual(signature, sign(payload, config.adminUiToken))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.expires_at > Date.now() && typeof session.name === 'string' ? session : null;
  } catch {
    return null;
  }
}

function sessionCookie(token, config, maxAgeSeconds = config.sessionMinutes * 60) {
  return `${COOKIE_NAME}=${token}; Path=${config.cookiePath}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

function json(response, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    ...headers
  });
  response.end(data);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function validateAdminName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw Object.assign(new Error('Name must contain 1 to 100 characters.'), { status: 400 });
  }
  return name;
}

function verifyOrigin(request, config) {
  if (request.headers.origin !== config.publicOrigin) {
    throw Object.assign(new Error('Request origin is not allowed.'), { status: 403 });
  }
}

function verifyCsrf(request, session) {
  if (!secureEqual(request.headers['x-live-edits-csrf'], session.csrf)) {
    throw Object.assign(new Error('The admin session could not be verified. Refresh and try again.'), { status: 403 });
  }
}

function countHtmlFiles(root, maximum = 5000) {
  let count = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (count >= maximum) return;
      const path = resolve(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (entry.isDirectory() && !EXCLUDED_CANDIDATES.has(entry.name.toLowerCase())) visit(path);
      else if (entry.isFile() && /\.html?$/i.test(entry.name)) count += 1;
    }
  };
  visit(root);
  return count;
}

function discoverCandidates(config) {
  const candidates = [];
  for (const siteKey of ['en', 'fr']) {
    const site = config.siteDefaults[siteKey];
    if (!existsSync(site.webRoot)) continue;
    for (const entry of readdirSync(site.webRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || EXCLUDED_CANDIDATES.has(entry.name.toLowerCase())) continue;
      const sourcePath = assertContained(site.webRoot, resolve(site.webRoot, entry.name), 'Candidate project');
      const htmlFiles = countHtmlFiles(sourcePath);
      if (!htmlFiles) continue;
      const supported = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(entry.name);
      candidates.push({
        site_key: siteKey,
        folder: entry.name,
        project_path: toUrlPath(entry.name),
        source_path: sourcePath,
        public_url: `${site.origin}${toUrlPath(entry.name)}/`,
        html_files: htmlFiles,
        supported,
        issue: supported ? null : 'Folder name must use letters, numbers, dots, underscores, or hyphens.'
      });
    }
  }
  return candidates.sort((a, b) => `${a.site_key}:${a.folder}`.localeCompare(`${b.site_key}:${b.folder}`));
}

function readLocalProjects(config) {
  const projects = [];
  for (const siteKey of ['en', 'fr']) {
    const directory = resolve(config.stateDirectory, 'projects', siteKey);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.json') continue;
      try {
        const value = readJson(resolve(directory, entry.name));
        projects.push(value);
      } catch (error) {
        projects.push({
          project_name: basename(entry.name, '.json'), site_key: siteKey,
          local_error: `Private project configuration is invalid: ${error.message}`
        });
      }
    }
  }
  return projects;
}

function archiveRoot(config) {
  return resolve(config.stateDirectory, 'project-archives');
}

function archiveTimestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

function archiveId(config, directory) {
  return Buffer.from(relative(archiveRoot(config), directory)).toString('base64url');
}

function archiveDirectory(config, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{4,500}$/.test(id)) {
    throw Object.assign(new Error('Invalid archive identifier.'), { status: 400 });
  }
  let relativePath;
  try {
    relativePath = Buffer.from(id, 'base64url').toString('utf8');
  } catch {
    throw Object.assign(new Error('Invalid archive identifier.'), { status: 400 });
  }
  if (!relativePath || relativePath.includes('\0')) {
    throw Object.assign(new Error('Invalid archive identifier.'), { status: 400 });
  }
  return assertContained(archiveRoot(config), resolve(archiveRoot(config), relativePath), 'Project archive');
}

function archiveRecord(config, directory) {
  const manifestPath = resolve(directory, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath);
  return {
    ...manifest,
    archive_id: archiveId(config, directory),
    archive_directory: directory,
    manifest_path: manifestPath
  };
}

function readProjectArchives(config) {
  const root = archiveRoot(config);
  if (!existsSync(root)) return [];
  const records = [];
  for (const siteEntry of readdirSync(root, { withFileTypes: true })) {
    if (!siteEntry.isDirectory()) continue;
    const siteDirectory = resolve(root, siteEntry.name);
    for (const projectEntry of readdirSync(siteDirectory, { withFileTypes: true })) {
      if (!projectEntry.isDirectory()) continue;
      const projectDirectory = resolve(siteDirectory, projectEntry.name);
      for (const timestampEntry of readdirSync(projectDirectory, { withFileTypes: true })) {
        if (!timestampEntry.isDirectory()) continue;
        try {
          const record = archiveRecord(config, resolve(projectDirectory, timestampEntry.name));
          if (record) records.push(record);
        } catch (error) {
          records.push({
            status: 'invalid', site_key: siteEntry.name, project_name: projectEntry.name,
            archived_at: null, local_error: `Archive manifest is invalid: ${error.message}`
          });
        }
      }
    }
  }
  return records.sort((a, b) => (b.archived_at || '').localeCompare(a.archived_at || ''));
}

function movePath(source, destination) {
  if (!existsSync(source)) return false;
  if (existsSync(destination)) {
    throw Object.assign(new Error(`Archive destination already exists: ${destination}`), { status: 409 });
  }
  mkdirSync(dirname(destination), { recursive: true });
  try {
    renameSync(source, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
    rmSync(source, { recursive: true, force: true });
  }
  return true;
}

function rollbackMoves(moves) {
  for (const move of [...moves].reverse()) {
    if (existsSync(move.destination) && !existsSync(move.source)) {
      movePath(move.destination, move.source);
    }
  }
}

function sourceState(project) {
  if (!project.source_path || !project.source_hashes) return 'unknown';
  try {
    for (const [relativeFile, expectedHash] of Object.entries(project.source_hashes)) {
      const file = assertContained(project.source_path, resolve(project.source_path, relativeFile), 'Source page');
      if (!existsSync(file)) return 'missing';
      if (sha256(readFileSync(file, 'utf8')) !== expectedHash) return 'changed';
    }
    return 'unchanged';
  } catch {
    return 'unknown';
  }
}

async function dashboard(config) {
  const [localProjects, candidates] = [readLocalProjects(config), discoverCandidates(config)];
  const localArchives = readProjectArchives(config).filter((archive) => archive.status === 'archived');
  let remoteProjects = [];
  let apiError = null;
  try {
    remoteProjects = await apiRequest(config.apiBase, '/api/v1/projects', { token: config.adminToken });
  } catch (error) {
    apiError = error.message;
  }
  const configured = new Set(localProjects.map((project) => `${project.site_key}:${project.project_path}`));
  const remoteById = new Map(remoteProjects.map((project) => [project.id, project]));
  const remoteByPath = new Map(remoteProjects.map((project) => [`${project.site_key}:${project.project_path}`, project]));
  const archivedPaths = new Set(localArchives.map((archive) => `${archive.site_key}:${archive.project_path}`));
  for (const remote of remoteProjects.filter((project) => project.status === 'archived')) {
    archivedPaths.add(`${remote.site_key}:${remote.project_path}`);
  }
  const projects = localProjects.map((local) => {
    const remote = remoteById.get(local.project_id) || remoteByPath.get(`${local.site_key}:${local.project_path}`) || null;
    return {
      ...local,
      source_state: sourceState(local),
      remote,
      state: local.local_error ? 'invalid-local-config' : (remote?.status === 'archived' ? 'archived' : (remote ? 'ready' : 'not-registered'))
    };
  }).filter((project) => project.state !== 'archived');
  const localIds = new Set(localProjects.map((project) => project.project_id).filter(Boolean));
  for (const remote of remoteProjects.filter((project) => project.status !== 'archived')) {
    if (!localIds.has(remote.id) && !configured.has(`${remote.site_key}:${remote.project_path}`)) {
      projects.push({
        project_name: remote.name, site_key: remote.site_key, project_path: remote.project_path,
        remote, state: 'remote-only', source_state: 'unknown'
      });
    }
  }
  const archives = localArchives.map((archive) => {
    const remote = remoteById.get(archive.project_id)
      || remoteByPath.get(`${archive.site_key}:${archive.project_path}`)
      || null;
    const { archive_directory: privateDirectory, manifest_path: privateManifest, ...publicArchive } = archive;
    return { ...publicArchive, remote, state: remote ? 'archived' : 'archive-only' };
  });
  const archivedLocalIds = new Set(localArchives.map((archive) => archive.project_id).filter(Boolean));
  for (const remote of remoteProjects.filter((project) => project.status === 'archived')) {
    if (!archivedLocalIds.has(remote.id)) {
      archives.push({
        archive_id: null, project_id: remote.id, project_name: remote.name,
        site_key: remote.site_key, project_path: remote.project_path,
        archived_at: new Date(remote.updated_at).toISOString(), source_archived: false,
        remote, state: 'remote-only'
      });
    }
  }
  return {
    generated_at: new Date().toISOString(),
    api: { ok: !apiError, error: apiError },
    candidates: candidates.filter((candidate) => (
      !configured.has(`${candidate.site_key}:${candidate.project_path}`)
      && !archivedPaths.has(`${candidate.site_key}:${candidate.project_path}`)
    )),
    projects: projects.sort((a, b) => `${a.site_key}:${a.project_name}`.localeCompare(`${b.site_key}:${b.project_name}`)),
    archives: archives.sort((a, b) => (b.archived_at || '').localeCompare(a.archived_at || ''))
  };
}

function projectConfig(config, siteKeyValue, projectNameValue) {
  const siteKey = assertSiteKey(siteKeyValue);
  const projectName = assertSimpleName(projectNameValue, 'Project name');
  const path = resolve(config.stateDirectory, 'projects', siteKey, `${projectName}.json`);
  assertContained(resolve(config.stateDirectory, 'projects', siteKey), path, 'Project config');
  if (!existsSync(path)) throw Object.assign(new Error('Project configuration was not found on C9.'), { status: 404 });
  return readJson(path);
}

function runScript(config, script, args) {
  return new Promise((resolvePromise, reject) => {
    const childEnvironment = {
      ...process.env,
      LIVE_EDITS_STATE_DIR: config.stateDirectory,
      LIVE_EDITS_ADMIN_TOKEN: config.adminToken,
      LIVE_EDITS_API_BASE: config.apiBase
    };
    delete childEnvironment.LIVE_EDITS_ADMIN_UI_TOKEN;
    const child = spawn(process.execPath, [resolve(REPO_ROOT, 'scripts', script), ...args], {
      cwd: REPO_ROOT,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => `${current}${chunk}`.slice(-1_000_000);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => child.kill('SIGTERM'), config.commandTimeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
      const reason = signal ? `terminated by ${signal}` : `exited with code ${code}`;
      return reject(Object.assign(new Error((stderr || stdout || `Operation ${reason}.`).trim()), { status: 409 }));
    });
  });
}

async function archiveProjectLifecycle(config, project, archivedBy, options) {
  const site = config.siteDefaults[project.site_key];
  const sourcePath = assertContained(site.webRoot, resolve(project.source_path), 'Source folder');
  const previewPath = assertContained(
    site.stagingRoot,
    resolve(site.stagingRoot, 'products', project.site_key, project.project_name),
    'Staged preview'
  );
  const configPath = assertContained(
    resolve(config.stateDirectory, 'projects', project.site_key),
    resolve(config.stateDirectory, 'projects', project.site_key, `${project.project_name}.json`),
    'Project config'
  );
  if (!existsSync(configPath)) {
    throw Object.assign(new Error('Private project configuration was not found.'), { status: 404 });
  }
  if (options.archiveSource && !existsSync(sourcePath)) {
    throw Object.assign(new Error('The source folder cannot be archived because it was not found.'), { status: 409 });
  }
  const remoteProjects = await apiRequest(config.apiBase, '/api/v1/projects', { token: config.adminToken });
  const remote = remoteProjects.find((entry) => (
    entry.id === project.project_id
    || (entry.site_key === project.site_key && entry.project_path === project.project_path)
  ));
  if (!remote) throw Object.assign(new Error('Azure project registration was not found.'), { status: 409 });
  if (remote.status !== 'active') throw Object.assign(new Error('Only active projects can be archived.'), { status: 409 });

  const directory = resolve(
    archiveRoot(config), project.site_key, project.project_name, archiveTimestamp()
  );
  if (existsSync(directory)) throw Object.assign(new Error('A project archive with this timestamp already exists.'), { status: 409 });
  mkdirSync(directory, { recursive: true });
  const manifestPath = resolve(directory, 'manifest.json');
  const manifest = {
    schema_version: ARCHIVE_SCHEMA_VERSION,
    status: 'archiving',
    project_id: remote.id,
    project_name: project.project_name,
    site_key: project.site_key,
    project_path: project.project_path,
    source_path: sourcePath,
    web_root: project.web_root,
    staging_root: project.staging_root,
    preview_path: project.preview_path,
    preview_url: project.preview_url,
    public_url: project.public_url,
    source_archived: Boolean(options.archiveSource),
    archived_by: archivedBy,
    archived_at: new Date().toISOString(),
    azure_before: {
      status: remote.status,
      review_status: remote.review_status,
      page_count: remote.page_count,
      unpublished_pages: remote.unpublished_pages,
      unresolved_comments: remote.unresolved_comments,
      last_edit_at: remote.last_edit_at,
      last_published_at: remote.last_published_at
    }
  };
  writeJson(manifestPath, manifest);

  const moves = [];
  const move = (source, destination, required = false) => {
    const moved = movePath(source, destination);
    if (required && !moved) throw Object.assign(new Error(`Required project path was not found: ${source}`), { status: 409 });
    if (moved) moves.push({ source, destination });
  };
  let remoteChanged = false;
  try {
    move(previewPath, resolve(directory, 'preview'));
    if (options.archiveSource) move(sourcePath, resolve(directory, 'source'), true);
    move(configPath, resolve(directory, 'project.json'), true);
    const archivedRemote = await apiRequest(
      config.apiBase,
      `/api/v1/projects/${encodeURIComponent(remote.id)}`,
      {
        method: 'PATCH', token: config.adminToken,
        body: { status: 'archived', review_status: 'closed' }
      }
    );
    remoteChanged = true;
    writeJson(manifestPath, { ...manifest, status: 'archived', azure_after: archivedRemote });
    return {
      archived: true,
      archive_id: archiveId(config, directory),
      project_name: project.project_name,
      site_key: project.site_key,
      source_archived: Boolean(options.archiveSource),
      archived_at: manifest.archived_at
    };
  } catch (error) {
    if (remoteChanged) {
      await apiRequest(config.apiBase, `/api/v1/projects/${encodeURIComponent(remote.id)}`, {
        method: 'PATCH', token: config.adminToken,
        body: { status: remote.status, review_status: remote.review_status }
      }).catch(() => {});
    }
    rollbackMoves(moves);
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function restoreProjectLifecycle(config, record, restoredBy) {
  if (record.status !== 'archived') {
    throw Object.assign(new Error('Only archived projects can be restored.'), { status: 409 });
  }
  const siteKey = assertSiteKey(record.site_key);
  const projectName = assertSimpleName(record.project_name, 'Project name');
  const site = config.siteDefaults[siteKey];
  const sourcePath = assertContained(site.webRoot, resolve(record.source_path), 'Source folder');
  const archivedSource = resolve(record.archive_directory, 'source');
  const liveConfigPath = resolve(config.stateDirectory, 'projects', siteKey, `${projectName}.json`);
  const livePreviewPath = resolve(site.stagingRoot, 'products', siteKey, projectName);
  if (existsSync(liveConfigPath) || existsSync(livePreviewPath)) {
    throw Object.assign(new Error('An active configuration or preview already exists for this project.'), { status: 409 });
  }
  if (existsSync(archivedSource) && existsSync(sourcePath)) {
    throw Object.assign(new Error('Both the archived and original source folders exist. Resolve the duplicate before restoring.'), { status: 409 });
  }
  if (existsSync(archivedSource)) movePath(archivedSource, sourcePath);
  if (!existsSync(sourcePath) || !lstatSync(sourcePath).isDirectory()) {
    throw Object.assign(new Error('The source folder was not found and cannot be restored.'), { status: 409 });
  }
  const result = await runScript(config, 'setup-product.js', [
    '--site', siteKey, '--source', sourcePath, '--name', projectName,
    '--web-root', site.webRoot, '--staging-root', site.stagingRoot,
    '--origin', site.origin, '--api-base', config.apiBase
  ]);
  writeJson(record.manifest_path, {
    ...readJson(record.manifest_path),
    status: 'restored', restored_by: restoredBy, restored_at: new Date().toISOString()
  });
  return { restored: true, project_name: projectName, site_key: siteKey, ...result };
}

async function purgeProjectLifecycle(config, record, purgedBy, body) {
  if (record.status !== 'archived') {
    throw Object.assign(new Error('Only archived projects can be permanently deleted.'), { status: 409 });
  }
  if (!record.project_id) {
    throw Object.assign(new Error('The Azure project identifier is missing from the archive.'), { status: 409 });
  }
  const deleted = await apiRequest(
    config.apiBase,
    `/api/v1/projects/${encodeURIComponent(record.project_id)}`,
    {
      method: 'DELETE', token: config.adminToken,
      body: { confirmation: body.confirmation, delete_confirmation: body.delete_confirmation }
    }
  );
  const purgeRecord = {
    schema_version: 1,
    project_id: record.project_id,
    project_name: record.project_name,
    site_key: record.site_key,
    project_path: record.project_path,
    source_archived: record.source_archived,
    archived_at: record.archived_at,
    purged_by: purgedBy,
    purged_at: new Date().toISOString(),
    azure_result: deleted
  };
  writeJson(
    resolve(config.stateDirectory, 'project-purge-records', record.site_key, `${record.project_name}-${archiveTimestamp()}.json`),
    purgeRecord
  );
  rmSync(record.archive_directory, { recursive: true, force: true });
  return { purged: true, project_name: record.project_name, site_key: record.site_key };
}

function staticResponse(request, response) {
  const definition = STATIC_FILES.get(new URL(request.url, 'http://localhost').pathname);
  if (!definition) return false;
  const [file, type] = definition;
  const path = resolve(PUBLIC_DIRECTORY, file);
  const stat = lstatSync(path);
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': type,
    'content-length': stat.size,
    'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY'
  });
  createReadStream(path).pipe(response);
  return true;
}

export function createAdminServer(config = loadAdminConfig()) {
  const loginAttempts = new Map();
  let activeOperation = null;

  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (request.method === 'GET' && url.pathname === '/healthz') {
        return json(response, 200, { status: 'ok', version: '4.2.0' });
      }
      if (request.method === 'POST' && url.pathname === '/api/login') {
        verifyOrigin(request, config);
        const client = (request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
        const attempts = loginAttempts.get(client) || [];
        const recent = attempts.filter((time) => time > Date.now() - 15 * 60_000);
        if (recent.length >= 10) return json(response, 429, { error: 'Too many login attempts. Try again later.' });
        const body = await readBody(request);
        const name = validateAdminName(body.name);
        if (!secureEqual(body.passphrase, config.adminUiToken)) {
          recent.push(Date.now());
          loginAttempts.set(client, recent);
          return json(response, 401, { error: 'The admin passphrase is not valid.' });
        }
        loginAttempts.delete(client);
        const token = createSession(name, config);
        const session = readSession({ headers: { cookie: `${COOKIE_NAME}=${token}` } }, config);
        return json(response, 200, { name: session.name, csrf: session.csrf }, {
          'set-cookie': sessionCookie(token, config)
        });
      }

      const session = readSession(request, config);
      if (url.pathname.startsWith('/api/')) {
        if (!session) return json(response, 401, { error: 'Admin sign-in is required.' });
        if (request.method !== 'GET') {
          verifyOrigin(request, config);
          verifyCsrf(request, session);
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/session') {
        return json(response, 200, { name: session.name, csrf: session.csrf });
      }
      if (request.method === 'POST' && url.pathname === '/api/logout') {
        return json(response, 200, { ok: true }, { 'set-cookie': sessionCookie('', config, 0) });
      }
      if (request.method === 'GET' && url.pathname === '/api/dashboard') {
        return json(response, 200, await dashboard(config));
      }
      if (request.method === 'POST' && url.pathname === '/api/projects') {
        if (activeOperation) return json(response, 409, { error: `Another operation is running: ${activeOperation}` });
        const body = await readBody(request);
        const siteKey = assertSiteKey(body.site_key);
        const folder = assertSimpleName(body.folder, 'Folder');
        const projectName = assertSimpleName(body.project_name || folder, 'Project name');
        const site = config.siteDefaults[siteKey];
        const source = assertContained(site.webRoot, resolve(site.webRoot, folder), 'Source folder');
        if (!existsSync(source) || !lstatSync(source).isDirectory()) {
          throw Object.assign(new Error('Source folder was not found.'), { status: 404 });
        }
        activeOperation = `adding ${siteKey}:${projectName}`;
        try {
          const result = await runScript(config, 'setup-product.js', [
            '--site', siteKey, '--source', source, '--name', projectName,
            '--web-root', site.webRoot, '--staging-root', site.stagingRoot,
            '--origin', site.origin, '--api-base', config.apiBase
          ]);
          return json(response, 201, result);
        } finally {
          activeOperation = null;
        }
      }

      const match = url.pathname.match(/^\/api\/projects\/(en|fr)\/([A-Za-z0-9][A-Za-z0-9._-]{0,79})\/(refresh|dry-run|publish|review|activity|archive)$/);
      if (match) {
        const [, siteKey, projectName, action] = match;
        const project = projectConfig(config, siteKey, projectName);
        if (action === 'activity' && request.method === 'GET') {
          if (!project.project_id) throw Object.assign(new Error('Project is not registered with Azure.'), { status: 409 });
          const activity = await apiRequest(
            config.apiBase,
            `/api/v1/projects/${encodeURIComponent(project.project_id)}/activity`,
            { token: config.adminToken }
          );
          return json(response, 200, activity);
        }
        if (action === 'activity') return json(response, 405, { error: 'Method not allowed.' });
        if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
        if (activeOperation) return json(response, 409, { error: `Another operation is running: ${activeOperation}` });
        const body = await readBody(request);
        if (action === 'review') {
          if (!['open', 'closed'].includes(body.review_status)) {
            throw Object.assign(new Error('review_status must be open or closed.'), { status: 400 });
          }
          const updated = await apiRequest(
            config.apiBase,
            `/api/v1/projects/${encodeURIComponent(project.project_id)}`,
            { method: 'PATCH', token: config.adminToken, body: { review_status: body.review_status } }
          );
          return json(response, 200, updated);
        }
        activeOperation = `${action} ${siteKey}:${projectName}`;
        try {
          if (action === 'refresh') {
            const result = await runScript(config, 'setup-product.js', [
              '--site', siteKey, '--source', project.source_path, '--name', projectName,
              '--web-root', project.web_root, '--staging-root', project.staging_root,
              '--origin', config.siteDefaults[siteKey].origin, '--api-base', config.apiBase, '--force'
            ]);
            return json(response, 200, result);
          }
          if (action === 'dry-run') {
            const result = await runScript(config, 'publish-product.js', ['--site', siteKey, '--name', projectName]);
            return json(response, 200, result);
          }
          if (action === 'archive') {
            if (body.confirmation !== projectName) {
              throw Object.assign(new Error(`Enter ${projectName} to confirm archival.`), { status: 400 });
            }
            if (body.archive_source !== undefined && typeof body.archive_source !== 'boolean') {
              throw Object.assign(new Error('archive_source must be a boolean.'), { status: 400 });
            }
            const result = await archiveProjectLifecycle(config, project, session.name, {
              archiveSource: Boolean(body.archive_source)
            });
            return json(response, 200, result);
          }
          if (body.confirmation !== projectName) {
            throw Object.assign(new Error(`Enter ${projectName} to confirm publication.`), { status: 400 });
          }
          const result = await runScript(config, 'publish-product.js', [
            '--site', siteKey, '--name', projectName, '--apply', '--published-by', session.name
          ]);
          return json(response, 200, result);
        } finally {
          activeOperation = null;
        }
      }

      const archiveMatch = url.pathname.match(/^\/api\/archives\/([A-Za-z0-9_-]{4,500})\/(restore|purge)$/);
      if (archiveMatch) {
        if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
        if (activeOperation) return json(response, 409, { error: `Another operation is running: ${activeOperation}` });
        const [, id, action] = archiveMatch;
        const record = archiveRecord(config, archiveDirectory(config, id));
        if (!record) throw Object.assign(new Error('Project archive was not found.'), { status: 404 });
        const body = await readBody(request);
        if (body.confirmation !== record.project_name) {
          throw Object.assign(new Error(`Enter ${record.project_name} to confirm ${action}.`), { status: 400 });
        }
        activeOperation = `${action} ${record.site_key}:${record.project_name}`;
        try {
          const result = action === 'restore'
            ? await restoreProjectLifecycle(config, record, session.name)
            : await purgeProjectLifecycle(config, record, session.name, body);
          return json(response, 200, result);
        } finally {
          activeOperation = null;
        }
      }

      if (request.method === 'GET' && staticResponse(request, response)) return;
      return json(response, 404, { error: 'Route not found.' });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) console.error('Admin request failed:', error);
      return json(response, status, {
        error: status >= 500 ? 'Admin operation failed.' : error.message,
        ...(status < 500 && error.details ? error.details : {})
      });
    }
  });
}

async function main() {
  const config = loadAdminConfig();
  const server = createAdminServer(config);
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolvePromise);
  });
  console.log(`Live Edits admin listening on http://${config.host}:${config.port}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Live Edits admin failed to start:', error.message);
    process.exitCode = 1;
  });
}
