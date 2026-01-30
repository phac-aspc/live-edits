import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { initDatabase } from './database.js';
import { generateId } from './database.js';
import { setupRoutes } from './routes.js';
import { setupWebSocket } from './websocket.js';
import {
  validateProjectInput,
  validateUUID,
  validatePath,
  sanitizeError
} from './security.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST']
  },
  path: process.env.WS_PATH || '/socket.io'
});

const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' })); // Large limit for HTML content
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Security: Remove X-Powered-By header
app.disable('x-powered-by');

// Rate limiting
// Stricter limits for POST endpoints (create/update operations)
const postLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// More lenient limits for GET endpoints (read operations)
const getLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to API routes
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    return postLimiter(req, res, next);
  }
  return getLimiter(req, res, next);
});

app.use('/live-edits', (req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    return postLimiter(req, res, next);
  }
  return getLimiter(req, res, next);
});

// Request logging middleware (before routes)
app.use((req, res, next) => {
  if (req.path.startsWith('/projects') || req.path.startsWith('/edits') || req.path.startsWith('/comments') || req.path.startsWith('/presence') || req.path.startsWith('/live-edits/')) {
    console.log(`[${req.method}] ${req.originalUrl || req.url}`);
    console.log('  Path:', req.path);
    console.log('  URL:', req.url);
    console.log('  Original URL:', req.originalUrl);
  }
  next();
});

// Initialize database
console.log('Initializing database...');
const db = initDatabase();
console.log('Database initialized');

// Setup routes at root path (for when IIS strips /live-edits prefix)
setupRoutes(app, db);

// Also setup routes at /live-edits path (for when IIS doesn't strip it)
// Mount router so routes work at /live-edits/projects
const apiRouter = express.Router();
setupRoutes(apiRouter, db);
app.use('/live-edits', apiRouter);

// Direct routes as fallback for /live-edits paths
app.get('/live-edits/projects', (req, res) => {
  try {
    const getAllProjects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
    const projects = getAllProjects.all();
    res.json(projects);
  } catch (error) {
    const errorMessage = sanitizeError(error, 'Failed to get projects');
    res.status(500).json({ error: errorMessage });
  }
});

