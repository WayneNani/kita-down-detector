-- name: InsertMeldung :one
INSERT INTO meldung (kita_id, status, datum_von, datum_bis, uhrzeit_von, uhrzeit_bis, grund, quelle, melder_hash, link_id, erstellt_am)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id;

-- name: MeldungenImZeitraum :many
SELECT id, kita_id, status, datum_von, datum_bis, uhrzeit_von, uhrzeit_bis, grund, quelle, melder_hash, erstellt_am
FROM meldung
WHERE kita_id = sqlc.arg(kita_id) AND zeitraum && daterange(sqlc.arg(von)::date, sqlc.arg(bis)::date, '[]')
ORDER BY id;

-- name: ZaehleMeldungenHeute :one
SELECT count(*) FROM meldung WHERE kita_id = $1 AND melder_hash = $2 AND erstellt_am = $3;

-- name: TagesstatusBereich :many
SELECT * FROM tagesstatus WHERE kita_id = $1 AND datum BETWEEN sqlc.arg(von)::date AND sqlc.arg(bis)::date ORDER BY datum;

-- name: TagesstatusFuerKitas :many
SELECT * FROM tagesstatus
WHERE kita_id = ANY (sqlc.arg(ids)::bigint[]) AND datum BETWEEN sqlc.arg(von)::date AND sqlc.arg(bis)::date;

-- name: UpsertTagesstatus :exec
INSERT INTO tagesstatus (kita_id, datum, status, stufe, uhrzeit_von, uhrzeit_bis, grund, anzahl)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (kita_id, datum) DO UPDATE SET
  status = excluded.status, stufe = excluded.stufe, uhrzeit_von = excluded.uhrzeit_von,
  uhrzeit_bis = excluded.uhrzeit_bis, grund = excluded.grund, anzahl = excluded.anzahl;

-- name: DeleteTagesstatus :exec
DELETE FROM tagesstatus WHERE kita_id = $1 AND datum = $2;

-- name: Einschraenkungen :many
SELECT sqlc.embed(k), sqlc.embed(t)
FROM tagesstatus t JOIN kita k ON k.id = t.kita_id
WHERE t.datum = sqlc.arg(datum)::date
  AND k.aktiv
  AND t.status IN ('verkuerzt', 'notbetreuung', 'geschlossen')
  AND (sqlc.narg(ort)::text IS NULL OR lower(k.ort) = lower(sqlc.narg(ort)::text))
ORDER BY CASE t.status WHEN 'geschlossen' THEN 0 WHEN 'notbetreuung' THEN 1 ELSE 2 END, k.name
LIMIT 2000;

-- name: InsertProtokoll :exec
INSERT INTO protokoll (kita_id, datum, alt_status, neu_status, neu_stufe, erstellt_am)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: ProtokollFuerKita :many
SELECT datum, alt_status, neu_status, neu_stufe, erstellt_am FROM protokoll
WHERE kita_id = $1 ORDER BY id DESC LIMIT $2;

-- name: InsertBerichtigung :one
INSERT INTO berichtigung (kita_id, status, datum_von, datum_bis, uhrzeit_von, uhrzeit_bis, grund, token_hash, ablauf, erstellt_am)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id;

-- name: GetBerichtigungNachHash :one
SELECT * FROM berichtigung WHERE token_hash = $1;

-- name: OffeneGleicheBerichtigung :one
SELECT count(*) FROM berichtigung
WHERE kita_id = $1 AND NOT bestaetigt AND ablauf >= sqlc.arg(heute)::date
  AND status = $2 AND datum_von = $3 AND datum_bis = $4
  AND uhrzeit_von IS NOT DISTINCT FROM $5 AND uhrzeit_bis IS NOT DISTINCT FROM $6 AND grund IS NOT DISTINCT FROM $7;

-- name: BerichtigungBestaetigen :execrows
UPDATE berichtigung SET bestaetigt = true WHERE id = $1 AND NOT bestaetigt;

-- name: ZaehleBerichtigungenHeute :one
SELECT count(*) FROM berichtigung WHERE kita_id = $1 AND erstellt_am = $2;

-- name: InsertFehlendeKita :exec
INSERT INTO fehlende_kita (name, strasse, plz, ort, erstellt_am) VALUES ($1, $2, $3, $4, $5);

-- name: ListFehlendeKitas :many
SELECT * FROM fehlende_kita ORDER BY id;

-- name: GetFehlendeKita :one
SELECT * FROM fehlende_kita WHERE id = $1;

-- name: DeleteFehlendeKita :exec
DELETE FROM fehlende_kita WHERE id = $1;

-- name: ZaehleFehlendeHeute :one
SELECT count(*) FROM fehlende_kita WHERE erstellt_am = $1;

-- name: LoescheAlteFehlende :execrows
DELETE FROM fehlende_kita WHERE erstellt_am < $1;
