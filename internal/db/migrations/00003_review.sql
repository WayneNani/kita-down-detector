-- +goose Up
-- Nur maßgebliche (primäre) Quellen dürfen Kitas aktiv halten oder ausblenden.
ALTER TABLE kita_zuordnung ADD COLUMN primaer boolean NOT NULL DEFAULT false;

-- Die App-Rolle braucht keinen Zugriff auf die Migrationstabelle.
-- +goose StatementBegin
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kita_app')
     AND to_regclass('goose_db_version') IS NOT NULL THEN
    REVOKE ALL ON goose_db_version FROM kita_app;
  END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
ALTER TABLE kita_zuordnung DROP COLUMN primaer;
