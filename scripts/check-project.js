#!/usr/bin/env node

import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './runtime.js';

const roots = ['scripts', 'server/src', 'server/test', 'tests', 'widget'];
const files = [];

function visit(path) {
  for (const entry of readdirSync(path)) {
    const absolute = resolve(path, entry);
    if (statSync(absolute).isDirectory()) visit(absolute);
    else if (entry.endsWith('.js')) files.push(absolute);
  }
}

for (const root of roots) {
  try { visit(resolve(REPO_ROOT, root)); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}
console.log(`Syntax checked ${files.length} JavaScript files.`);

const shellScripts = [
  resolve(REPO_ROOT, 'deployment', 'aws', 'bootstrap-cloud9.sh'),
  resolve(REPO_ROOT, 'deployment', 'aws', 'install-apache-config.sh')
];
const bashCheck = spawnSync('bash', ['--version'], { encoding: 'utf8' });
if (bashCheck.status === 0) {
  for (const file of shellScripts) {
    const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      process.stderr.write(result.stderr);
      process.exit(result.status || 1);
    }
  }
  console.log(`Syntax checked ${shellScripts.length} shell scripts.`);
}
