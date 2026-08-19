# Deployment guide

This guide assumes the corrected Azure TEST hostname is `test.infobase-dev.com`. The English and French preview hostnames belong to the EC2 Cloud9 host only.

## Deployment map

| Component | Host | Public address | Local location |
| --- | --- | --- | --- |
| API and realtime service | Azure Windows TEST VM | `https://test.infobase-dev.com/live-edits` | `E:\live-edits\server`, listening on `127.0.0.1:3000` |
| English previews and source | EC2 Cloud9 | `https://en.infobase-dev.com` | `/home/ec2-user/environment/wwwroot/en` |
| French previews and source | EC2 Cloud9 | `https://fr.infobase-dev.com` | `/home/ec2-user/environment/wwwroot/fr` |
| Shared version 4 staging | EC2 Cloud9 | `https://HOST/_live-edits/v4/` | `/home/ec2-user/environment/wwwroot/_live-edits/v4` |
| Cloud9 tool checkout | EC2 Cloud9 | Never web served | `/home/ec2-user/environment/tools/live-edits` |

Use Node.js 24 LTS on both hosts. The checked in engine range starts at Node.js 24.18.1, and `.nvmrc` pins the tested release. Using the same version on TEST and Cloud9 makes runtime behavior predictable.

## Generate credentials

Generate two different high entropy values. Run this command twice and save each result in your approved secret manager:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

The first is `EDITOR_TOKEN`. Reviewers may enter it in the browser. The second is `ADMIN_TOKEN`. Only the Azure service and authorized Cloud9 operators may have the administrator value.

## Azure Windows TEST VM

### 1. Prepare DNS, TLS, IIS, and Node.js

1. Point `test.infobase-dev.com` to the TEST VM endpoint used by IIS.
2. Install a valid TLS certificate and add an HTTPS binding for `test.infobase-dev.com` to the chosen IIS site.
3. Enable the IIS WebSocket Protocol Windows feature.
4. Install IIS URL Rewrite and Application Request Routing, including the proxy module.
5. Install 64 bit Node.js 24 LTS and Git. If another application requires an older machine wide Node.js version, extract the official Node.js 24 ZIP to a dedicated runtime directory instead. Confirm the selected Node.js 24 executable, its adjacent `npm.cmd`, and Git in an elevated PowerShell session.
6. Permit inbound TCP 443 through the Azure network security group and Windows Firewall. Do not expose TCP 3000; Node binds to loopback only.

### 2. Install the repository

In elevated PowerShell:

```powershell
New-Item -ItemType Directory -Path E:\live-edits -Force | Out-Null
git clone https://github.com/phac-aspc/live-edits.git E:\live-edits
Set-Location E:\live-edits
git switch master
Copy-Item server\.env.example server\.env
notepad server\.env
```

Set these production values:

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
EDITOR_TOKEN=the-first-generated-secret
ADMIN_TOKEN=the-second-generated-secret
MAX_EDIT_BYTES=10485760
HISTORY_LIMIT=25
```

Restrict access to `.env`, the database, backups, and logs to VM administrators and the account running the service. Do not put a copy of `.env` in Cloud9 or any web root.

### 3. Install IIS application and scheduled task

Run this when Node.js 24 is the machine wide version:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\deployment\windows\install-live-edits.ps1 -IisSiteName 'Default Web Site'
```

If the VM retains an older machine wide Node.js version for another application, select the isolated runtime explicitly:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\deployment\windows\install-live-edits.ps1 `
  -IisSiteName 'Default Web Site' `
  -NodePath 'E:\runtimes\node-v24.18.1-win-x64\node.exe'
```

The installer uses `npm.cmd` beside the selected executable and records the absolute Node.js path in the Live Edits scheduled task. Other applications continue using the machine wide runtime.

The script performs a clean production dependency install, initializes or migrates the database, confirms the IIS WebSocket module, creates the `/live-edits` IIS application, enables ARR proxying, registers a startup task under `SYSTEM`, starts it, and waits up to 30 seconds for `http://127.0.0.1:3000/healthz`. WebSocket support is enabled as a Windows feature and inherited by the application; `server/web.config` does not override the server level WebSocket section because hardened IIS installations commonly lock it at the parent level.

