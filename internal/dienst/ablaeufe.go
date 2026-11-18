package dienst

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/WayneNani/kita-down-detector/internal/datum"
	"github.com/WayneNani/kita-down-detector/internal/db"
	"github.com/WayneNani/kita-down-detector/internal/domain"
	"github.com/WayneNani/kita-down-detector/internal/privacy"
)

const (
	// Obergrenze je Kita und Tag über alle Anfragenden; zusätzlich begrenzt die
	// HTTP-Schicht je Anschluss (2 pro Kita und Tag), damit niemand allein das
	// Kontingent einer Kita aufbrauchen kann.
	maxAnfragenProKitaUndTag  = 10
	vorschlagAufbewahrungTage = 60
	fehlendeAufbewahrungTage  = 90
	berichtigungGueltigTage   = 7
	einladungGueltigTage      = 7
	pruefungGueltigTage       = 30
	maxFehlendeProTag         = 200
)

// ---------------------------------------------------------------- Melde-Links

type LinkInfo struct {
	Link db.MeldeLink
	Kita db.Kitum
}

// ErstelleLink erzeugt einen Melde-Link. Das Token wird nur hier zurückgegeben,
// gespeichert wird nur sein Hash.
func (d *Dienst) ErstelleLink(ctx context.Context, q *db.Queries, kitaID int64, rolle domain.Rolle, gueltigBis *time.Time) (string, time.Time, error) {
	if q == nil {
		q = d.Q
	}
	if !rolle.Gueltig() {
		return "", time.Time{}, fmt.Errorf("unbekannte Rolle %q", rolle)
	}
	bis := datum.EndeKitaJahr(d.Heute())
	if gueltigBis != nil {
		bis = *gueltigBis
	}
	token := privacy.NeuesToken()
	_, err := q.InsertLink(ctx, db.InsertLinkParams{KitaID: kitaID, Rolle: string(rolle), TokenHash: privacy.TokenHash(token), GueltigBis: bis, ErstelltAm: d.Heute()})
	return token, bis, err
}

func (d *Dienst) FindeLink(ctx context.Context, token string) (LinkInfo, error) {
	l, err := d.Q.GetLinkNachHash(ctx, privacy.TokenHash(token))
	if err != nil || l.Widerrufen || l.GueltigBis.Before(d.Heute()) {
		return LinkInfo{}, ErrUngueltig
	}
	k, err := d.Q.GetKita(ctx, l.KitaID)
	if err != nil {
		return LinkInfo{}, ErrUngueltig
	}
	return LinkInfo{Link: l, Kita: k}, nil
}

// MeldenPerLink speichert eine verifizierte Meldung; eine Kita-Meldung bestätigt zugleich die Kita-Adresse.
func (d *Dienst) MeldenPerLink(ctx context.Context, li LinkInfo, m Meldung) error {
	rolle := domain.Rolle(li.Link.Rolle)
	return d.inTx(ctx, func(q *db.Queries) error {
		if rolle == domain.RolleKita {
			if err := q.KontaktBestaetigen(ctx, db.KontaktBestaetigenParams{KitaID: li.Kita.ID, BestaetigtAm: ptr(d.Heute())}); err != nil {
				return err
			}
		}
		return d.speichere(ctx, q, li.Kita.ID, m, Herkunft{Quelle: rolle.Quelle(), LinkID: &li.Link.ID})
	})
}

