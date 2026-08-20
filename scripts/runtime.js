import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_API_BASE = 'https://test.infobase-dev.com/live-edits';
export const PUBLIC_STAGING_ROOT = '_live-edits/v4';
export const SITE_DEFAULTS = Object.freeze({
  en: {
    origin: 'https://en.infobase-dev.com',
    webRoot: '/home/ec2-user/environment/wwwroot/en',
    stagingRoot: '/home/ec2-user/environment/wwwroot/_live-edits/v4'
  },
  fr: {
    origin: 'https://fr.infobase-dev.com',
    webRoot: '/home/ec2-user/environment/wwwroot/fr',
    stagingRoot: '/home/ec2-user/environment/wwwroot/_live-edits/v4'
  }
});

export function parseArguments(argv, definitions = {}) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const [rawName, inlineValue] = value.slice(2).split(/=(.*)/s, 2);
    const definition = definitions[rawName] || { type: 'string' };
    if (definition.type === 'boolean') {
      result[rawName] = inlineValue === undefined ? true : inlineValue !== 'false';
      continue;
    }
    const nextValue = inlineValue ?? argv[index + 1];
    if (nextValue === undefined || (inlineValue === undefined && nextValue.startsWith('--'))) {
      throw new Error(`Missing value for --${rawName}.`);
    }
    result[rawName] = nextValue;
    if (inlineValue === undefined) index += 1;
  }
  return result;
}

export function assertSiteKey(siteKey) {
  if (!Object.hasOwn(SITE_DEFAULTS, siteKey)) {
    throw new Error('Site must be either "en" or "fr".');
  }
  return siteKey;
}

export function assertSimpleName(value, label = 'name') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value || '')) {
    throw new Error(`${label} must contain only letters, numbers, dots, underscores, and hyphens.`);
  }
  return value;
}

export function assertContained(root, candidate, label = 'path') {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const childPath = relative(resolvedRoot, resolvedCandidate);
  if (childPath === '' || (!childPath.startsWith(`..${sep}`) && childPath !== '..' && !isAbsolute(childPath))) {
    return resolvedCandidate;
  }
  throw new Error(`${label} is outside the allowed root: ${resolvedCandidate}`);
}

export function toUrlPath(...parts) {
  const value = parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join('/')
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/');
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

export function stateDirectory() {
  return resolve(process.env.LIVE_EDITS_STATE_DIR || resolve(REPO_ROOT, 'state'));
}

export function projectConfigPath(siteKey, projectName) {
  return resolve(stateDirectory(), 'projects', siteKey, `${projectName}.json`);
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function listHtmlFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in a staged product: ${absolute}`);
      }
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (/\.html?$/i.test(entry.name)) {
        files.push(absolute);
      }
    }
  };
  if (existsSync(root)) visit(root);
  return files.sort();
}

export async function apiRequest(apiBase, route, options = {}) {
  const url = `${apiBase.replace(/\/$/, '')}${route}`;
  const headers = {
    accept: 'application/json',
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
  };
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || 15_000)
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    const error = new Error(`API ${response.status}: ${body?.error || body?.message || response.statusText}`);
    error.status = response.status;
    if (body && typeof body === 'object') {
      const { error: privateError, message: privateMessage, ...details } = body;
      error.details = details;
    }
    throw error;
  }
  return body;
}

export function requireExistingDirectory(pathValue, label) {
  const absolute = resolve(pathValue);
  if (!existsSync(absolute) || !lstatSync(absolute).isDirectory()) {
    throw new Error(`${label} does not exist or is not a directory: ${absolute}`);
  }
  return absolute;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
