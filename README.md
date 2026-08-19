# Health Infobase Live Edits

Live Edits is a bilingual, collaborative review tool for making controlled HTML content changes in staged Health Infobase pages. Version 4 separates the public preview sites from the edit API:

| Role | URL or location |
| --- | --- |
| English preview | `https://en.infobase-dev.com`, served from `/home/ec2-user/environment/wwwroot/en` |
| French preview | `https://fr.infobase-dev.com`, served from `/home/ec2-user/environment/wwwroot/fr` |
| TEST API | `https://test.infobase-dev.com/live-edits` on the Azure Windows TEST VM |
| Production source | The selected product folder under the applicable English or French document root |

The Cloud9 setup command copies a product into the existing shared Apache alias under `/_live-edits/v4/products/en/` or `/_live-edits/v4/products/fr/`, assigns deterministic keys to safe content blocks, injects the editor bootstrap, copies the shared version 4 widget, and registers the project with Azure. Editors authenticate with a shared editor access code, edit only keyed regions, save versioned fragment maps, comment on specific elements, view history, and see presence. The publisher retrieves the latest unpublished revisions and applies only those fragments to the source files after validation and a dry run.

Version 4 intentionally does not publish the widget or its bootstrap. It leaves only benign `data-live-edits-key` attributes in published HTML so future edit sessions keep the same element identities.

## Safety model

The default production mode requires two different 32 character or longer tokens:

* `EDITOR_TOKEN` permits browser editing, history, comments, and presence.
* `ADMIN_TOKEN` permits project registration and publishing. It must never be placed in browser code or a web root.

The server sanitizes every saved fragment. Publishing is dry run by default, refuses changed source files unless explicitly overridden, rejects missing or nested keys and structurally invalid HTML, creates private per file backups, writes validated files atomically, and records a publish event.

The shared token mode is the secure interim deployment option. Individual Microsoft Entra ID authentication and role based authorization are tracked in [FUTURE_CHANGES.md](FUTURE_CHANGES.md) pending tenant and app registration decisions.

## Requirements

* Node.js 24.18.1 or newer and earlier than Node.js 25.
* Azure TEST VM with IIS, WebSocket Protocol, URL Rewrite, and Application Request Routing.
* SQLite storage on a persistent local TEST VM volume.
* Apache with English and French document roots on the EC2 Cloud9 host.

## Start here

1. Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to build the Azure TEST VM and the new Cloud9 host.
2. Follow [docs/OPERATIONS.md](docs/OPERATIONS.md) to stage and publish a product.
3. Read [docs/SECURITY.md](docs/SECURITY.md) before exposing previews to external reviewers. The Cloud9 bootstrap does not change existing Apache mappings; its access hardening configuration is optional.
4. Review [CHANGELOG.md](CHANGELOG.md) and [FUTURE_CHANGES.md](FUTURE_CHANGES.md).

## Development

```bash
npm ci
npm --prefix server ci
npm test
npm --prefix server test
npm run check
```

Copy `server/.env.example` to `server/.env` before starting the API. Development may use `AUTH_MODE=disabled` only when `NODE_ENV` is not `production` and the server is bound to a trusted local interface.

```bash
npm --prefix server start
```

The release version is `4.0.0`. It is intentionally a major version because the API routes, database schema, saved payload, project identity, setup state, and publishing behavior are incompatible with version 3.
