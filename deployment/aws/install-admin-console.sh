#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node_path="${1:-$(command -v node || true)}"
environment_file='/etc/live-edits/admin.env'
apache_config='/etc/httpd/conf.d/live-edits-admin.conf'
service_file='/etc/systemd/system/live-edits-admin.service'

if (( EUID != 0 )); then
  echo 'Run this installer with sudo and optionally pass the full Node.js 24 executable path.' >&2
  exit 1
fi
if [[ ! -x "$node_path" ]]; then
  echo "Node.js executable not found: $node_path" >&2
  exit 1
fi
if [[ "$($node_path --version)" != v24.* ]]; then
  echo 'The admin console requires the isolated Node.js 24 runtime.' >&2
  exit 1
fi
if [[ ! -f "$environment_file" ]]; then
  install -d -o root -g root -m 0700 /etc/live-edits
  install -o root -g root -m 0600 \
    "$repository_root/deployment/aws/live-edits-admin.env.example" "$environment_file"
  echo "Created $environment_file. Replace both placeholder secrets, then rerun this installer." >&2
  exit 1
fi
if grep -qF 'replace-with-' "$environment_file"; then
  echo "$environment_file still contains placeholder secrets." >&2
  exit 1
fi
if [[ ! -d /etc/httpd/conf.d ]]; then
  echo 'Amazon Linux /etc/httpd/conf.d was not found.' >&2
  exit 1
fi

config_backup="$(mktemp)"
service_backup="$(mktemp)"
had_config='false'
had_service='false'
[[ ! -f "$apache_config" ]] || { cp --preserve=mode,ownership,timestamps "$apache_config" "$config_backup"; had_config='true'; }
[[ ! -f "$service_file" ]] || { cp --preserve=mode,ownership,timestamps "$service_file" "$service_backup"; had_service='true'; }

restore_previous_installation() {
  if [[ "$had_config" == 'true' ]]; then
    cp --preserve=mode,ownership,timestamps "$config_backup" "$apache_config"
  else
    rm -f "$apache_config"
  fi
  if [[ "$had_service" == 'true' ]]; then
    cp --preserve=mode,ownership,timestamps "$service_backup" "$service_file"
  else
    systemctl disable --now live-edits-admin.service >/dev/null 2>&1 || true
    rm -f "$service_file"
  fi
  systemctl daemon-reload
  if [[ "$had_service" == 'true' ]]; then
    systemctl restart live-edits-admin.service >/dev/null 2>&1 || true
  fi
  /usr/sbin/httpd -t >/dev/null 2>&1 && systemctl reload httpd >/dev/null 2>&1 || true
  rm -f "$config_backup" "$service_backup"
}

installation_succeeded='false'
finish_installation() {
  if [[ "$installation_succeeded" != 'true' ]]; then
    echo 'Admin console installation failed. Restoring the previous service and Apache configuration.' >&2
    restore_previous_installation
  fi
}
trap finish_installation EXIT

install -o root -g root -m 0644 \
  "$repository_root/deployment/aws/apache-live-edits-admin.conf" "$apache_config"
sed \
  -e "s|__REPOSITORY_ROOT__|$repository_root|g" \
  -e "s|__NODE_PATH__|$node_path|g" \
  "$repository_root/deployment/aws/live-edits-admin.service.template" > "$service_file"
chown root:root "$service_file"
chmod 0644 "$service_file"

mkdir -p "$repository_root/state"
chown -R ec2-user:apache "$repository_root/state"
chmod 0750 "$repository_root/state"

if ! /usr/sbin/httpd -t; then
  echo "Apache rejected $apache_config." >&2
  exit 1
fi

systemctl daemon-reload
systemctl enable live-edits-admin.service
systemctl restart live-edits-admin.service
admin_healthy='false'
for attempt in {1..15}; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:3100/healthz >/dev/null 2>&1; then
    admin_healthy='true'
    break
  fi
  sleep 1
done
if [[ "$admin_healthy" != 'true' ]]; then
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3100/healthz >/dev/null
fi
systemctl reload httpd

installation_succeeded='true'
trap - EXIT
rm -f "$config_backup" "$service_backup"

echo 'Live Edits admin console is running.'
echo 'Open: https://en.infobase-dev.com/_live-edits/v4/admin/'