// LinksWiderrufen sperrt Links einer Kita. Mit meldungenEntfernen werden auch
// alle Meldungen über diese Links gelöscht und der Status neu berechnet (z. B.
// wenn ein Link in falsche Hände geraten ist).
func (d *Dienst) LinksWiderrufen(ctx context.Context, kitaID int64, rolle *string, meldungenEntfernen bool) (widerrufen int64, entfernt int, err error) {
	err = d.inTx(ctx, func(q *db.Queries) error {
		if err := q.SperreKita(ctx, kitaID); err != nil {
			return err
		}
		if widerrufen, err = q.WiderrufeLinks(ctx, db.WiderrufeLinksParams{KitaID: kitaID, Rolle: rolle}); err != nil {
			return err
		}
		if !meldungenEntfernen {
			return nil
		}
		bereiche, err := q.LoescheMeldungenWiderrufenerLinks(ctx, db.LoescheMeldungenWiderrufenerLinksParams{KitaID: kitaID, Rolle: rolle})
		if err != nil || len(bereiche) == 0 {
			return err
		}
		entfernt = len(bereiche)
		von, bis := bereiche[0].DatumVon, bereiche[0].DatumBis
		for _, b := range bereiche[1:] {
			if b.DatumVon.Before(von) {
				von = b.DatumVon
			}
			if b.DatumBis.After(bis) {
				bis = b.DatumBis
			}
		}
		return d.neuBerechnen(ctx, q, kitaID, von, bis)
	})
	return widerrufen, entfernt, err
}

// ---------------------------------------------------------------- Berichtigung

func (d *Dienst) BerichtigungAnfragen(ctx context.Context, kitaID int64, m Meldung) (string, error) {
	var gesendetAn string
	err := d.inTx(ctx, func(q *db.Queries) error {
		k, err := q.GetKita(ctx, kitaID)
		if err != nil {
			return nichtGefunden(err)
		}
		kontakt, err := q.GetKontakt(ctx, kitaID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrKeinKontakt
		} else if err != nil {
			return err
		}
		gesendetAn = privacy.MaskiereEmail(kontakt.Email)
		// Gleiche Anfrage noch offen? Dann keine weitere Mail – die erste gilt.
		offen, err := q.OffeneGleicheBerichtigung(ctx, db.OffeneGleicheBerichtigungParams{
			KitaID: kitaID, Heute: d.Heute(), Status: m.Status, DatumVon: m.Von, DatumBis: m.Bis,
			UhrzeitVon: m.UhrzeitVon, UhrzeitBis: m.UhrzeitBis, Grund: m.Grund,
		})
		if err != nil {
			return err
		}
		if offen > 0 {
			return nil
		}
		n, err := q.ZaehleBerichtigungenHeute(ctx, db.ZaehleBerichtigungenHeuteParams{KitaID: kitaID, ErstelltAm: d.Heute()})
		if err != nil {
			return err
		}
		if n >= maxAnfragenProKitaUndTag {
			return ErrZuViele
		}
		token := privacy.NeuesToken()
		if _, err := q.InsertBerichtigung(ctx, db.InsertBerichtigungParams{
			KitaID: kitaID, Status: m.Status, DatumVon: m.Von, DatumBis: m.Bis, UhrzeitVon: m.UhrzeitVon,
			UhrzeitBis: m.UhrzeitBis, Grund: m.Grund, TokenHash: privacy.TokenHash(token),
			Ablauf: datum.Plus(d.Heute(), berichtigungGueltigTage), ErstelltAm: d.Heute(),
		}); err != nil {
			return err
		}
		return q.InsertMail(ctx, d.mailBerichtigung(k, kontakt, m, token))
	})
	return gesendetAn, err
}

type BerichtigungInfo struct {
	Berichtigung db.Berichtigung
	Kita         db.Kitum
}

func (d *Dienst) FindeBerichtigung(ctx context.Context, token string) (BerichtigungInfo, error) {
	b, err := d.Q.GetBerichtigungNachHash(ctx, privacy.TokenHash(token))
	if err != nil || b.Bestaetigt || b.Ablauf.Before(d.Heute()) {
		return BerichtigungInfo{}, ErrUngueltig
	}
	k, err := d.Q.GetKita(ctx, b.KitaID)
	if err != nil {
		return BerichtigungInfo{}, ErrUngueltig
	}
	return BerichtigungInfo{Berichtigung: b, Kita: k}, nil
}

