// Package importer liest Kita-Verzeichnisse (Landesdatensatz, kommunale Open
// Data, OSM) ein und gleicht sie mit vorhandenen Kitas ab.
package importer

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
)

// Roh ist ein eingelesener Datensatz mit Originalspalten und optionaler Geometrie.
type Roh struct {
	Felder map[string]string
	X, Y   *float64 // Geometrie (Punkt) in Dateikoordinaten
}

// Lesen erkennt das Format anhand von Endung und Inhalt.
func Lesen(pfad string) ([]Roh, string, error) {
	b, err := os.ReadFile(pfad)
	if err != nil {
		return nil, "", err
	}
	b = bytes.TrimPrefix(b, []byte("\xef\xbb\xbf"))
	if !utf8.Valid(b) {
		if b, err = charmap.Windows1252.NewDecoder().Bytes(b); err != nil {
			return nil, "", err
		}
	}
	if strings.EqualFold(filepath.Ext(pfad), ".csv") || !bytes.HasPrefix(bytes.TrimSpace(b), []byte("{")) {
		r, err := lesenCSV(b)
		return r, "csv", err
	}
	var kopf struct {
		Type     string            `json:"type"`
		Features []json.RawMessage `json:"features"`
		Elements []json.RawMessage `json:"elements"`
	}
	if err := json.Unmarshal(b, &kopf); err != nil {
		return nil, "", fmt.Errorf("JSON: %w", err)
	}
	switch {
	case kopf.Elements != nil:
		r, err := lesenOverpass(kopf.Elements)
		return r, "overpass", err
	case kopf.Type == "FeatureCollection":
		r, err := lesenGeoJSON(kopf.Features)
		return r, "geojson", err
	case kopf.Features != nil:
		r, err := lesenEsri(kopf.Features)
		return r, "esri-json", err
	}
	return nil, "", fmt.Errorf("unbekanntes JSON-Format (erwartet GeoJSON, Esri-JSON oder Overpass)")
}

func lesenCSV(b []byte) ([]Roh, error) {
	ersteZeile, _, _ := bytes.Cut(b, []byte("\n"))
	trenner := ','
	best := bytes.Count(ersteZeile, []byte(","))
	for _, t := range []rune{';', '\t', '|'} {
		if n := bytes.Count(ersteZeile, []byte(string(t))); n > best {
			trenner, best = t, n
		}
	}
	r := csv.NewReader(bytes.NewReader(b))
	r.Comma = trenner
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	kopf, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("CSV-Kopfzeile: %w", err)
	}
	var out []Roh
	for {
		zeile, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("CSV: %w", err)
		}
		f := map[string]string{}
		for i, k := range kopf {
			if i < len(zeile) {
				f[strings.TrimSpace(k)] = strings.TrimSpace(zeile[i])
			}
		}
		out = append(out, Roh{Felder: f})
	}
	return out, nil
}

func eigenschaften(m map[string]any) map[string]string {
	f := map[string]string{}
	for k, v := range m {
		switch x := v.(type) {
		case nil:
		case string:
			f[k] = strings.TrimSpace(x)
		case float64:
			f[k] = strconv.FormatFloat(x, 'f', -1, 64)
		default:
			f[k] = fmt.Sprint(x)
		}
	}
	return f
}

func lesenGeoJSON(features []json.RawMessage) ([]Roh, error) {
	var out []Roh
	for _, raw := range features {
		var ft struct {
			ID         any            `json:"id"`
			Properties map[string]any `json:"properties"`
			Geometry   *struct {
				Type        string          `json:"type"`
				Coordinates json.RawMessage `json:"coordinates"`
			} `json:"geometry"`
		}
		if err := json.Unmarshal(raw, &ft); err != nil {
			return nil, fmt.Errorf("GeoJSON: %w", err)
		}
		r := Roh{Felder: eigenschaften(ft.Properties)}
		if ft.ID != nil {
			if _, ok := r.Felder["id"]; !ok {
				r.Felder["id"] = fmt.Sprint(ft.ID)
			}
		}
		if ft.Geometry != nil {
			var p []float64
			var mp [][]float64
			switch {
			case ft.Geometry.Type == "Point" && json.Unmarshal(ft.Geometry.Coordinates, &p) == nil && len(p) >= 2:
				r.X, r.Y = &p[0], &p[1]
			case ft.Geometry.Type == "MultiPoint" && json.Unmarshal(ft.Geometry.Coordinates, &mp) == nil && len(mp) > 0 && len(mp[0]) >= 2:
				r.X, r.Y = &mp[0][0], &mp[0][1]
			}
		}
		out = append(out, r)
	}
	return out, nil
}

func lesenEsri(features []json.RawMessage) ([]Roh, error) {
	var out []Roh
	for _, raw := range features {
		var ft struct {
			Attributes map[string]any `json:"attributes"`
			Geometry   *struct {
				X *float64 `json:"x"`
				Y *float64 `json:"y"`
			} `json:"geometry"`
		}
		if err := json.Unmarshal(raw, &ft); err != nil {
			return nil, fmt.Errorf("Esri-JSON: %w", err)
		}
		r := Roh{Felder: eigenschaften(ft.Attributes)}
		if ft.Geometry != nil {
			r.X, r.Y = ft.Geometry.X, ft.Geometry.Y
		}
		out = append(out, r)
	}
	return out, nil
}

