package dienst

import (
	"context"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/WayneNani/kita-down-detector/internal/config"
	"github.com/WayneNani/kita-down-detector/internal/datum"
	"github.com/WayneNani/kita-down-detector/internal/db"
	"github.com/WayneNani/kita-down-detector/internal/domain"
	"github.com/WayneNani/kita-down-detector/internal/privacy"
	"github.com/WayneNani/kita-down-detector/internal/status"
)

type Dienst struct {
	Pool  *pgxpool.Pool
	Q     *db.Queries
	Cfg   config.Config
	Jetzt func() time.Time
}

func Neu(pool *pgxpool.Pool, cfg config.Config, jetzt func() time.Time) *Dienst {
	if jetzt == nil {
		jetzt = time.Now
	}
	return &Dienst{Pool: pool, Q: db.New(pool), Cfg: cfg, Jetzt: jetzt}
}

func (d *Dienst) Heute() time.Time { return datum.Heute(d.Jetzt()) }

// inTx führt fn in einer Transaktion aus.
func (d *Dienst) inTx(ctx context.Context, fn func(q *db.Queries) error) error {
	return pgx.BeginFunc(ctx, d.Pool, func(tx pgx.Tx) error { return fn(d.Q.WithTx(tx)) })
}

func nichtGefunden(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNichtGefunden
	}
	return err
}

// ---------------------------------------------------------------- Lesen

// tage liefert den angezeigten Status je Kita und Tag (fehlende Zeilen = unbekannt).
func (d *Dienst) tage(ctx context.Context, q *db.Queries, ids []int64, von, bis time.Time) (map[int64][]status.Tag, error) {
	rows, err := q.TagesstatusFuerKitas(ctx, db.TagesstatusFuerKitasParams{Ids: ids, Von: von, Bis: bis})
	if err != nil {
		return nil, err
	}
	vorhanden := map[int64]map[time.Time]db.Tagesstatus{}
	for _, r := range rows {
		if vorhanden[r.KitaID] == nil {
			vorhanden[r.KitaID] = map[time.Time]db.Tagesstatus{}
		}
		vorhanden[r.KitaID][r.Datum] = r
	}
	out := map[int64][]status.Tag{}
	for _, id := range ids {
		for _, t := range datum.Bereich(von, bis) {
			if r, ok := vorhanden[id][t]; ok {
				out[id] = append(out[id], ausZeile(r))
			} else {
				out[id] = append(out[id], status.Unbekannt(t))
			}
		}
	}
	return out, nil
}

func ausZeile(r db.Tagesstatus) status.Tag {
	return status.Tag{Datum: r.Datum, Status: domain.Status(r.Status), Stufe: domain.Stufe(r.Stufe),
		UhrzeitVon: r.UhrzeitVon, UhrzeitBis: r.UhrzeitBis, Grund: r.Grund, Anzahl: int(r.Anzahl)}
}

func (d *Dienst) uebersicht(ctx context.Context, kitas []db.Kitum) ([]KitaUebersicht, error) {
	ids := make([]int64, len(kitas))
	for i, k := range kitas {
		ids[i] = k.ID
	}
	h := d.Heute()
	tage, err := d.tage(ctx, d.Q, ids, h, datum.Plus(h, 1))
	if err != nil {
		return nil, err
	}
	out := make([]KitaUebersicht, len(kitas))
	for i, k := range kitas {
		t := tage[k.ID]
		out[i] = KitaUebersicht{Kita: kurz(k), Heute: tagJSON(t[0]), Morgen: tagJSON(t[1])}
	}
	return out, nil
}

