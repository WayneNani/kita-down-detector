// Package status berechnet den angezeigten Status einer Kita an einem Tag.
// Reine Logik ohne Ein-/Ausgabe.
package status

import (
	"time"

	"github.com/WayneNani/kita-down-detector/internal/domain"
)

type Meldung struct {
	ID         int64
	Status     domain.Status
	Von, Bis   time.Time
	UhrzeitVon *string
	UhrzeitBis *string
	Grund      *string
	Quelle     domain.Quelle
	MelderHash []byte
}

type Tag struct {
	Datum      time.Time
	Status     domain.Status
	Stufe      domain.Stufe
	UhrzeitVon *string
	UhrzeitBis *string
	Grund      *string
	// Anzahl unabhängiger anonymer Meldungen für den angezeigten Status.
	Anzahl int
}

func Unbekannt(d time.Time) Tag {
	return Tag{Datum: d, Status: domain.Unbekannt, Stufe: domain.StufeKeine}
}

func aus(m Meldung, d time.Time, stufe domain.Stufe, anzahl int) Tag {
	return Tag{Datum: d, Status: m.Status, Stufe: stufe, UhrzeitVon: m.UhrzeitVon, UhrzeitBis: m.UhrzeitBis, Grund: m.Grund, Anzahl: anzahl}
}

// Berechne bestimmt den Status für Tag d:
//
//  1. Gibt es verifizierte Meldungen (Link, Berichtigung), gewinnt die höchste
//     Stufe, bei Gleichstand die neueste.
//  2. Sonst zählen anonyme Meldungen: Der Status mit den meisten unabhängigen
//     Meldenden gewinnt (Gleichstand: neueste Meldung). Ab `schwelle`
//     unabhängigen Meldungen gilt er als bestätigt.
func Berechne(meldungen []Meldung, d time.Time, schwelle int) Tag {
	var relevant []Meldung
	for _, m := range meldungen {
		if !m.Von.After(d) && !m.Bis.Before(d) {
			relevant = append(relevant, m)
		}
	}
	if len(relevant) == 0 {
		return Unbekannt(d)
	}

	var best *Meldung
	var bestStufe domain.Stufe
	for i := range relevant {
		m := &relevant[i]
		if m.Quelle == domain.QuelleAnonym {
			continue
		}
		s := m.Quelle.Stufe()
		if best == nil || s > bestStufe || (s == bestStufe && m.ID > best.ID) {
			best, bestStufe = m, s
		}
	}
	if best != nil {
		return aus(*best, d, bestStufe, 0)
	}

	type gruppe struct {
		melder  map[string]struct{}
		neueste Meldung
	}
	gruppen := map[domain.Status]*gruppe{}
	var reihenfolge []domain.Status
	for _, m := range relevant {
		g, ok := gruppen[m.Status]
		if !ok {
			g = &gruppe{melder: map[string]struct{}{}, neueste: m}
			gruppen[m.Status] = g
			reihenfolge = append(reihenfolge, m.Status)
		}
		g.melder[string(m.MelderHash)] = struct{}{}
		if m.ID > g.neueste.ID {
			g.neueste = m
		}
	}
	var sieger *gruppe
	for _, s := range reihenfolge {
		g := gruppen[s]
		if sieger == nil || len(g.melder) > len(sieger.melder) ||
			(len(g.melder) == len(sieger.melder) && g.neueste.ID > sieger.neueste.ID) {
			sieger = g
		}
	}
	stufe := domain.StufeUnbestaetigt
	if len(sieger.melder) >= schwelle {
		stufe = domain.StufeBestaetigt
	}
	return aus(sieger.neueste, d, stufe, len(sieger.melder))
}

// Gleich prüft, ob sich zwei Anzeigen unterscheiden (für Änderungsprotokoll und Upsert).
func Gleich(a, b Tag) bool {
	return a.Status == b.Status && a.Stufe == b.Stufe && a.Anzahl == b.Anzahl &&
		eqPtr(a.UhrzeitVon, b.UhrzeitVon) && eqPtr(a.UhrzeitBis, b.UhrzeitBis) && eqPtr(a.Grund, b.Grund)
}

func eqPtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
