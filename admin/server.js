#!/usr/bin/env node

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, resolve } from 'node:path';
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
  toUrlPath
} from '../scripts/runtime.js';

const PUBLIC_DIRECTORY = resolve(REPO_ROOT, 'admin', 'public');
const COOKIE_NAME = 'live_edits_admin_session';
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
  const projects = localProjects.map((local) => {
    const remote = remoteById.get(local.project_id) || remoteByPath.get(`${local.site_key}:${local.project_path}`) || null;
    return {
      ...local,
      source_state: sourceState(local),
      remote,
      state: local.local_error ? 'invalid-local-config' : (remote ? 'ready' : 'not-registered')
    };
  });
  const localIds = new Set(localProjects.map((project) => project.project_id).filter(Boolean));
  for (const remote of remoteProjects) {
    if (!localIds.has(remote.id) && !configured.has(`${remote.site_key}:${remote.project_path}`)) {
      projects.push({
        project_name: remote.name, site_key: remote.site_key, project_path: remote.project_path,
        remote, state: 'remote-only', source_state: 'unknown'
      });
    }
  }
  return {
    generated_at: new Date().toISOString(),
    api: { ok: !apiError, error: apiError },
    candidates: candidates.filter((candidate) => !configured.has(`${candidate.site_key}:${candidate.project_path}`)),
    projects: projects.sort((a, b) => `${a.site_key}:${a.project_name}`.localeCompare(`${b.site_key}:${b.project_name}`))
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
        return json(response, 200, { status: 'ok', version: '4.1.0' });
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

      const match = url.pathname.match(/^\/api\/projects\/(en|fr)\/([A-Za-z0-9][A-Za-z0-9._-]{0,79})\/(refresh|dry-run|publish|review|activity)$/);
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

      if (request.method === 'GET' && staticResponse(request, response)) return;
      return json(response, 404, { error: 'Route not found.' });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) console.error('Admin request failed:', error);
      return json(response, status, { error: status >= 500 ? 'Admin operation failed.' : error.message });
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