app.get('/live-edits/projects/', (req, res) => {
  try {
    const getAllProjects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
    const projects = getAllProjects.all();
    res.json(projects);
  } catch (error) {
    const errorMessage = sanitizeError(error, 'Failed to get projects');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /live-edits/projects (register project)
app.post('/live-edits/projects', (req, res) => {
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

// Get all edits for a project (fallback for /live-edits paths)
// Use regex pattern to match the route (like other dynamic routes)
app.get(/^\/live-edits\/edits\/project\/([^\/]+)$/, (req, res) => {
  try {
    console.log('Direct edits/project route matched:', {
      path: req.path,
      url: req.url,
      originalUrl: req.originalUrl
    });
    
    // Extract projectId from the URL
    let projectId = null;
    let match = req.path.match(/^\/live-edits\/edits\/project\/([^\/]+)$/);
    if (match) {
      projectId = match[1];
    } else {
      match = req.url.match(/^\/live-edits\/edits\/project\/([^\/]+)$/);
      if (match) projectId = match[1];
    }
    if (!projectId && req.originalUrl) {
      match = req.originalUrl.match(/^\/live-edits\/edits\/project\/([^\/]+)$/);
      if (match) projectId = match[1];
    }
    
    if (!projectId) {
      console.error('Could not extract projectId from URL:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
      return res.status(400).json({ error: 'projectId is required' });
    }
    
    // Decode the projectId (in case it's URL encoded)
    projectId = decodeURIComponent(projectId);
    console.log('Extracted projectId:', projectId);
    
    // Validate projectId (UUID)
    const projectIdValidation = validateUUID(projectId, 'projectId');
    if (!projectIdValidation.valid) {
      return res.status(400).json({ error: projectIdValidation.error });
    }

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
    const errorMessage = sanitizeError(error, 'Failed to get edits for project');
    console.error('Error in edits/project route:', errorMessage, error);
    res.status(500).json({ error: errorMessage });
  }
});

// Get edit by ID (fallback for /live-edits paths)
app.get('/live-edits/edits/by-id/:editId', (req, res) => {
  try {
    const { editId } = req.params;
    
    // Validate editId (UUID)
    const editIdValidation = validateUUID(editId, 'editId');
    if (!editIdValidation.valid) {
      return res.status(400).json({ error: editIdValidation.error });
    }
    
    console.log('Direct edit-by-id route matched:', editId);

    const getEdit = db.prepare('SELECT * FROM edits WHERE id = ?');
    const edit = getEdit.get(editId);

    if (!edit) {
      return res.status(404).json({ error: 'Edit not found' });
    }

    res.json(edit);
  } catch (error) {
    const errorMessage = sanitizeError(error, 'Failed to get edit');
    res.status(500).json({ error: errorMessage });
  }
});

// Get edit history (fallback for /live-edits paths)
app.get(/^\/live-edits\/edits\/history\/(.+)$/, (req, res) => {
  try {
    console.log('Direct history route matched:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
    
    let afterHistory = null;
    let match = req.path.match(/^\/live-edits\/edits\/history\/(.+)$/);
    if (match) {
      afterHistory = match[1];
    } else {
      match = req.url.match(/^\/live-edits\/edits\/history\/(.+)$/);
      if (match) afterHistory = match[1];
    }
    if (!afterHistory && req.originalUrl) {
      match = req.originalUrl.match(/^\/live-edits\/edits\/history\/(.+)$/);
      if (match) afterHistory = match[1];
    }
    
    if (!afterHistory) {
      return res.status(400).json({ error: 'Invalid history route format' });
    }
    
    // Decode and normalize
    afterHistory = decodeURIComponent(afterHistory);
    afterHistory = afterHistory.replace(/^\/+/, '/');
    
    // Split on first slash
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
    
    // Get last 5 edits with full content for revert functionality
    const getAllEdits = db.prepare(`
      SELECT id, project_id, page_path, edited_by, created_at, html_content, LENGTH(html_content) as content_length
      FROM edits 
      WHERE project_id = ? AND page_path = ?
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    const edits = getAllEdits.all(projectId, decodedPagePath);
    if (edits.length === 0 && decodedPagePath.startsWith('/')) {
      const editsAlt = getAllEdits.all(projectId, decodedPagePath.slice(1));
      return res.json(editsAlt.length > 0 ? editsAlt : []);
    }
    
    res.json(edits);
  } catch (error) {
    const errorMessage = sanitizeError(error, 'Failed to get edit history');
    res.status(500).json({ error: errorMessage });
  }
});

// Get project by folder path (fallback for /live-edits paths with slashes)
// Use req.url to get the raw URL before Express decodes it
app.get(/^\/live-edits\/projects\/(.+)$/, (req, res) => {
  try {
    console.log('Direct project route matched:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
    
    // Try req.path first (Express may have decoded it)
    let match = req.path.match(/^\/live-edits\/projects\/(.+)$/);
    if (!match) {
      // Fallback to req.url if req.path doesn't match
      match = req.url.match(/^\/live-edits\/projects\/(.+)$/);
    }
    if (!match && req.originalUrl) {
      match = req.originalUrl.match(/^\/live-edits\/projects\/(.+)$/);
    }
    
    if (!match || !match[1]) {
      console.log('No match in direct route:', { path: req.path, url: req.url, originalUrl: req.originalUrl });
      return res.status(400).json({ error: 'folder_path is required' });
    }
    
    let folderPath = decodeURIComponent(match[1]);
    console.log('Decoded folder path in direct route (before normalization):', folderPath);
    
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
    console.log('Normalized folder path in direct route:', folderPath);
    
    const getProject = db.prepare('SELECT * FROM projects WHERE folder_path = ?');
    let project = getProject.get(folderPath);

    if (!project) {
      console.log('Project not found in database:', folderPath);
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

    console.log('Project found in direct route:', project.id);
    res.json(project);
  } catch (error) {
    const errorMessage = sanitizeError(error, 'Failed to get project');
    res.status(500).json({ error: errorMessage });
  }
});

// Setup WebSocket
setupWebSocket(io, db);

// Debug route to see unmatched requests
app.use((req, res, next) => {
  // Only log API routes that didn't match
  if (req.path.startsWith('/projects') || req.path.startsWith('/edits') || req.path.startsWith('/comments') || req.path.startsWith('/presence') || req.path.startsWith('/live-edits/')) {
    console.log('Unmatched API route:', {
      method: req.method,
      path: req.path,
      url: req.url,
      originalUrl: req.originalUrl
    });
  }
  next();
});

// Catch-all route for 404 errors (must be last)
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    url: req.url,
    originalUrl: req.originalUrl
  });
});

// Start server
// Bind to 0.0.0.0 to make it accessible from outside localhost
const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`🚀 Live Edits Server running on ${SERVER_URL}`);
  console.log(`📡 WebSocket available at ${SERVER_URL}${process.env.WS_PATH || '/socket.io'}`);
  console.log(`💾 Database: ${process.env.DB_PATH || './database.db'}`);
  console.log(`🌐 Listening on ${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing database...');
  db.close();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing database...');
  db.close();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
