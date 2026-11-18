package importer

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/text/encoding/charmap"

	"github.com/WayneNani/kita-down-detector/internal/config"
	"github.com/WayneNani/kita-down-detector/internal/dienst"
	"github.com/WayneNani/kita-down-detector/internal/testdb"
)

func schreibe(t *testing.T, name, inhalt string, latin1 bool) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	b := []byte(inhalt)
	if latin1 {
		var err error
		if b, err = charmap.Windows1252.NewEncoder().Bytes(b); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(p, b, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLesenErkenntSpaltenUndUTM(t *testing.T) {
	p := schreibe(t, "kitas.csv", "Einrichtungsnummer;Name der Einrichtung;Straße;Hausnr.;PLZ;Gemeinde;Rechtswert;Hochwert\n"+
		"4711;Städtische Kita Domspatzen;Domkloster;4;50667;Köln;356558,858;5645279,727\n", true)
	roh, format, err := Lesen(p)
	if err != nil || format != "csv" || len(roh) != 1 {
		t.Fatalf("%v %s %d", err, format, len(roh))
	}
	sp := ErkenneSpalten(roh, nil)
	if sp[FeldName] != "Name der Einrichtung" || sp[FeldX] != "Rechtswert" || sp[FeldHausnummer] != "Hausnr." {
		t.Fatalf("Spalten: %v", sp)
	}
	ds, err := umwandeln(roh[0], sp, Optionen{CRS: "auto"})
	if err != nil {
		t.Fatal(err)
	}
	if ds.Name != "Städtische Kita Domspatzen" || *ds.Strasse != "Domkloster 4" || *ds.Plz != "50667" || *ds.Ort != "Köln" || ds.QuelleID != "4711" {
		t.Fatalf("%+v", ds)
	}
	if *ds.Lat < 50.9412 || *ds.Lat > 50.9414 || *ds.Lon < 6.9582 || *ds.Lon > 6.9584 {
		t.Fatalf("Koordinaten: %v %v", *ds.Lat, *ds.Lon)
	}
}

func TestAdresseInEinemFeld(t *testing.T) {
	roh := []Roh{{Felder: map[string]string{"Bezeichnung": "Kita Rheinaue", "Adresse": "Ludwig-Erhard-Allee 2, 53175 Bonn"}}}
	ds, err := umwandeln(roh[0], ErkenneSpalten(roh, nil), Optionen{})
	if err != nil || *ds.Strasse != "Ludwig-Erhard-Allee 2" || *ds.Plz != "53175" || *ds.Ort != "Bonn" {
		t.Fatalf("%v %+v", err, ds)
	}
}

func TestImportPrimaerUndErgaenzung(t *testing.T) {
	pool := testdb.Pool(t, "test_importer")
	jetzt := time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)
	d := dienst.Neu(pool, config.Config{}, func() time.Time { return jetzt })
	ctx := context.Background()

	land := schreibe(t, "land.csv", "id;name;strasse;plz;ort\n"+
		"1;Kita Sonnenschein;Poppelsdorfer Allee 1;53115;Bonn\n"+
		"2;Städtische Kita Löwenzahn;Venloer Straße 10;50672;Köln\n"+
		"3;Kita Regenbogen;Hauptstr. 5;53111;Bonn\n", false)
	st, err := Importieren(ctx, d, land, Optionen{Quelle: "kibiz", Modus: Primaer})
	if err != nil || st.Neu != 3 {
		t.Fatalf("%v\n%s", err, st)
	}

	// Kommunale Daten: andere Schreibweisen, E-Mail-Adressen, Esri-JSON mit UTM
	stadt := schreibe(t, "koeln.json", `{"features":[
	  {"attributes":{"OBJECTID":10,"NAME":"Kita Löwenzahn","STRASSE":"Venloer Str. 10","PLZ":"50672","ORT":"Köln","EMAIL":"kita-loewenzahn@stadt-koeln.de"},"geometry":{"x":356558.858,"y":5645279.727}},
	  {"attributes":{"OBJECTID":11,"NAME":"Kita Unbekannt","STRASSE":"Irgendwo 1","PLZ":"50667","ORT":"Köln","EMAIL":"anna.schmidt@stadt-koeln.de"}}
	]}`, false)
	st, err = Importieren(ctx, d, stadt, Optionen{Quelle: "koeln", Modus: Ergaenzung})
	if err != nil || st.Zugeordnet != 1 || st.Offen != 1 || st.Emails != 1 || st.Neu != 0 {
		t.Fatalf("%v\n%s", err, st)
	}
	var email string
	var lat *float64
	if err := pool.QueryRow(ctx, `SELECT kk.email, k.lat FROM kita k JOIN kita_kontakt kk ON kk.kita_id = k.id WHERE k.plz = '50672'`).Scan(&email, &lat); err != nil {
		t.Fatal(err)
	}
	if email != "kita-loewenzahn@stadt-koeln.de" || lat == nil {
		t.Fatalf("E-Mail/Koordinate nicht ergänzt: %s %v", email, lat)
	}
	var namen string
	pool.QueryRow(ctx, `SELECT string_agg(name, ',') FROM kita`).Scan(&namen)
	if strings.Contains(namen, "Unbekannt") {
		t.Fatal("Ergänzung darf ohne --anlegen keine Kitas anlegen")
	}
	var persoenlich int
	pool.QueryRow(ctx, `SELECT count(*) FROM kita_kontakt WHERE email LIKE 'anna%'`).Scan(&persoenlich)
	if persoenlich != 0 {
		t.Fatal("persönliche Adresse übernommen")
	}

	// Nächster Monat: Kita 3 fehlt im Landesdatensatz → ausgeblendet
	jetzt = jetzt.AddDate(0, 1, 0)
	land2 := schreibe(t, "land2.csv", "id;name;strasse;plz;ort\n1;Kita Sonnenschein;Poppelsdorfer Allee 1;53115;Bonn\n2;Städtische Kita Löwenzahn;Venloer Straße 10;50672;Köln\n", false)
	st, err = Importieren(ctx, d, land2, Optionen{Quelle: "kibiz", Modus: Primaer})
	if err != nil || st.Deaktiviert != 1 || st.Neu != 0 || st.Zugeordnet != 2 {
		t.Fatalf("%v\n%s", err, st)
	}
	treffer, _ := d.Suche(ctx, "Regenbogen")
	if len(treffer) != 0 {
		t.Fatal("ausgeblendete Kita darf nicht gefunden werden")
	}

	// Trockenlauf speichert nichts
	neu := schreibe(t, "neu.csv", "id;name;plz\n9;Kita Test;53111\n", false)
	if st, err = Importieren(ctx, d, neu, Optionen{Quelle: "kibiz2", Modus: Primaer, Trockenlauf: true}); err != nil || st.Neu != 1 {
		t.Fatalf("%v %s", err, st)
	}
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM kita WHERE name = 'Kita Test'`).Scan(&n)
	if n != 0 {
		t.Fatal("Trockenlauf hat gespeichert")
	}
}

// Review-Funde: generische Namen, Ergänzung reaktiviert, Platzhalter-Koordinaten, „Nr“-Spalte, doppelte IDs.
func TestImportRealistischeStolpersteine(t *testing.T) {
	pool := testdb.Pool(t, "test_importer2")
	jetzt := time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)
	d := dienst.Neu(pool, config.Config{}, func() time.Time { return jetzt })
	ctx := context.Background()

	land := schreibe(t, "land.csv", "id;name;strasse;Nr;plz;ort;lat;lon\n"+
		"101;Städtische Kindertageseinrichtung Am Park;Parkstraße;1;50667;Köln;50.94;6.95\n"+
		"102;Städtische Kindertageseinrichtung Am Bach;Bachweg;3;50667;Köln;0;0\n"+
		"103;Städtische Kindertageseinrichtung Domstraße;Domstraße;3;50667;Köln;50.94;6.96\n"+
		"103;Doppelte ID;Irgendwo;1;50667;Köln;;\n", false)
	st, err := Importieren(ctx, d, land, Optionen{Quelle: "kibiz", Modus: Primaer})
	if err != nil {
		t.Fatal(err)
	}
	if st.Neu != 3 || st.Doppelt != 1 || st.KoordinatenVerworfen != 1 {
		t.Fatalf("ähnliche Namen mit verschiedenen Adressen müssen getrennte Kitas bleiben:\n%s", st)
	}
	var strasse string
	pool.QueryRow(ctx, `SELECT strasse FROM kita WHERE name LIKE '%Am Bach'`).Scan(&strasse)
	if strasse != "Bachweg 3" {
		t.Fatalf("Spalte „Nr“ muss Hausnummer sein: %q", strasse)
	}
	// erneuter Import: stabil, nichts neu, nichts überschrieben
	st, err = Importieren(ctx, d, land, Optionen{Quelle: "kibiz", Modus: Primaer})
	if err != nil || st.Neu != 0 || st.Zugeordnet != 3 {
		t.Fatalf("%v\n%s", err, st)
	}

	// Primärquelle lässt „Am Park“ weg → ausgeblendet; Ergänzung darf sie nicht wieder aktivieren
	jetzt = jetzt.AddDate(0, 1, 0)
	land2 := schreibe(t, "land2.csv", "id;name;strasse;plz;ort\n102;Städtische Kindertageseinrichtung Am Bach;Bachweg 3;50667;Köln\n103;Städtische Kindertageseinrichtung Domstraße;Domstraße 3;50667;Köln\n", false)
	if st, err = Importieren(ctx, d, land2, Optionen{Quelle: "kibiz", Modus: Primaer}); err != nil || st.Deaktiviert != 1 {
		t.Fatalf("%v\n%s", err, st)
	}
	osm := schreibe(t, "osm.csv", "id;name;strasse;plz;ort;lat;lon\nnode/1;Städtische Kindertageseinrichtung Am Park;Parkstraße 1;50667;Köln;50.94;6.95\n", false)
	if st, err = Importieren(ctx, d, osm, Optionen{Quelle: "osm", Modus: Ergaenzung}); err != nil {
		t.Fatal(err)
	}
	var aktiv bool
	pool.QueryRow(ctx, `SELECT aktiv FROM kita WHERE name LIKE '%Am Park'`).Scan(&aktiv)
	if aktiv {
		t.Fatal("Ergänzungsquelle hat eine ausgeblendete Kita wieder aktiviert")
	}
}

func TestZahlMitTausendertrennern(t *testing.T) {
	for in, want := range map[string]float64{"356.558,858": 356558.858, "6,9583": 6.9583, "50.94": 50.94} {
		if got, ok := zahl(in); !ok || got != want {
			t.Errorf("%s: %v", in, got)
		}
	}
}
