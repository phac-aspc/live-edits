#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_config="$repository_root/deployment/aws/apache-live-edits.conf"
debian_enabled_before='false'

if (( EUID != 0 )); then
  echo 'Run this installer with sudo.' >&2
  exit 1
fi

if [[ -d /etc/httpd/conf.d ]]; then
  destination='/etc/httpd/conf.d/live-edits.conf'
  service_name='httpd'
  apache_control="$(command -v apachectl || command -v httpd || true)"
elif [[ -d /etc/apache2/conf-available ]]; then
  destination='/etc/apache2/conf-available/live-edits.conf'
  service_name='apache2'
  apache_control="$(command -v apache2ctl || command -v apachectl || true)"
  [[ -e /etc/apache2/conf-enabled/live-edits.conf ]] && debian_enabled_before='true'
else
  echo 'A supported Apache configuration directory was not found.' >&2
  exit 1
fi

if [[ -z "$apache_control" ]]; then
  echo 'Apache is not installed or its control command is not on PATH.' >&2
  exit 1
fi

backup=''
if [[ -f "$destination" ]]; then
  backup="$(mktemp)"
  cp --preserve=mode,ownership,timestamps "$destination" "$backup"
fi

restore_previous_config() {
  if [[ -n "$backup" && -f "$backup" ]]; then
    cp --preserve=mode,ownership,timestamps "$backup" "$destination"
  else
    rm -f "$destination"
  fi
  if [[ "$service_name" == 'apache2' && "$debian_enabled_before" == 'false' ]]; then
    a2disconf live-edits >/dev/null 2>&1 || true
  fi
}

install -o root -g root -m 0644 "$source_config" "$destination"

if [[ "$service_name" == 'apache2' ]]; then
  a2enconf live-edits >/dev/null
fi

if ! "$apache_control" -t; then
  echo 'Apache rejected the Live Edits configuration. Restoring the previous file.' >&2
  restore_previous_config
  "$apache_control" -t || true
  [[ -z "$backup" ]] || rm -f "$backup"
  exit 1
fi

if ! systemctl reload "$service_name"; then
  echo "Apache validation passed, but $service_name did not reload. Restoring the previous file." >&2
  restore_previous_config
  "$apache_control" -t || true
  systemctl reload "$service_name" || true
  [[ -z "$backup" ]] || rm -f "$backup"
  exit 1
fi
[[ -z "$backup" ]] || rm -f "$backup"

echo "Installed $destination and reloaded $service_name."
