package dienst

import (
	"fmt"
	"strings"
	"time"

	"github.com/WayneNani/kita-down-detector/internal/datum"
	"github.com/WayneNani/kita-down-detector/internal/db"
	"github.com/WayneNani/kita-down-detector/internal/domain"
)

// Zusammenfassung: „Notbetreuung – Mi, 18.11. bis Fr, 20.11., Betreuung 08:00–12:00 Uhr, Grund: Streik“
func Zusammenfassung(m Meldung) string {
	var b strings.Builder
	b.WriteString(domain.Status(m.Status).Label())
	b.WriteString(" – ")
	b.WriteString(datum.Kurz(m.Von))
	if !m.Bis.Equal(m.Von) {
		b.WriteString(" bis " + datum.Kurz(m.Bis))
	}
	if m.UhrzeitVon != nil && m.UhrzeitBis != nil {
		fmt.Fprintf(&b, ", Betreuung %s–%s Uhr", *m.UhrzeitVon, *m.UhrzeitBis)
	}
	if m.Grund != nil {
		b.WriteString(", Grund: " + domain.Grund(*m.Grund).Label())
	}
	return b.String()
}

func (d *Dienst) herkunftHinweis(k db.KitaKontakt) string {
	if k.BestaetigtAm != nil {
		return ""
	}
	return fmt.Sprintf("\n\nIhre Adresse stammt aus einem öffentlichen Verzeichnis. Wenn wir Ihnen nicht mehr schreiben sollen, antworten Sie kurz an %s.", d.Cfg.KontaktEmail)
}

func (d *Dienst) mailBerichtigung(k db.Kitum, kontakt db.KitaKontakt, m Meldung, token string) db.InsertMailParams {
	text := fmt.Sprintf(`Guten Tag,

für Ihre Einrichtung „%s“ wurde auf Kita-Ausfall NRW folgende Berichtigung angefragt:

  %s

Wenn diese Angabe stimmt, bestätigen Sie sie bitte innerhalb von %d Tagen hier:
%s/berichtigung#%s

Die Angabe wird dann als „berichtigt durch Kita“ angezeigt und hat Vorrang vor allen anderen Meldungen.
Wenn Sie die Anfrage nicht gestellt haben, ignorieren Sie diese Mail einfach.%s`,
		k.Name, Zusammenfassung(m), berichtigungGueltigTage, d.Cfg.BaseURL, token, d.herkunftHinweis(kontakt))
	return db.InsertMailParams{An: kontakt.Email, Betreff: "Bitte bestätigen: Berichtigung für " + k.Name, Text: text}
}

func (d *Dienst) mailEinladung(k db.Kitum, kitaEmail, token string) db.InsertMailParams {
	text := fmt.Sprintf(`Guten Tag,

der Elternbeirat Ihrer Einrichtung „%s“ möchte auf Kita-Ausfall NRW einen persönlichen Melde-Link erhalten.
Damit kann er Notbetreuung, verkürzte Zeiten oder Schließungen als „verifiziert“ melden – das hilft allen Eltern.

Nur Sie können bestätigen, dass die Anfrage wirklich vom Elternbeirat kommt:
%s/einladung#%s

Dort können Sie auf Wunsch auch einen eigenen Melde-Link für Ihre Kita anfordern.
Der Link ist %d Tage gültig. Wenn Sie die Anfrage nicht einordnen können, ignorieren Sie diese Mail einfach.

Kita-Ausfall NRW speichert keine Namen, keine IP-Adressen und keine Freitexte. Mehr: %s/datenschutz`,
		k.Name, d.Cfg.BaseURL, token, einladungGueltigTage, d.Cfg.BaseURL)
	return db.InsertMailParams{An: kitaEmail, Betreff: "Bitte bestätigen: Melde-Link für den Elternbeirat – " + k.Name, Text: text}
}

func (d *Dienst) mailLink(k db.Kitum, an string, rolle domain.Rolle, token string, bis time.Time) db.InsertMailParams {
	wer := "den Elternbeirat"
	if rolle == domain.RolleKita {
		wer = "Ihre Kita"
	}
	text := fmt.Sprintf(`Guten Tag,

hier ist der persönliche Melde-Link für %s „%s“ auf Kita-Ausfall NRW:

%s/m#%s

Meldungen über diesen Link werden als verifiziert angezeigt. Tipp: Öffnen Sie den Link auf dem Handy
und wählen Sie „Auf diesem Gerät merken“.
Bitte geben Sie den Link nicht weiter. Er ist gültig bis %s und kann jederzeit gesperrt werden
(Nachricht an %s).`,
		wer, k.Name, d.Cfg.BaseURL, token, bis.Format("02.01.2006"), d.Cfg.KontaktEmail)
	return db.InsertMailParams{An: an, Betreff: "Ihr Melde-Link für " + k.Name, Text: text}
}
