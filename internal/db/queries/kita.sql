-- name: GetKita :one
SELECT * FROM kita WHERE id = $1;

-- name: LockKita :one
SELECT id FROM kita WHERE id = $1 FOR UPDATE;

-- name: SucheKitas :many
SELECT * FROM kita
WHERE aktiv AND suchtext LIKE ALL (sqlc.arg(muster)::text[])
ORDER BY similarity(name, sqlc.arg(begriff)::text) DESC, name
LIMIT sqlc.arg(anzahl);

-- name: KitasImBereich :many
SELECT * FROM kita
WHERE aktiv AND lat BETWEEN sqlc.arg(lat_min)::float8 AND sqlc.arg(lat_max)::float8
  AND lon BETWEEN sqlc.arg(lon_min)::float8 AND sqlc.arg(lon_max)::float8;

-- name: KitasNachIDs :many
SELECT * FROM kita WHERE id = ANY (sqlc.arg(ids)::bigint[]);

-- name: InsertKita :one
INSERT INTO kita (name, traeger, strasse, plz, ort, lat, lon, suchtext, adresse_norm, erstellt_am)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id;

-- name: UpdateKita :exec
UPDATE kita SET name = $2, traeger = $3, strasse = $4, plz = $5, ort = $6, lat = $7, lon = $8,
  suchtext = $9, adresse_norm = $10, aktiv = true
WHERE id = $1;

-- name: KitaKandidaten :many
SELECT id, name, adresse_norm, similarity(name, sqlc.arg(name)::text)::real AS aehnlichkeit
FROM kita
WHERE plz = sqlc.arg(plz)::text
ORDER BY (adresse_norm = sqlc.arg(adresse_norm)::text) DESC, aehnlichkeit DESC
LIMIT 3;

-- name: DeaktiviereNichtGesehene :execrows
UPDATE kita SET aktiv = false
WHERE aktiv AND id IN (
  SELECT z.kita_id FROM kita_zuordnung z
  WHERE z.quelle = sqlc.arg(quelle) AND z.zuletzt_gesehen < sqlc.arg(stichtag)
) AND NOT EXISTS (
  SELECT 1 FROM kita_zuordnung z2
  WHERE z2.kita_id = kita.id AND z2.zuletzt_gesehen >= sqlc.arg(stichtag)
);

-- name: GetZuordnung :one
SELECT * FROM kita_zuordnung WHERE quelle = $1 AND quelle_id = $2;

-- name: UpsertZuordnung :exec
INSERT INTO kita_zuordnung (quelle, quelle_id, kita_id, aehnlichkeit, geprueft, daten, zuletzt_gesehen)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (quelle, quelle_id) DO UPDATE SET
  kita_id = COALESCE(kita_zuordnung.kita_id, excluded.kita_id),
  aehnlichkeit = COALESCE(kita_zuordnung.aehnlichkeit, excluded.aehnlichkeit),
  daten = excluded.daten,
  zuletzt_gesehen = excluded.zuletzt_gesehen;

-- name: OffeneZuordnungen :many
SELECT * FROM kita_zuordnung WHERE kita_id IS NULL AND NOT geprueft ORDER BY quelle, quelle_id LIMIT $1;

-- name: SetzeZuordnung :exec
UPDATE kita_zuordnung SET kita_id = $3, geprueft = true WHERE quelle = $1 AND quelle_id = $2;

-- name: ZaehleKitas :one
SELECT count(*) FILTER (WHERE aktiv) AS aktiv, count(*) AS gesamt FROM kita;
