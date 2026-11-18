// Package dienst enthält die Anwendungsfälle (Melden, Berichtigen, Einladen …).
// HTTP und CLI rufen nur diese Schicht auf.
package dienst

import (
	"errors"
	"time"

	"github.com/WayneNani/kita-down-detector/internal/datum"
	"github.com/WayneNani/kita-down-detector/internal/db"
	"github.com/WayneNani/kita-down-detector/internal/status"
)

var (
	ErrNichtGefunden = errors.New("nicht gefunden")
	ErrUngueltig     = errors.New("ungültig oder abgelaufen")
	ErrZuViele       = errors.New("zu viele Anfragen")
	ErrKeinKontakt   = errors.New("keine Kontaktadresse hinterlegt")
)

// FeldFehler ist ein Validierungsfehler, der der Oberfläche angezeigt wird.
type FeldFehler struct {
	Feld    string `json:"feld,omitempty"`
	Meldung string `json:"meldung"`
}

type Validierungsfehler []FeldFehler

func (v Validierungsfehler) Error() string { return "Eingaben ungültig" }

type KitaKurz struct {
	ID      int64    `json:"id"`
	Name    string   `json:"name"`
	Traeger *string  `json:"traeger"`
	Strasse *string  `json:"strasse"`
	Plz     *string  `json:"plz"`
	Ort     *string  `json:"ort"`
	Lat     *float64 `json:"lat"`
	Lon     *float64 `json:"lon"`
}

func kurz(k db.Kitum) KitaKurz {
	return KitaKurz{ID: k.ID, Name: k.Name, Traeger: k.Traeger, Strasse: k.Strasse, Plz: k.Plz, Ort: k.Ort, Lat: k.Lat, Lon: k.Lon}
}

type TagesStatus struct {
	Datum      string  `json:"datum"`
	Status     string  `json:"status"`
	Stufe      int     `json:"stufe"`
	UhrzeitVon *string `json:"uhrzeit_von"`
	UhrzeitBis *string `json:"uhrzeit_bis"`
	Grund      *string `json:"grund"`
	Anzahl     int     `json:"anzahl"`
}

func tagJSON(t status.Tag) TagesStatus {
	return TagesStatus{
		Datum: datum.Format(t.Datum), Status: string(t.Status), Stufe: int(t.Stufe),
		UhrzeitVon: t.UhrzeitVon, UhrzeitBis: t.UhrzeitBis, Grund: t.Grund, Anzahl: t.Anzahl,
	}
}

type KitaUebersicht struct {
	Kita        KitaKurz    `json:"kita"`
	Heute       TagesStatus `json:"heute"`
	Morgen      TagesStatus `json:"morgen"`
	EntfernungM *int        `json:"entfernung_m,omitempty"`
}

type ProtokollEintrag struct {
	Datum      string `json:"datum"`
	AltStatus  string `json:"alt_status"`
	NeuStatus  string `json:"neu_status"`
	NeuStufe   int    `json:"neu_stufe"`
	ErstelltAm string `json:"erstellt_am"`
}

type KitaDetail struct {
	Kita           KitaKurz           `json:"kita"`
	Tage           []TagesStatus      `json:"tage"`
	Protokoll      []ProtokollEintrag `json:"protokoll"`
	KontaktBekannt bool               `json:"kontakt_bekannt"`
}

type Einschraenkung struct {
	Kita   KitaKurz    `json:"kita"`
	Status TagesStatus `json:"status"`
}

// MeldungInput entspricht dem JSON der API.
type MeldungInput struct {
	Status     string  `json:"status"`
	DatumVon   string  `json:"datum_von"`
	DatumBis   *string `json:"datum_bis"`
	UhrzeitVon *string `json:"uhrzeit_von"`
	UhrzeitBis *string `json:"uhrzeit_bis"`
	Grund      *string `json:"grund"`
}

// Meldung ist eine geprüfte Meldung.
type Meldung struct {
	Status     string
	Von, Bis   time.Time
	UhrzeitVon *string
	UhrzeitBis *string
	Grund      *string
}

func (m Meldung) Input() MeldungInput {
	bis := datum.Format(m.Bis)
	return MeldungInput{Status: m.Status, DatumVon: datum.Format(m.Von), DatumBis: &bis, UhrzeitVon: m.UhrzeitVon, UhrzeitBis: m.UhrzeitBis, Grund: m.Grund}
}
