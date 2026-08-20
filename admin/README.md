# C9 admin console

The admin console is a loopback-only Node.js service on C9. Apache exposes only `/_live-edits/v4/admin/` through a dedicated reverse proxy. The service scans the English and French document roots, invokes the existing setup and publisher with validated arguments, and calls Azure with the administrator token held in its environment.

The console also manages the complete project lifecycle. Archiving moves staging and private configuration below `state/project-archives/`, optionally moves a temporary source product, closes Azure review, and preserves collaborative history. Restoration rebuilds staging and keeps review closed. Permanent deletion is available only after the Azure-enforced retention period and only when no unpublished edits or unresolved comments remain.

Browser sessions are signed with a separate console passphrase, expire after 60 minutes by default, use a Secure, HttpOnly, SameSite=Strict cookie, and require an origin-bound CSRF value for every change. The Azure administrator token is never returned to the browser or written to project state.

One-time installation is documented in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). Normal use is documented in [../docs/OPERATIONS.md](../docs/OPERATIONS.md).
