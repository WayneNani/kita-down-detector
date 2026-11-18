package importer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/WayneNani/kita-down-detector/internal/db"
	"github.com/WayneNani/kita-down-detector/internal/dienst"
	"github.com/WayneNani/kita-down-detector/internal/privacy"
)

type Modus string

const (
	// Primaer: maßgebliches Verzeichnis (z. B. Landesdatensatz). Unbekannte Kitas
	// werden angelegt, nicht mehr enthaltene ausgeblendet, Stammdaten überschrieben.
	Primaer Modus = "primaer"
	// Ergaenzung: nur abgleichen; ergänzt fehlende Felder und Kontaktadressen.
	Ergaenzung Modus = "ergaenzung"
)

type Optionen struct {
	Quelle      string // z. B. "kibiz", "bonn", "koeln", "osm"
	Modus       Modus
	Anlegen     bool            // Ergänzung: nicht zuordenbare Kitas trotzdem anlegen
	Spalten     map[Feld]string // manuelle Spaltenzuordnung
	CRS         string          // "auto", "4326", "25832"
	Ort         string          // Standard-Ort, falls die Quelle keinen enthält
	Herkunft    string          // Herkunft der E-Mail-Adressen: opendata, osm, ifg
	Trockenlauf bool
}

type Statistik struct {
	Format                                       string
	Spalten                                      map[Feld]string
	Gelesen, Uebersprungen, Neu, Zugeordnet      int
	Aktualisiert, Offen, Emails, EmailsVerworfen int
	Doppelt, KoordinatenVerworfen                int
	Deaktiviert                                  int64
}

func (s Statistik) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Format: %s\nErkannte Spalten:\n", s.Format)
	for _, f := range Felder {
		if v, ok := s.Spalten[f]; ok {
			fmt.Fprintf(&b, "  %-11s ← %s\n", f, v)
		}
	}
	fmt.Fprintf(&b, "Gelesen: %d, übersprungen (ohne Name): %d, doppelte IDs übersprungen: %d\n", s.Gelesen, s.Uebersprungen, s.Doppelt)
	if s.KoordinatenVerworfen > 0 {
		fmt.Fprintf(&b, "Ungültige Koordinaten verworfen (Kita trotzdem importiert): %d\n", s.KoordinatenVerworfen)
	}
	fmt.Fprintf(&b, "Neu angelegt: %d, vorhandenen Kitas zugeordnet: %d (davon aktualisiert: %d), offen zur Prüfung: %d\n", s.Neu, s.Zugeordnet, s.Aktualisiert, s.Offen)
	fmt.Fprintf(&b, "Kontaktadressen übernommen: %d, als persönlich verworfen: %d\n", s.Emails, s.EmailsVerworfen)
	if s.Deaktiviert > 0 {
		fmt.Fprintf(&b, "Ausgeblendet (nicht mehr in der Quelle): %d\n", s.Deaktiviert)
	}
	return b.String()
}

type datensatz struct {
	QuelleID string
	dienst.KitaDaten
	Email string
}

var (
	plzOrtRe = regexp.MustCompile(`(\d{5})\s+([^,]+)$`)
	plzRe    = regexp.MustCompile(`\d{5}`)
	endetZif = regexp.MustCompile(`\d\s*[a-zA-Z]?$`)
)

func zahl(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if strings.Contains(s, ",") {
		// deutsches Format „356.558,858“: Punkte sind Tausendertrenner
		s = strings.ReplaceAll(strings.ReplaceAll(s, ".", ""), ",", ".")
	}
	if s == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	return f, err == nil
}

