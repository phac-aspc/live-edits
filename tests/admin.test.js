import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminServer } from '../admin/server.js';

const ADMIN = 'azure-admin-token-that-is-longer-than-thirty-two-characters';
const UI_TOKEN = 'console-passphrase-that-is-longer-than-thirty-two-characters';
const PROJECT_ID = 'c1d9f307-f8b6-4b75-8f74-bfbd02ce8dc2';

function listen(server) {
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server.address().port));
  });
}

test('admin console authenticates, discovers a product, and stages it without exposing the Azure token', async (context) => {
  const root = resolve(process.cwd(), 'state', 'tests');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(resolve(root, 'admin-'));
  const englishRoot = resolve(directory, 'wwwroot', 'en');
  const frenchRoot = resolve(directory, 'wwwroot', 'fr');
  const stagingRoot = resolve(directory, 'wwwroot', '_live-edits', 'v4');
  const stateRoot = resolve(directory, 'state');
  mkdirSync(resolve(englishRoot, 'demo'), { recursive: true });
  mkdirSync(frenchRoot, { recursive: true });
  writeFileSync(resolve(englishRoot, 'demo', 'index.html'), '<!doctype html><html><body><main><h1>Demo</h1></main></body></html>');

  const remoteProjects = [];
  const azure = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    assert.equal(request.headers.authorization, `Bearer ${ADMIN}`);
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && request.url === '/live-edits/api/v1/projects') {
      response.end(JSON.stringify(remoteProjects));
      return;
    }
    if (request.method === 'POST' && request.url === '/live-edits/api/v1/projects') {
      const project = {
        id: PROJECT_ID, ...body, status: 'active', review_status: 'open',
        created_at: Date.now(), updated_at: Date.now(), page_count: 0,
        unresolved_comments: 0, unpublished_pages: 0, last_edit_at: null, last_published_at: null
      };
      remoteProjects.push(project);
      response.statusCode = 201;
      response.end(JSON.stringify(project));
      return;
    }
    if (request.method === 'POST' && request.url === `/live-edits/api/v1/projects/${PROJECT_ID}/pages/register`) {
      remoteProjects[0].page_count = body.pages.length;
      response.end(JSON.stringify(body));
      return;
    }
    if (request.method === 'GET' && request.url === `/live-edits/api/v1/projects/${PROJECT_ID}/edits/latest`) {
      response.end('[]');
      return;
    }
    if (request.method === 'PATCH' && request.url === `/live-edits/api/v1/projects/${PROJECT_ID}`) {
      Object.assign(remoteProjects[0], body, { updated_at: Date.now() });
      response.end(JSON.stringify(remoteProjects[0]));
      return;
    }
    if (request.method === 'GET' && request.url === `/live-edits/api/v1/projects/${PROJECT_ID}/activity`) {
      response.end(JSON.stringify({ edits: [], comments: [], publishes: [] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found.' }));
  });
  const azurePort = await listen(azure);

  const config = {
    host: '127.0.0.1', port: 0,
    apiBase: `http://127.0.0.1:${azurePort}/live-edits`, adminToken: ADMIN, adminUiToken: UI_TOKEN,
    publicOrigin: 'https://en.infobase-dev.com', cookiePath: '/', sessionMinutes: 60,
    commandTimeoutMs: 30_000, stateDirectory: stateRoot,
    siteDefaults: {
      en: { origin: 'https://en.infobase-dev.com', webRoot: englishRoot, stagingRoot },
      fr: { origin: 'https://fr.infobase-dev.com', webRoot: frenchRoot, stagingRoot }
    }
  };
  const admin = createAdminServer(config);
  const adminPort = await listen(admin);
  const base = `http://127.0.0.1:${adminPort}`;
  context.after(() => {
    admin.close();
    azure.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.csrf ? { 'x-live-edits-csrf': options.csrf } : {}),
        ...(options.body ? { 'content-type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };

  assert.equal((await request('/api/session')).status, 401);
  assert.equal((await request('/api/login', {
    method: 'POST', body: { name: 'Administrator', passphrase: UI_TOKEN }
  })).status, 403);

  const login = await request('/api/login', {
    method: 'POST', origin: config.publicOrigin,
    body: { name: 'Administrator', passphrase: UI_TOKEN }
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.doesNotMatch(cookie, new RegExp(ADMIN));

  const firstDashboard = await request('/api/dashboard', { cookie });
  assert.equal(firstDashboard.status, 200);
  assert.equal(firstDashboard.body.candidates[0].folder, 'demo');
  assert.equal(firstDashboard.body.projects.length, 0);

  assert.equal((await request('/api/projects', {
    method: 'POST', origin: config.publicOrigin, cookie,
    body: { site_key: 'en', folder: 'demo' }
  })).status, 403);

  const added = await request('/api/projects', {
    method: 'POST', origin: config.publicOrigin, cookie, csrf: login.body.csrf,
    body: { site_key: 'en', folder: 'demo' }
  });
  assert.equal(added.status, 201);
  assert.match(added.body.stdout, /Registered project/);
  assert.equal(existsSync(resolve(stagingRoot, 'products', 'en', 'demo', 'index.html')), true);
  const privateConfig = readFileSync(resolve(stateRoot, 'projects', 'en', 'demo.json'), 'utf8');
  assert.match(privateConfig, new RegExp(PROJECT_ID));
  assert.doesNotMatch(privateConfig, new RegExp(ADMIN));

  const secondDashboard = await request('/api/dashboard', { cookie });
  assert.equal(secondDashboard.body.candidates.length, 0);
  assert.equal(secondDashboard.body.projects[0].state, 'ready');

  const dryRun = await request('/api/projects/en/demo/dry-run', {
    method: 'POST', origin: config.publicOrigin, cookie, csrf: login.body.csrf, body: {}
  });
  assert.equal(dryRun.status, 200);
  assert.match(dryRun.body.stdout, /No unpublished content changes/);

  const rejectedPublish = await request('/api/projects/en/demo/publish', {
    method: 'POST', origin: config.publicOrigin, cookie, csrf: login.body.csrf,
    body: { confirmation: 'wrong-project' }
  });
  assert.equal(rejectedPublish.status, 400);

  const closed = await request('/api/projects/en/demo/review', {
    method: 'POST', origin: config.publicOrigin, cookie, csrf: login.body.csrf,
    body: { review_status: 'closed' }
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.review_status, 'closed');

  const activity = await request('/api/projects/en/demo/activity', { cookie });
  assert.equal(activity.status, 200);
  assert.deepEqual(activity.body, { edits: [], comments: [], publishes: [] });
});
