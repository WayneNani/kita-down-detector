-- +goose Up
-- Die App läuft mit der Rolle kita_app: nur Daten lesen/schreiben, kein DDL.
-- +goose StatementBegin
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kita_app') THEN
    GRANT USAGE ON SCHEMA public TO kita_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kita_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kita_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kita_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kita_app;
  END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
SELECT 1;
