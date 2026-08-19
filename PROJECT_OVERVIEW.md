# Project overview

Live Edits 4 has three runtime components.

1. `scripts/setup-product.js` runs on the EC2 Cloud9 host. It creates locale specific staged previews and private project configuration.
2. `widget/editor.js` runs only in staged pages. It loads and saves versioned element fragments through the Azure TEST API.
3. `server/` runs on the Azure Windows TEST VM behind the IIS application at `/live-edits`. It stores projects, revisions, comments, and publish audit events in SQLite and provides Socket.IO presence.

`scripts/publish-product.js` runs on Cloud9 as an administrator operation. It does not copy a staged tree over a source tree. It applies sanitized fragments to their stable source elements, after source hash and HTML structure checks.

Project identity is `(site_key, project_path)`. This prevents English and French projects with the same URL path from colliding. Page identity is `site_key:page_path`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the detailed data flow and [docs/OPERATIONS.md](docs/OPERATIONS.md) for commands.