func (b BerichtigungInfo) Meldung() Meldung {
	x := b.Berichtigung
	return Meldung{Status: x.Status, Von: x.DatumVon, Bis: x.DatumBis, UhrzeitVon: x.UhrzeitVon, UhrzeitBis: x.UhrzeitBis, Grund: x.Grund}
}

// BerichtigungBestaetigen übernimmt die Berichtigung (einmalig) und bestätigt die Kita-Adresse.
func (d *Dienst) BerichtigungBestaetigen(ctx context.Context, token string) (int64, error) {
	info, err := d.FindeBerichtigung(ctx, token)
	if err != nil {
		return 0, err
	}
	err = d.inTx(ctx, func(q *db.Queries) error {
		n, err := q.BerichtigungBestaetigen(ctx, info.Berichtigung.ID)
		if err != nil {
			return err
		}
		if n != 1 {
			return ErrUngueltig // parallel schon bestätigt
		}
		if err := q.KontaktBestaetigen(ctx, db.KontaktBestaetigenParams{KitaID: info.Kita.ID, BestaetigtAm: ptr(d.Heute())}); err != nil {
			return err
		}
		return d.speichere(ctx, q, info.Kita.ID, info.Meldung(), Herkunft{Quelle: domain.QuelleBerichtigung})
	})
	return info.Kita.ID, err
}

// ---------------------------------------------------------------- Einladung (Elternbeirat)

type EinladungErgebnis struct {
	Status     string // "gesendet" oder "pruefung"
	GesendetAn string
}

// Vertraut: Die Domain gehört zu einem bekannten Träger. Das ist nur ein Hinweis
// für die manuelle Prüfung – Adressen werden nie automatisch übernommen, sonst
// könnte jedes Postfach einer Stadtverwaltung die Adresse jeder Kita übernehmen.
func (d *Dienst) Vertraut(email string) bool {
	_, domain, _ := strings.Cut(email, "@")
	return slices.Contains(d.Cfg.VertrauteDomains, domain)
}

func pruefeKitaEmail(feld string, roh string) (string, error) {
	e, ok := privacy.NormalisiereEmail(roh)
	if !ok {
		return "", Validierungsfehler{{feld, "Bitte eine gültige E-Mail-Adresse angeben."}}
	}
	if !privacy.IstFunktionsadresse(e) {
		return "", Validierungsfehler{{feld, "Bitte die allgemeine Adresse der Kita angeben (z. B. kita-name@traeger.de), keine persönliche Adresse."}}
	}
	return e, nil
}

func (d *Dienst) EinladungAnfragen(ctx context.Context, kitaID int64, ebEmail string, kitaEmail *string) (EinladungErgebnis, error) {
	eb, ok := privacy.NormalisiereEmail(ebEmail)
	if !ok {
		return EinladungErgebnis{}, Validierungsfehler{{"email", "Bitte eine gültige E-Mail-Adresse angeben."}}
	}
	var erg EinladungErgebnis
	err := d.inTx(ctx, func(q *db.Queries) error {
		k, err := q.GetKita(ctx, kitaID)
		if err != nil {
			return nichtGefunden(err)
		}
		n, err := q.ZaehleEinladungenHeute(ctx, db.ZaehleEinladungenHeuteParams{KitaID: kitaID, ErstelltAm: d.Heute()})
		if err != nil {
			return err
		}
		if n >= maxAnfragenProKitaUndTag {
			return ErrZuViele
		}
		kontakt, err := q.GetKontakt(ctx, kitaID)
		if errors.Is(err, pgx.ErrNoRows) {
			if kitaEmail == nil || strings.TrimSpace(*kitaEmail) == "" {
				return Validierungsfehler{{"kita_email", "Für diese Kita ist keine Adresse hinterlegt. Bitte die allgemeine E-Mail-Adresse der Kita angeben."}}
			}
			ke, err := pruefeKitaEmail("kita_email", *kitaEmail)
			if err != nil {
				return err
			}
			// Die Adresse wird geprüft, bevor irgendetwas an sie geht.
			if _, err := q.InsertEinladung(ctx, db.InsertEinladungParams{KitaID: kitaID, EbEmail: eb, Status: "pruefung", Ablauf: datum.Plus(d.Heute(), pruefungGueltigTage), ErstelltAm: d.Heute()}); err != nil {
				return err
			}
			_, err = q.InsertVorschlag(ctx, db.InsertVorschlagParams{KitaID: kitaID, Email: ke, Anlass: "einladung", ErstelltAm: d.Heute()})
			erg = EinladungErgebnis{Status: "pruefung"}
			return err
		} else if err != nil {
			return err
		}
		id, err := q.InsertEinladung(ctx, db.InsertEinladungParams{KitaID: kitaID, EbEmail: eb, Status: "pruefung", Ablauf: datum.Plus(d.Heute(), pruefungGueltigTage), ErstelltAm: d.Heute()})
		if err != nil {
			return err
		}
		if err := d.sendeEinladung(ctx, q, id, k, kontakt.Email, eb); err != nil {
			return err
		}
		erg = EinladungErgebnis{Status: "gesendet", GesendetAn: privacy.MaskiereEmail(kontakt.Email)}
		return nil
	})
	return erg, err
}

