# Security notes

## Current access model

Version 4 uses the confirmed shared random Bearer token model. The editor token is typed by reviewers and stored only in browser `sessionStorage`. The administrator token is used only by Cloud9 setup and publish commands. Tokens are compared in constant time after hashing, must be at least 32 characters, and must differ.

Shared tokens do not provide individual identity assurance. The reviewer name is an audit label supplied by the reviewer. Rotate both tokens after suspected disclosure, team membership changes, or according to the organizational secret rotation policy. Microsoft Entra ID is the planned identity model once tenant and application details are confirmed.

## Preview confidentiality

API authentication does not protect the static preview HTML itself. The checked in Apache base policy leaves staged HTML readable, disables indexes and execution, and blocks private or executable file types. Apply authentication, VPN, a client certificate, or IP restrictions to the shared `/_live-edits/v4/products/` tree when edits or staged content are not intended for the public. An unguessable URL is not an access control.

The optional Apache Basic Authentication override is separate from application authentication. Never put `EDITOR_TOKEN` or `ADMIN_TOKEN` in an Apache password file.

## Content safety

The browser converts pasted content to plain text. The API is the security boundary and sanitizes all HTML fragments against an explicit tag, attribute, and URL scheme allowlist. The publisher sanitizes again and refuses a fragment that reparsing would move outside its keyed container.

This reduces stored cross site scripting risk but does not make arbitrary HTML safe for every product. Keep product Content Security Policy headers enabled and review links, images, identifiers, classes, accessibility, and visual behavior before publishing.

## Network and secret boundaries

* Azure accepts browser cross origin requests only from the exact English and French HTTPS origins.
* Node binds to `127.0.0.1`; IIS is the only public ingress and terminates TLS.
* Only TCP 443 should be publicly reachable on TEST. Do not open Node port 3000.
* The administrator token, `.env`, SQLite files, WAL files, logs, private config, and backups must never be web served or committed.
* Setup rejects symlinks and path traversal and excludes common credential and database file types from staging.
* Use a dedicated TEST database and TEST secrets. Do not reuse production application credentials.

## Operational controls

Publishing requires an explicit `--apply`, creates backups, refuses changed source baselines by default, and logs a publish event. The shared token does not itself enforce two person approval, so retain the dry run output and follow the team's release approval process.

Database and log backup retention, centralized monitoring, malware scanning of repository content, operating system patching, and TLS certificate management remain infrastructure responsibilities.

## Reporting

Do not put real tokens, reviewer personal information, database contents, or unpublished content in a public issue. Follow the repository and organizational vulnerability reporting process.
