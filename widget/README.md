# Browser editor

`editor.js` is copied to `/_live-edits/v4/widget/` whenever a project is added or refreshed. Do not add it to production product pages manually.

The injected bootstrap supplies the API base, locale, project path, and page path. In the intended `EDITOR_AUTH_MODE=network` deployment, reviewers provide a self-reported name and email. Requests carry those values to the network-restricted API, which stores the email privately for audit attribution. Token mode remains available as a rollback setting.

The editor changes only elements with `data-live-edits-key`. Its Shadow DOM controls and client checks improve usability, but the Azure sanitizer, manifest validation, source-bound publisher, and network boundary remain the security controls.
