#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  apiRequest,
  assertContained,
  assertSimpleName,
  assertSiteKey,
  parseArguments,
  projectConfigPath,
  readJson,
  sha256,
  stateDirectory,
  toUrlPath,
  writeJson
} from './runtime.js';
import { EDIT_PAYLOAD_VERSION, applyElementEdits, stripEditorBootstrap } from './html-tools.js';

const HELP = `
Live Edits safe publisher

Usage:
  node scripts/publish-product.js --site en --name my-product
  node scripts/publish-product.js --site en --name my-product --apply

The default is a dry run. Use --apply only after reviewing the plan.

Options:
  --site en|fr              Project namespace
  --name NAME               Project name (or provide it as the first argument)
  --apply                   Write validated changes to source files
  --allow-source-changes    Permit source hashes changed since setup
  --published-by NAME       Audit name for the publish operation
  --help                    Show this help

Set LIVE_EDITS_ADMIN_TOKEN in the environment.
`;

function relativePagePath(projectPath, pagePath) {
  const normalizedProject = toUrlPath(projectPath);
  const normalizedPage = toUrlPath(pagePath);
  if (normalizedProject === '/') return normalizedPage.slice(1);
  const prefix = `${normalizedProject}/`;
  if (!normalizedPage.startsWith(prefix)) {
    throw new Error(`Page ${normalizedPage} is outside project path ${normalizedProject}.`);
  }
  return normalizedPage.slice(prefix.length);
}

function decodePayload(edit) {
  if (edit.payload_version !== EDIT_PAYLOAD_VERSION) {
    throw new Error(
      `Page ${edit.page_path} uses unsupported payload version ${edit.payload_version ?? 'legacy'}. `
      + 'Create a fresh version 4 edit before publishing.'
    );
  }
  const payload = typeof edit.payload === 'string' ? JSON.parse(edit.payload) : edit.payload;
  if (payload?.version !== EDIT_PAYLOAD_VERSION || !payload.elements) {
    throw new Error(`Page ${edit.page_path} has an invalid edit payload.`);
  }
  return payload;
}

async function main() {
  const args = parseArguments(process.argv.slice(2), {
    apply: { type: 'boolean' },
    'allow-source-changes': { type: 'boolean' },
    help: { type: 'boolean' }
  });
  if (args.help) {
    console.log(HELP.trim());
    return;
  }

  const siteKey = assertSiteKey(args.site || process.env.LIVE_EDITS_SITE);
  const projectName = assertSimpleName(args.name || args._[0], 'Project name');
  const configFile = projectConfigPath(siteKey, projectName);
  if (!existsSync(configFile)) throw new Error(`Project config not found: ${configFile}`);
  const config = readJson(configFile);
  if (!config.project_id) throw new Error('Project is not registered with the Azure API.');

  const adminToken = process.env.LIVE_EDITS_ADMIN_TOKEN;
  if (!adminToken) throw new Error('LIVE_EDITS_ADMIN_TOKEN is required.');

  if (config.pending_publish_ack) {
    await apiRequest(config.api_base, `/api/v1/projects/${encodeURIComponent(config.project_id)}/publish`, {
      method: 'POST', token: adminToken, body: config.pending_publish_ack
    });
    delete config.pending_publish_ack;
    writeJson(configFile, config);
    console.log('Reconciled the pending publish audit acknowledgement.');
  }

  const edits = await apiRequest(
    config.api_base,
    `/api/v1/projects/${encodeURIComponent(config.project_id)}/edits/latest`,
    { token: adminToken }
  );

  const plans = [];
  for (const edit of edits) {
    const payload = decodePayload(edit);
    const relativeFile = relativePagePath(config.project_path, edit.page_path);
    if (!/\.html?$/i.test(relativeFile)) throw new Error(`Edited page is not HTML: ${edit.page_path}`);
    const sourceFile = assertContained(config.source_path, resolve(config.source_path, relativeFile), 'Edited page');
    if (!existsSync(sourceFile)) throw new Error(`Source page does not exist: ${sourceFile}`);
    const before = readFileSync(sourceFile, 'utf8');
    const expectedHash = config.source_hashes?.[relativeFile];
    const applied = applyElementEdits(before, `${siteKey}:${edit.page_path}`, payload.elements);
    const after = stripEditorBootstrap(applied.html);
    if (expectedHash && sha256(before) !== expectedHash && after !== before && !args['allow-source-changes']) {
      throw new Error(
        `Source changed after setup: ${relativeFile}. Re-run setup to refresh the preview, `
        + 'or inspect the change and use --allow-source-changes.'
      );
    }
    plans.push({
      edit,
      relativeFile,
      sourceFile,
      before,
      after,
      needsWrite: after !== before,
      changedKeys: applied.changedKeys
    });
  }

  if (!plans.length) {
    console.log('No unpublished content changes were found.');
    return;
  }

  console.log(`${args.apply ? 'Applying' : 'Dry run:'} ${plans.length} page(s)`);
  for (const plan of plans) {
    const action = plan.needsWrite ? `${plan.changedKeys.length} region(s)` : 'source already matches; audit acknowledgement only';
    console.log(`  ${plan.relativeFile}: ${action}, revision ${plan.edit.revision}`);
  }
  if (!args.apply) {
    console.log('No files were written. Re-run with --apply to publish this plan.');
    return;
  }

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const backupRoot = resolve(stateDirectory(), 'publish-backups', siteKey, projectName, timestamp);
  const written = [];
  try {
    for (const plan of plans) {
      if (!plan.needsWrite) continue;
      const backupFile = assertContained(backupRoot, resolve(backupRoot, plan.relativeFile), 'Backup file');
      mkdirSync(dirname(backupFile), { recursive: true });
      copyFileSync(plan.sourceFile, backupFile);

      const temporaryFile = resolve(dirname(plan.sourceFile), `.${basename(plan.sourceFile)}.live-edits-${process.pid}.tmp`);
      writeFileSync(temporaryFile, plan.after, 'utf8');
      renameSync(temporaryFile, plan.sourceFile);
      written.push({ ...plan, backupFile });
    }
  } catch (error) {
    for (const plan of written.reverse()) copyFileSync(plan.backupFile, plan.sourceFile);
    throw new Error(`Publish write failed and completed files were rolled back: ${error.message}`);
  }

  const acknowledgement = {
    operation_id: randomUUID(),
    published_by: args['published-by'] || process.env.USER || 'publisher',
    pages: plans.map(({ edit }) => ({ page_path: edit.page_path, revision: edit.revision }))
  };
  for (const plan of plans) config.source_hashes[plan.relativeFile] = sha256(plan.after);
  config.last_published_at = new Date().toISOString();
  config.pending_publish_ack = acknowledgement;
  writeJson(configFile, config);

  let auditError = null;
  try {
    await apiRequest(config.api_base, `/api/v1/projects/${encodeURIComponent(config.project_id)}/publish`, {
      method: 'POST',
      token: adminToken,
      body: acknowledgement
    });
  } catch (error) {
    auditError = error;
    console.warn(`Files were published, but the API audit update failed: ${error.message}`);
    console.warn('Re-running with --apply is safe; matching files will be acknowledged without another write.');
  }

  if (!auditError) {
    delete config.pending_publish_ack;
  }
  writeJson(configFile, config);
  if (auditError) {
    process.exitCode = 2;
    return;
  }
  console.log(`Published ${plans.length} page(s). Backup: ${backupRoot}`);
}

main().catch((error) => {
  console.error(`Publish failed: ${error.message}`);
  process.exitCode = 1;
});
