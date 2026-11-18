#!/usr/bin/env bash
# Nächtliches, verschlüsseltes Backup (per Cron auf der VM, z. B. 3:17 Uhr):
#   17 3 * * * /opt/kita-ausfall/deploy/backup.sh
# Voraussetzungen: age (https://age-encryption.org) und rclone mit einem Ziel „backup:“
# in der EU. Aufbewahrung 14 Tage, damit Löschfristen auch in Backups greifen.
set -euo pipefail  # bricht ab, wenn pg_dump fehlschlägt – sonst würde ein leeres Backup hochgeladen
cd "$(dirname "$0")"
: "${AGE_RECIPIENT:?öffentlichen age-Schlüssel in AGE_RECIPIENT setzen}"
DATEI="kita-$(date +%Y-%m-%d).sql.gz.age"
docker compose exec -T db pg_dump -U postgres -d kita --no-owner \
  | gzip | age -r "$AGE_RECIPIENT" > "/tmp/$DATEI"
rclone copy "/tmp/$DATEI" backup:kita-ausfall/
rm -f "/tmp/$DATEI"
rclone delete --min-age 14d backup:kita-ausfall/
