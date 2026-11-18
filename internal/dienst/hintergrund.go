package dienst

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/WayneNani/kita-down-detector/internal/db"
	"github.com/WayneNani/kita-down-detector/internal/mail"
)

// MailsVersenden arbeitet die Outbox ab. Fehlgeschlagene Mails werden mit
// wachsendem Abstand erneut versucht und nach 10 Versuchen bzw. 7 Tagen verworfen.
func (d *Dienst) MailsVersenden(ctx context.Context, sender mail.Sender, log *slog.Logger) (int, error) {
	gesendet := 0
	err := pgx.BeginFunc(ctx, d.Pool, func(tx pgx.Tx) error {
		q := d.Q.WithTx(tx)
		mails, err := q.FaelligeMails(ctx, 20)
		if err != nil {
			return err
		}
		for _, m := range mails {
			if err := sender.Senden(ctx, mail.Mail{An: m.An, Betreff: m.Betreff, Text: m.Text}); err != nil {
				// Keine Empfängeradresse ins Log schreiben.
				log.Warn("Mailversand fehlgeschlagen", "id", m.ID, "versuch", m.Versuche+1, "fehler", err.Error())
				warte := time.Duration(1<<min(m.Versuche, 8)) * time.Minute
				if err := q.MailFehlgeschlagen(ctx, db.MailFehlgeschlagenParams{ID: m.ID, NaechsterVersuch: time.Now().Add(warte)}); err != nil {
					return err
				}
				continue
			}
			if err := q.DeleteMail(ctx, m.ID); err != nil {
				return err
			}
			gesendet++
		}
		return nil
	})
	return gesendet, err
}

// Hintergrund startet Mailversand (alle 5 s) und Aufräumen (stündlich).
// Es gibt bewusst nur eine Instanz; mehrere Instanzen wären durch SKIP LOCKED trotzdem sicher.
func (d *Dienst) Hintergrund(ctx context.Context, sender mail.Sender, log *slog.Logger) {
	mails := time.NewTicker(5 * time.Second)
	aufr := time.NewTicker(time.Hour)
	defer mails.Stop()
	defer aufr.Stop()
	raeumeAuf := func() {
		if r, err := d.Aufraeumen(ctx); err != nil {
			log.Error("Aufräumen fehlgeschlagen", "fehler", err)
		} else if r != (AufraeumErgebnis{}) {
			log.Info("Aufgeräumt", "meldungen", r.Meldungen, "berichtigungen", r.Berichtigungen, "links", r.Links, "einladungen", r.Einladungen, "pow", r.Pow, "mails", r.Mails)
		}
	}
	raeumeAuf()
	for {
		select {
		case <-ctx.Done():
			return
		case <-mails.C:
			if _, err := d.MailsVersenden(ctx, sender, log); err != nil && ctx.Err() == nil {
				log.Error("Outbox", "fehler", err)
			}
		case <-aufr.C:
			raeumeAuf()
		}
	}
}
