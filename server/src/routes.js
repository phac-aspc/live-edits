import { Router } from 'express';
import { generateId } from './database.js';
import {
  contentHash,
  httpError,
  validateCommentPosition,
  validateEditPayload,
  validateElementKey,
  validateId,
  validateName,
  validateOrigin,
  validatePath,
  validateSiteKey
} from './security.js';

function pageRoom(projectId, pagePath) {
  return `page:${projectId}:${pagePath}`;
}

function assertPageInProject(project, pagePath) {
  const normalized = validatePath(pagePath, 'page_path');
  if (project.project_path !== '/' && normalized !== project.project_path && !normalized.startsWith(`${project.project_path}/`)) {
    httpError('page_path is outside this project.', 400);
  }
  return normalized;
}

function projectOr404(db, projectId) {
  validateId(projectId, 'project id');
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND status = ?').get(projectId, 'active');
  if (!project) httpError('Project not found.', 404);
  return project;
}

function pageRegistrationOr404(db, project, pagePath) {
  const normalized = assertPageInProject(project, pagePath);
  const page = db.prepare('SELECT * FROM project_pages WHERE project_id = ? AND page_path = ?')
    .get(project.id, normalized);
  if (!page) httpError('Page is not registered. Run setup for this project again.', 404);
  return { ...page, element_keys: JSON.parse(page.element_keys) };
}

function editResponse(row) {
  return row ? { ...row, payload: JSON.parse(row.payload) } : null;
}

function emit(request, room, event, body) {
  request.app.locals.io?.to(room).emit(event, body);
}

