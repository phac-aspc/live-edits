import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import express from '../server/node_modules/express/index.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initDatabase } from '../server/src/database.js';
import { createRoutes } from '../server/src/routes.js';
import { requireAuth } from '../server/src/security.js';

const ADMIN = 'publisher-admin-token-longer-than-thirty-two-characters';
const EDITOR = 'publisher-editor-token-longer-than-thirty-two-characters';

function runNode(argumentsList, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, argumentsList, options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`Command failed (${code}): ${stderr}`));
    });
  });
}

test('setup, save, dry run, and safe publish operate end to end', async (context) => {
  const testRoot = resolve(process.cwd(), 'state', 'tests');
  mkdirSync(testRoot, { recursive: true });
  const directory = mkdtempSync(resolve(testRoot, 'publish-'));
  const state = resolve(directory, 'state');
  const webRoot = resolve(directory, 'wwwroot', 'en');
  const stagingRoot = resolve(directory, 'wwwroot', '_live-edits', 'v4');
  const source = resolve(webRoot, 'demo');
  mkdirSync(source, { recursive: true });
  const original = '<!doctype html><html><head><title>Demo</title></head><body><main><h1>Original</h1><p>Source text.</p></main></body></html>';
  writeFileSync(resolve(source, 'index.html'), original);

  const serverConfig = {
    dbPath: resolve(directory, 'api.db'), authMode: 'token', adminToken: ADMIN, editorToken: EDITOR,
    maxEditBytes: 1_000_000, historyLimit: 25
  };
  const db = await initDatabase(serverConfig);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createRoutes(
    db, serverConfig, requireAuth(serverConfig, 'editor'), requireAuth(serverConfig, 'admin')
  ));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    response.status(error.status || 500).json({ error: error.message, ...(error.details || {}) });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolvePromise) => server.once('listening', resolvePromise));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  context.after(() => {
    server.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const environment = {
    ...process.env,
    LIVE_EDITS_STATE_DIR: state,
    LIVE_EDITS_ADMIN_TOKEN: ADMIN
  };
  await runNode([
    'scripts/setup-product.js', '--site', 'en', '--source', source, '--web-root', webRoot,
    '--staging-root', stagingRoot, '--origin', 'https://en.infobase-dev.com', '--api-base', apiBase
  ], { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });

  const projectConfig = JSON.parse(readFileSync(resolve(state, 'projects', 'en', 'demo.json'), 'utf8'));
  const keys = projectConfig.page_manifests[0].element_keys;
  const elements = Object.fromEntries(keys.map((key, index) => [key, index ? 'Published source text.' : 'Published heading']));
  const saveResponse = await fetch(`${apiBase}/api/v1/projects/${projectConfig.project_id}/edits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${EDITOR}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      page_path: '/demo/index.html', base_revision: 0, edited_by: 'Integration test',
      payload: { version: 1, elements }
    })
  });
  assert.equal(saveResponse.status, 201);

  const dryRun = await runNode([
    'scripts/publish-product.js', '--site', 'en', '--name', 'demo'
  ], { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(dryRun, /Dry run: 1 page/);
  assert.equal(readFileSync(resolve(source, 'index.html'), 'utf8'), original);

  await runNode([
    'scripts/publish-product.js', '--site', 'en', '--name', 'demo', '--apply', '--published-by', 'Test release'
  ], { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const published = readFileSync(resolve(source, 'index.html'), 'utf8');
  assert.match(published, /Published heading/);
  assert.match(published, /Published source text/);
  assert.match(published, /data-live-edits-key/);
  assert.doesNotMatch(published, /data-live-edits-bootstrap|editor\.js/);
  assert.equal(existsSync(resolve(state, 'publish-backups', 'en', 'demo')), true);

  const pending = await fetch(`${apiBase}/api/v1/projects/${projectConfig.project_id}/edits/latest`, {
    headers: { authorization: `Bearer ${ADMIN}` }
  }).then((response) => response.json());
  assert.deepEqual(pending, []);
});
