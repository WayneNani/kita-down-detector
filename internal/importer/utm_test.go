package importer

import (
	"math"
	"testing"
)

// Referenzwerte mit pyproj (EPSG:4326 → EPSG:25832) berechnet.
func TestUTMzuWGS84(t *testing.T) {
	cases := []struct {
		name                string
		lat, lon, ost, nord float64
	}{
		{"Kölner Dom", 50.941278, 6.958281, 356558.858, 5645279.727},
		{"Bonner Münster", 50.733630, 7.099820, 365908.006, 5621925.994},
		{"Mittelmeridian", 51.0, 9.0, 500000.0, 5649824.888},
		{"Aachen", 50.775346, 6.083887, 294408.688, 5628897.561},
		{"Minden", 52.289, 8.917, 494338.771, 5793185.651},
	}
	for _, c := range cases {
		lat, lon := UTMzuWGS84(c.ost, c.nord, 32)
		if math.Abs(lat-c.lat) > 1e-6 || math.Abs(lon-c.lon) > 1e-6 {
			t.Errorf("%s: got %.7f,%.7f want %.7f,%.7f", c.name, lat, lon, c.lat, c.lon)
		}
	}
}
