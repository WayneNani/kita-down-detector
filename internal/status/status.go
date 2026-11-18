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
	// Tag der Meldung. Melder-Hashes gelten nur innerhalb eines Tages (der
	// Schlüssel wechselt täglich) – unabhängige Meldende zählen wir daher je Tag.
	ErstelltAm time.Time
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
//  1. Gibt es verifizierte Meldungen (Link, Berichtigung), gewinnt der höchste
//     Rang, bei Gleichstand die neueste. Kita-Link und Berichtigung kommen beide
//     von der Kita und haben denselben Rang – so kann die Kita eine eigene
//     Berichtigung später per Link wieder ändern.
//  2. Sonst zählen anonyme Meldungen: Der Status mit den meisten unabhängigen
//     Meldenden gewinnt (Gleichstand: neueste Meldung). Unabhängig heißt:
//     verschiedene Melder-Hashes am selben Meldetag – über Tage hinweg lassen
//     sich Hashes nicht vergleichen, daher zählt der stärkste Tag. Ab `schwelle`
//     gilt der Status als bestätigt.
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
	var bestRang domain.Stufe
	for i := range relevant {
		m := &relevant[i]
		if m.Quelle == domain.QuelleAnonym {
			continue
		}
		r := rang(m.Quelle)
		if best == nil || r > bestRang || (r == bestRang && m.ID > best.ID) {
			best, bestRang = m, r
		}
	}
	if best != nil {
		return aus(*best, d, best.Quelle.Stufe(), 0)
	}

	type gruppe struct {
		melderJeTag map[time.Time]map[string]struct{}
		neueste     Meldung
		anzahl      int
	}
	gruppen := map[domain.Status]*gruppe{}
	var reihenfolge []domain.Status
	for _, m := range relevant {
		g, ok := gruppen[m.Status]
		if !ok {
			g = &gruppe{melderJeTag: map[time.Time]map[string]struct{}{}, neueste: m}
			gruppen[m.Status] = g
			reihenfolge = append(reihenfolge, m.Status)
		}
		tag := g.melderJeTag[m.ErstelltAm]
		if tag == nil {
			tag = map[string]struct{}{}
			g.melderJeTag[m.ErstelltAm] = tag
		}
		tag[string(m.MelderHash)] = struct{}{}
		g.anzahl = max(g.anzahl, len(tag))
		if m.ID > g.neueste.ID {
			g.neueste = m
		}
	}
	var sieger *gruppe
	for _, s := range reihenfolge {
		g := gruppen[s]
		if sieger == nil || g.anzahl > sieger.anzahl || (g.anzahl == sieger.anzahl && g.neueste.ID > sieger.neueste.ID) {
			sieger = g
		}
	}
	stufe := domain.StufeUnbestaetigt
	if sieger.anzahl >= schwelle {
		stufe = domain.StufeBestaetigt
	}
	return aus(sieger.neueste, d, stufe, sieger.anzahl)
}

// rang: Reihenfolge verifizierter Quellen. Kita-Link und Berichtigung sind gleichrangig.
func rang(q domain.Quelle) domain.Stufe {
	if q == domain.QuelleBerichtigung {
		return domain.StufeKita
	}
	return q.Stufe()
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
