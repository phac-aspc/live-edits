import { generateId } from './database.js';
import {
  validateProjectInput,
  validateEditInput,
  validateCommentInput,
  validateUUID,
  validatePath,
  sanitizeError
} from './security.js';

/**
 * API Routes for Express server
 */
export function setupRoutes(app, db) {
  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Debug route to see what Express receives
  app.get('/debug', (req, res) => {
    res.json({
      url: req.url,
      originalUrl: req.originalUrl,
      path: req.path,
      baseUrl: req.baseUrl,
      method: req.method
    });
  });

  // Get all projects (handle both with and without trailing slash)
  app.get('/projects', (req, res) => {
    try {
      const getAllProjects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
      const projects = getAllProjects.all();
      res.json(projects);
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to get projects');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/projects/', (req, res) => {
    try {
      const getAllProjects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
      const projects = getAllProjects.all();
      res.json(projects);
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to get projects');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Register a new project
  app.post('/projects', (req, res) => {
    // Validate and sanitize input
    const validation = validateProjectInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.errors.join(', ') });
    }

    const { folder_path, name } = validation.sanitized;
    
    try {
      const projectId = generateId();
      const now = Date.now();

      const insert = db.prepare(`
        INSERT INTO projects (id, folder_path, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      insert.run(projectId, folder_path, name, now, now);

      res.json({
        id: projectId,
        folder_path,
        name,
        created_at: now
      });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // Project already exists, return existing
        const getProject = db.prepare('SELECT * FROM projects WHERE folder_path = ?');
        const project = getProject.get(folder_path);
        return res.json(project);
      }
      const errorMessage = sanitizeError(error, 'Failed to register project');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get project by folder path (using regex to handle paths with slashes)
  // This route must come AFTER /projects (the list route) but BEFORE other routes
  app.get(/^\/projects\/(.+)$/, (req, res) => {
    try {
      console.log('Project route matched:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
      
      // Extract folder path from the URL path
      // Try req.path first (Express may have decoded it), then fallback to req.url
      let match = req.path.match(/^\/projects\/(.+)$/);
      if (!match) {
        match = req.url.match(/^\/projects\/(.+)$/);
      }
      if (!match && req.originalUrl) {
        match = req.originalUrl.match(/^\/projects\/(.+)$/);
      }
      
      if (!match || !match[1]) {
        console.log('No match found:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
        return res.status(400).json({ error: 'folder_path is required', path: req.path, url: req.url, originalUrl: req.originalUrl });
      }
      
      let folderPath = decodeURIComponent(match[1]);
      console.log('Decoded folder path (before normalization):', folderPath);
      
      // Use same sanitization as POST to ensure consistency
      // Remove path traversal attempts
      folderPath = folderPath.replace(/\.\./g, '');
      // Remove dangerous characters
      folderPath = folderPath.replace(/[<>:"|?*\x00-\x1f]/g, '');
      // Normalize slashes
      folderPath = folderPath.replace(/\\/g, '/');
      folderPath = folderPath.replace(/\/+/g, '/');
      // Remove leading/trailing slashes then ensure leading slash
      folderPath = folderPath.replace(/^\/+|\/+$/g, '');
      if (!folderPath.startsWith('/')) {
        folderPath = '/' + folderPath;
      }
      console.log('Normalized folder path:', folderPath);
      
      const getProject = db.prepare('SELECT * FROM projects WHERE folder_path = ?');
      let project = getProject.get(folderPath);

      if (!project) {
        console.log('Project not found in database for path:', folderPath);
        // Try without leading slash as fallback (for backwards compatibility)
        const folderPathNoSlash = folderPath.startsWith('/') ? folderPath.slice(1) : folderPath;
        project = getProject.get(folderPathNoSlash);
        if (project) {
          console.log('Project found without leading slash');
          return res.json(project);
        }
        // Try with original decoded path (for backwards compatibility with existing data)
        const originalPath = decodeURIComponent(match[1]);
        project = getProject.get(originalPath);
        if (project) {
          console.log('Project found with original path format');
          return res.json(project);
        }
        // Try original path without leading slash
        const originalPathNoSlash = originalPath.startsWith('/') ? originalPath.slice(1) : originalPath;
        project = getProject.get(originalPathNoSlash);
        if (project) {
          console.log('Project found with original path format (no leading slash)');
          return res.json(project);
        }
        return res.status(404).json({ error: 'Project not found' });
      }

      console.log('Project found:', project.id);
      res.json(project);
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to get project');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Save edit (latest HTML content for a page)
  app.post('/edits', (req, res) => {
    try {
      // Validate and sanitize input
      const validation = validateEditInput(req.body);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join(', ') });
      }

      const { project_id, page_path, html_content, edited_by } = validation.sanitized;

      console.log('Saving edit:', {
        project_id,
        page_path,
        contentLength: html_content.length,
        edited_by
      });

      const editId = generateId();
      const now = Date.now();

      const insert = db.prepare(`
        INSERT INTO edits (id, project_id, page_path, html_content, edited_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      insert.run(editId, project_id, page_path, html_content, edited_by, now);
      
      console.log('Edit saved successfully:', { id: editId, page_path, created_at: now });

      res.json({
        id: editId,
        project_id,
        page_path,
        edited_by,
        created_at: now
      });
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to save edit');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get edit history for a specific page (all edits, not just latest)
  // MUST come BEFORE the general /edits/:projectId/:pagePath route
  app.get(/^\/edits\/history\/(.+)$/, (req, res) => {
    try {
      console.log('History route matched:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
      
      // Extract everything after /edits/history/
      let afterHistory = null;
      let match = req.path.match(/^\/edits\/history\/(.+)$/);
      if (match) {
        afterHistory = match[1];
      } else {
        match = req.url.match(/^\/edits\/history\/(.+)$/);
        if (match) afterHistory = match[1];
      }
      if (!afterHistory && req.originalUrl) {
        match = req.originalUrl.match(/^\/edits\/history\/(.+)$/);
        if (match) afterHistory = match[1];
      }
      
      if (!afterHistory) {
        console.log('No match found in history route:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
        return res.status(400).json({ error: 'Invalid history route format', path: req.path, url: req.url, originalUrl: req.originalUrl });
      }
      
      // Decode and normalize the path
      afterHistory = decodeURIComponent(afterHistory);
      // Handle double slashes and normalize
      afterHistory = afterHistory.replace(/^\/+/, '/');
      
      // Split on first slash: projectId/pagePath
      const firstSlashIndex = afterHistory.indexOf('/');
      if (firstSlashIndex === -1) {
        return res.status(400).json({ error: 'Invalid format: expected projectId/pagePath' });
      }
      
      const projectId = afterHistory.substring(0, firstSlashIndex);
      let decodedPagePath = afterHistory.substring(firstSlashIndex);
      
      // Validate projectId (UUID)
      const projectIdValidation = validateUUID(projectId, 'projectId');
      if (!projectIdValidation.valid) {
        return res.status(400).json({ error: projectIdValidation.error });
      }
      
      // Validate and sanitize page path
      const pagePathValidation = validatePath(decodedPagePath, 'page_path');
      if (!pagePathValidation.valid) {
        return res.status(400).json({ error: pagePathValidation.error });
      }
      
      decodedPagePath = pagePathValidation.sanitized;
      console.log('Getting edit history:', { projectId, decodedPagePath });

      // Get last 5 edits with full content for revert functionality
      const getAllEdits = db.prepare(`
        SELECT id, project_id, page_path, edited_by, created_at, html_content, LENGTH(html_content) as content_length
        FROM edits 
        WHERE project_id = ? AND page_path = ?
        ORDER BY created_at DESC
        LIMIT 5
      `);

      const edits = getAllEdits.all(projectId, decodedPagePath);
      
      console.log('Found edits:', edits.length);
      
      // Try without leading slash as fallback
      if (edits.length === 0 && decodedPagePath.startsWith('/')) {
        const editsAlt = getAllEdits.all(projectId, decodedPagePath.slice(1));
        if (editsAlt.length > 0) {
          console.log('Found edits without leading slash');
          return res.json(editsAlt);
        }
      }
      
      if (edits.length === 0) {
        return res.status(404).json({ error: 'No edits found', searchedProjectId: projectId, searchedPagePath: decodedPagePath });
      }

      res.json(edits);
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to get edit history');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get a specific edit by ID
  app.get('/edits/by-id/:editId', (req, res) => {
    try {
      const { editId } = req.params;
      
      // Validate editId (UUID)
      const editIdValidation = validateUUID(editId, 'editId');
      if (!editIdValidation.valid) {
        return res.status(400).json({ error: editIdValidation.error });
      }
      
      console.log('Getting edit by ID:', editId);

      const getEdit = db.prepare('SELECT * FROM edits WHERE id = ?');
      const edit = getEdit.get(editId);

      if (!edit) {
        return res.status(404).json({ error: 'Edit not found' });
      }

      console.log('Edit found:', { id: edit.id, project_id: edit.project_id, page_path: edit.page_path, created_at: edit.created_at });
      res.json(edit);
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to get edit');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get all edits for a project (for publish/export)
  // MUST come BEFORE the general regex route below to ensure it matches first
  app.get('/edits/project/:projectId', (req, res) => {
    try {
      const { projectId } = req.params;
      
      // Validate projectId (UUID)
      const projectIdValidation = validateUUID(projectId, 'projectId');
      if (!projectIdValidation.valid) {
        return res.status(400).json({ error: projectIdValidation.error });
      }

      console.log('Getting all edits for project:', projectId);

      const getAll = db.prepare(`
        SELECT * FROM edits 
        WHERE project_id = ?
        ORDER BY page_path, created_at DESC
      `);

      const edits = getAll.all(projectId);
      console.log(`Found ${edits.length} edit(s) for project ${projectId}`);

      // Group by page_path and get latest for each
      const latestByPage = {};
      edits.forEach(edit => {
        if (!latestByPage[edit.page_path]) {
          latestByPage[edit.page_path] = edit;
        }
      });

      const result = Object.values(latestByPage);
      console.log(`Returning ${result.length} unique page(s) with edits`);
      res.json(result);
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to get edits');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get latest edit for a page (using regex to handle page paths with slashes)
  // MUST come AFTER the /edits/project/:projectId route above
  app.get(/^\/edits\/([^/]+)\/(.+)$/, (req, res) => {
    try {
      // Skip if this is a history or project route (handled by specific routes above)
      const pathToCheck = req.path || req.url || req.originalUrl || '';
      if (pathToCheck.includes('/edits/history/') || pathToCheck.includes('/edits/project/')) {
        // Don't handle - let it fall through (though Express doesn't support fallthrough)
        // Instead, return 404 to indicate route not found
        return res.status(404).json({ error: 'Route not found - use /edits/history/ for history' });
      }
      
      console.log('Edit route matched:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
      
      // Extract projectId and pagePath from the regex match
      let match = req.path.match(/^\/edits\/([^/]+)\/(.+)$/);
      if (!match) {
        match = req.url.match(/^\/edits\/([^/]+)\/(.+)$/);
      }
      if (!match && req.originalUrl) {
        match = req.originalUrl.match(/^\/edits\/([^/]+)\/(.+)$/);
      }
      
      // Double-check it's not history or project
      if (match && (match[1] === 'history' || match[1] === 'project')) {
        return res.status(404).json({ error: 'Route not found' });
      }
      
      if (!match || !match[1] || !match[2]) {
        console.log('No match found:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
        return res.status(400).json({ error: 'projectId and pagePath are required', path: req.path, url: req.url, originalUrl: req.originalUrl });
      }
      
      const projectId = match[1];
      let decodedPagePath = decodeURIComponent(match[2]);
      
      // Validate projectId (UUID)
      const projectIdValidation = validateUUID(projectId, 'projectId');
      if (!projectIdValidation.valid) {
        return res.status(400).json({ error: projectIdValidation.error });
      }
      
      // Validate and sanitize page path
      const pagePathValidation = validatePath(decodedPagePath, 'page_path');
      if (!pagePathValidation.valid) {
        return res.status(400).json({ error: pagePathValidation.error });
      }
      
      decodedPagePath = pagePathValidation.sanitized;
      console.log('Normalized page path:', decodedPagePath);

      const getLatest = db.prepare(`
        SELECT * FROM edits 
        WHERE project_id = ? AND page_path = ?
        ORDER BY created_at DESC
        LIMIT 1
      `);

      const edit = getLatest.get(projectId, decodedPagePath);
      
      console.log('Edit query result:', edit ? { id: edit.id, page_path: edit.page_path, created_at: edit.created_at } : 'not found');
      
      // Try without leading slash as fallback
      if (!edit && decodedPagePath.startsWith('/')) {
        const editAlt = getLatest.get(projectId, decodedPagePath.slice(1));
        if (editAlt) {
          console.log('Edit found without leading slash');
          return res.json(editAlt);
        }
      }

      if (!edit) {
        return res.status(404).json({ error: 'No edits found', searchedProjectId: projectId, searchedPagePath: decodedPagePath });
      }

      res.json(edit);
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to get edit');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Add comment
  app.post('/comments', (req, res) => {
    try {
      // Validate and sanitize input
      const validation = validateCommentInput(req.body);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join(', ') });
      }

      const { project_id, page_path, x_position, y_position, comment_text, author } = validation.sanitized;

      const commentId = generateId();
      const now = Date.now();

      const insert = db.prepare(`
        INSERT INTO comments (id, project_id, page_path, x_position, y_position, comment_text, author, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // x_position and y_position are now percentages (0-100) instead of pixels
      insert.run(commentId, project_id, page_path, x_position, y_position, comment_text, author, now);

      res.json({
        id: commentId,
        project_id,
        page_path,
        comment_text,
        author,
        created_at: now
      });
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to add comment');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get comments for a page (using regex to handle page paths with slashes)
  app.get(/^\/comments\/([^/]+)\/(.+)$/, (req, res) => {
    try {
      let match = req.path.match(/^\/comments\/([^/]+)\/(.+)$/);
      if (!match) {
        match = req.url.match(/^\/comments\/([^/]+)\/(.+)$/);
      }
      
      if (!match || !match[1] || !match[2]) {
        return res.status(400).json({ error: 'projectId and pagePath are required' });
      }
      
      const projectId = match[1];
      let decodedPagePath = decodeURIComponent(match[2]);
      
      // Validate projectId (UUID)
      const projectIdValidation = validateUUID(projectId, 'projectId');
      if (!projectIdValidation.valid) {
        return res.status(400).json({ error: projectIdValidation.error });
      }
      
      // Validate and sanitize page path
      const pagePathValidation = validatePath(decodedPagePath, 'page_path');
      if (!pagePathValidation.valid) {
        return res.status(400).json({ error: pagePathValidation.error });
      }
      
      decodedPagePath = pagePathValidation.sanitized;

      const getComments = db.prepare(`
        SELECT * FROM comments 
        WHERE project_id = ? AND page_path = ?
        ORDER BY created_at DESC
      `);

      const comments = getComments.all(projectId, decodedPagePath);
      res.json(comments);
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to get comments');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Delete comment
  app.delete('/comments/:commentId', (req, res) => {
    try {
      const { commentId } = req.params;
      
      // Validate commentId (UUID)
      const commentIdValidation = validateUUID(commentId, 'commentId');
      if (!commentIdValidation.valid) {
        return res.status(400).json({ error: commentIdValidation.error });
      }

      const deleteComment = db.prepare('DELETE FROM comments WHERE id = ?');
      const result = deleteComment.run(commentId);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      res.json({ success: true });
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to delete comment');
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get presence (active users) for a page (using regex to handle page paths with slashes)
  app.get(/^\/presence\/([^/]+)\/(.+)$/, (req, res) => {
    try {
      let match = req.path.match(/^\/presence\/([^/]+)\/(.+)$/);
      if (!match) {
        match = req.url.match(/^\/presence\/([^/]+)\/(.+)$/);
      }
      
      if (!match || !match[1] || !match[2]) {
        return res.status(400).json({ error: 'projectId and pagePath are required' });
      }
      
      const projectId = match[1];
      let decodedPagePath = decodeURIComponent(match[2]);
      
      // Validate projectId (UUID)
      const projectIdValidation = validateUUID(projectId, 'projectId');
      if (!projectIdValidation.valid) {
        return res.status(400).json({ error: projectIdValidation.error });
      }
      
      // Validate and sanitize page path
      const pagePathValidation = validatePath(decodedPagePath, 'page_path');
      if (!pagePathValidation.valid) {
        return res.status(400).json({ error: pagePathValidation.error });
      }
      
      decodedPagePath = pagePathValidation.sanitized;

      const getPresence = db.prepare(`
        SELECT DISTINCT user_id, user_name, MAX(last_seen) as last_seen
        FROM presence 
        WHERE project_id = ? AND page_path = ? AND last_seen > ? - 30000
        GROUP BY user_id, user_name
      `);

      const presence = getPresence.all(projectId, decodedPagePath, Date.now());
      res.json(presence);
    } catch (error) {
      const errorMessage = sanitizeError(error, 'Failed to get presence');
      res.status(500).json({ error: errorMessage });
    }
  });
}
