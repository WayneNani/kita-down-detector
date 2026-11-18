package status

import (
	"fmt"
	"testing"
	"time"

	"github.com/WayneNani/kita-down-detector/internal/domain"
)

var tag = time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC)

type mOpt func(*Meldung)

var nextID int64

func m(opts ...mOpt) Meldung {
	nextID++
	x := Meldung{ID: nextID, Status: domain.Notbetreuung, Von: tag, Bis: tag, Quelle: domain.QuelleAnonym, MelderHash: []byte(fmt.Sprintf("h%d", nextID)), ErstelltAm: tag}
	for _, o := range opts {
		o(&x)
	}
	return x
}
func st(s domain.Status) mOpt      { return func(x *Meldung) { x.Status = s } }
func quelle(q domain.Quelle) mOpt  { return func(x *Meldung) { x.Quelle = q; x.MelderHash = nil } }
func hash(h string) mOpt           { return func(x *Meldung) { x.MelderHash = []byte(h) } }
func zeit(von, bis time.Time) mOpt { return func(x *Meldung) { x.Von, x.Bis = von, bis } }
func erstellt(t time.Time) mOpt    { return func(x *Meldung) { x.ErstelltAm = t } }
func uhr(von, bis string) mOpt     { return func(x *Meldung) { x.UhrzeitVon, x.UhrzeitBis = &von, &bis } }

func TestBerechne(t *testing.T) {
	morgen := tag.AddDate(0, 0, 1)
	tests := []struct {
		name       string
		meldungen  []Meldung
		wantStatus domain.Status
		wantStufe  domain.Stufe
		wantAnzahl int
	}{
		{"ohne Meldungen unbekannt", nil, domain.Unbekannt, domain.StufeKeine, 0},
		{"Meldung außerhalb des Zeitraums zählt nicht", []Meldung{m(zeit(morgen, morgen))}, domain.Unbekannt, domain.StufeKeine, 0},
		{"eine anonyme Meldung ist unbestätigt", []Meldung{m()}, domain.Notbetreuung, domain.StufeUnbestaetigt, 1},
		{"zwei unabhängige Meldungen bestätigen", []Meldung{m(), m()}, domain.Notbetreuung, domain.StufeBestaetigt, 2},
		{"gleiches Gerät zählt einmal", []Meldung{m(hash("x")), m(hash("x"))}, domain.Notbetreuung, domain.StufeUnbestaetigt, 1},
		{"Mehrheit gewinnt", []Meldung{m(st(domain.Geschlossen)), m(st(domain.Geschlossen)), m(st(domain.Regulaer))}, domain.Geschlossen, domain.StufeBestaetigt, 2},
		{"Gleichstand: neueste gewinnt", []Meldung{m(st(domain.Geschlossen)), m(st(domain.Verkuerzt), uhr("08:00", "12:00"))}, domain.Verkuerzt, domain.StufeUnbestaetigt, 1},
		{"Elternbeirat schlägt bestätigte anonyme", []Meldung{m(quelle(domain.QuelleElternbeirat), st(domain.Verkuerzt)), m(), m(), m()}, domain.Verkuerzt, domain.StufeElternbeirat, 0},
		{"Kita schlägt Elternbeirat", []Meldung{m(quelle(domain.QuelleKita)), m(quelle(domain.QuelleElternbeirat), st(domain.Geschlossen))}, domain.Notbetreuung, domain.StufeKita, 0},
		{"Berichtigung schlägt Elternbeirat und ältere Kita-Meldung", []Meldung{m(quelle(domain.QuelleKita)), m(quelle(domain.QuelleBerichtigung), st(domain.Regulaer)), m(quelle(domain.QuelleElternbeirat), st(domain.Geschlossen))}, domain.Regulaer, domain.StufeBerichtigung, 0},
		{"Kita kann eigene Berichtigung später per Link ändern", []Meldung{m(quelle(domain.QuelleBerichtigung), st(domain.Regulaer)), m(quelle(domain.QuelleKita), st(domain.Geschlossen))}, domain.Geschlossen, domain.StufeKita, 0},
		{"Hashes verschiedener Meldetage sind nicht unabhängig", []Meldung{m(st(domain.Geschlossen)), m(st(domain.Geschlossen), erstellt(tag.AddDate(0, 0, -1)))}, domain.Geschlossen, domain.StufeUnbestaetigt, 1},
		{"gleiche Stufe: neueste verifizierte", []Meldung{m(quelle(domain.QuelleElternbeirat), st(domain.Geschlossen)), m(quelle(domain.QuelleElternbeirat), st(domain.Regulaer))}, domain.Regulaer, domain.StufeElternbeirat, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Berechne(tt.meldungen, tag, 2)
			if got.Status != tt.wantStatus || got.Stufe != tt.wantStufe || got.Anzahl != tt.wantAnzahl {
				t.Fatalf("got %s/%d/%d, want %s/%d/%d", got.Status, got.Stufe, got.Anzahl, tt.wantStatus, tt.wantStufe, tt.wantAnzahl)
			}
		})
	}
}

func TestBerechneUebernimmtUhrzeiten(t *testing.T) {
	got := Berechne([]Meldung{m(st(domain.Verkuerzt), uhr("08:00", "12:30"))}, tag, 2)
	if got.UhrzeitBis == nil || *got.UhrzeitBis != "12:30" {
		t.Fatalf("Uhrzeit fehlt: %+v", got)
	}
}
