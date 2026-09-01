#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo 'ERROR: install.sh must run as root' >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
SOURCE_OPERATOR="$SCRIPT_DIR/medical-calendar-vk-ops"
SOURCE_SUDOERS="$SCRIPT_DIR/medical-calendar-vk-ops.sudoers"
SOURCE_CONFIG="$REPO_ROOT/config/vk.json"
TARGET_OPERATOR='/usr/local/sbin/medical-calendar-vk-ops'
TARGET_SUDOERS='/etc/sudoers.d/medical-calendar-vk-ops'
TARGET_CONFIG='/etc/medical-calendar/vk/kirov-gmu.json'
BACKUP_ROOT='/var/lib/medical-calendar/vk-operator-backups'
CLOUDRU_DIR='/etc/medical-calendar/cloudru'

test -f "$SOURCE_OPERATOR" || { echo 'ERROR: operator source missing' >&2; exit 1; }
test -f "$SOURCE_SUDOERS" || { echo 'ERROR: sudoers source missing' >&2; exit 1; }
test -f "$SOURCE_CONFIG" || { echo 'ERROR: VK config source missing' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'ERROR: python3 missing' >&2; exit 1; }
command -v visudo >/dev/null || { echo 'ERROR: visudo missing' >&2; exit 1; }

for required in key-id key-secret secretmanager-product-instance-id; do
  test -s "$CLOUDRU_DIR/$required" || {
    echo "ERROR: Cloud.ru credential file missing: $required" >&2
    exit 1
  }
done

python3 - "$SOURCE_CONFIG" <<'PY'
import json
import sys
from urllib.parse import urlparse

path = sys.argv[1]
with open(path, encoding='utf-8') as handle:
    config = json.load(handle)
community = config.get('community') or {}
secret = config.get('secretReference') or {}
screen_name = community.get('screenName')
public_url = community.get('publicUrl')
if not isinstance(screen_name, str) or not screen_name.strip():
    raise SystemExit('invalid VK screenName')
if secret.get('provider') != 'cloud.ru-secret-management':
    raise SystemExit('invalid VK secret provider')
if not isinstance(secret.get('path'), str) or not secret['path'].strip():
    raise SystemExit('invalid VK secret path')
url = urlparse(public_url)
if url.scheme != 'https' or url.netloc != 'vk.ru' or url.path.strip('/') != screen_name:
    raise SystemExit('VK publicUrl does not match screenName')
PY

install -d -m 0755 -o root -g root /etc/medical-calendar/vk
install -d -m 0700 -o root -g root "$BACKUP_ROOT"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$BACKUP_ROOT/$stamp"
install -d -m 0700 -o root -g root "$backup_dir"
for path in "$TARGET_OPERATOR" "$TARGET_SUDOERS" "$TARGET_CONFIG"; do
  if [[ -e "$path" ]]; then
    cp -a -- "$path" "$backup_dir/"
  fi
done

sudoers_tmp="$(mktemp /etc/sudoers.d/.medical-calendar-vk-ops.XXXXXX)"
trap 'rm -f -- "$sudoers_tmp"' EXIT
install -m 0440 -o root -g root "$SOURCE_SUDOERS" "$sudoers_tmp"
visudo -cf "$sudoers_tmp" >/dev/null

install -m 0750 -o root -g root "$SOURCE_OPERATOR" "$TARGET_OPERATOR"
install -m 0644 -o root -g root "$SOURCE_CONFIG" "$TARGET_CONFIG"
mv -f -- "$sudoers_tmp" "$TARGET_SUDOERS"
chown root:root "$TARGET_SUDOERS"
chmod 0440 "$TARGET_SUDOERS"
visudo -cf "$TARGET_SUDOERS" >/dev/null
trap - EXIT

python3 -m py_compile "$TARGET_OPERATOR"
test -x "$TARGET_OPERATOR"
test -r "$TARGET_CONFIG"
printf 'VK_OPERATOR_INSTALLED=ok\n'
printf 'CALENDAR_SERVICE_RESTARTED=no\n'