func (d *Dienst) Detail(ctx context.Context, id int64) (KitaDetail, error) {
	k, err := d.Q.GetKita(ctx, id)
	if err != nil {
		return KitaDetail{}, nichtGefunden(err)
	}
	h := d.Heute()
	tage, err := d.tage(ctx, d.Q, []int64{id}, h, datum.Plus(h, domain.TageAnzeige-1))
	if err != nil {
		return KitaDetail{}, err
	}
	prot, err := d.Q.ProtokollFuerKita(ctx, db.ProtokollFuerKitaParams{KitaID: id, Limit: 30})
	if err != nil {
		return KitaDetail{}, err
	}
	_, kErr := d.Q.GetKontakt(ctx, id)
	if kErr != nil && !errors.Is(kErr, pgx.ErrNoRows) {
		return KitaDetail{}, kErr
	}
	det := KitaDetail{Kita: kurz(k), KontaktBekannt: kErr == nil, Tage: []TagesStatus{}, Protokoll: []ProtokollEintrag{}}
	for _, t := range tage[id] {
		det.Tage = append(det.Tage, tagJSON(t))
	}
	for _, p := range prot {
		det.Protokoll = append(det.Protokoll, ProtokollEintrag{
			Datum: datum.Format(p.Datum), AltStatus: p.AltStatus, NeuStatus: p.NeuStatus,
			NeuStufe: int(p.NeuStufe), ErstelltAm: datum.Format(p.ErstelltAm),
		})
	}
	return det, nil
}

func (d *Dienst) Suche(ctx context.Context, begriff string) ([]KitaUebersicht, error) {
	norm := privacy.Normalisiere(begriff)
	woerter := strings.Fields(norm)
	if len(norm) < 2 || len(woerter) == 0 {
		return []KitaUebersicht{}, nil
	}
	if len(woerter) > 5 {
		woerter = woerter[:5]
	}
	muster := make([]string, len(woerter))
	for i, w := range woerter {
		muster[i] = "%" + w + "%" // nach Normalisierung nur a-z0-9, also kein Escaping nötig
	}
	kitas, err := d.Q.SucheKitas(ctx, db.SucheKitasParams{Muster: muster, Begriff: begriff, Anzahl: 50})
	if err != nil {
		return nil, err
	}
	return d.uebersicht(ctx, kitas)
}

const umkreisM = 3000

func (d *Dienst) Nahe(ctx context.Context, lat, lon float64) ([]KitaUebersicht, error) {
	// Zusätzlich serverseitig auf ca. 1 km runden; gespeichert wird nichts.
	lat, lon = math.Round(lat*100)/100, math.Round(lon*100)/100
	if lat < 47 || lat > 56 || lon < 5 || lon > 16 {
		return []KitaUebersicht{}, nil
	}
	dLat := umkreisM / 111_000.0
	dLon := umkreisM / (111_000.0 * math.Cos(lat*math.Pi/180))
	kitas, err := d.Q.KitasImBereich(ctx, db.KitasImBereichParams{LatMin: lat - dLat, LatMax: lat + dLat, LonMin: lon - dLon, LonMax: lon + dLon})
	if err != nil {
		return nil, err
	}
	type mitAbstand struct {
		k db.Kitum
		m int
	}
	var liste []mitAbstand
	for _, k := range kitas {
		m := int(haversine(lat, lon, *k.Lat, *k.Lon))
		if m <= umkreisM {
			liste = append(liste, mitAbstand{k, m})
		}
	}
	slices.SortFunc(liste, func(a, b mitAbstand) int { return a.m - b.m })
	if len(liste) > 30 {
		liste = liste[:30]
	}
	sortiert := make([]db.Kitum, len(liste))
	for i, x := range liste {
		sortiert[i] = x.k
	}
	out, err := d.uebersicht(ctx, sortiert)
	if err != nil {
		return nil, err
	}
	for i := range out {
		m := liste[i].m
		out[i].EntfernungM = &m
	}
	return out, nil
}

func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6_371_000.0
	p1, p2 := lat1*math.Pi/180, lat2*math.Pi/180
	dp, dl := (lat2-lat1)*math.Pi/180, (lon2-lon1)*math.Pi/180
	a := math.Sin(dp/2)*math.Sin(dp/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}

func (d *Dienst) Auswahl(ctx context.Context, ids []int64) ([]KitaUebersicht, error) {
	kitas, err := d.Q.KitasNachIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	pos := map[int64]int{}
	for i, id := range ids {
		pos[id] = i
	}
	slices.SortFunc(kitas, func(a, b db.Kitum) int { return pos[a.ID] - pos[b.ID] })
	return d.uebersicht(ctx, kitas)
}

