import assert from 'node:assert/strict';
import test from 'node:test';
import {
  annotateEditableHtml,
  applyElementEdits,
  injectEditorBootstrap,
  sanitizeFragment
} from '../scripts/html-tools.js';

const PAGE = '<!doctype html><html><head><title>T</title></head><body><main><h1>Hello</h1><p>World <a href="/x">link</a></p><ul><li><p>Nested</p></li></ul></main></body></html>';

test('automatic keys are deterministic and choose nonnested content blocks', () => {
  const first = annotateEditableHtml(PAGE, 'en:/demo/index.html');
  const second = annotateEditableHtml(PAGE, 'en:/demo/index.html');
  assert.equal(first.html, second.html);
  assert.equal(first.keys.length, 3);
  assert.equal(new Set(first.keys).size, 3);
  assert.match(first.html, /<h1 data-live-edits-key="le_[a-f0-9]{20}">/);
  assert.doesNotMatch(first.html, /<li data-live-edits-key/);
});

test('explicit keys are preserved and limit the editing scope', () => {
  const html = '<html><body><main><p data-live-edits-key="intro">One</p><p>Two</p></main></body></html>';
  const result = annotateEditableHtml(html, 'en:/index.html');
  assert.deepEqual(result.keys, ['intro']);
  assert.equal(result.addedCount, 0);
});

test('nested explicit regions are rejected', () => {
  const html = '<html><body><main><div class="editable"><p class="editable">Text</p></div></main></body></html>';
  assert.throws(() => annotateEditableHtml(html, 'en:/index.html'), /Nested editable elements/);
});

test('element edits preserve the document and remove active content', () => {
  const annotated = annotateEditableHtml(PAGE, 'en:/demo/index.html');
  const key = annotated.keys[0];
  const result = applyElementEdits(PAGE, 'en:/demo/index.html', {
    [key]: '<strong onclick="alert(1)">Updated</strong><script>alert(1)</script>'
  });
  assert.match(result.html, /<!doctype html>/i);
  assert.match(result.html, /<strong>Updated<\/strong>/);
  assert.doesNotMatch(result.html, /onclick|<script>alert/);
  assert.match(result.html, /<title>T<\/title>/);
});

test('fragments that break their container structure are rejected', () => {
  const annotated = annotateEditableHtml(PAGE, 'en:/demo/index.html');
  assert.throws(
    () => applyElementEdits(PAGE, 'en:/demo/index.html', { [annotated.keys[1]]: '<h2>Invalid in p</h2>' }),
    /not valid inside element|changed the document structure/
  );
});

test('sanitizer secures blank target links', () => {
  assert.equal(
    sanitizeFragment('<a href="https://example.com" target="_blank">Example</a>'),
    '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Example</a>'
  );
});

test('bootstrap injection is idempotent and uses explicit deployment data', () => {
  const options = {
    apiBase: 'https://test.infobase-dev.com/live-edits',
    siteKey: 'fr', projectPath: '/demo', pagePath: '/demo/index.html',
    widgetUrl: 'https://fr.infobase-dev.com/_live-edits/v4/widget/editor.js'
  };
  const once = injectEditorBootstrap(PAGE, options);
  const twice = injectEditorBootstrap(once, options);
  assert.equal(once, twice);
  assert.match(once, /data-site-key="fr"/);
  assert.match(once, /https:\/\/test\.infobase-dev\.com\/live-edits/);
});
