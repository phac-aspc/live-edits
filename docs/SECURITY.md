# Security notes

## Network-trusted reviewer access

The intended version 4.1 deployment uses `EDITOR_AUTH_MODE=network`. Reviewer API routes no longer require a shared access code, so the organizational VPN/network boundary is the primary access control for previews, HTTP APIs, and realtime connections.

This mode is appropriate only when all of these statements are true:

* `en.infobase-dev.com`, `fr.infobase-dev.com`, and `test.infobase-dev.com` are unreachable outside the approved network or VPN;
* Azure exposes only IIS HTTPS ingress, not Node port 3000;
* C9 exposes only Apache HTTPS ingress, not the admin service port 3100;
* CORS remains limited to the exact English and French HTTPS origins;
* the team accepts that name and email are self-reported, not verified identities.

Test the three hostnames from a device that is not on the VPN before enabling network mode and after firewall, DNS, proxy, or load-balancer changes. CORS is a browser control, not a substitute for network access control.

Every reviewer request must include a valid name and email. Azure stores the normalized email privately with edits and comments, but reviewer responses, history, comments, realtime presence, and the C9 activity view expose only the display name. Treat the database as containing personal information and apply the approved retention and access rules.

`EDITOR_AUTH_MODE=token` remains available for rollback. `EDITOR_AUTH_MODE=disabled` is rejected in production.

## Administrative access

Azure administrative routes always retain `AUTH_MODE=token` and require `ADMIN_TOKEN`. That token is present only in the Azure environment and the loopback-only C9 admin-service environment. It must never appear in browser JavaScript, session storage, a web root, project configuration, command history, logs, or source control.

The C9 console uses a different `LIVE_EDITS_ADMIN_UI_TOKEN`. Successful login creates a short-lived session signed by that value. The cookie is Secure, HttpOnly, SameSite=Strict, restricted to the admin path, and paired with an origin-bound CSRF value. Login attempts are rate limited. The service binds only to `127.0.0.1` and Apache proxies only the dedicated admin path.

The UI passphrase is for the Health Infobase administration team, not program reviewers. Rotate it after suspected disclosure or team-membership changes. Rotate `ADMIN_TOKEN` separately and update Azure and C9 together.

## Project controls

Projects have independent lifecycle values:

* `status=active|archived` controls administrative lifecycle;
* `review_status=open|closed` controls reviewer access.

Closing review immediately blocks lookup, page data, saves, comments, and realtime room joins while retaining all project data. Program reviewers have no registration, refresh, project-state, activity, publish, or archive permissions.

## Content and publishing safety

The API sanitizes HTML fragments against an explicit allowlist. Setup rejects symlinks and excludes common credentials, databases, executable scripts, logs, backups, dependency folders, and version-control data. Page manifests bind edits to exact stable element keys.

Publishing sanitizes again, verifies source containment and hashes, validates the complete plan before writing, creates private backups, uses atomic sibling replacement, and rolls back partial writes. The console always runs a fresh dry run and requires typed project-name confirmation before `--apply` is invoked.

This reduces stored cross-site scripting and accidental overwrite risk but does not replace review of links, images, identifiers, classes, accessibility, product behavior, and Content Security Policy.

## Secrets, files, and reporting

Protect `/etc/live-edits/admin.env`, Azure `server/.env`, SQLite database and WAL files, C9 `state/`, logs, setup backups, and publish backups. None may be web served or committed. The C9 repository does not require a `.git` directory at runtime.

Do not put real tokens, reviewer personal information, database contents, or unpublished content in public issues or chat transcripts. Follow organizational incident and vulnerability reporting processes.
