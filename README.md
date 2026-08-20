# Health Infobase Live Edits

Live Edits is a bilingual, collaborative review tool for controlled HTML content changes in staged Health Infobase products. Version 4.1 adds a browser-based administration console so normal project setup and publishing no longer require Cloud9 commands.

| Component | Location | Purpose |
| --- | --- | --- |
| Reviewer previews | `en.infobase-dev.com` and `fr.infobase-dev.com` | Program teams edit keyed content, comment, view history, and see presence. |
| TEST API | `https://test.infobase-dev.com/live-edits` | Azure stores revisions, comments, project status, and publish audit events. |
| Admin console | `https://en.infobase-dev.com/_live-edits/v4/admin/` | The Health Infobase team discovers products, stages projects, manages review, previews publication, publishes, and views activity. |
| C9 source and publisher | `/home/ec2-user/environment` | Source products, staged previews, private state, and backups remain on C9. |

## Normal workflow

An administrator opens the admin console, selects a product found under the English or French web root, and chooses **Add to Live Edits**. The console stages the product, assigns deterministic content keys, installs the editor widget, and registers the page manifests with Azure.

A reviewer opens the generated preview link and supplies a self-reported name and email. No editor access code is used in the network-trusted mode. Reviewers cannot publish. The admin console shows pending pages and unresolved comments, requires a dry run before publication, requires the project name as confirmation, creates private backups, and records the publisher in Azure.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for the short browser workflow. Shell commands remain only as a break-glass recovery interface.

## Access model

The intended deployment relies on the organizational VPN/network boundary for all three development hostnames. `EDITOR_AUTH_MODE=network` removes the shared reviewer token but does not verify a person's identity; names and emails are self-reported audit labels. The email is stored privately and is not returned in reviewer API responses.

Administrative operations remain protected by two different secrets:

* `ADMIN_TOKEN` is held by the Azure API and the loopback-only C9 admin service. It never reaches the browser.
* `LIVE_EDITS_ADMIN_UI_TOKEN` signs short-lived admin-console sessions and is known only to the Health Infobase administration team.

Do not enable network mode unless the preview and API hostnames are unreachable from outside the approved VPN. Read [docs/SECURITY.md](docs/SECURITY.md) before deployment.

## Safety model

The server sanitizes every saved fragment. Publishing refuses changed source baselines, missing or nested keys, incompatible manifests, and structurally invalid HTML. It validates the complete plan before writing, creates private per-file backups, replaces files atomically, rolls back partial writes, and uses an idempotent Azure audit acknowledgement.

The widget and bootstrap are never published to the source product. Only benign stable `data-live-edits-key` attributes remain so future review sessions preserve element identity.

## Development

Requirements are Node.js 24.18.1 or newer and earlier than Node.js 25, Apache on C9, and IIS with URL Rewrite and ARR on Azure TEST.

```bash
npm ci
npm --prefix server ci
node --test tests/*.test.js
node --test server/test/*.test.js
npm run check
```

The current release is `4.1.0`. Deployment and upgrade order are documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
