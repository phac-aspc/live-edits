# Browser editor

`editor.js` is copied by the setup command to the shared `/_live-edits/v4/widget/` folder served through the existing Apache alias. Do not add it to production product pages manually.

The injected script supplies `data-api-base`, `data-site-key`, `data-project-path`, and `data-page-path`. The editor never infers English or French hostnames. It edits only elements with `data-live-edits-key` and keeps the editor access code in `sessionStorage`.

The control bar uses Shadow DOM. Saved page fragments are sanitized again by the server, so client behavior is not a security boundary.