func opt(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

var errKoordinate = errors.New("ungültige Koordinate")

// umwandeln liefert errKoordinate, wenn nur die Koordinate unbrauchbar ist (Datensatz bleibt nutzbar).
func umwandeln(r Roh, sp map[Feld]string, o Optionen) (datensatz, error) {
	get := func(f Feld) string {
		if k, ok := sp[f]; ok {
			return strings.TrimSpace(r.Felder[k])
		}
		return ""
	}
	d := datensatz{QuelleID: get(FeldID), Email: get(FeldEmail)}
	d.Name = get(FeldName)
	strasse, plz, ort := get(FeldStrasse), get(FeldPlz), get(FeldOrt)
	if hnr := get(FeldHausnummer); hnr != "" && !endetZif.MatchString(strasse) {
		strasse = strings.TrimSpace(strasse + " " + hnr)
	}
	// „Musterstr. 1, 53111 Bonn“ in einem Feld
	if plz == "" {
		if vorn, hinten, ok := strings.Cut(strasse, ","); ok {
			if m := plzOrtRe.FindStringSubmatch(strings.TrimSpace(hinten)); m != nil {
				strasse, plz = strings.TrimSpace(vorn), m[1]
				if ort == "" {
					ort = strings.TrimSpace(m[2])
				}
			}
		}
	}
	if m := plzRe.FindString(plz); m != "" {
		plz = m
	} else {
		plz = ""
	}
	if ort == "" {
		ort = o.Ort
	}
	d.Traeger, d.Strasse, d.Plz, d.Ort = opt(get(FeldTraeger)), opt(strasse), opt(plz), opt(ort)

	// Koordinaten
	var x, y float64
	var hatXY bool
	if lat, ok1 := zahl(get(FeldLat)); ok1 {
		if lon, ok2 := zahl(get(FeldLon)); ok2 {
			x, y, hatXY = lon, lat, true
		}
	}
	if !hatXY {
		if xv, ok1 := zahl(get(FeldX)); ok1 {
			if yv, ok2 := zahl(get(FeldY)); ok2 {
				x, y, hatXY = xv, yv, true
			}
		}
	}
	if !hatXY && r.X != nil && r.Y != nil {
		x, y, hatXY = *r.X, *r.Y, true
	}
	if d.QuelleID == "" {
		h := sha256.Sum256([]byte(privacy.Normalisiere(d.Name) + "|" + plz + "|" + privacy.AdresseNorm(strasse)))
		d.QuelleID = "h:" + hex.EncodeToString(h[:8])
	}
	if hatXY && !(x == 0 && y == 0) {
		lat, lon, err := koordinaten(x, y, o.CRS)
		if err != nil {
			return d, errKoordinate
		}
		d.Lat, d.Lon = &lat, &lon
	} else if hatXY {
		return d, errKoordinate // 0/0 ist ein Platzhalter
	}
	return d, nil
}

func koordinaten(x, y float64, crs string) (lat, lon float64, err error) {
	switch {
	case crs == "4326" || (crs == "auto" || crs == "") && x >= -180 && x <= 180 && y >= -90 && y <= 90:
		lat, lon = y, x
	case crs == "25832" || (crs == "auto" || crs == "") && x > 100_000 && x < 1_000_000 && y > 5_000_000 && y < 6_500_000:
		lat, lon = UTMzuWGS84(x, y, 32)
	case (crs == "auto" || crs == "") && x > 32_100_000 && x < 33_000_000: // UTM mit Zonenvorsatz „32“
		lat, lon = UTMzuWGS84(x-32_000_000, y, 32)
	default:
		return 0, 0, fmt.Errorf("Koordinatensystem nicht erkannt (x=%v, y=%v) – bitte --crs angeben", x, y)
	}
	if lat < 47 || lat > 56 || lon < 5 || lon > 16 {
		return 0, 0, fmt.Errorf("Koordinate außerhalb Deutschlands (%.5f, %.5f) – bitte --crs prüfen", lat, lon)
	}
	return lat, lon, nil
}

var errTrockenlauf = errors.New("trockenlauf")

// Importieren liest eine Datei ein und gleicht sie mit dem Bestand ab.
func Importieren(ctx context.Context, d *dienst.Dienst, pfad string, o Optionen) (Statistik, error) {
	if o.Herkunft == "" {
		o.Herkunft = "opendata"
	}
	roh, format, err := Lesen(pfad)
	if err != nil {
		return Statistik{}, err
	}
	sp := ErkenneSpalten(roh, o.Spalten)
	st := Statistik{Format: format, Spalten: sp, Gelesen: len(roh)}
	if _, ok := sp[FeldName]; !ok {
		return st, fmt.Errorf("keine Namensspalte erkannt – bitte --spalte name=<Spalte> angeben")
	}
	err = pgx.BeginFunc(ctx, d.Pool, func(tx pgx.Tx) error {
		q := d.Q.WithTx(tx)
		gesehen := map[string]bool{}
		for _, r := range roh {
			ds, err := umwandeln(r, sp, o)
			if errors.Is(err, errKoordinate) {
				st.KoordinatenVerworfen++
			} else if err != nil {
				return fmt.Errorf("%s: %w", ds.Name, err)
			}
			if ds.Name == "" {
				st.Uebersprungen++
				continue
			}
			if gesehen[ds.QuelleID] {
				st.Doppelt++
				continue
			}
			gesehen[ds.QuelleID] = true
			if err := importiereEinen(ctx, d, q, ds, o, &st); err != nil {
				return fmt.Errorf("%s: %w", ds.Name, err)
			}
		}
		if o.Modus == Primaer {
			n, err := q.DeaktiviereNichtGesehene(ctx, db.DeaktiviereNichtGeseheneParams{Quelle: o.Quelle, Stichtag: d.Heute()})
			if err != nil {
				return err
			}
			st.Deaktiviert = n
		}
		if o.Trockenlauf {
			return errTrockenlauf
		}
		return nil
	})
	if errors.Is(err, errTrockenlauf) {
		err = nil
	}
	return st, err
}

func importiereEinen(ctx context.Context, d *dienst.Dienst, q *db.Queries, ds datensatz, o Optionen, st *Statistik) error {
	var kitaID *int64
	var aehnlichkeit *float32
	if z, err := q.GetZuordnung(ctx, db.GetZuordnungParams{Quelle: o.Quelle, QuelleID: ds.QuelleID}); err == nil {
		kitaID = z.KitaID
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if kitaID == nil && ds.Plz != nil {
		adr := privacy.AdresseNorm(deref(ds.Strasse))
		kand, err := q.KitaKandidaten(ctx, db.KitaKandidatenParams{Name: ds.Name, Plz: *ds.Plz, AdresseNorm: adr, Quelle: o.Quelle, QuelleID: ds.QuelleID})
		if err != nil {
			return err
		}
		if len(kand) > 0 {
			k := kand[0]
			// Gleiche Adresse + halbwegs ähnlicher Name → dieselbe Kita.
			// Abweichende Adresse → nie automatisch (generische Namen wie
			// „Städtische Kindertageseinrichtung …“ sind sehr ähnlich).
			// Fehlt einer Seite die Adresse, nur bei sehr ähnlichem Namen.
			gleicheAdresse := adr != "" && k.AdresseNorm == adr
			ohneAdresse := adr == "" || k.AdresseNorm == ""
			if (gleicheAdresse && k.Aehnlichkeit >= 0.2) || (ohneAdresse && k.Aehnlichkeit >= 0.8) {
				kitaID = &k.ID
			}
			aehnlichkeit = &k.Aehnlichkeit
		}
	}

	switch {
	case kitaID != nil:
		st.Zugeordnet++
		vorhanden, err := q.GetKita(ctx, *kitaID)
		if err != nil {
			return err
		}
		neu := ds.KitaDaten
		if o.Modus != Primaer {
			// Ergänzung: nur fehlende Koordinaten und Träger; Name, Adresse und
			// „aktiv“ bestimmt allein die primäre Quelle.
			neu = dienst.KitaDaten{Name: vorhanden.Name, Traeger: oder(vorhanden.Traeger, ds.Traeger), Strasse: vorhanden.Strasse,
				Plz: vorhanden.Plz, Ort: vorhanden.Ort, Lat: vorhanden.Lat, Lon: vorhanden.Lon}
			if vorhanden.Lat == nil || vorhanden.Lon == nil {
				neu.Lat, neu.Lon = ds.Lat, ds.Lon
			}
		} else {
			neu.Traeger, neu.Lat, neu.Lon = oder(ds.Traeger, vorhanden.Traeger), oderF(ds.Lat, vorhanden.Lat), oderF(ds.Lon, vorhanden.Lon)
			if !vorhanden.Aktiv {
				if err := q.SetzeKitaAktiv(ctx, *kitaID); err != nil {
					return err
				}
				st.Aktualisiert++
			}
		}
		if aendert(vorhanden, neu) {
			if err := d.KitaAktualisieren(ctx, q, *kitaID, neu); err != nil {
				return err
			}
			st.Aktualisiert++
		}
	case o.Modus == Primaer || o.Anlegen:
		id, err := d.KitaAnlegen(ctx, q, ds.KitaDaten)
		if err != nil {
			return err
		}
		kitaID = &id
		st.Neu++
	default:
		st.Offen++
	}

	daten, err := json.Marshal(map[string]any{"name": ds.Name, "traeger": ds.Traeger, "strasse": ds.Strasse, "plz": ds.Plz, "ort": ds.Ort, "lat": ds.Lat, "lon": ds.Lon})
	if err != nil {
		return err
	}
	if err := q.UpsertZuordnung(ctx, db.UpsertZuordnungParams{Quelle: o.Quelle, QuelleID: ds.QuelleID, KitaID: kitaID, Aehnlichkeit: aehnlichkeit, Geprueft: kitaID != nil && aehnlichkeit == nil, Daten: daten, ZuletztGesehen: d.Heute(), Primaer: o.Modus == Primaer}); err != nil {
		return err
	}

	if ds.Email != "" && kitaID != nil {
		email, ok := privacy.NormalisiereEmail(strings.Split(ds.Email, ";")[0])
		switch {
		case !ok:
		case !privacy.IstFunktionsadresse(email):
			st.EmailsVerworfen++
		default:
			n, err := q.KontaktWennLeer(ctx, db.KontaktWennLeerParams{KitaID: *kitaID, Email: email, Herkunft: o.Herkunft, GeaendertAm: d.Heute()})
			if err != nil {
				return err
			}
			st.Emails += int(n)
		}
	}
	return nil
}

func aendert(k db.Kitum, n dienst.KitaDaten) bool {
	return k.Name != n.Name || deref(k.Traeger) != deref(n.Traeger) || deref(k.Strasse) != deref(n.Strasse) ||
		deref(k.Plz) != deref(n.Plz) || deref(k.Ort) != deref(n.Ort) || !gleichF(k.Lat, n.Lat) || !gleichF(k.Lon, n.Lon)
}

func oder(a, b *string) *string {
	if a != nil && *a != "" {
		return a
	}
	return b
}

func oderF(a, b *float64) *float64 {
	if a != nil {
		return a
	}
	return b
}

func gleichF(a, b *float64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
