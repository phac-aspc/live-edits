import dotenv from 'dotenv';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(moduleDirectory, '../.env'), quiet: true });

function required(name, value) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function integer(name, value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function normalizedPath(value, fallback) {
  const path = value || fallback;
  if (!path.startsWith('/') || (path.length > 1 && path.endsWith('/'))) {
    throw new Error(`Invalid URL path: ${path}`);
  }
  return path;
}

export function loadConfig() {
  const environment = process.env.NODE_ENV || 'development';
  const authMode = process.env.AUTH_MODE || 'token';
  if (!['token', 'disabled'].includes(authMode)) throw new Error('AUTH_MODE must be token or disabled.');
  if (environment === 'production' && authMode === 'disabled') {
    throw new Error('AUTH_MODE=disabled is not permitted in production.');
  }
  const editorAuthMode = process.env.EDITOR_AUTH_MODE || authMode;
  if (!['token', 'network', 'disabled'].includes(editorAuthMode)) {
    throw new Error('EDITOR_AUTH_MODE must be token, network, or disabled.');
  }
  if (environment === 'production' && editorAuthMode === 'disabled') {
    throw new Error('EDITOR_AUTH_MODE=disabled is not permitted in production.');
  }

  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (!corsOrigins.length) throw new Error('CORS_ORIGINS must contain at least one exact origin.');
  for (const origin of corsOrigins) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
      throw new Error(`CORS origin must be an exact HTTPS origin: ${origin}`);
    }
  }

  const editorToken = editorAuthMode === 'token' ? required('EDITOR_TOKEN', process.env.EDITOR_TOKEN) : null;
  const adminToken = authMode === 'token' ? required('ADMIN_TOKEN', process.env.ADMIN_TOKEN) : null;
  if (editorAuthMode === 'token' && editorToken.length < 32) {
    throw new Error('EDITOR_TOKEN must contain at least 32 characters.');
  }
  if (authMode === 'token' && adminToken.length < 32) {
    throw new Error('ADMIN_TOKEN must contain at least 32 characters.');
  }
  if (authMode === 'token' && editorAuthMode === 'token' && editorToken === adminToken) {
    throw new Error('EDITOR_TOKEN and ADMIN_TOKEN must be different.');
  }

  const host = process.env.HOST || '127.0.0.1';
  if (environment === 'production' && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('Production HOST must bind to loopback behind IIS.');
  }
  const dbPathValue = required('DB_PATH', process.env.DB_PATH);
  if (!isAbsolute(dbPathValue)) throw new Error('DB_PATH must be absolute.');
  const publicBaseUrl = new URL(required('PUBLIC_BASE_URL', process.env.PUBLIC_BASE_URL));
  if (environment === 'production' && publicBaseUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_BASE_URL must use HTTPS in production.');
  }

  return Object.freeze({
    environment,
    host,
    port: integer('PORT', process.env.PORT, 3000, 1, 65535),
    publicBaseUrl: publicBaseUrl.href.replace(/\/$/, ''),
    apiPath: normalizedPath(process.env.API_PATH, '/api/v1'),
    wsPath: normalizedPath(process.env.WS_PATH, '/socket.io'),
    dbPath: resolve(dbPathValue),
    corsOrigins,
    trustProxy: process.env.TRUST_PROXY || 'loopback',
    authMode,
    editorAuthMode,
    editorToken,
    adminToken,
    maxEditBytes: integer('MAX_EDIT_BYTES', process.env.MAX_EDIT_BYTES, 10_485_760, 1024, 25_000_000),
    historyLimit: integer('HISTORY_LIMIT', process.env.HISTORY_LIMIT, 25, 1, 100)
  });
}