func (d *Dienst) sendeEinladung(ctx context.Context, q *db.Queries, einladungID int64, k db.Kitum, kitaEmail, ebEmail string) error {
	token := privacy.NeuesToken()
	if err := q.EinladungGesendet(ctx, db.EinladungGesendetParams{ID: einladungID, TokenHash: privacy.TokenHash(token), Ablauf: datum.Plus(d.Heute(), einladungGueltigTage)}); err != nil {
		return err
	}
	return q.InsertMail(ctx, d.mailEinladung(k, kitaEmail, ebEmail, token))
}

type EinladungInfo struct {
	Einladung db.Einladung
	Kita      db.Kitum
}

func (d *Dienst) FindeEinladung(ctx context.Context, token string) (EinladungInfo, error) {
	e, err := d.Q.GetEinladungNachHash(ctx, privacy.TokenHash(token))
	if err != nil || e.Ablauf.Before(d.Heute()) {
		return EinladungInfo{}, ErrUngueltig
	}
	k, err := d.Q.GetKita(ctx, e.KitaID)
	if err != nil {
		return EinladungInfo{}, ErrUngueltig
	}
	return EinladungInfo{Einladung: e, Kita: k}, nil
}

// EinladungBestaetigen: Die Kita bestätigt den Elternbeirat. Der Link geht an den
// Elternbeirat, danach wird dessen Adresse gelöscht.
func (d *Dienst) EinladungBestaetigen(ctx context.Context, token string, kitaLink bool) error {
	info, err := d.FindeEinladung(ctx, token)
	if err != nil {
		return err
	}
	return d.inTx(ctx, func(q *db.Queries) error {
		n, err := q.DeleteEinladung(ctx, info.Einladung.ID)
		if err != nil {
			return err
		}
		if n != 1 {
			return ErrUngueltig
		}
		kontakt, err := q.GetKontakt(ctx, info.Kita.ID)
		if err != nil {
			return err
		}
		if err := q.KontaktBestaetigen(ctx, db.KontaktBestaetigenParams{KitaID: info.Kita.ID, BestaetigtAm: ptr(d.Heute())}); err != nil {
			return err
		}
		ebToken, bis, err := d.ErstelleLink(ctx, q, info.Kita.ID, domain.RolleElternbeirat, nil)
		if err != nil {
			return err
		}
		if err := q.InsertMail(ctx, d.mailLink(info.Kita, info.Einladung.EbEmail, domain.RolleElternbeirat, ebToken, bis)); err != nil {
			return err
		}
		if kitaLink {
			kToken, bis, err := d.ErstelleLink(ctx, q, info.Kita.ID, domain.RolleKita, nil)
			if err != nil {
				return err
			}
			return q.InsertMail(ctx, d.mailLink(info.Kita, kontakt.Email, domain.RolleKita, kToken, bis))
		}
		return nil
	})
}

