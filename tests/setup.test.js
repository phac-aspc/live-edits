import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('setup stages a locale product without exposing private files', (context) => {
  const root = resolve(process.cwd(), 'state', 'tests');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(resolve(root, 'setup-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const webRoot = resolve(directory, 'wwwroot', 'en');
  const stagingRoot = resolve(directory, 'wwwroot', '_live-edits', 'v4');
  const source = resolve(webRoot, 'demo');
  mkdirSync(source, { recursive: true });
  mkdirSync(resolve(directory, 'wwwroot', '_live-edits', 'widget'), { recursive: true });
  writeFileSync(resolve(source, 'index.html'), '<!doctype html><html><body><main><h1>Demo</h1><p>Text</p></main></body></html>');
  writeFileSync(resolve(source, '.env'), 'SECRET=never-copy');
  writeFileSync(resolve(source, '.htpasswd'), 'reviewer:never-copy');
  writeFileSync(resolve(source, 'admin.php'), '<?php echo "never execute"; ?>');
  writeFileSync(resolve(source, 'maintenance.ps1'), 'Write-Host "never execute"');
  writeFileSync(resolve(directory, 'wwwroot', '_live-edits', 'widget', 'editor.js'), 'legacy widget');

  const env = { ...process.env, LIVE_EDITS_STATE_DIR: resolve(directory, 'private-state') };
  const args = [
    'scripts/setup-product.js', '--site', 'en', '--source', source,
    '--web-root', webRoot, '--staging-root', stagingRoot,
    '--origin', 'https://en.infobase-dev.com', '--no-register'
  ];
  execFileSync(process.execPath, args, { cwd: process.cwd(), env });

  const preview = resolve(stagingRoot, 'products', 'en', 'demo');
  const staged = readFileSync(resolve(preview, 'index.html'), 'utf8');
  assert.match(staged, /data-live-edits-key="le_[a-f0-9]{20}"/);
  assert.match(staged, /data-api-base="https:\/\/test\.infobase-dev\.com\/live-edits"/);
  assert.match(staged, /data-site-key="en"/);
  assert.equal(existsSync(resolve(preview, '.env')), false);
  assert.equal(existsSync(resolve(preview, '.htpasswd')), false);
  assert.equal(existsSync(resolve(preview, 'admin.php')), false);
  assert.equal(existsSync(resolve(preview, 'maintenance.ps1')), false);
  assert.equal(existsSync(resolve(stagingRoot, 'widget', 'editor.js')), true);
  assert.equal(
    readFileSync(resolve(directory, 'wwwroot', '_live-edits', 'widget', 'editor.js'), 'utf8'),
    'legacy widget'
  );
  assert.equal(existsSync(resolve(directory, 'private-state', 'projects', 'en', 'demo.json')), true);

  const duplicate = spawnSync(process.execPath, args, { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /--force/);

  execFileSync(process.execPath, [...args, '--force'], { cwd: process.cwd(), env });
  assert.equal(existsSync(resolve(directory, 'private-state', 'setup-backups', 'en')), true);
});