If the TEST VM uses another IIS site, pass its exact name. If IIS is managed separately, pass `-SkipIis` and configure an application rooted at `E:\live-edits\server` using the checked in `server\web.config`.

### 4. Verify Azure

```powershell
Invoke-RestMethod http://127.0.0.1:3000/healthz
Invoke-RestMethod https://test.infobase-dev.com/live-edits/healthz
Get-ScheduledTask -TaskName 'Health Infobase Live Edits'
Get-Content E:\live-edits\server\logs\live-edits.log -Tail 50
Get-Content E:\live-edits\server\logs\live-edits-error.log -Tail 50
```

The startup task launches the selected Node.js executable through `Start-Process -Wait`. Standard output and standard error are captured separately, and an unexpected Node.js exit code is appended to `live-edits-error.log` for service lifetime diagnostics.

An unauthenticated request to `/live-edits/api/v1/projects` must return `401`. A browser preflight from an origin other than the two configured preview origins must fail.

### 5. Version 3 database handling

Use `live-edits-v4.db` for the cleanest upgrade. If `DB_PATH` points to a version 3 database, startup first creates a timestamped SQLite backup, then renames the old tables to `legacy_*_v3` and creates the version 4 schema. Legacy edit snapshots are retained for manual reference but are not publishable because their payload model is incompatible.

Keep the old database backup until version 4 is accepted. Never copy a live SQLite file without also accounting for its WAL; stop the scheduled task or use SQLite's backup mechanism.

## EC2 Cloud9 host

### 1. Inspect Apache without changing it

The web server and DNS must already map:

* `en.infobase-dev.com` to `/home/ec2-user/environment/wwwroot/en`
* `fr.infobase-dev.com` to `/home/ec2-user/environment/wwwroot/fr`

Verify that the hostnames return the correct locale before staging an edit project. Confirm that the web server permits static JavaScript under `/_live-edits/v4/widget/` and WebSocket connections to the Azure TEST hostname.

The existing HTTPS virtual hosts already map `/_live-edits` on both hostnames to `/home/ec2-user/environment/wwwroot/_live-edits`. Version 4 uses that mapping without changing `vhosts.conf`. Its English and French previews are separated below `products/en/` and `products/fr/`.

Apache is already serving the Cloud9 sites. Do not replace the existing virtual hosts, document roots, TLS configuration, aliases, proxy rules, or rewrite rules. Begin with read only checks:

```bash
sudo apachectl -t
sudo apachectl -S
sudo systemctl status httpd --no-pager
```

On Debian or Ubuntu, use `apache2ctl` and the `apache2` service name. Save the `apachectl -S` output with the deployment record so the existing mappings can be compared after the pilot.

### 2. Install the tool outside both web roots

```bash
mkdir -p /home/ec2-user/environment/tools
git clone https://github.com/phac-aspc/live-edits.git /home/ec2-user/environment/tools/live-edits
cd /home/ec2-user/environment/tools/live-edits
nvm install
nvm use
./deployment/aws/bootstrap-cloud9.sh
```

The bootstrap verifies both document roots, installs the locked root dependencies, and runs syntax checks. The Cloud9 host does not need the server dependencies or SQLite native module.

The bootstrap does not edit or reload Apache. It only verifies Node.js, the two expected document root directories, dependencies, and project syntax.

### 3. Keep the existing Apache mappings

No Apache change is required for the first pilot if the existing virtual hosts already serve static files from both document roots. Verify this before staging:

```bash
curl -I https://en.infobase-dev.com/
curl -I https://fr.infobase-dev.com/
```