// ---------------------------------------------------------------- Kontaktadresse durch die Kita

func (d *Dienst) KontaktVorschlagen(ctx context.Context, kitaID int64, roh string) error {
	email, err := pruefeKitaEmail("email", roh)
	if err != nil {
		return err
	}
	return d.inTx(ctx, func(q *db.Queries) error {
		if _, err := q.GetKita(ctx, kitaID); err != nil {
			return nichtGefunden(err)
		}
		if k, err := q.GetKontakt(ctx, kitaID); err == nil && k.BestaetigtAm != nil {
			return Validierungsfehler{{"email", "Für diese Kita ist bereits eine bestätigte Adresse hinterlegt. Für eine Änderung schreiben Sie bitte an " + d.Cfg.KontaktEmail + "."}}
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		n, err := q.ZaehleVorschlaegeHeute(ctx, db.ZaehleVorschlaegeHeuteParams{KitaID: kitaID, ErstelltAm: d.Heute()})
		if err != nil {
			return err
		}
		if n >= maxAnfragenProKitaUndTag {
			return ErrZuViele
		}
		// Immer manuelle Prüfung – auch bei bekannten Träger-Domains.
		_, err = q.InsertVorschlag(ctx, db.InsertVorschlagParams{KitaID: kitaID, Email: email, Anlass: "kita", ErstelltAm: d.Heute()})
		return err
	})
}

var ErrBestaetigterKontakt = errors.New("die Kita hat bereits eine bestätigte Adresse – nur mit --ueberschreiben ersetzen")

// VorschlagAnnehmen (Verwaltung): Adresse übernehmen, wartende Einladungen versenden,
// bei Anlass „kita“ einen Kita-Link an die Adresse schicken.
func (d *Dienst) VorschlagAnnehmen(ctx context.Context, id int64, ueberschreiben bool) error {
	return d.inTx(ctx, func(q *db.Queries) error { return d.vorschlagAnnehmen(ctx, q, id, ueberschreiben) })
}

func (d *Dienst) vorschlagAnnehmen(ctx context.Context, q *db.Queries, id int64, ueberschreiben bool) error {
	v, err := q.GetVorschlag(ctx, id)
	if err != nil {
		return nichtGefunden(err)
	}
	if k, err := q.GetKontakt(ctx, v.KitaID); err == nil && k.BestaetigtAm != nil && !ueberschreiben {
		return ErrBestaetigterKontakt
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	herkunft := "eingeladen"
	if v.Anlass == "kita" {
		herkunft = "kita_selbst"
	}
	if err := q.SetzeKontakt(ctx, db.SetzeKontaktParams{KitaID: v.KitaID, Email: v.Email, Herkunft: herkunft, GeaendertAm: d.Heute()}); err != nil {
		return err
	}
	if err := q.DeleteVorschlaegeFuerKita(ctx, v.KitaID); err != nil {
		return err
	}
	k, err := q.GetKita(ctx, v.KitaID)
	if err != nil {
		return err
	}
	if v.Anlass == "kita" {
		token, bis, err := d.ErstelleLink(ctx, q, k.ID, domain.RolleKita, nil)
		if err != nil {
			return err
		}
		if err := q.InsertMail(ctx, d.mailLink(k, v.Email, domain.RolleKita, token, bis)); err != nil {
			return err
		}
	}
	return d.wartendeEinladungenSenden(ctx, q, k, v.Email)
}

func (d *Dienst) wartendeEinladungenSenden(ctx context.Context, q *db.Queries, k db.Kitum, kitaEmail string) error {
	wartend, err := q.EinladungenInPruefung(ctx, k.ID)
	if err != nil {
		return err
	}
	for _, e := range wartend {
		if err := d.sendeEinladung(ctx, q, e.ID, k, kitaEmail, e.EbEmail); err != nil {
			return err
		}
	}
	return nil
}

// VorschlagAblehnen löscht den Vorschlag und – bei Einladungen – die gespeicherten Elternbeirat-Adressen.
func (d *Dienst) VorschlagAblehnen(ctx context.Context, id int64) error {
	return d.inTx(ctx, func(q *db.Queries) error {
		v, err := q.GetVorschlag(ctx, id)
		if err != nil {
			return nichtGefunden(err)
		}
		if err := q.DeleteVorschlag(ctx, id); err != nil {
			return err
		}
		if v.Anlass == "einladung" {
			wartend, err := q.EinladungenInPruefung(ctx, v.KitaID)
			if err != nil {
				return err
			}
			for _, e := range wartend {
				if _, err := q.DeleteEinladung(ctx, e.ID); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// KontaktSetzen (Verwaltung): Adresse manuell hinterlegen.
func (d *Dienst) KontaktSetzen(ctx context.Context, kitaID int64, roh, herkunft string) error {
	email, ok := privacy.NormalisiereEmail(roh)
	if !ok {
		return fmt.Errorf("ungültige Adresse")
	}
	return d.inTx(ctx, func(q *db.Queries) error {
		k, err := q.GetKita(ctx, kitaID)
		if err != nil {
			return nichtGefunden(err)
		}
		if err := q.SetzeKontakt(ctx, db.SetzeKontaktParams{KitaID: kitaID, Email: email, Herkunft: herkunft, GeaendertAm: d.Heute()}); err != nil {
			return err
		}
		return d.wartendeEinladungenSenden(ctx, q, k, email)
	})
}

// ---------------------------------------------------------------- Fehlende Kita

type FehlendeKita struct {
	Name    string `json:"name"`
	Strasse string `json:"strasse"`
	Plz     string `json:"plz"`
	Ort     string `json:"ort"`
}

func (d *Dienst) FehlendeKitaMelden(ctx context.Context, f FehlendeKita) error {
	var fehler Validierungsfehler
	pruef := func(feld, wert string, max int) string {
		w := strings.TrimSpace(wert)
		if w == "" || len(w) > max {
			fehler = append(fehler, FeldFehler{feld, "Bitte ausfüllen (max. " + fmt.Sprint(max) + " Zeichen)."})
		}
		return w
	}
	f.Name, f.Strasse, f.Ort = pruef("name", f.Name, 200), pruef("strasse", f.Strasse, 200), pruef("ort", f.Ort, 100)
	f.Plz = strings.TrimSpace(f.Plz)
	if len(f.Plz) != 5 || strings.Trim(f.Plz, "0123456789") != "" {
		fehler = append(fehler, FeldFehler{"plz", "Bitte eine fünfstellige PLZ angeben."})
	}
	if len(fehler) > 0 {
		return fehler
	}
	n, err := d.Q.ZaehleFehlendeHeute(ctx, d.Heute())
	if err != nil {
		return err
	}
	if n >= maxFehlendeProTag {
		return ErrZuViele
	}
	return d.Q.InsertFehlendeKita(ctx, db.InsertFehlendeKitaParams{Name: f.Name, Strasse: f.Strasse, Plz: f.Plz, Ort: f.Ort, ErstelltAm: d.Heute()})
}

// FehlendeAnnehmen (Verwaltung) legt die Kita an.
func (d *Dienst) FehlendeAnnehmen(ctx context.Context, id int64) (int64, error) {
	var kitaID int64
	err := d.inTx(ctx, func(q *db.Queries) error {
		f, err := q.GetFehlendeKita(ctx, id)
		if err != nil {
			return nichtGefunden(err)
		}
		kitaID, err = d.KitaAnlegen(ctx, q, KitaDaten{Name: f.Name, Strasse: &f.Strasse, Plz: &f.Plz, Ort: &f.Ort})
		if err != nil {
			return err
		}
		return q.DeleteFehlendeKita(ctx, id)
	})
	return kitaID, err
}

// KitaDaten sind Stammdaten aus Import oder Verwaltung.
type KitaDaten struct {
	Name     string
	Traeger  *string
	Strasse  *string
	Plz      *string
	Ort      *string
	Lat, Lon *float64
}

func suchtext(k KitaDaten) string {
	teile := []string{k.Name}
	for _, p := range []*string{k.Traeger, k.Strasse, k.Plz, k.Ort} {
		if p != nil {
			teile = append(teile, *p)
		}
	}
	return privacy.Normalisiere(strings.Join(teile, " "))
}

func (d *Dienst) KitaAnlegen(ctx context.Context, q *db.Queries, k KitaDaten) (int64, error) {
	return q.InsertKita(ctx, db.InsertKitaParams{
		Name: k.Name, Traeger: k.Traeger, Strasse: k.Strasse, Plz: k.Plz, Ort: k.Ort, Lat: k.Lat, Lon: k.Lon,
		Suchtext: suchtext(k), AdresseNorm: privacy.AdresseNorm(deref(k.Strasse)), ErstelltAm: d.Heute(),
	})
}

func (d *Dienst) KitaAktualisieren(ctx context.Context, q *db.Queries, id int64, k KitaDaten) error {
	return q.UpdateKita(ctx, db.UpdateKitaParams{
		ID: id, Name: k.Name, Traeger: k.Traeger, Strasse: k.Strasse, Plz: k.Plz, Ort: k.Ort, Lat: k.Lat, Lon: k.Lon,
		Suchtext: suchtext(k), AdresseNorm: privacy.AdresseNorm(deref(k.Strasse)),
	})
}

// ---------------------------------------------------------------- Aufräumen

type AufraeumErgebnis struct {
	Meldungen, Berichtigungen, Links, Einladungen, Pow, Mails, Vorschlaege, Fehlende int64
}

// Aufraeumen setzt die Löschfristen durch. Das aggregierte tagesstatus/protokoll bleibt.
func (d *Dienst) Aufraeumen(ctx context.Context) (AufraeumErgebnis, error) {
	h := d.Heute()
	var r AufraeumErgebnis
	var err error
	schritte := []func() error{
		func() error {
			r.Meldungen, err = d.Q.LoescheAlteMeldungen(ctx, datum.Plus(h, -d.Cfg.AufbewahrungTage))
			return err
		},
		func() error {
			r.Berichtigungen, err = d.Q.LoescheAlteBerichtigungen(ctx, db.LoescheAlteBerichtigungenParams{Heute: h, Grenze: datum.Plus(h, -30)})
			return err
		},
		func() error { r.Links, err = d.Q.LoescheAlteLinks(ctx, h); return err },
		func() error { r.Einladungen, err = d.Q.LoescheAlteEinladungen(ctx, h); return err },
		func() error { r.Pow, err = d.Q.PowAufraeumen(ctx); return err },
		func() error { r.Mails, err = d.Q.MailsAufgeben(ctx); return err },
		func() error {
			r.Vorschlaege, err = d.Q.LoescheAlteVorschlaege(ctx, datum.Plus(h, -vorschlagAufbewahrungTage))
			return err
		},
		func() error {
			r.Fehlende, err = d.Q.LoescheAlteFehlende(ctx, datum.Plus(h, -fehlendeAufbewahrungTage))
			return err
		},
	}
	for _, s := range schritte {
		if err := s(); err != nil {
			return r, err
		}
	}
	return r, nil
}

// PowVerbrauchen markiert eine Proof-of-Work-Challenge als verwendet.
func (d *Dienst) PowVerbrauchen(ctx context.Context, nonce string, ablauf time.Time) (bool, error) {
	n, err := d.Q.PowVerwenden(ctx, db.PowVerwendenParams{Nonce: nonce, Ablauf: ablauf})
	return n == 1, err
}

func ptr[T any](v T) *T { return &v }

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