func (d *Dienst) Einschraenkungen(ctx context.Context, tag time.Time, ort *string) ([]Einschraenkung, error) {
	rows, err := d.Q.Einschraenkungen(ctx, db.EinschraenkungenParams{Datum: tag, Ort: ort})
	if err != nil {
		return nil, err
	}
	out := make([]Einschraenkung, len(rows))
	for i, r := range rows {
		out[i] = Einschraenkung{Kita: kurz(r.Kitum), Status: tagJSON(ausZeile(r.Tagesstatus))}
	}
	return out, nil
}

// ---------------------------------------------------------------- Prüfen

func (d *Dienst) PruefeMeldung(in MeldungInput) (Meldung, error) {
	var f Validierungsfehler
	st := domain.Status(in.Status)
	if !st.Gueltig() {
		f = append(f, FeldFehler{"status", "Bitte einen Status auswählen."})
	}
	var grund *string
	if in.Grund != nil && *in.Grund != "" {
		if !domain.Grund(*in.Grund).Gueltig() {
			f = append(f, FeldFehler{"grund", "Ungültiger Grund."})
		} else {
			grund = in.Grund
		}
	}
	von, okV := datum.Parse(in.DatumVon)
	bis := von
	okB := true
	if in.DatumBis != nil && *in.DatumBis != "" {
		bis, okB = datum.Parse(*in.DatumBis)
	}
	h := d.Heute()
	if !okV || !okB {
		f = append(f, FeldFehler{"datum_von", "Bitte ein gültiges Datum angeben."})
	} else {
		switch {
		case bis.Before(von):
			f = append(f, FeldFehler{"datum_bis", "Das Enddatum liegt vor dem Startdatum."})
		case datum.TageZwischen(von, bis) >= domain.MaxZeitraumTage:
			f = append(f, FeldFehler{"datum_bis", fmt.Sprintf("Ein Zeitraum darf höchstens %d Tage umfassen.", domain.MaxZeitraumTage)})
		}
		if von.Before(datum.Plus(h, -domain.MaxTageZurueck)) {
			f = append(f, FeldFehler{"datum_von", fmt.Sprintf("Meldungen sind höchstens %d Tage rückwirkend möglich.", domain.MaxTageZurueck)})
		}
		if bis.After(datum.Plus(h, domain.MaxTageVoraus)) {
			f = append(f, FeldFehler{"datum_bis", fmt.Sprintf("Meldungen sind höchstens %d Tage im Voraus möglich.", domain.MaxTageVoraus)})
		}
	}
	uVon, uBis := leerZuNil(in.UhrzeitVon), leerZuNil(in.UhrzeitBis)
	switch st {
	case domain.Verkuerzt:
		if uVon == nil || uBis == nil || !datum.IstUhrzeit(*uVon) || !datum.IstUhrzeit(*uBis) {
			f = append(f, FeldFehler{"uhrzeit_von", "Bei verkürzten Betreuungszeiten bitte Beginn und Ende der Betreuung angeben."})
		} else if *uBis <= *uVon {
			f = append(f, FeldFehler{"uhrzeit_bis", "Das Betreuungsende liegt vor dem Beginn."})
		}
	case domain.Notbetreuung:
		if (uVon == nil) != (uBis == nil) {
			f = append(f, FeldFehler{"uhrzeit_von", "Bitte Beginn und Ende angeben oder beide Felder leer lassen."})
		} else if (uVon != nil && !datum.IstUhrzeit(*uVon)) || (uBis != nil && !datum.IstUhrzeit(*uBis)) {
			f = append(f, FeldFehler{"uhrzeit_von", "Ungültige Uhrzeit."})
		} else if uVon != nil && uBis != nil && *uBis <= *uVon {
			f = append(f, FeldFehler{"uhrzeit_bis", "Das Betreuungsende liegt vor dem Beginn."})
		}
	default:
		uVon, uBis = nil, nil
	}
	if len(f) > 0 {
		return Meldung{}, f
	}
	return Meldung{Status: in.Status, Von: von, Bis: bis, UhrzeitVon: uVon, UhrzeitBis: uBis, Grund: grund}, nil
}

func leerZuNil(s *string) *string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	v := strings.TrimSpace(*s)
	return &v
}

