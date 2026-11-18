#!/bin/sh
# Legt beim ersten Start die Rollen an:
#   kita_migrate – besitzt das Schema, führt Migrationen aus
#   kita_app     – nur Daten lesen/schreiben (Rechte vergibt die Migration)
set -eu
MIGRATE_PW=$(cat "$KITA_MIGRATE_PASSWORD_FILE")
APP_PW=$(cat "$KITA_APP_PASSWORD_FILE")
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrate_pw="$MIGRATE_PW" -v app_pw="$APP_PW" <<'SQL'
CREATE ROLE kita_migrate LOGIN PASSWORD :'migrate_pw';
CREATE ROLE kita_app LOGIN PASSWORD :'app_pw';
ALTER SCHEMA public OWNER TO kita_migrate;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO kita_app;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL
