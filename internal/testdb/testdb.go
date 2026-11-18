// Package testdb stellt für Integrationstests eine frische Datenbank bereit.
// Jedes Testpaket bekommt ein eigenes Schema. Ohne TEST_DATABASE_URL werden
// die Tests übersprungen.
package testdb

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/WayneNani/kita-down-detector/internal/db"
)

// Oeffnen legt das Schema neu an und migriert. pool == nil, wenn TEST_DATABASE_URL fehlt.
func Oeffnen(schema string) (*pgxpool.Pool, error) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		return nil, nil
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return nil, err
	}
	ident := pgx.Identifier{schema}.Sanitize()
	if _, err := conn.Exec(ctx, "DROP SCHEMA IF EXISTS "+ident+" CASCADE; CREATE SCHEMA "+ident); err != nil {
		return nil, err
	}
	conn.Close(ctx)
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := db.Migrieren(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// Pool für einen einzelnen Test (wird danach geschlossen).
func Pool(t *testing.T, schema string) *pgxpool.Pool {
	t.Helper()
	pool, err := Oeffnen(schema)
	if err != nil {
		t.Fatal(err)
	}
	if pool == nil {
		t.Skip("TEST_DATABASE_URL nicht gesetzt – Integrationstest übersprungen")
	}
	t.Cleanup(pool.Close)
	return pool
}

// Leeren setzt alle Tabellen zurück.
func Leeren(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `TRUNCATE kita, kita_zuordnung, kita_kontakt, kontakt_vorschlag, melde_link, einladung,
		meldung, tagesstatus, protokoll, berichtigung, fehlende_kita, pow_verwendet, mail_outbox RESTART IDENTITY CASCADE`)
	if err != nil {
		t.Fatal(err)
	}
}