The repository includes an optional defense in depth policy at `deployment/aws/apache-live-edits.conf`. It contains no `VirtualHost`, `ServerName`, `DocumentRoot`, `Alias`, `ProxyPass`, TLS, or rewrite directives, so it is not designed to remap either site. It applies only below `/_live-edits/v4/` and does not alter older `/_live-edits/` content. It can still change version 4 access rules, so do not install it until the existing Apache configuration has been reviewed and the pilot previews work.

If the policy is approved later, first back up the current Apache configuration and run a syntax check. The optional installer performs its own validation and restoration:

```bash
sudo ./deployment/aws/install-apache-config.sh
```

The installer detects Amazon Linux or RHEL versus Debian or Ubuntu, validates the complete Apache configuration before reload, and restores the previous file if validation or reload fails. The optional policy:

* permits only `/_live-edits/v4/widget/` and `/_live-edits/v4/products/` below the version 4 directory;
* disables directory indexes and dynamic script execution in those folders;
* blocks dotfiles, credentials, databases, executable scripts, logs, certificates, keys, backups, and temporary build directories;
* leaves staged HTML readable so the confirmed application access code prompt remains the only reviewer sign in step.

Only if the optional policy is installed, recheck Apache and both mappings:

```bash
sudo apachectl -t
sudo apachectl -S
curl -I https://en.infobase-dev.com/
curl -I https://fr.infobase-dev.com/
```

### 4. Supply the administrator token only for operations

Load `ADMIN_TOKEN` from your approved secret manager into the current shell without writing it to the repository or a web root:

```bash
read -rsp 'Live Edits administrator token: ' LIVE_EDITS_ADMIN_TOKEN
echo
export LIVE_EDITS_ADMIN_TOKEN
```

Unset it when the operation is complete:

```bash
unset LIVE_EDITS_ADMIN_TOKEN
```

### 5. Understand preview access

Version 4 retains the confirmed shared application access code. The editor token protects API reads and writes, history, comments, and presence. It does not encrypt or hide the staged HTML returned by Apache. Without the optional policy, the existing Apache configuration continues to govern static preview access. If installed later, the optional policy keeps the preview HTML readable while blocking listings and unsafe file types.

If a future preview contains unpublished sensitive information, use VPN or an organizational access layer. A ready Apache Basic Authentication override is also included at `deployment/aws/apache-live-edits-private.conf.example`. It adds a second browser prompt and must use a password separate from both application tokens. Do not install that optional override for the current shared access code workflow.

### 6. Smoke test one project per locale

Choose small projects and follow [OPERATIONS.md](OPERATIONS.md). Confirm:

1. English and French preview URLs load only from their own hostnames.
2. The access code prompt appears and a bad code fails.
3. `/_live-edits/v4/widget/editor.js` and the staged product assets load normally.
4. Saving, history, a comment, and presence work.
5. A dry run lists the expected source page and no other files.
6. A publish creates a private backup and changes only keyed HTML regions.

After staging the smoke test products, verify the Apache boundary directly:

```bash
curl -I https://en.infobase-dev.com/_live-edits/v4/
curl -I https://en.infobase-dev.com/_live-edits/v4/widget/editor.js
curl -I https://en.infobase-dev.com/_live-edits/v4/products/en/PRODUCT/index.html
curl -I https://fr.infobase-dev.com/_live-edits/v4/
curl -I https://fr.infobase-dev.com/_live-edits/v4/widget/editor.js
curl -I https://fr.infobase-dev.com/_live-edits/v4/products/fr/PRODUCT/index.html
```

The widget and real staged page paths must return `200`. Replace `PRODUCT` with the smoke test project name. If the optional Apache policy is installed later, the parent paths, dotfile paths, and hidden temporary build paths must return `403` or `404`.

## Upgrade procedure

On Azure, back up the database through an approved method, stop the scheduled task, update the checkout, run `npm --prefix server ci --omit=dev`, run `node server/src/init-db.js`, then start the task and check both health URLs.

On Cloud9, update the checkout and run `npm ci --omit=dev`. Re-run setup with `--force` for each active project so the widget and page manifests match the deployed release. Always run the publisher without `--apply` first after an upgrade.