export function createRoutes(db, config, editorAuth, adminAuth) {
  const router = Router();

  router.get('/projects', adminAuth, (request, response) => {
    const projects = db.prepare('SELECT * FROM projects ORDER BY site_key, name').all();
    response.json(projects);
  });

  router.post('/projects', adminAuth, (request, response) => {
    const siteKey = validateSiteKey(request.body?.site_key);
    const projectPath = validatePath(request.body?.project_path, 'project_path');
    const name = validateName(request.body?.name, 'name', 80);
    const origin = validateOrigin(request.body?.origin);
    const now = Date.now();
    const existing = db.prepare('SELECT * FROM projects WHERE site_key = ? AND project_path = ?').get(siteKey, projectPath);
    if (existing) {
      db.prepare('UPDATE projects SET name = ?, origin = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(name, origin, 'active', now, existing.id);
      return response.json({ ...existing, name, origin, status: 'active', updated_at: now });
    }
    const project = {
      id: generateId(), site_key: siteKey, project_path: projectPath, name, origin,
      status: 'active', created_at: now, updated_at: now
    };
    db.prepare(`
      INSERT INTO projects (id, site_key, project_path, name, origin, status, created_at, updated_at)
      VALUES (@id, @site_key, @project_path, @name, @origin, @status, @created_at, @updated_at)
    `).run(project);
    return response.status(201).json(project);
  });

  router.get('/projects/lookup', editorAuth, (request, response) => {
    const siteKey = validateSiteKey(request.query.site_key);
    const projectPath = validatePath(request.query.project_path, 'project_path');
    const project = db.prepare(`
      SELECT id, site_key, project_path, name, origin, status, created_at, updated_at
      FROM projects WHERE site_key = ? AND project_path = ? AND status = 'active'
    `).get(siteKey, projectPath);
    if (!project) httpError('Project not found.', 404);
    response.json(project);
  });

  router.post('/projects/:projectId/pages/register', adminAuth, (request, response) => {
    const project = projectOr404(db, request.params.projectId);
    if (!Array.isArray(request.body?.pages) || request.body.pages.length < 1 || request.body.pages.length > 5000) {
      httpError('pages must contain 1 to 5000 page manifests.');
    }
    const now = Date.now();
    const pages = request.body.pages.map((page) => {
      const pagePath = assertPageInProject(project, page?.page_path);
      if (!Array.isArray(page?.element_keys) || page.element_keys.length < 1 || page.element_keys.length > 2000) {
        httpError(`Invalid element_keys for ${pagePath}.`);
      }
      const elementKeys = [...new Set(page.element_keys.map(validateElementKey))].sort();
      if (elementKeys.length !== page.element_keys.length) httpError(`Duplicate element key in ${pagePath}.`);
      const elementKeysJson = JSON.stringify(elementKeys);
      return {
        project_id: project.id, page_path: pagePath,
        manifest_hash: contentHash(elementKeysJson), element_keys: elementKeysJson, updated_at: now
      };
    });
    const upsert = db.prepare(`
      INSERT INTO project_pages (project_id, page_path, manifest_hash, element_keys, updated_at)
      VALUES (@project_id, @page_path, @manifest_hash, @element_keys, @updated_at)
      ON CONFLICT(project_id, page_path) DO UPDATE SET
        manifest_hash = excluded.manifest_hash,
        element_keys = excluded.element_keys,
        updated_at = excluded.updated_at
    `);
    db.transaction(() => pages.forEach((page) => upsert.run(page)))();
    response.json({ pages: pages.map((page) => ({ ...page, element_keys: JSON.parse(page.element_keys) })) });
  });

  router.get('/projects/:projectId/pages/latest', editorAuth, (request, response) => {
    const project = projectOr404(db, request.params.projectId);
    const page = pageRegistrationOr404(db, project, request.query.page_path);
    const latest = db.prepare(`
      SELECT * FROM edits WHERE project_id = ? AND page_path = ? ORDER BY revision DESC LIMIT 1
    `).get(project.id, page.page_path);
    const compatible = latest?.manifest_hash === page.manifest_hash ? latest : null;
    response.json(editResponse(compatible) || {
      project_id: project.id,
      page_path: page.page_path,
      payload_version: 1,
      payload: { version: 1, elements: {} },
      manifest_hash: page.manifest_hash,
      revision: latest?.revision || 0,
      created_at: null,
      edited_by: null,
      stale: Boolean(latest)
    });
  });

  router.get('/projects/:projectId/pages/history', editorAuth, (request, response) => {
    const project = projectOr404(db, request.params.projectId);
    const page = pageRegistrationOr404(db, project, request.query.page_path);
    const requestedLimit = Number.parseInt(request.query.limit || config.historyLimit, 10);
    const limit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : config.historyLimit, 1), config.historyLimit);
    const rows = db.prepare(`
      SELECT * FROM edits
      WHERE project_id = ? AND page_path = ? AND manifest_hash = ?
      ORDER BY revision DESC LIMIT ?
    `).all(project.id, page.page_path, page.manifest_hash, limit);
    response.json(rows.map(editResponse));
  });

  router.post('/projects/:projectId/edits', editorAuth, (request, response) => {
    const project = projectOr404(db, request.params.projectId);
    const page = pageRegistrationOr404(db, project, request.body?.page_path);
    const pagePath = page.page_path;
    const editedBy = validateName(request.body?.edited_by, 'edited_by', 100);
    const baseRevision = Number(request.body?.base_revision);
    if (!Number.isInteger(baseRevision) || baseRevision < 0) httpError('base_revision must be a nonnegative integer.');
    const { payload, json } = validateEditPayload(request.body?.payload, config.maxEditBytes);
    const actualKeys = Object.keys(payload.elements).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(page.element_keys)) {
      httpError('payload keys do not match the registered page manifest. Refresh the staged page.', 409);
    }

    const save = db.transaction(() => {
      const latest = db.prepare(`
        SELECT * FROM edits WHERE project_id = ? AND page_path = ? ORDER BY revision DESC LIMIT 1
      `).get(project.id, pagePath);
      const currentRevision = latest?.revision || 0;
      if (baseRevision !== currentRevision) {
        const error = new Error('The page was changed by another editor.');
        error.status = 409;
        error.details = { latest: editResponse(latest) };
        throw error;
      }
      const row = {
        id: generateId(), project_id: project.id, page_path: pagePath, manifest_hash: page.manifest_hash,
        payload_version: payload.version, payload: json, content_hash: contentHash(json),
        edited_by: editedBy, revision: currentRevision + 1, created_at: Date.now(), published_at: null
      };
      db.prepare(`
        INSERT INTO edits (
          id, project_id, page_path, manifest_hash, payload_version, payload, content_hash,
          edited_by, revision, created_at, published_at
        ) VALUES (
          @id, @project_id, @page_path, @manifest_hash, @payload_version, @payload, @content_hash,
          @edited_by, @revision, @created_at, @published_at
        )
      `).run(row);
      return row;
    });

    const saved = editResponse(save());
    emit(request, pageRoom(project.id, pagePath), 'edit-saved', saved);
    response.status(201).json(saved);
  });

  router.get('/projects/:projectId/edits/latest', adminAuth, (request, response) => {
    const project = projectOr404(db, request.params.projectId);
    const rows = db.prepare(`
      SELECT e.* FROM edits e
      JOIN project_pages page
        ON page.project_id = e.project_id
        AND page.page_path = e.page_path
        AND page.manifest_hash = e.manifest_hash
      WHERE e.project_id = ? AND e.published_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM edits newer
          WHERE newer.project_id = e.project_id
            AND newer.page_path = e.page_path
            AND newer.revision > e.revision
        )
      ORDER BY e.page_path
    `).all(project.id);
    response.json(rows.map(editResponse));
  });

  router.post('/projects/:projectId/publish', adminAuth, (request, response) => {
    const project = projectOr404(db, request.params.projectId);
    const operationId = validateId(request.body?.operation_id, 'operation_id');
    const publishedBy = validateName(request.body?.published_by, 'published_by', 100);
    const existingEvent = db.prepare('SELECT * FROM publish_events WHERE operation_id = ? AND project_id = ?')
      .get(operationId, project.id);
    if (existingEvent) {
      return response.json({ ...existingEvent, pages: JSON.parse(existingEvent.pages), replayed: true });
    }
    if (!Array.isArray(request.body?.pages) || request.body.pages.length < 1 || request.body.pages.length > 1000) {
      httpError('pages must contain 1 to 1000 published page revisions.');
    }
    const pages = request.body.pages.map((page) => {
      const pagePath = assertPageInProject(project, page?.page_path);
      const revision = Number(page?.revision);
      if (!Number.isInteger(revision) || revision < 1) httpError('Each published revision must be a positive integer.');
      return { page_path: pagePath, revision };
    });
    const now = Date.now();
    const event = db.transaction(() => {
      for (const page of pages) {
        const result = db.prepare(`
          UPDATE edits SET published_at = ?
          WHERE project_id = ? AND page_path = ? AND revision = ? AND published_at IS NULL
        `).run(now, project.id, page.page_path, page.revision);
        if (result.changes !== 1) httpError(`Edit revision not found: ${page.page_path} r${page.revision}.`, 409);
      }
      const audit = {
        id: generateId(), operation_id: operationId, project_id: project.id, published_by: publishedBy,
        pages: JSON.stringify(pages), created_at: now
      };
      db.prepare(`
        INSERT INTO publish_events (id, operation_id, project_id, published_by, pages, created_at)
        VALUES (@id, @operation_id, @project_id, @published_by, @pages, @created_at)
      `).run(audit);
      return audit;
    })();
    response.status(201).json({ ...event, pages });
  });

  router.get('/projects/:projectId/comments', editorAuth, (request, response) => {
    const project = projectOr404(db, request.params.projectId);
    const pagePath = pageRegistrationOr404(db, project, request.query.page_path).page_path;
    const comments = db.prepare(`
      SELECT * FROM comments WHERE project_id = ? AND page_path = ? ORDER BY resolved, created_at
    `).all(project.id, pagePath).map((comment) => ({ ...comment, resolved: Boolean(comment.resolved) }));
    response.json(comments);
  });

  router.post('/projects/:projectId/comments', editorAuth, (request, response) => {
    const project = projectOr404(db, request.params.projectId);
    const page = pageRegistrationOr404(db, project, request.body?.page_path);
    const pagePath = page.page_path;
    const elementKey = validateElementKey(request.body?.element_key);
    if (!page.element_keys.includes(elementKey)) httpError('element_key is not registered for this page.', 409);
    const now = Date.now();
    const comment = {
      id: generateId(), project_id: project.id, page_path: pagePath,
      element_key: elementKey,
      offset_x: validateCommentPosition(request.body?.offset_x, 'offset_x'),
      offset_y: validateCommentPosition(request.body?.offset_y, 'offset_y'),
      comment_text: validateName(request.body?.comment_text, 'comment_text', 2000),
      author: validateName(request.body?.author, 'author', 100),
      resolved: 0, created_at: now, updated_at: now
    };
    db.prepare(`
      INSERT INTO comments (
        id, project_id, page_path, element_key, offset_x, offset_y,
        comment_text, author, resolved, created_at, updated_at
      ) VALUES (
        @id, @project_id, @page_path, @element_key, @offset_x, @offset_y,
        @comment_text, @author, @resolved, @created_at, @updated_at
      )
    `).run(comment);
    const body = { ...comment, resolved: false };
    emit(request, pageRoom(project.id, pagePath), 'comment-created', body);
    response.status(201).json(body);
  });

  router.patch('/projects/:projectId/comments/:commentId', editorAuth, (request, response) => {
    const project = projectOr404(db, request.params.projectId);
    const commentId = validateId(request.params.commentId, 'comment id');
    if (typeof request.body?.resolved !== 'boolean') httpError('resolved must be a boolean.');
    const current = db.prepare('SELECT * FROM comments WHERE id = ? AND project_id = ?').get(commentId, project.id);
    if (!current) httpError('Comment not found.', 404);
    db.prepare('UPDATE comments SET resolved = ?, updated_at = ? WHERE id = ?')
      .run(request.body.resolved ? 1 : 0, Date.now(), commentId);
    const updated = { ...current, resolved: request.body.resolved, updated_at: Date.now() };
    emit(request, pageRoom(project.id, current.page_path), 'comment-updated', updated);
    response.json(updated);
  });

  return router;
}
