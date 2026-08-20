# Project overview

Live Edits 4.1 has four runtime components.

1. `admin/server.js` runs on C9 behind a narrow Apache proxy. It discovers products and provides the admin landing page.
2. `scripts/setup-product.js` and `scripts/publish-product.js` run as validated child operations of the admin service. They own staging, source writes, private state, and backups.
3. `widget/editor.js` runs only in staged pages. It handles reviewer editing, comments, history, and presence.
4. `server/` runs on Azure TEST behind IIS. It stores projects, review state, revisions, comments, and publish audit events in SQLite.

Project identity is `(site_key, project_path)`, preventing English and French paths from colliding. Page identity is `site_key:page_path`. Azure never receives C9 filesystem credentials, and the browser never receives the Azure administrator token.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for data boundaries and [docs/OPERATIONS.md](docs/OPERATIONS.md) for the browser workflow.
