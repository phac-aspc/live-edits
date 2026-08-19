import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { initDatabase } from './database.js';
import { createRoutes } from './routes.js';
import { requireAuth } from './security.js';
import { setupWebsocket } from './websocket.js';

async function main() {
  const config = loadConfig();
  const db = await initDatabase(config);
  const app = express();
  const httpServer = createServer(app);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use((request, response, next) => {
    const suppliedId = request.get('x-request-id') || '';
    request.id = /^[A-Za-z0-9._:-]{1,64}$/.test(suppliedId) ? suppliedId : randomUUID();
    response.set('x-request-id', request.id);
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true);
      const error = new Error('Origin is not allowed.');
      error.status = 403;
      return callback(error);
    },
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
    maxAge: 3600
  }));
  app.use(express.json({ limit: config.maxEditBytes + 16_384, strict: true }));

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 180,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again shortly.' }
  });
  app.use(config.apiPath, apiLimiter);

  app.get('/healthz', (request, response) => {
    db.prepare('SELECT 1').get();
    response.set('cache-control', 'no-store').json({ status: 'ok', version: '4.0.0' });
  });

  const editorAuth = requireAuth(config, 'editor');
  const adminAuth = requireAuth(config, 'admin');
  app.use(config.apiPath, createRoutes(db, config, editorAuth, adminAuth));

  app.use((request, response) => response.status(404).json({ error: 'Route not found.' }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = Number.isInteger(error.status) ? error.status : (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(`[${request.id}]`, error);
    const body = {
      error: status >= 500 ? 'Internal server error.' : error.message,
      request_id: request.id
    };
    if (status === 409 && error.details) Object.assign(body, error.details);
    return response.status(status).json(body);
  });

  const io = setupWebsocket(httpServer, db, config);
  app.locals.io = io;
  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 35_000;

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, resolve);
  });
  console.log(`Live Edits 4.0.0 listening on http://${config.host}:${config.port}`);

  const shutdown = (signal) => {
    console.log(`${signal} received; shutting down.`);
    httpServer.close(() => {
      io.close();
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Live Edits failed to start:', error.message);
  process.exitCode = 1;
});
