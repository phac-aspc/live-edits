# Changelog

## 4.2.0

### Project lifecycle

* Added administrator-only project archival from the browser console with typed confirmation and a clear summary of pending pages and unresolved comments.
* Archival closes review, preserves Azure history, moves active staging and private configuration into C9 private storage, and leaves the source product untouched by default.
* Added an explicit option for smoke tests and temporary demonstrations that moves the source folder into the same recoverable private archive.
* Added an Archived Projects section with retention status and restoration that rebuilds staging from the current source, reactivates Azure registration, and keeps review closed until an administrator reopens it.
* Added permanent deletion only after a 30-day archive retention period, with separate project-name and `DELETE` confirmations. Azure rejects deletion while unpublished edits or unresolved comments remain.
* Added private purge records and server-side Azure cascade deletion so normal lifecycle operations never require direct SQLite or shell commands.

### Deployment resilience

* Changed the C9 admin service mask to `0027` so Apache can read staged previews through the `apache` group while private JSON remains explicitly `0600`.
* Added bounded admin health retries to prevent a successful service start from being rolled back by an immediate health-check race.
* Added verified temporary HTML writes so an empty or incomplete generated page cannot replace a valid staging preview.

## 4.1.0

### Browser administration

* Added a C9-hosted admin landing page that discovers eligible English and French product folders and lists current Live Edits projects.
* Added one-click project setup and staging refresh, preview and live links, link copying, source-state checks, Azure health and work summaries, and recent activity.
* Added open and closed review state. Closing review immediately blocks reviewer reads, writes, comments, and realtime joins without deleting project data.
* Added publication dry runs and confirmed publication to the dashboard. The console runs a new dry run, requires typed project-name confirmation, preserves publisher attribution, and uses the existing validated backup-producing publisher.
* Added a loopback-only C9 admin service, separate short-lived admin-console sessions, origin and CSRF enforcement, login throttling, serialized filesystem operations, a dedicated systemd unit, and a narrowly scoped Apache proxy configuration.

### Reviewer access and audit

* Added production `EDITOR_AUTH_MODE=network` so VPN-authorized reviewers enter only a self-reported name and email instead of receiving a shared editor token.
* Retained `AUTH_MODE=token` and `ADMIN_TOKEN` for all administrative API operations, and retained editor token mode as a rollback option.
* Added private normalized reviewer email attribution to edits and comments while deliberately omitting email from reviewer responses, history, comments, presence, and admin activity output.
* Added project-summary counts and activity endpoints for administrators.

### Documentation and quality

* Replaced normal command-line operations with the admin-console workflow and retained the scripts only as a break-glass interface.
* Added network-mode, review-closure, private-attribution, admin-session, CSRF, discovery, and end-to-end admin setup tests.
* Documented Azure-first deployment order, network access gates, C9 installation without Git metadata, isolated rollback, and the unchanged English/French Apache mappings.

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
