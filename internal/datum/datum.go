// Package datum rechnet mit Kalendertagen in Deutschland (Europe/Berlin).
// Ein Datum ist ein time.Time um 00:00 UTC; so bleiben Vergleiche und
// Tagesarithmetik frei von Sommerzeit-Effekten.
package datum

import (
	"regexp"
	"time"
)

const Layout = "2006-01-02"

var berlin = mustLoad("Europe/Berlin")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

// Heute liefert den aktuellen Kalendertag in Deutschland.
func Heute(jetzt time.Time) time.Time {
	y, m, d := jetzt.In(berlin).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func Parse(s string) (time.Time, bool) {
	t, err := time.Parse(Layout, s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func Format(t time.Time) string { return t.Format(Layout) }

func Plus(t time.Time, tage int) time.Time { return t.AddDate(0, 0, tage) }

func TageZwischen(von, bis time.Time) int { return int(bis.Sub(von).Hours() / 24) }

// Bereich liefert alle Tage von..bis (inklusive).
func Bereich(von, bis time.Time) []time.Time {
	var out []time.Time
	for d := von; !d.After(bis); d = Plus(d, 1) {
		out = append(out, d)
	}
	return out
}

// EndeKitaJahr: Das Kita-Jahr in NRW endet am 31.07.; danach wechseln Elternbeiräte.
func EndeKitaJahr(t time.Time) time.Time {
	ende := time.Date(t.Year(), time.July, 31, 0, 0, 0, 0, time.UTC)
	if t.After(ende) {
		return ende.AddDate(1, 0, 0)
	}
	return ende
}

var uhrzeitRe = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

func IstUhrzeit(s string) bool { return uhrzeitRe.MatchString(s) }

var wochentag = [...]string{"So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"}

// Kurz formatiert „Mi, 18.11.“ (für Mails).
func Kurz(t time.Time) string {
	return wochentag[t.Weekday()] + ", " + t.Format("02.01.")
}
