// Package domain enthält die festen Begriffe. Bewusst kein Freitext: So können
// keine Namen oder Gesundheitsdaten von Beschäftigten ins System gelangen.
package domain

type Status string

const (
	Unbekannt    Status = "unbekannt"
	Regulaer     Status = "regulaer"
	Verkuerzt    Status = "verkuerzt"
	Notbetreuung Status = "notbetreuung"
	Geschlossen  Status = "geschlossen"
)

func (s Status) Gueltig() bool {
	switch s {
	case Regulaer, Verkuerzt, Notbetreuung, Geschlossen:
		return true
	}
	return false
}

func (s Status) Label() string {
	switch s {
	case Regulaer:
		return "Reguläre Betreuung"
	case Verkuerzt:
		return "Verkürzte Betreuungszeiten"
	case Notbetreuung:
		return "Notbetreuung"
	case Geschlossen:
		return "Keine Betreuung möglich"
	}
	return "Keine Meldung"
}

// Einschraenkung: Status, die auf Übersichten als Einschränkung zählen.
func (s Status) Einschraenkung() bool {
	return s == Verkuerzt || s == Notbetreuung || s == Geschlossen
}

type Grund string

var gruende = map[Grund]string{
	"personalmangel":  "Personalmangel",
	"krankheitswelle": "Krankheitswelle",
	"streik":          "Streik",
	"schliesstag":     "Geplanter Schließtag",
	"sonstiges":       "Sonstiges",
}

func (g Grund) Gueltig() bool { _, ok := gruende[g]; return ok }
func (g Grund) Label() string { return gruende[g] }

type Quelle string

const (
	QuelleAnonym       Quelle = "anonym"
	QuelleElternbeirat Quelle = "elternbeirat"
	QuelleKita         Quelle = "kita"
	QuelleBerichtigung Quelle = "kita_berichtigung"
)

// Stufe ist die Vertrauensstufe einer Anzeige (höher = vertrauenswürdiger).
// Die Lücken lassen Platz für spätere Quellen (z. B. DKIM-geprüfte Mails = 25).
type Stufe int16

const (
	StufeKeine        Stufe = 0
	StufeUnbestaetigt Stufe = 10
	StufeBestaetigt   Stufe = 20
	StufeElternbeirat Stufe = 30
	StufeKita         Stufe = 40
	StufeBerichtigung Stufe = 50
)

func (q Quelle) Stufe() Stufe {
	switch q {
	case QuelleElternbeirat:
		return StufeElternbeirat
	case QuelleKita:
		return StufeKita
	case QuelleBerichtigung:
		return StufeBerichtigung
	}
	return StufeUnbestaetigt
}

type Rolle string

const (
	RolleElternbeirat Rolle = "elternbeirat"
	RolleKita         Rolle = "kita"
)

func (r Rolle) Gueltig() bool { return r == RolleElternbeirat || r == RolleKita }

func (r Rolle) Quelle() Quelle {
	if r == RolleKita {
		return QuelleKita
	}
	return QuelleElternbeirat
}

const (
	MaxZeitraumTage = 31
	MaxTageZurueck  = 7
	MaxTageVoraus   = 90
	TageAnzeige     = 14
)
