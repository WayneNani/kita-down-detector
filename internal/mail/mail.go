// Package mail versendet Mails asynchron über eine Outbox-Tabelle.
// Mails werden in derselben Transaktion eingereiht wie die fachliche Änderung
// und nach dem Versand gelöscht.
package mail

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"time"

	gomail "github.com/wneessen/go-mail"
)

type Mail struct {
	An, Betreff, Text string
}

type Sender interface {
	Senden(ctx context.Context, m Mail) error
}

// LogSender gibt Mails nur im Log aus (Entwicklung).
type LogSender struct{ Log *slog.Logger }

func (s LogSender) Senden(_ context.Context, m Mail) error {
	fmt.Printf("\n--- Mail an %s ---\nBetreff: %s\n\n%s\n---\n", m.An, m.Betreff, m.Text)
	return nil
}

// Fehlergrund beschreibt einen Versandfehler ohne Empfängeradressen (für Logs).
func Fehlergrund(err error) string {
	var se *gomail.SendError
	if errors.As(err, &se) {
		return fmt.Sprintf("%s (Code %d, %s, vorübergehend: %v)", se.Reason, se.ErrorCode(), se.EnhancedStatusCode(), se.IsTemp())
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "abgebrochen/Zeitüberschreitung"
	}
	return "Verbindungs- oder Konfigurationsfehler"
}

type SMTPSender struct {
	client *gomail.Client
	von    string
}

// NeuSMTP: smtps://user:pass@host:465 oder smtp://user:pass@host:587 (STARTTLS Pflicht).
func NeuSMTP(rohURL, von string) (*SMTPSender, error) {
	u, err := url.Parse(rohURL)
	if err != nil {
		return nil, fmt.Errorf("SMTP_URL: %w", err)
	}
	opts := []gomail.Option{gomail.WithTimeout(20 * time.Second)}
	port, _ := strconv.Atoi(u.Port())
	switch u.Scheme {
	case "smtps":
		if port == 0 {
			port = 465
		}
		opts = append(opts, gomail.WithSSLPort(false))
	case "smtp":
		if port == 0 {
			port = 587
		}
		opts = append(opts, gomail.WithTLSPolicy(gomail.TLSMandatory))
	default:
		return nil, fmt.Errorf("SMTP_URL: Schema muss smtp oder smtps sein")
	}
	opts = append(opts, gomail.WithPort(port))
	if u.User != nil {
		pw, _ := u.User.Password()
		opts = append(opts, gomail.WithSMTPAuth(gomail.SMTPAuthAutoDiscover), gomail.WithUsername(u.User.Username()), gomail.WithPassword(pw))
	}
	c, err := gomail.NewClient(u.Hostname(), opts...)
	if err != nil {
		return nil, err
	}
	return &SMTPSender{client: c, von: von}, nil
}

func (s *SMTPSender) Senden(ctx context.Context, m Mail) error {
	msg := gomail.NewMsg()
	if err := msg.From(s.von); err != nil {
		return err
	}
	if err := msg.To(m.An); err != nil {
		return err
	}
	msg.Subject(m.Betreff)
	msg.SetBodyString(gomail.TypeTextPlain, m.Text)
	return s.client.DialAndSendWithContext(ctx, msg)
}
