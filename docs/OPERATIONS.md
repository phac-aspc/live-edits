# Day-to-day operations

Normal Live Edits work is performed in the admin console at:

`https://en.infobase-dev.com/_live-edits/v4/admin/`

The console is for the Health Infobase administration team. Program reviewers receive only a project preview link.

## Start a project

1. Open the admin console while connected to the approved network or VPN.
2. Sign in with your name and the separate admin-console passphrase.
3. In **Add a project**, filter by product or locale.
4. Confirm the product has the expected locale, path, and HTML page count.
5. Select **Add to Live Edits**.
6. Open the generated preview and confirm that the expected pages, assets, and Live Edits controls load.
7. Use **Copy review link** and send only that link to the program team.

The product must be a top-level folder under the English or French web root and contain at least one HTML page. Folder names must use letters, numbers, dots, underscores, or hyphens. Private files, executable scripts, databases, logs, version-control data, and symbolic links are excluded or rejected during staging.

## Program-team review

The reviewer opens the preview and enters a name and email. These values are self-reported and recorded for activity attribution; they are not verified accounts. The reviewer can:

* edit only the visibly keyed content regions;
* save a new page revision;
* add and resolve anchored comments;
* view compatible revision history;
* see who else is present on the page.

Reviewers cannot register, refresh, close, archive, or publish projects. If two people save the same block, the widget preserves the local version and reports the conflict instead of silently overwriting it.

## Manage a current project

The dashboard shows review state, registered page count, unpublished page count, unresolved comments, source state, last edit, and last publication. Available actions are:

| Action | Effect |
| --- | --- |
| **Open preview** | Opens the staged, editable product. |
| **Open live** | Opens the current source product served by the dev site. |
| **Copy review link** | Copies the program-team preview URL. |
| **Activity** | Shows recent saves, comments, and publications without exposing reviewer email addresses. |
| **Refresh staging** | Backs up and rebuilds the preview from current source, then refreshes Azure page manifests. |
| **Dry run** | Validates and displays the exact pending publication plan without writing files. |
| **Publish** | Runs a fresh dry run, requires typed confirmation, writes validated content, creates backups, and records the audit event. |
| **Close review** | Immediately blocks reviewer API access while preserving previews, revisions, comments, and backups. |
| **Reopen review** | Allows reviewers to connect to the project again. |
| **Archive** | Closes review, preserves Azure history, and moves staging plus private configuration into private C9 storage. The source is retained by default. |

When the dashboard marks the source as **changed**, refresh staging and have the program team confirm or resave the affected page before publishing. Refreshing can make old edits structurally incompatible when the source page layout changed; the API intentionally excludes those stale revisions.

## Publish safely

1. Resolve or consciously accept the outstanding comments.
2. Select **Publish**.
3. Review the automatically generated dry run.
4. Confirm every listed page and revision belongs to this release.
5. Enter the displayed project name exactly.
6. Select **Publish changes**.
7. Open the live dev link and verify the published content in context.
8. Close review when the program team is finished.

Publishing changes only registered keyed fragments. It does not copy staged CSS, JavaScript, media, configuration, a whole page body, or the editor widget into the source product.

## Archive and restore projects

1. Select **Archive** on the current project.
2. Review the pending page and unresolved comment counts.
3. Enter the exact project name.
4. Leave **Also move the source folder** unchecked for every real product.
5. Select that option only for a smoke test or temporary demonstration whose source should be removed from the locale web root.
6. Confirm archival. The project moves to **Archived projects** and reviewer access closes immediately.

Select **Restore** to reactivate an archive. Restoration returns an archived test source when necessary, rebuilds staging from the current source, refreshes page manifests, and keeps review closed. Inspect the preview before selecting **Reopen review**.

Permanent deletion becomes available after 30 days. It requires the exact project name and `DELETE`. Azure refuses deletion while compatible unpublished edits or unresolved comments remain. Permanent deletion removes the Azure project and its related collaborative records, then removes the private C9 archive while retaining a private purge record.

## Recovery

Project archives are stored privately below `state/project-archives/SITE/PROJECT/TIMESTAMP/`. Publication backups remain below `state/publish-backups/SITE/PROJECT/`. Project restoration does not restore an individual publication backup. A release manager must compare a publication backup with the current source and record any content rollback before restoring it. After a content rollback, refresh staging so the preview, source hashes, and page manifests agree.

The scripts in `scripts/` remain available for incident recovery when the admin service is unavailable. They are not the normal operating workflow; see [scripts/README.md](../scripts/README.md).
