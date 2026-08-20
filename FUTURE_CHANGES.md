# Future changes

This backlog records improvements intentionally deferred beyond version 4.2.0.

## Next release candidates

1. A first class rollback command that validates and restores a publish event, updates local source hashes, records a rollback audit event, and guides preview refresh.
2. A human readable publish diff showing text, markup, links, accessibility attributes, and before versus after fragments, with an approval artifact that can be retained.
3. Structured application logs with rotation, correlation IDs across IIS and Node, health telemetry, disk and database alerts, and centralized security monitoring.
4. Verified individual identity and role-based authorization if an approved organizational identity provider becomes available. The current deployment intentionally uses network-trusted, self-reported reviewer identity and a separate admin-console credential.

## Editor and workflow

* Replace the remaining browser `execCommand` use for plain text insertion with a maintained selection and input implementation.
* Add an explicit formatting toolbar backed by a structured rich text model so invalid nesting is prevented before save.
* Add autosave drafts stored separately from approved revisions and a recovery UI for browser or network failure.
* Add comment threads, mentions, assignments, due dates, filters, and comment history.
* Add compare and selective merge controls for same element collaboration conflicts.
* Add formal approvals, notifications, assignments, due dates, and richer release readiness checks to the current project dashboard and review state.
* Add WCAG focused automated and manual validation for editor controls and edited output, including bilingual screen reader review.
* Add professionally reviewed French interface translations and localized dates and plural forms.
* Add controlled media upload through a scanning and approval pipeline instead of accepting only existing URLs and data images.

## Publishing and source control

* Offer Git branch and pull request publishing as an alternative to direct source writes, including reviewer attribution and CI validation.
* Add HTML, link, accessibility, CSP, and product specific automated checks to the publish gate.
* Add a durable publish job state so an API audit acknowledgement failure can be reconciled automatically.
* Add retention policies and cleanup commands for staging previews, setup backups, publish backups, legacy database tables, edits, comments, logs, and audit records.
* Add a source move and rename workflow that preserves explicit element keys and page history.
* Replace DOM position derived automatic keys with build time explicit source keys for products whose templates reorder content frequently.

## Platform and operations

* Package signed release artifacts and implement CI that tests Windows IIS and Linux staging behavior before deployment.
* Run the Azure API as a managed Windows service with controlled log rotation and service recovery instead of Task Scheduler.
* Add automated database backup verification, restore drills, integrity checks, and documented recovery objectives.
* Evaluate PostgreSQL and a shared realtime adapter if multiple API instances, high availability, or larger collaboration volume becomes necessary.
* Add infrastructure as code for DNS, TLS, IIS, firewall, service identity, secrets, monitoring, and Cloud9 web server access rules.
* Add administrator-secret rotation tooling and overlapping console credentials during a controlled cutover.
* Add browser end to end tests for Chromium, Firefox, and WebKit plus visual regression tests against representative WET and Health Infobase pages.

## Decisions needed

* Reconfirm the approved VPN/network boundary whenever dev hosting or infrastructure changes.
* If verified individual authentication becomes feasible, confirm the identity provider, tenant, app registration ownership, redirect URIs, reviewer population, and group model.
* Confirm desired backup retention, edit history retention, comment retention, reviewer audit requirements, and release approval policy.
* Confirm whether source publishing should remain direct filesystem editing or move to a Git based review and deployment flow.
