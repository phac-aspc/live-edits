# Operations guide

Run all commands from `/home/ec2-user/environment/tools/live-edits` on the EC2 Cloud9 host. Load `LIVE_EDITS_ADMIN_TOKEN` into the current shell first.

## Stage a project

English:

```bash
node scripts/setup-product.js \
  --site en \
  --source /home/ec2-user/environment/wwwroot/en/product-name
```

French:

```bash
node scripts/setup-product.js \
  --site fr \
  --source /home/ec2-user/environment/wwwroot/fr/product-name
```

The project name defaults to the source folder name. Use `--name` only when a different stable identifier is needed. The source must be inside the selected locale's document root.

Setup performs these actions:

1. Copies public site content to the shared staging root at `wwwroot/_live-edits/v4/products/SITE/PROJECT` while excluding common secret, key, database, log, VCS, dependency, backup, and server configuration files.
2. Rejects symbolic links so a staged copy cannot escape its source boundary.
3. Selects explicit `.editable` elements when present. Otherwise it selects safe, meaningful leaf content blocks under `<main>`, falling back to `<body>`.
4. Assigns deterministic `data-live-edits-key` values and rejects nested or duplicate regions.
5. Injects explicit API, locale, project, page, and widget settings into each staged page.
6. Copies the current widget to the shared `/_live-edits/v4/widget/editor.js` path without touching an older Live Edits widget.
7. Registers the locale specific project and exact page key manifests with Azure.
8. Writes private state to `state/projects/SITE/PROJECT.json` in the tool checkout.

If a preview already exists, setup stops. Re-run with `--force`; the old preview is first copied to the private `state/setup-backups/` folder.

Use `--files` or `--subfolders` with comma separated relative paths for a deliberately limited preview. Use `--no-register` only when preparing files before Azure is available. A registered setup is required before browser editing.

## Choose editable regions explicitly

Automatic selection covers headings, paragraphs, list terms and items, captions, table cells, and block quotes. It skips forms, scripts, styles, templates, SVG, canvas, embeds, generated content, and anything marked with `data-live-edits-ignore`, `data-dynamic`, `data-generated`, `.dynamic-content`, or `.no-live-edits`.

For precise control, add `class="editable"` to nonnested source elements before setup. Existing valid `data-live-edits-key` values are preserved. Do not place one editable element inside another.

## Review and save

Open the preview URL printed by setup, such as:

```text
https://en.infobase-dev.com/_live-edits/v4/products/en/product-name/
```

Enter the reviewer name and shared editor access code. The code remains in browser `sessionStorage`, not persistent local storage.

Use Edit to enable keyed content, Save or Ctrl+S to save, Comment to view or add anchored notes, and History to restore an earlier compatible revision into the current unsaved page. Restoring history requires a new Save and never changes source files directly.

If another reviewer saves first, the API returns a revision conflict. The widget automatically merges blocks changed on only one side. If the same block changed on both sides, it keeps the local page visible and offers the server version rather than silently overwriting either editor.

## Refresh a preview after source changes

Re-run setup with `--force`. The source hashes, deterministic keys, and registered page manifests are refreshed. If page structure changed, older revisions with a different manifest are marked structurally stale and excluded from publishing. Open the refreshed preview and save a reviewed version against the new structure.

## Publish

Always review the dry run first:

```bash
node scripts/publish-product.js --site en --name product-name
```

Apply exactly that plan:

```bash
node scripts/publish-product.js --site en --name product-name --apply --published-by 'Release manager name'
```

For French, change `--site en` to `--site fr`.

The publisher retrieves only the latest unpublished edit whose manifest matches the current setup. It validates every source boundary, page extension, baseline hash, key, sanitized fragment, and resulting HTML structure before writing any file. It then backs up each changed source file below `state/publish-backups/`, uses a temporary sibling for the replacement, updates private source hashes, and sends the exact page revisions to the API publish audit endpoint under an idempotent operation ID. A failed acknowledgement is saved in private project state and reconciled on the next run.

No staged CSS, JavaScript, media, `.env`, database, configuration, or whole page body is copied back to source.

## Source change conflict

If source changed since setup, publish stops. The preferred response is:

1. Inspect the source change.
2. Re-run setup with `--force`.
3. Review the refreshed preview and save again if needed.
4. Run another dry run.

`--allow-source-changes` is available only for a release manager who has inspected the concurrent source change. Key and HTML structure validation still applies.

## Restore a file backup

Publish reports the exact backup folder. To restore, first stop other publishing activity, compare the backup and current file, then copy the required backup file back to the corresponding source path. Re-run setup afterward so stored hashes and previews match the restored source.

Restoring source files does not delete the API audit event or edit history. Record the operational rollback separately until a first class rollback command is implemented.

## Common checks

```bash
node scripts/setup-product.js --site en --list
node scripts/check-project.js
curl -fsS https://test.infobase-dev.com/live-edits/healthz
git status --short
```

Do not use `--apply`, `--force`, or `--allow-source-changes` from unattended automation without an approval and retained logs.
