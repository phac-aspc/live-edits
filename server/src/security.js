import { createHash, timingSafeEqual } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/;
const SITE_KEYS = new Set(['en', 'fr']);
const SANITIZE_OPTIONS = {
  allowedTags: [
    'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'cite', 'code', 'data',
    'del', 'dfn', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture',
    'pre', 'q', 's', 'samp', 'small', 'source', 'span', 'strong', 'sub', 'sup',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr'
  ],
  allowedAttributes: {
    '*': ['aria-*', 'class', 'data-*', 'dir', 'id', 'lang', 'role', 'title'],
    a: ['download', 'href', 'hreflang', 'rel', 'target', 'type'],
    blockquote: ['cite'], data: ['value'], del: ['cite', 'datetime'], ins: ['cite', 'datetime'],
    img: ['alt', 'decoding', 'height', 'loading', 'src', 'srcset', 'width'],
    ol: ['reversed', 'start', 'type'],
    source: ['height', 'media', 'sizes', 'src', 'srcset', 'type', 'width'],
    table: ['summary'], td: ['colspan', 'headers', 'rowspan'],
    th: ['abbr', 'colspan', 'headers', 'rowspan', 'scope'], time: ['datetime']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['data', 'http', 'https'], source: ['http', 'https'] },
  allowProtocolRelative: false,
  enforceHtmlBoundary: true,
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target === '_blank') {
        const rel = new Set((attribs.rel || '').split(/\s+/).filter(Boolean));
        rel.add('noopener');
        rel.add('noreferrer');
        attribs.rel = [...rel].join(' ');
      }
      return { tagName, attribs };
    }
  }
};

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function validateId(value, label = 'id') {
  if (!ID_PATTERN.test(value || '')) fail(`Invalid ${label}.`);
  return value;
}

export function validateElementKey(value) {
  if (!KEY_PATTERN.test(value || '')) fail('Invalid element_key.');
  return value;
}

export function validateSiteKey(value) {
  if (!SITE_KEYS.has(value)) fail('site_key must be en or fr.');
  return value;
}

export function validatePath(value, label = 'path') {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) fail(`Invalid ${label}.`);
  if (!value.startsWith('/') || value.includes('\\') || value.includes('\0')) fail(`${label} must be an absolute URL path.`);
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    fail(`${label} contains invalid encoding.`);
  }
  if (decoded.split('/').includes('..')) fail(`${label} cannot contain traversal segments.`);
  return `/${value.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/')}`;
}

export function validateName(value, label, max = 100) {
  if (typeof value !== 'string') fail(`${label} is required.`);
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!clean || clean.length > max) fail(`${label} must contain 1 to ${max} characters.`);
  return clean;
}

export function validateOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    fail('origin must be an HTTPS origin without a path.');
  }
}

export function validateEditPayload(value, maxBytes) {
  if (!value || value.version !== 1 || !value.elements || typeof value.elements !== 'object' || Array.isArray(value.elements)) {
    fail('payload must be a version 1 object with an elements map.');
  }
  const sanitizedElements = {};
  const entries = Object.entries(value.elements);
  if (!entries.length || entries.length > 2000) fail('payload must contain 1 to 2000 edited elements.');
  for (const [key, fragment] of entries) {
    if (!KEY_PATTERN.test(key)) fail(`Invalid element key: ${key}.`);
    if (typeof fragment !== 'string') fail(`Element ${key} must contain HTML text.`);
    sanitizedElements[key] = sanitizeHtml(fragment, SANITIZE_OPTIONS);
  }
  const sanitized = { version: 1, elements: sanitizedElements };
  const json = JSON.stringify(sanitized);
  if (Buffer.byteLength(json) > maxBytes) fail('Edit payload is too large.', 413);
  return { payload: sanitized, json };
}

export function validateCommentPosition(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) fail(`${label} must be between 0 and 1.`);
  return number;
}

function tokenMatches(received, expected) {
  if (!received || !expected) return false;
  const receivedHash = createHash('sha256').update(received).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

export function authorizeToken(config, received, role = 'editor') {
  if (config.authMode === 'disabled') return true;
  if (tokenMatches(received, config.adminToken)) return true;
  return role === 'editor' && tokenMatches(received, config.editorToken);
}

export function requireAuth(config, role = 'editor') {
  return (request, response, next) => {
    const header = request.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!authorizeToken(config, token, role)) {
      response.set('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'Authentication required.' });
    }
    return next();
  };
}

export function contentHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function httpError(message, status = 400) {
  return fail(message, status);
}
