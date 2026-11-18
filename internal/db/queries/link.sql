-- name: InsertLink :one
INSERT INTO melde_link (kita_id, rolle, token_hash, gueltig_bis, erstellt_am)
VALUES ($1, $2, $3, $4, $5) RETURNING id;

-- name: GetLinkNachHash :one
SELECT * FROM melde_link WHERE token_hash = $1;

-- name: LoescheMeldungenWiderrufenerLinks :many
DELETE FROM meldung m
WHERE m.kita_id = sqlc.arg(kita_id) AND m.link_id IN (
  SELECT l.id FROM melde_link l WHERE l.kita_id = sqlc.arg(kita_id) AND l.widerrufen
    AND (sqlc.narg(rolle)::text IS NULL OR l.rolle = sqlc.narg(rolle)::text)
)
RETURNING datum_von, datum_bis;

-- name: WiderrufeLinks :execrows
UPDATE melde_link SET widerrufen = true
WHERE kita_id = sqlc.arg(kita_id) AND (sqlc.narg(rolle)::text IS NULL OR rolle = sqlc.narg(rolle)::text) AND NOT widerrufen;

-- name: ListLinks :many
SELECT id, kita_id, rolle, gueltig_bis, widerrufen, erstellt_am FROM melde_link WHERE kita_id = $1 ORDER BY id;

-- name: InsertEinladung :one
INSERT INTO einladung (kita_id, eb_email, status, token_hash, ablauf, erstellt_am)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;

-- name: GetEinladungNachHash :one
SELECT * FROM einladung WHERE token_hash = $1 AND status = 'gesendet';

-- name: EinladungenInPruefung :many
SELECT * FROM einladung WHERE kita_id = $1 AND status = 'pruefung' ORDER BY id;

-- name: EinladungGesendet :exec
UPDATE einladung SET status = 'gesendet', token_hash = $2, ablauf = $3 WHERE id = $1;

-- name: DeleteEinladung :execrows
DELETE FROM einladung WHERE id = $1;

-- name: ZaehleEinladungenHeute :one
SELECT count(*) FROM einladung WHERE kita_id = $1 AND erstellt_am = $2;
