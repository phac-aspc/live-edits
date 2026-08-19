import { createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { parse } from 'parse5';

const KEY_ATTRIBUTE = 'data-live-edits-key';
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/;
const AUTO_EDITABLE_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'dt', 'dd', 'figcaption', 'caption',
  'th', 'td', 'blockquote'
]);
const NEVER_EDIT_TAGS = new Set([
  'html', 'head', 'body', 'main', 'script', 'style', 'noscript', 'template',
  'svg', 'canvas', 'form', 'input', 'select', 'option', 'textarea', 'button',
  'iframe', 'object', 'embed'
]);
const HAZARDOUS_DESCENDANTS = new Set([
  'script', 'style', 'template', 'svg', 'canvas', 'form', 'iframe', 'object', 'embed'
]);

const SANITIZE_OPTIONS = {
  allowedTags: [
    'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'cite', 'code', 'data',
    'del', 'dfn', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture',
    'pre', 'q', 's', 'samp', 'small', 'source', 'span', 'strong', 'sub', 'sup',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var',
    'wbr'
  ],
  allowedAttributes: {
    '*': [
      'aria-*', 'class', 'data-*', 'dir', 'id', 'lang', 'role', 'title'
    ],
    a: ['download', 'href', 'hreflang', 'rel', 'target', 'type'],
    blockquote: ['cite'],
    data: ['value'],
    del: ['cite', 'datetime'],
    img: ['alt', 'decoding', 'height', 'loading', 'src', 'srcset', 'width'],
    ins: ['cite', 'datetime'],
    ol: ['reversed', 'start', 'type'],
    source: ['height', 'media', 'sizes', 'src', 'srcset', 'type', 'width'],
    table: ['summary'],
    td: ['colspan', 'headers', 'rowspan'],
    th: ['abbr', 'colspan', 'headers', 'rowspan', 'scope'],
    time: ['datetime']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['data', 'http', 'https'],
    source: ['http', 'https']
  },
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

function attributes(node) {
  return new Map((node.attrs || []).map(({ name, value }) => [name, value]));
}

function elementChildren(node) {
  return (node.childNodes || []).filter((child) => child.tagName);
}

function classList(node) {
  return (attributes(node).get('class') || '').split(/\s+/).filter(Boolean);
}

function isIgnored(node, ancestors) {
  return [...ancestors, node].some((candidate) => {
    const attrs = attributes(candidate);
    const classes = classList(candidate);
    return (candidate === node ? NEVER_EDIT_TAGS.has(candidate.tagName) : HAZARDOUS_DESCENDANTS.has(candidate.tagName))
      || attrs.has('data-live-edits-ignore')
      || attrs.has('data-dynamic')
      || attrs.has('data-generated')
      || attrs.get('contenteditable') === 'false'
      || classes.includes('dynamic-content')
      || classes.includes('no-live-edits');
  });
}

function hasHazardousDescendant(node) {
  return elementChildren(node).some((child) => (
    HAZARDOUS_DESCENDANTS.has(child.tagName) || hasHazardousDescendant(child)
  ));
}

function containsMeaningfulContent(node) {
  const visit = (candidate) => {
    if (candidate.nodeName === '#text' && candidate.value.trim()) return true;
    if (candidate.tagName === 'img') return true;
    return (candidate.childNodes || []).some(visit);
  };
  return visit(node);
}

function walkElements(node, callback, ancestors = [], path = '') {
  let elementIndex = 0;
  for (const child of node.childNodes || []) {
    if (!child.tagName) continue;
    const childPath = `${path}/${child.tagName}[${elementIndex}]`;
    callback(child, ancestors, childPath);
    walkElements(child, callback, [...ancestors, child], childPath);
    elementIndex += 1;
  }
}

function makeStableKey(pageIdentity, domPath) {
  const digest = createHash('sha256').update(`${pageIdentity}:${domPath}`).digest('hex');
  return `le_${digest.slice(0, 20)}`;
}

function insertionOffset(html, node) {
  const startTag = node.sourceCodeLocation?.startTag;
  if (!startTag) throw new Error(`Cannot annotate <${node.tagName}> without source location data.`);
  const source = html.slice(startTag.startOffset, startTag.endOffset);
  return startTag.endOffset - (source.endsWith('/>') ? 2 : 1);
}

function selectNodes(document, pageIdentity) {
  const all = [];
  walkElements(document, (node, ancestors, domPath) => {
    const attrs = attributes(node);
    all.push({
      node,
      ancestors,
      domPath,
      existingKey: attrs.get(KEY_ATTRIBUTE),
      explicitlyEditable: classList(node).includes('editable') && !NEVER_EDIT_TAGS.has(node.tagName)
    });
  });

  const existing = all.filter(({ existingKey }) => existingKey !== undefined);
  const explicit = all.filter(({ explicitlyEditable }) => explicitlyEditable);
  const useExplicitSelection = existing.length > 0 || explicit.length > 0;

  let selected;
  if (useExplicitSelection) {
    selected = all.filter(({ existingKey, explicitlyEditable }) => (
      existingKey !== undefined || explicitlyEditable
    ));
  } else {
    const main = all.find(({ node }) => node.tagName === 'main');
    const scopeNode = main?.node || all.find(({ node }) => node.tagName === 'body')?.node;
    if (!scopeNode) throw new Error('No <main> or <body> element was found.');

    const scopeEntry = main || all.find(({ node }) => node === scopeNode);
    const candidates = all.filter(({ node, ancestors }) => (
      (node === scopeNode || ancestors.includes(scopeNode))
      && node !== scopeNode
      && AUTO_EDITABLE_TAGS.has(node.tagName)
      && !isIgnored(node, ancestors)
      && !hasHazardousDescendant(node)
      && containsMeaningfulContent(node)
    ));
    const candidateNodes = new Set(candidates.map(({ node }) => node));
    selected = candidates.filter(({ node }) => {
      let nestedCandidate = false;
      walkElements(node, (descendant) => {
        if (candidateNodes.has(descendant)) nestedCandidate = true;
      });
      return !nestedCandidate;
    });
    if (!selected.length && scopeEntry) {
      throw new Error('No safe editable content blocks were found. Add class="editable" to the intended elements.');
    }
  }

  const selectedNodes = new Set(selected.map(({ node }) => node));
  for (const entry of selected) {
    if (entry.ancestors.some((ancestor) => selectedNodes.has(ancestor))) {
      throw new Error(`Nested editable elements are not supported (${entry.domPath}). Remove one editable marker.`);
    }
  }

  const seen = new Set();
  return selected.map((entry) => {
    const key = entry.existingKey || makeStableKey(pageIdentity, entry.domPath);
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid ${KEY_ATTRIBUTE} value: ${key}`);
    if (seen.has(key)) throw new Error(`Duplicate ${KEY_ATTRIBUTE} value: ${key}`);
    seen.add(key);
    return { ...entry, key };
  });
}

export function sanitizeFragment(fragment) {
  if (typeof fragment !== 'string') throw new TypeError('Edited content must be a string.');
  return sanitizeHtml(fragment, SANITIZE_OPTIONS);
}

export function annotateEditableHtml(html, pageIdentity) {
  if (!pageIdentity) throw new Error('A page identity is required to generate stable edit keys.');
  const document = parse(html, { sourceCodeLocationInfo: true });
  const selected = selectNodes(document, pageIdentity);
  const additions = selected
    .filter(({ existingKey }) => existingKey === undefined)
    .map(({ node, key }) => ({
      offset: insertionOffset(html, node),
      text: ` ${KEY_ATTRIBUTE}="${key}"`
    }))
    .sort((a, b) => b.offset - a.offset);

  let result = html;
  for (const addition of additions) {
    result = result.slice(0, addition.offset) + addition.text + result.slice(addition.offset);
  }
  return {
    html: result,
    keys: selected.map(({ key }) => key),
    addedCount: additions.length
  };
}

export function applyElementEdits(html, pageIdentity, elements) {
  if (!elements || typeof elements !== 'object' || Array.isArray(elements)) {
    throw new TypeError('The edit payload must contain an elements object.');
  }

  const annotated = annotateEditableHtml(html, pageIdentity);
  const document = parse(annotated.html, { sourceCodeLocationInfo: true });
  const keyedNodes = new Map();
  walkElements(document, (node) => {
    const key = attributes(node).get(KEY_ATTRIBUTE);
    if (key) keyedNodes.set(key, node);
  });

  const replacements = [];
  for (const [key, rawFragment] of Object.entries(elements)) {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid edit key: ${key}`);
    const node = keyedNodes.get(key);
    if (!node) throw new Error(`Edit key was not found in the source page: ${key}`);
    const location = node.sourceCodeLocation;
    if (!location?.startTag || !location?.endTag) {
      throw new Error(`Editable element cannot be a void element: ${key}`);
    }
    replacements.push({
      start: location.startTag.endOffset,
      end: location.endTag.startOffset,
      fragment: sanitizeFragment(rawFragment),
      key
    });
  }

  replacements.sort((a, b) => b.start - a.start);
  let result = annotated.html;
  for (const replacement of replacements) {
    result = result.slice(0, replacement.start) + replacement.fragment + result.slice(replacement.end);
  }

  const verifiedDocument = parse(result, { sourceCodeLocationInfo: true });
  const verified = new Map();
  walkElements(verifiedDocument, (node) => {
    const key = attributes(node).get(KEY_ATTRIBUTE);
    if (!key) return;
    if (verified.has(key)) throw new Error(`Publishing produced a duplicate edit key: ${key}`);
    verified.set(key, node);
  });
  for (const replacement of replacements) {
    const node = verified.get(replacement.key);
    const location = node?.sourceCodeLocation;
    if (!location?.startTag || !location?.endTag) {
      throw new Error(`Edited HTML changed the document structure around ${replacement.key}.`);
    }
    const actualFragment = result.slice(location.startTag.endOffset, location.endTag.startOffset);
    if (actualFragment !== replacement.fragment) {
      throw new Error(`Edited HTML is not valid inside element ${replacement.key}.`);
    }
  }

  return {
    html: result,
    changedKeys: replacements.map(({ key }) => key),
    allKeys: annotated.keys
  };
}

export function stripEditorBootstrap(html) {
  return html
    .replace(/\s*<script\b[^>]*\bdata-live-edits-bootstrap\b[^>]*>[\s\S]*?<\/script>\s*/gi, '')
    .replace(/\s*<meta\b[^>]*\bname=["']live-edits-[^"']+["'][^>]*>\s*/gi, '');
}

export function injectEditorBootstrap(html, options) {
  const clean = stripEditorBootstrap(html);
  const attrs = {
    'data-live-edits-bootstrap': '',
    'data-api-base': options.apiBase,
    'data-site-key': options.siteKey,
    'data-project-path': options.projectPath,
    'data-page-path': options.pagePath,
    src: options.widgetUrl
  };
  const rendered = Object.entries(attrs).map(([name, value]) => (
    value === '' ? name : `${name}="${escapeAttribute(value)}"`
  )).join(' ');
  const bootstrap = `\n  <script ${rendered} defer></script>\n`;
  if (/<\/body\s*>/i.test(clean)) return clean.replace(/<\/body\s*>/i, `${bootstrap}</body>`);
  throw new Error('No closing </body> tag was found.');
}

export function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export const EDIT_PAYLOAD_VERSION = 1;
