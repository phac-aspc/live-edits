# Changelog

## 4.0.0

### Deployment and identity

* Changed the Azure TEST API address to `https://test.infobase-dev.com/live-edits`.
* Added explicit English and French preview origins and document roots.
* Isolated all public version 4 previews and widget assets under the existing shared Apache alias at `/_live-edits/v4/`, with locale namespaced product folders, so deployment cannot overwrite older Live Edits assets or require virtual host changes.
* Replaced hostname rewriting with injected `site_key`, API, project, page, and widget settings.
* Namespaced projects by locale and source URL path.
* Added locked dependency files, Node engine policy, `.nvmrc`, environment template, IIS configuration, a Windows installer and startup task, a Cloud9 bootstrap, and an Apache static preview policy plus installer.

### Editing and collaboration

* Replaced random browser element IDs with deterministic source keys.
* Limited automatic editing to safe leaf content blocks and supported explicit nonnested regions.
* Added registered page manifests so structurally stale revisions cannot be silently loaded or published.
* Rebuilt the bilingual editor with isolated Shadow DOM controls, session only credentials, accessible status, keyboard save, dirty state warnings, safe plain text paste, anchored comments, history, presence, and optimistic conflict handling with element level merge.
* Removed hostname inference, duplicate event registration, forced polling, whole `<main>` editing, and body HTML snapshots.

### API and data

* Replaced duplicated and regular expression routes with one `/api/v1` API.
* Added separate editor and administrator roles, production authentication enforcement, exact CORS origins, Helmet headers, rate limiting, body limits, request IDs, safe errors, and graceful shutdown.
* Added server side HTML sanitization, UUID generation through `crypto`, optimistic revisions, content hashes, key manifest validation, publish audit events, and anchored comment validation.
* Replaced persisted presence rows with authenticated Socket.IO room presence.
* Added SQLite WAL, foreign keys, busy timeout, indexes, schema versioning, persistent data directory creation, and backup plus archival of detected version 3 tables.
* Fixed environment loading so `.env` is read before the database path is resolved, regardless of process working directory.

### Setup and publishing

* Moved private project state and backups outside public preview folders.
* Added source and destination containment checks, symlink rejection, secret and executable file exclusions, hidden temporary staging, safe staging replacement, and widget version synchronization.
* Changed publishing to dry run by default.
* Replaced whole body reconstruction and whole tree copying with sanitized keyed fragment application.
* Added baseline hash conflicts, page manifest compatibility, complete preflight validation, structural reparse validation, atomic file replacement, per file backups, rollback on partial write failure, and idempotent exact revision publish acknowledgement with recovery after a lost API response.

### Quality and documentation

* Added parsing, sanitization, structure, authorization, API conflict, publishing audit, and comments tests.
* Added syntax validation and comprehensive deployment, operations, architecture, and security documentation.

Version 4 is not API, payload, database, project state, or publisher compatible with version 3. Legacy database tables are preserved for manual reference and should not be published through version 4.
