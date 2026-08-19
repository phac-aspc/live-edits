#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
english_root="${LIVE_EDITS_EN_ROOT:-/home/ec2-user/environment/wwwroot/en}"
french_root="${LIVE_EDITS_FR_ROOT:-/home/ec2-user/environment/wwwroot/fr}"
staging_root="${LIVE_EDITS_STAGING_ROOT:-/home/ec2-user/environment/wwwroot/_live-edits/v4}"

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if (( node_major != 24 )); then
  echo 'Node.js 24 LTS is required.' >&2
  exit 1
fi

for web_root in "$english_root" "$french_root"; do
  if [[ ! -d "$web_root" ]]; then
    echo "Missing web root: $web_root" >&2
    exit 1
  fi
done

mkdir -p "$staging_root"
if [[ ! -d "$staging_root" ]]; then
  echo "Could not create the shared staging root: $staging_root" >&2
  exit 1
fi

cd "$repository_root"
npm ci --omit=dev
node scripts/check-project.js

echo 'Cloud9 dependencies and document roots are ready.'
echo "Version 4 staging root: $staging_root"
if command -v httpd >/dev/null 2>&1 || command -v apachectl >/dev/null 2>&1 || command -v apache2ctl >/dev/null 2>&1; then
  echo 'Apache detected. Existing virtual hosts and document root mappings were not changed.'
  echo 'An optional hardening policy is available for review at:'
  echo "  $repository_root/deployment/aws/apache-live-edits.conf"
else
  echo 'Apache was not detected on PATH. Install or start Apache before exposing previews.' >&2
fi
echo 'Set LIVE_EDITS_ADMIN_TOKEN in your shell, then run setup-product.js for each project.'
