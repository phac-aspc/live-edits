# Deployment guide

Version 4.1 changes both Azure TEST and C9. Use a three-phase rollout: deploy the Azure 4.1 code while temporarily retaining editor token mode, deploy C9 and refresh the shared widget, then switch Azure to network reviewer mode. This keeps the existing staged pages usable throughout the rollout.

## Deployment map

| Component | Host | Address or binding |
| --- | --- | --- |
| API and realtime | Azure Windows TEST VM | `https://test.infobase-dev.com/live-edits` → `127.0.0.1:3000` |
| English previews/source | C9 | `https://en.infobase-dev.com` → `wwwroot/en` |
| French previews/source | C9 | `https://fr.infobase-dev.com` → `wwwroot/fr` |
| Admin console | C9 | `https://en.infobase-dev.com/_live-edits/v4/admin/` → `127.0.0.1:3100` |
| Tool, state, backups | C9 | `/home/ec2-user/environment/tools/live-edits`; never web served |

Use the isolated Node.js 24 runtime already installed on each host. The C9 runtime does not require a `.git` folder or GitHub remote.

## 1. Pre-deployment gates

1. From a device outside the VPN, confirm that all three development hostnames are unreachable.
2. Back up the Azure SQLite database using an approved method while accounting for its WAL.
3. Back up the C9 `state/` directory.
4. Record `sudo /usr/sbin/httpd -S` and `sudo apachectl -t` output so virtual hosts can be compared afterward.
5. Generate a new random `LIVE_EDITS_ADMIN_UI_TOKEN` of at least 32 characters. It must differ from `ADMIN_TOKEN`.

## 2. Deploy Azure TEST in compatibility mode

Update the release in `E:\live-edits` while preserving `server\.env` and `server\data`. Set the access section to:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_BASE_URL=https://test.infobase-dev.com/live-edits
API_PATH=/api/v1
WS_PATH=/socket.io
DB_PATH=E:/live-edits/server/data/live-edits-v4.db
CORS_ORIGINS=https://en.infobase-dev.com,https://fr.infobase-dev.com
TRUST_PROXY=loopback
AUTH_MODE=token
EDITOR_AUTH_MODE=token
EDITOR_TOKEN=the-existing-editor-token
ADMIN_TOKEN=the-existing-azure-admin-token
```

Keep the existing editor token for this compatibility phase. Keep Node bound to loopback and TCP 3000 closed externally.

In elevated PowerShell, install the locked server dependencies, run the database migration, and reinstall/restart the existing task with the isolated Node runtime:

```powershell
Set-Location E:\live-edits
& 'E:\runtimes\node-v24.18.1-win-x64\npm.cmd' --prefix server ci --omit=dev
& 'E:\runtimes\node-v24.18.1-win-x64\node.exe' server\src\init-db.js
Set-ExecutionPolicy -Scope Process Bypass
.\deployment\windows\install-live-edits.ps1 `
  -IisSiteName 'Default Web Site' `
  -NodePath 'E:\runtimes\node-v24.18.1-win-x64\node.exe'
```

Verify locally and through IIS:

```powershell
curl.exe -i http://127.0.0.1:3000/healthz
curl.exe -i https://test.infobase-dev.com/live-edits/healthz
curl.exe -i https://test.infobase-dev.com/live-edits/api/v1/auth/config
```

Health must report `4.1.0`; auth config must still report `token`. Existing staged projects must continue accepting the existing editor token. An unauthenticated `/api/v1/projects` request must return `401` because that is an administrator route.

## 3. Deploy C9 second

Place the 4.1 release in `/home/ec2-user/environment/tools/live-edits` while preserving `state/`. This can be done from an approved release archive; Git connectivity and `.git` metadata are not required. Install the locked root dependencies with the isolated Node 24 `npm`.

Create `/etc/live-edits/admin.env` from `deployment/aws/live-edits-admin.env.example`. Put the existing Azure `ADMIN_TOKEN` and the new, different console passphrase in this root-owned `0600` file. Do not put either value in the repository, C9 project settings, Apache configuration, or web root.

Run the one-time installer with the existing C9 Node 24 executable:

```bash
sudo ./deployment/aws/install-admin-console.sh \
  /home/ec2-user/environment/tools/runtimes/node-v24.18.1-linux-x64/bin/node
```

The installer:

* creates a systemd service running as `ec2-user` and group `apache`;
* binds the admin service only to `127.0.0.1:3100`;
* installs a separate `/etc/httpd/conf.d/live-edits-admin.conf`;
* adds only the `/_live-edits/v4/admin/` proxy path;
* validates the complete Apache configuration before reload;
* does not edit `vhosts.conf`, virtual hosts, document roots, TLS, locale aliases, or existing rewrites.

Verify the old mappings and new service:

```bash
sudo apachectl -t
sudo /usr/sbin/httpd -S
sudo systemctl status live-edits-admin --no-pager
curl -fsS http://127.0.0.1:3100/healthz
curl -kfsS --resolve 'en.infobase-dev.com:443:127.0.0.1' \
  https://en.infobase-dev.com/_live-edits/v4/admin/healthz
```

The virtual-host listing must match the pre-deployment record. The new public health path must return `4.1.0` only while connected through the approved network.

## 4. Install the shared 4.1 widget

1. Open `https://en.infobase-dev.com/_live-edits/v4/admin/`.
2. Sign in with the new console passphrase.
3. Confirm existing C9 projects appear with Azure counts and links.
4. Use **Refresh staging** on the smoke-test project. Setup copies the 4.1 widget to the shared widget URL used by all staged projects.
5. Open its preview and confirm the existing access code still works during this compatibility phase.

## 5. Enable network reviewer mode

Return to `E:\live-edits\server\.env` on Azure and change only:

```dotenv
EDITOR_AUTH_MODE=network
```

The existing `EDITOR_TOKEN` may remain temporarily for rollback, but it is ignored in network mode. Restart the scheduled task and verify `/api/v1/auth/config` now reports `network`.

Complete the acceptance test:

1. Reload the smoke-test preview and confirm the prompt asks for name and email, not an access code.
2. Save an edit, add and resolve a comment, open history, and verify presence from a second browser.
3. Close review and confirm the reviewer can no longer load project data; reopen it.
4. Use **Publish**, inspect the required dry run, publish the smoke change, and verify the live dev page plus private backup.
5. Repeat the preview check for one French project.
6. Repeat the off-VPN reachability test.

## Rollback

To restore shared reviewer-token access, set `EDITOR_AUTH_MODE=token`, restore a 32-character-or-longer `EDITOR_TOKEN`, restart the Azure task, and refresh staged projects after returning the matching widget release. Administrative `AUTH_MODE=token` and `ADMIN_TOKEN` remain unchanged.

To disable only the new admin page, stop and disable `live-edits-admin.service`, remove `/etc/httpd/conf.d/live-edits-admin.conf`, validate Apache, and reload it. This does not remove source products, staged previews, private state, backups, Azure data, or existing Apache mappings.
