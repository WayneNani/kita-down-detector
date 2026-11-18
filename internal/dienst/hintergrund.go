package dienst

import (
	"context"
	"log/slog"
	"time"

	"github.com/WayneNani/kita-down-detector/internal/db"
	"github.com/WayneNani/kita-down-detector/internal/mail"
)

// MailsVersenden arbeitet die Outbox ab. Fällige Mails werden in einer kurzen
// Transaktion für 10 Minuten reserviert und danach einzeln versendet – so wird
// bei einem Abbruch nichts doppelt verschickt und keine Transaktion bleibt offen.
// Fehlgeschlagene Mails werden mit wachsendem Abstand erneut versucht und nach
// 10 Versuchen bzw. 7 Tagen verworfen.
func (d *Dienst) MailsVersenden(ctx context.Context, sender mail.Sender, log *slog.Logger) (int, error) {
	mails, err := d.Q.ReserviereMails(ctx, 20)
	if err != nil {
		return 0, err
	}
	gesendet := 0
	for _, m := range mails {
		if err := sender.Senden(ctx, mail.Mail{An: m.An, Betreff: m.Betreff, Text: m.Text}); err != nil {
			// Nie die Fehlermeldung des Mailservers ungefiltert loggen: Sie enthält Empfängeradressen.
			log.Warn("Mailversand fehlgeschlagen", "id", m.ID, "versuch", m.Versuche+1, "grund", mail.Fehlergrund(err))
			warte := time.Duration(1<<min(m.Versuche, 8)) * time.Minute
			if err := d.Q.MailFehlgeschlagen(ctx, db.MailFehlgeschlagenParams{ID: m.ID, NaechsterVersuch: time.Now().Add(warte)}); err != nil {
				return gesendet, err
			}
			continue
		}
		if err := d.Q.DeleteMail(ctx, m.ID); err != nil {
			return gesendet, err
		}
		gesendet++
	}
	return gesendet, nil
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
