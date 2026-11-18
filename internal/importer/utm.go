package importer

import "math"

// UTMzuWGS84 rechnet UTM-Koordinaten (ETRS89/GRS80, Nordhalbkugel) in Breite/Länge um.
// NRW-Geodaten liegen meist in EPSG:25832 (UTM Zone 32N). Formel nach Krüger
// (Reihenentwicklung, Genauigkeit im Millimeterbereich).
func UTMzuWGS84(ostwert, nordwert float64, zone int) (lat, lon float64) {
	const (
		a  = 6378137.0
		f  = 1 / 298.257222101 // GRS80
		k0 = 0.9996
	)
	n := f / (2 - f)
	A := a / (1 + n) * (1 + n*n/4 + n*n*n*n/64)
	beta := [3]float64{
		n/2 - 2*n*n/3 + 37*n*n*n/96,
		n*n/48 + n*n*n/15,
		17 * n * n * n / 480,
	}
	delta := [3]float64{
		2*n - 2*n*n/3 - 2*n*n*n,
		7*n*n/3 - 8*n*n*n/5,
		56 * n * n * n / 15,
	}
	xi := nordwert / (k0 * A)
	eta := (ostwert - 500000) / (k0 * A)
	xiP, etaP := xi, eta
	for j := 1; j <= 3; j++ {
		jf := float64(j)
		xiP -= beta[j-1] * math.Sin(2*jf*xi) * math.Cosh(2*jf*eta)
		etaP -= beta[j-1] * math.Cos(2*jf*xi) * math.Sinh(2*jf*eta)
	}
	chi := math.Asin(math.Sin(xiP) / math.Cosh(etaP))
	phi := chi
	for j := 1; j <= 3; j++ {
		phi += delta[j-1] * math.Sin(2*float64(j)*chi)
	}
	lambda0 := float64(zone*6-183) * math.Pi / 180
	lambda := lambda0 + math.Atan(math.Sinh(etaP)/math.Cos(xiP))
	return phi * 180 / math.Pi, lambda * 180 / math.Pi
}