func lesenOverpass(elements []json.RawMessage) ([]Roh, error) {
	var out []Roh
	for _, raw := range elements {
		var el struct {
			Type   string                      `json:"type"`
			ID     int64                       `json:"id"`
			Lat    *float64                    `json:"lat"`
			Lon    *float64                    `json:"lon"`
			Center *struct{ Lat, Lon float64 } `json:"center"`
			Tags   map[string]string           `json:"tags"`
		}
		if err := json.Unmarshal(raw, &el); err != nil {
			return nil, fmt.Errorf("Overpass: %w", err)
		}
		f := map[string]string{"@id": fmt.Sprintf("%s/%d", el.Type, el.ID)}
		for k, v := range el.Tags {
			f[k] = v
		}
		r := Roh{Felder: f}
		if el.Lat != nil && el.Lon != nil {
			r.X, r.Y = el.Lon, el.Lat
		} else if el.Center != nil {
			r.X, r.Y = &el.Center.Lon, &el.Center.Lat
		}
		out = append(out, r)
	}
	return out, nil
}

// ---------------------------------------------------------------- Spalten erkennen

// Feld ist ein Zielfeld des Imports.
type Feld string

const (
	FeldID         Feld = "id"
	FeldName       Feld = "name"
	FeldTraeger    Feld = "traeger"
	FeldStrasse    Feld = "strasse"
	FeldHausnummer Feld = "hausnummer"
	FeldPlz        Feld = "plz"
	FeldOrt        Feld = "ort"
	FeldEmail      Feld = "email"
	FeldLat        Feld = "lat"
	FeldLon        Feld = "lon"
	FeldX          Feld = "x"
	FeldY          Feld = "y"
)

var Felder = []Feld{FeldID, FeldName, FeldTraeger, FeldStrasse, FeldHausnummer, FeldPlz, FeldOrt, FeldEmail, FeldLat, FeldLon, FeldX, FeldY}

// Kandidaten je Zielfeld, in Prioritätsreihenfolge (normalisierte Spaltennamen).
var kandidaten = map[Feld][]string{
	FeldID:         {"id", "einrichtungsnummer", "einrichtungsnr", "einrichtungsid", "kibizid", "kitaid", "objectid", "fid", "gmlid"},
	FeldName:       {"name", "einrichtungsname", "nameeinrichtung", "namedereinrichtung", "nameeinrichtungkita", "bezeichnung", "einrichtung", "kitaname", "kita", "titel", "objektname"},
	FeldTraeger:    {"traeger", "traegername", "nametraeger", "traegerschaft", "operator", "betreiber"},
	FeldStrasse:    {"strasse", "strassehausnummer", "strasseundhausnummer", "addrstreet", "anschrift", "adresse", "str", "strassenname"},
	FeldHausnummer: {"hausnummer", "hausnr", "hnr", "addrhousenumber", "nr"},
	FeldPlz:        {"plz", "postleitzahl", "addrpostcode"},
	FeldOrt:        {"ort", "gemeinde", "gemeindename", "stadt", "kommune", "addrcity", "ortsname"},
	FeldEmail:      {"email", "emailadresse", "mail", "contactemail", "kontaktemail", "emaileinrichtung"},
	FeldLat:        {"lat", "latitude", "breite", "breitengrad", "ywgs84", "wgs84lat"},
	FeldLon:        {"lon", "lng", "long", "longitude", "laenge", "laengengrad", "xwgs84", "wgs84lon"},
	FeldX:          {"x", "rechtswert", "xutm", "utmx", "easting", "ostwert", "xkoordinate", "koordinatex"},
	FeldY:          {"y", "hochwert", "yutm", "utmy", "northing", "nordwert", "ykoordinate", "koordinatey"},
}

var nichtAlnum = regexp.MustCompile(`[^a-z0-9]`)

func normSpalte(s string) string {
	s = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss", "Ä", "ae", "Ö", "oe", "Ü", "ue").Replace(strings.ToLower(s))
	return nichtAlnum.ReplaceAllString(s, "")
}

// ErkenneSpalten ordnet Zielfelder Originalspalten zu; vorgaben überschreiben die Erkennung.
func ErkenneSpalten(daten []Roh, vorgaben map[Feld]string) map[Feld]string {
	spalten := map[string]string{} // normalisiert → original
	for _, r := range daten {
		for k := range r.Felder {
			n := normSpalte(k)
			if _, ok := spalten[n]; !ok {
				spalten[n] = k
			}
		}
	}
	zuord := map[Feld]string{}
	for _, f := range Felder {
		if v, ok := vorgaben[f]; ok {
			zuord[f] = v
			continue
		}
		for _, k := range kandidaten[f] {
			if orig, ok := spalten[k]; ok {
				zuord[f] = orig
				break
			}
		}
	}
	return zuord
}
