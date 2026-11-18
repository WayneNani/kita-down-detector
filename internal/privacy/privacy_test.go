package privacy

import (
	"bytes"
	"net/netip"
	"testing"
	"time"
)

func TestMelderHashTaeglichNeuUndKitaGetrennt(t *testing.T) {
	jetzt := time.Date(2026, 11, 18, 10, 0, 0, 0, time.UTC)
	g := NeuesTagesgeheimnis(func() time.Time { return jetzt })
	ip := netip.MustParseAddr("203.0.113.7")
	a := g.MelderHash(ip, "UA", 1)
	if !bytes.Equal(a, g.MelderHash(ip, "UA", 1)) {
		t.Fatal("gleicher Tag, gleiches Gerät: Hash muss gleich sein")
	}
	if bytes.Equal(a, g.MelderHash(ip, "UA", 2)) {
		t.Fatal("andere Kita: Hash muss sich unterscheiden")
	}
	jetzt = jetzt.Add(24 * time.Hour)
	if bytes.Equal(a, g.MelderHash(ip, "UA", 1)) {
		t.Fatal("neuer Tag: Hash muss sich unterscheiden")
	}
}

func TestIPv6WirdAufPraefixGekuerzt(t *testing.T) {
	a := IPPraefix(netip.MustParseAddr("2001:db8:1:2:aaaa::1"))
	b := IPPraefix(netip.MustParseAddr("2001:db8:1:2:bbbb::9"))
	if a != b || a != "2001:db8:1:2::/64" {
		t.Fatalf("got %s / %s", a, b)
	}
}

func TestIstFunktionsadresse(t *testing.T) {
	for email, want := range map[string]bool{
		"kita.sonnenschein@stadt.de":    true,
		"info@kita-regenbogen.de":       true,
		"kts-lindenthal@stadt-koeln.de": true,
		"familienzentrum.nord@bonn.de":  true,
		"anna.schmidt@stadt.de":         false,
		"a.schmidt@stadt.de":            false,
		"max-mueller@traeger.de":        false,
		"kita123@traeger.de":            true,
	} {
		if got := IstFunktionsadresse(email); got != want {
			t.Errorf("%s: got %v want %v", email, got, want)
		}
	}
}

func TestAdresseNorm(t *testing.T) {
	cases := map[string]string{
		"Hauptstraße 5a":   "hauptstrasse5a",
		"Hauptstr. 5 a":    "hauptstrasse5a",
		"Haupt Strasse 5A": "hauptstrasse5a",
		"Kölner Str. 12":   "koelnerstrasse12",
	}
	for in, want := range cases {
		if got := AdresseNorm(in); got != want {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
}

func TestMaskiereEmail(t *testing.T) {
	if got := MaskiereEmail("leitung@kita.example"); got != "l***@kita.example" {
		t.Fatal(got)
	}
}