// ---------------------------------------------------------------- Speichern

type Herkunft struct {
	Quelle     domain.Quelle
	MelderHash []byte // nur anonym
	LinkID     *int64
}

// SpeichereMeldung speichert eine Meldung und aktualisiert den angezeigten Status.
func (d *Dienst) SpeichereMeldung(ctx context.Context, kitaID int64, m Meldung, h Herkunft) error {
	return d.inTx(ctx, func(q *db.Queries) error { return d.speichere(ctx, q, kitaID, m, h) })
}

func (d *Dienst) speichere(ctx context.Context, q *db.Queries, kitaID int64, m Meldung, h Herkunft) error {
	// Sperrt die Kita-Zeile: Schreibvorgänge pro Kita laufen nacheinander.
	if _, err := q.LockKita(ctx, kitaID); err != nil {
		return nichtGefunden(err)
	}
	heute := d.Heute()
	if h.Quelle == domain.QuelleAnonym {
		n, err := q.ZaehleMeldungenHeute(ctx, db.ZaehleMeldungenHeuteParams{KitaID: kitaID, MelderHash: h.MelderHash, ErstelltAm: heute})
		if err != nil {
			return err
		}
		if n >= int64(d.Cfg.MaxMeldungenProTag) {
			return ErrZuViele
		}
	}
	if _, err := q.InsertMeldung(ctx, db.InsertMeldungParams{
		KitaID: kitaID, Status: m.Status, DatumVon: m.Von, DatumBis: m.Bis,
		UhrzeitVon: m.UhrzeitVon, UhrzeitBis: m.UhrzeitBis, Grund: m.Grund,
		Quelle: string(h.Quelle), MelderHash: h.MelderHash, LinkID: h.LinkID, ErstelltAm: heute,
	}); err != nil {
		return err
	}
	return d.neuBerechnen(ctx, q, kitaID, m.Von, m.Bis)
}

// neuBerechnen aktualisiert tagesstatus und protokolliert geänderte Tage.
func (d *Dienst) neuBerechnen(ctx context.Context, q *db.Queries, kitaID int64, von, bis time.Time) error {
	rows, err := q.MeldungenImZeitraum(ctx, db.MeldungenImZeitraumParams{KitaID: kitaID, Von: von, Bis: bis})
	if err != nil {
		return err
	}
	meldungen := make([]status.Meldung, len(rows))
	for i, r := range rows {
		meldungen[i] = status.Meldung{ID: r.ID, Status: domain.Status(r.Status), Von: r.DatumVon, Bis: r.DatumBis,
			UhrzeitVon: r.UhrzeitVon, UhrzeitBis: r.UhrzeitBis, Grund: r.Grund, Quelle: domain.Quelle(r.Quelle), MelderHash: r.MelderHash}
	}
	alt, err := d.tage(ctx, q, []int64{kitaID}, von, bis)
	if err != nil {
		return err
	}
	heute := d.Heute()
	for i, tag := range datum.Bereich(von, bis) {
		a := alt[kitaID][i]
		n := status.Berechne(meldungen, tag, d.Cfg.BestaetigungsSchwelle)
		if status.Gleich(a, n) {
			continue
		}
		if n.Status == domain.Unbekannt {
			err = q.DeleteTagesstatus(ctx, db.DeleteTagesstatusParams{KitaID: kitaID, Datum: tag})
		} else {
			err = q.UpsertTagesstatus(ctx, db.UpsertTagesstatusParams{
				KitaID: kitaID, Datum: tag, Status: string(n.Status), Stufe: int16(n.Stufe),
				UhrzeitVon: n.UhrzeitVon, UhrzeitBis: n.UhrzeitBis, Grund: n.Grund, Anzahl: int16(n.Anzahl),
			})
		}
		if err != nil {
			return err
		}
		if a.Status != n.Status || a.Stufe != n.Stufe {
			if err := q.InsertProtokoll(ctx, db.InsertProtokollParams{
				KitaID: kitaID, Datum: tag, AltStatus: string(a.Status), NeuStatus: string(n.Status),
				NeuStufe: int16(n.Stufe), ErstelltAm: heute,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}
