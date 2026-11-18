-- name: PowVerwenden :execrows
INSERT INTO pow_verwendet (nonce, ablauf) VALUES ($1, $2) ON CONFLICT DO NOTHING;

-- name: PowAufraeumen :execrows
DELETE FROM pow_verwendet WHERE ablauf < now();

-- name: InsertMail :exec
INSERT INTO mail_outbox (an, betreff, text) VALUES ($1, $2, $3);

-- name: ReserviereMails :many
-- Reserviert fällige Mails für 10 Minuten (kurze Transaktion); versendet wird danach außerhalb.
UPDATE mail_outbox SET naechster_versuch = now() + interval '10 minutes'
WHERE id IN (
  SELECT id FROM mail_outbox WHERE naechster_versuch <= now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: DeleteMail :exec
DELETE FROM mail_outbox WHERE id = $1;

-- name: MailFehlgeschlagen :exec
UPDATE mail_outbox SET versuche = versuche + 1, naechster_versuch = $2 WHERE id = $1;

-- name: MailsAufgeben :execrows
DELETE FROM mail_outbox WHERE versuche >= 10 OR erstellt < now() - interval '7 days';

-- name: LoescheAlteMeldungen :execrows
DELETE FROM meldung WHERE datum_bis < $1;

-- name: LoescheAlteBerichtigungen :execrows
DELETE FROM berichtigung WHERE ablauf < sqlc.arg(heute) OR (bestaetigt AND erstellt_am < sqlc.arg(grenze));

-- name: LoescheAlteLinks :execrows
DELETE FROM melde_link
WHERE (gueltig_bis < sqlc.arg(heute) OR widerrufen)
  AND NOT EXISTS (SELECT 1 FROM meldung WHERE meldung.link_id = melde_link.id);

-- name: LoescheAlteEinladungen :execrows
DELETE FROM einladung WHERE ablauf < $1;
