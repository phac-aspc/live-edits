import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initDatabase } from '../src/database.js';
import { createRoutes } from '../src/routes.js';
import { requireAuth } from '../src/security.js';

const ADMIN = 'admin-token-that-is-longer-than-thirty-two-characters';
const EDITOR = 'editor-token-that-is-longer-than-thirty-two-characters';

test('API enforces roles, sanitizes edits, detects conflicts, and audits publish', async (context) => {
  const temporaryRoot = resolve(process.cwd(), '..', 'state', 'tests');
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(resolve(temporaryRoot, 'live-edits-test-'));
  const config = {
    dbPath: resolve(directory, 'test.db'), authMode: 'token', adminToken: ADMIN, editorToken: EDITOR,
    maxEditBytes: 1_000_000, historyLimit: 25
  };
  const db = await initDatabase(config);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createRoutes(db, config, requireAuth(config, 'editor'), requireAuth(config, 'admin')));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    response.status(error.status || 500).json({ error: error.message, ...(error.details || {}) });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolvePromise) => server.once('listening', resolvePromise));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  context.after(() => {
    server.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const request = async (path, token, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers: { authorization: `Bearer ${token}`, ...(options.body ? { 'content-type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, body: await response.json() };
  };

  assert.equal((await request('/projects', EDITOR)).status, 401);
  const created = await request('/projects', ADMIN, {
    method: 'POST', body: { site_key: 'en', project_path: '/demo', name: 'demo', origin: 'https://en.infobase-dev.com' }
  });
  assert.equal(created.status, 201);
  const projectId = created.body.id;
  const registered = await request(`/projects/${projectId}/pages/register`, ADMIN, {
    method: 'POST', body: { pages: [{ page_path: '/demo/index.html', element_keys: ['intro'] }] }
  });
  assert.equal(registered.status, 200);

  const lookup = await request('/projects/lookup?site_key=en&project_path=%2Fdemo', EDITOR);
  assert.equal(lookup.body.id, projectId);
  const latest = await request(`/projects/${projectId}/pages/latest?page_path=%2Fdemo%2Findex.html`, EDITOR);
  assert.equal(latest.body.revision, 0);

  const editBody = {
    page_path: '/demo/index.html', base_revision: 0, edited_by: 'Tester',
    payload: { version: 1, elements: { intro: '<strong onclick="bad()">Safe</strong><script>bad()</script>' } }
  };
  const saved = await request(`/projects/${projectId}/edits`, EDITOR, { method: 'POST', body: editBody });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.payload.elements.intro, '<strong>Safe</strong>');

  const conflict = await request(`/projects/${projectId}/edits`, EDITOR, { method: 'POST', body: editBody });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.latest.revision, 1);

  const exportResult = await request(`/projects/${projectId}/edits/latest`, ADMIN);
  assert.equal(exportResult.body.length, 1);
  const operationId = randomUUID();
  const publishBody = {
    operation_id: operationId, published_by: 'Release manager',
    pages: [{ page_path: '/demo/index.html', revision: 1 }]
  };
  const published = await request(`/projects/${projectId}/publish`, ADMIN, {
    method: 'POST', body: {
      ...publishBody
    }
  });
  assert.equal(published.status, 201);
  const replayed = await request(`/projects/${projectId}/publish`, ADMIN, { method: 'POST', body: publishBody });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal((await request(`/projects/${projectId}/edits/latest`, ADMIN)).body.length, 0);

  const comment = await request(`/projects/${projectId}/comments`, EDITOR, {
    method: 'POST', body: {
      page_path: '/demo/index.html', element_key: 'intro', offset_x: 0.5, offset_y: 0.25,
      comment_text: 'Please review.', author: 'Tester'
    }
  });
  assert.equal(comment.status, 201);
  assert.equal(comment.body.element_key, 'intro');
});

test('network editor mode requires self-reported identity and respects review closure', async (context) => {
  const temporaryRoot = resolve(process.cwd(), '..', 'state', 'tests');
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(resolve(temporaryRoot, 'live-edits-network-test-'));
  const config = {
    dbPath: resolve(directory, 'test.db'), authMode: 'token', editorAuthMode: 'network',
    adminToken: ADMIN, editorToken: null, maxEditBytes: 1_000_000, historyLimit: 25
  };
  const db = await initDatabase(config);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createRoutes(db, config, requireAuth(config, 'editor'), requireAuth(config, 'admin')));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    response.status(error.status || 500).json({ error: error.message, ...(error.details || {}) });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolvePromise) => server.once('listening', resolvePromise));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  context.after(() => {
    server.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const request = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.admin ? { authorization: `Bearer ${ADMIN}` } : {}),
        ...(options.identity ? {
          'x-live-edits-name': options.identity.name,
          'x-live-edits-email': options.identity.email
        } : {}),
        ...(options.body ? { 'content-type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, body: await response.json() };
  };

  const authConfig = await request('/auth/config');
  assert.equal(authConfig.status, 200);
  assert.equal(authConfig.body.editor_auth_mode, 'network');

  const created = await request('/projects', {
    method: 'POST', admin: true,
    body: { site_key: 'en', project_path: '/network-demo', name: 'network-demo', origin: 'https://en.infobase-dev.com' }
  });
  const projectId = created.body.id;
  await request(`/projects/${projectId}/pages/register`, {
    method: 'POST', admin: true,
    body: { pages: [{ page_path: '/network-demo/index.html', element_keys: ['intro'] }] }
  });

  assert.equal((await request('/projects/lookup?site_key=en&project_path=%2Fnetwork-demo')).status, 400);
  const identity = { name: 'Program Reviewer', email: 'Reviewer@Example.ca' };
  assert.equal((await request('/projects/lookup?site_key=en&project_path=%2Fnetwork-demo', { identity })).status, 200);

  const saved = await request(`/projects/${projectId}/edits`, {
    method: 'POST', identity,
    body: {
      page_path: '/network-demo/index.html', base_revision: 0, edited_by: 'Spoofed name',
      payload: { version: 1, elements: { intro: 'Reviewed content' } }
    }
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.edited_by, 'Program Reviewer');
  assert.equal(Object.hasOwn(saved.body, 'edited_email'), false);
  assert.equal(db.prepare('SELECT edited_email FROM edits WHERE id = ?').get(saved.body.id).edited_email, 'reviewer@example.ca');

  const closed = await request(`/projects/${projectId}`, {
    method: 'PATCH', admin: true, body: { review_status: 'closed' }
  });
  assert.equal(closed.body.review_status, 'closed');
  assert.equal((await request('/projects/lookup?site_key=en&project_path=%2Fnetwork-demo', { identity })).status, 404);
});
