-- name: GetKontakt :one
SELECT * FROM kita_kontakt WHERE kita_id = $1;

-- name: KontaktWennLeer :execrows
INSERT INTO kita_kontakt (kita_id, email, herkunft, geaendert_am)
VALUES ($1, $2, $3, $4)
ON CONFLICT (kita_id) DO NOTHING;

-- name: SetzeKontakt :exec
INSERT INTO kita_kontakt (kita_id, email, herkunft, bestaetigt_am, geaendert_am)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (kita_id) DO UPDATE SET
  email = excluded.email, herkunft = excluded.herkunft,
  bestaetigt_am = excluded.bestaetigt_am, geaendert_am = excluded.geaendert_am;

-- name: KontaktBestaetigen :exec
UPDATE kita_kontakt SET bestaetigt_am = $2 WHERE kita_id = $1 AND bestaetigt_am IS NULL;

-- name: InsertVorschlag :one
INSERT INTO kontakt_vorschlag (kita_id, email, anlass, erstellt_am) VALUES ($1, $2, $3, $4) RETURNING id;

-- name: ListVorschlaege :many
SELECT v.*, k.name AS kita_name, k.ort AS kita_ort
FROM kontakt_vorschlag v JOIN kita k ON k.id = v.kita_id
ORDER BY v.id;

-- name: GetVorschlag :one
SELECT * FROM kontakt_vorschlag WHERE id = $1;

-- name: DeleteVorschlaegeFuerKita :exec
DELETE FROM kontakt_vorschlag WHERE kita_id = $1;

-- name: DeleteVorschlag :exec
DELETE FROM kontakt_vorschlag WHERE id = $1;

-- name: ZaehleVorschlaegeHeute :one
SELECT count(*) FROM kontakt_vorschlag WHERE kita_id = $1 AND erstellt_am = $2;
