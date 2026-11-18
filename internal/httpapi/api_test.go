package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/WayneNani/kita-down-detector/internal/config"
	"github.com/WayneNani/kita-down-detector/internal/datum"
	"github.com/WayneNani/kita-down-detector/internal/db"
	"github.com/WayneNani/kita-down-detector/internal/dienst"
	"github.com/WayneNani/kita-down-detector/internal/domain"
	"github.com/WayneNani/kita-down-detector/internal/pow"
	"github.com/WayneNani/kita-down-detector/internal/privacy"
	"github.com/WayneNani/kita-down-detector/internal/testdb"
)

var jetzt = time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC) // Mi, 18.11.2026

type umgebung struct {
	t     *testing.T
	pool  *pgxpool.Pool
	d     *dienst.Dienst
	h     http.Handler
	ip    string
	jetzt time.Time
	kita1 int64 // mit Kontaktadresse
	kita2 int64 // ohne Kontaktadresse
}

var gemeinsamerPool *pgxpool.Pool

func TestMain(m *testing.M) {
	pool, err := testdb.Oeffnen("test_httpapi")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	gemeinsamerPool = pool
	code := m.Run()
	if pool != nil {
		pool.Close()
	}
	os.Exit(code)
}

func neu(t *testing.T) *umgebung {
	t.Helper()
	if gemeinsamerPool == nil {
		t.Skip("TEST_DATABASE_URL nicht gesetzt – Integrationstest übersprungen")
	}
	testdb.Leeren(t, gemeinsamerPool)
	u := &umgebung{t: t, pool: gemeinsamerPool, ip: "203.0.113.7", jetzt: jetzt}
	cfg := config.Config{
		BaseURL: "https://kita.example", KontaktEmail: "kontakt@kita.example",
		AltchaSecret: strings.Repeat("s", 32), AltchaCost: 1, AltchaCounterMin: 1, AltchaCounterMax: 5,
		BestaetigungsSchwelle: 2, MaxMeldungenProTag: 3, AufbewahrungTage: 180,
		VertrauteDomains: []string{"stadt-koeln.de"},
	}
	u.d = dienst.Neu(u.pool, cfg, func() time.Time { return u.jetzt })
	ctx := context.Background()
	var err error
	u.kita1, err = u.d.KitaAnlegen(ctx, u.d.Q, dienst.KitaDaten{Name: "Kita Sonnenschein", Strasse: p("Poppelsdorfer Allee 1"), Plz: p("53115"), Ort: p("Bonn"), Lat: f(50.7280), Lon: f(7.0960)})
	if err != nil {
		t.Fatal(err)
	}
	u.kita2, _ = u.d.KitaAnlegen(ctx, u.d.Q, dienst.KitaDaten{Name: "Städtische Kita Löwenzahn", Strasse: p("Venloer Str. 10"), Plz: p("50672"), Ort: p("Köln")})
	if err := u.d.KontaktSetzen(ctx, u.kita1, "kita.sonnenschein@bonn.de", "opendata"); err != nil {
		t.Fatal(err)
	}
	p := pow.Neu(cfg.AltchaSecret, cfg.AltchaCost, cfg.AltchaCounterMin, cfg.AltchaCounterMax, u.d.PowVerbrauchen)
	frontend := fstest.MapFS{
		"index.html":    {Data: []byte(`<!doctype html><html><head><!--app-head--></head><body><div id="root"></div><!--app-data--></body></html>`)},
		"assets/app.js": {Data: []byte(`console.log(1)`)},
		"sw.js":         {Data: []byte(`self`)},
	}
	u.h = Neu(u.d, p, privacy.NeuesTagesgeheimnis(func() time.Time { return u.jetzt }), fs.FS(frontend), slog.New(slog.NewTextHandler(io.Discard, nil))).Handler()
	return u
}

func p(s string) *string   { return &s }
func f(v float64) *float64 { return &v }

type antwort struct {
	code int
	body []byte
	hdr  http.Header
}

func (a antwort) json(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(a.body, v); err != nil {
		t.Fatalf("JSON: %v\n%s", err, a.body)
	}
}

func (u *umgebung) anfrage(methode, pfad string, body any, hdr ...string) antwort {
	u.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(methode, pfad, r)
	req.RemoteAddr = u.ip + ":12345"
	req.Header.Set("User-Agent", "Testbrowser")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	u.h.ServeHTTP(rec, req)
	return antwort{code: rec.Code, body: rec.Body.Bytes(), hdr: rec.Header()}
}

func (u *umgebung) altcha() string {
	u.t.Helper()
	a := u.anfrage("GET", "/api/v1/pow/challenge", nil)
	if a.code != 200 {
		u.t.Fatalf("challenge: %d", a.code)
	}
	var ch altcha.Challenge
	a.json(u.t, &ch)
	payload, err := pow.Loese(ch)
	if err != nil {
		u.t.Fatal(err)
	}
	return payload
}

func meldung(status, von string, extra ...string) map[string]any {
	m := map[string]any{"status": status, "datum_von": von}
	for i := 0; i+1 < len(extra); i += 2 {
		m[extra[i]] = extra[i+1]
	}
	return m
}

func (u *umgebung) detail(id int64) dienst.KitaDetail {
	u.t.Helper()
	var d dienst.KitaDetail
	u.anfrage("GET", "/api/v1/kitas/"+itoa(id), nil).json(u.t, &d)
	return d
}

func (u *umgebung) mails() []db.MailOutbox {
	rows, err := u.pool.Query(context.Background(), "SELECT id, an, betreff, text, versuche, naechster_versuch, erstellt FROM mail_outbox ORDER BY id")
	if err != nil {
		u.t.Fatal(err)
	}
	defer rows.Close()
	var out []db.MailOutbox
	for rows.Next() {
		var m db.MailOutbox
		if err := rows.Scan(&m.ID, &m.An, &m.Betreff, &m.Text, &m.Versuche, &m.NaechsterVersuch, &m.Erstellt); err != nil {
			u.t.Fatal(err)
		}
		out = append(out, m)
	}
	return out
}

var tokenRe = regexp.MustCompile(`https://kita\.example/(m|berichtigung|einladung)#([A-Za-z0-9_-]+)`)

func tokenAus(t *testing.T, text, art string) string {
	t.Helper()
	for _, m := range tokenRe.FindAllStringSubmatch(text, -1) {
		if m[1] == art {
			return m[2]
		}
	}
	t.Fatalf("kein %s-Link in Mail:\n%s", art, text)
	return ""
}

// ---------------------------------------------------------------- Tests

func TestSucheUndUmlaute(t *testing.T) {
	u := neu(t)
	var l struct{ Kitas []dienst.KitaUebersicht }
	u.anfrage("GET", "/api/v1/kitas?q=53115", nil).json(t, &l)
	if len(l.Kitas) != 1 || l.Kitas[0].Kita.Name != "Kita Sonnenschein" || l.Kitas[0].Heute.Status != "unbekannt" {
		t.Fatalf("PLZ-Suche: %+v", l)
	}
	u.anfrage("GET", "/api/v1/kitas?q=loewenzahn%20koeln", nil).json(t, &l)
	if len(l.Kitas) != 1 || l.Kitas[0].Kita.ID != u.kita2 {
		t.Fatalf("Umlaut-Suche: %+v", l)
	}
	if a := u.anfrage("GET", "/api/v1/kitas?q=a", nil); a.code != 400 {
		t.Fatalf("zu kurz: %d", a.code)
	}
}

func TestNahe(t *testing.T) {
	u := neu(t)
	var l struct{ Kitas []dienst.KitaUebersicht }
	u.anfrage("GET", "/api/v1/kitas/nahe?lat=50.73&lon=7.10", nil).json(t, &l)
	if len(l.Kitas) != 1 || l.Kitas[0].EntfernungM == nil || *l.Kitas[0].EntfernungM > 1000 {
		t.Fatalf("%+v", l)
	}
}

func TestAnonymeMeldungBrauchtPoWUndKeineWiederverwendung(t *testing.T) {
	u := neu(t)
	if a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita1)+"/meldungen", meldung("notbetreuung", "2026-11-18")); a.code != 403 {
		t.Fatalf("ohne PoW: %d", a.code)
	}
	alt := u.altcha()
	m := meldung("notbetreuung", "2026-11-18")
	m["altcha"] = alt
	if a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita1)+"/meldungen", m); a.code != 201 {
		t.Fatalf("mit PoW: %d %s", a.code, a.body)
	}
	if a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita1)+"/meldungen", m); a.code != 403 {
		t.Fatalf("Wiederverwendung: %d", a.code)
	}
}

func (u *umgebung) melde(kita int64, m map[string]any) antwort {
	u.t.Helper()
	m["altcha"] = u.altcha()
	return u.anfrage("POST", "/api/v1/kitas/"+itoa(kita)+"/meldungen", m)
}

func TestUnbestaetigtDannBestaetigtMitProtokoll(t *testing.T) {
	u := neu(t)
	a := u.melde(u.kita1, meldung("notbetreuung", "2026-11-18", "datum_bis", "2026-11-19"))
	var det dienst.KitaDetail
	a.json(t, &det)
	if det.Tage[0].Status != "notbetreuung" || det.Tage[0].Stufe != int(domain.StufeUnbestaetigt) || det.Tage[1].Status != "notbetreuung" || det.Tage[2].Status != "unbekannt" {
		t.Fatalf("nach 1. Meldung: %+v", det.Tage[:3])
	}
	// gleiches Gerät: bleibt unbestätigt
	u.melde(u.kita1, meldung("notbetreuung", "2026-11-18"))
	if d := u.detail(u.kita1); d.Tage[0].Stufe != int(domain.StufeUnbestaetigt) {
		t.Fatalf("gleiches Gerät hat bestätigt: %+v", d.Tage[0])
	}
	u.ip = "198.51.100.20"
	u.melde(u.kita1, meldung("notbetreuung", "2026-11-18"))
	d := u.detail(u.kita1)
	if d.Tage[0].Stufe != int(domain.StufeBestaetigt) || d.Tage[0].Anzahl != 2 {
		t.Fatalf("zweites Gerät: %+v", d.Tage[0])
	}
	if len(d.Protokoll) != 3 || d.Protokoll[0].NeuStufe != int(domain.StufeBestaetigt) {
		t.Fatalf("Protokoll: %+v", d.Protokoll)
	}
	var st struct {
		Kitas []dienst.Einschraenkung
	}
	u.anfrage("GET", "/api/v1/status?ort=bonn", nil).json(t, &st)
	if len(st.Kitas) != 1 || st.Kitas[0].Status.Status != "notbetreuung" {
		t.Fatalf("Einschränkungen: %+v", st)
	}
}

func TestKeineIPGespeichert(t *testing.T) {
	u := neu(t)
	u.melde(u.kita1, meldung("geschlossen", "2026-11-18"))
	var zeile string
	if err := u.pool.QueryRow(context.Background(), "SELECT row_to_json(m)::text FROM meldung m").Scan(&zeile); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(zeile, "203.0.113.7") || strings.Contains(zeile, "Testbrowser") || strings.Contains(zeile, "T09") {
		t.Fatalf("personenbezogene Daten gespeichert: %s", zeile)
	}
}

func TestRateLimitProGeraetKitaTag(t *testing.T) {
	u := neu(t)
	for i := 0; i < 3; i++ {
		if a := u.melde(u.kita1, meldung("geschlossen", "2026-11-18")); a.code != 201 {
			t.Fatalf("Meldung %d: %d", i, a.code)
		}
	}
	if a := u.melde(u.kita1, meldung("geschlossen", "2026-11-18")); a.code != 429 {
		t.Fatalf("4. Meldung: %d", a.code)
	}
	// Am nächsten Tag wieder möglich
	u.jetzt = u.jetzt.Add(24 * time.Hour)
	if a := u.melde(u.kita1, meldung("geschlossen", "2026-11-19")); a.code != 201 {
		t.Fatalf("nächster Tag: %d", a.code)
	}
}

func TestValidierung(t *testing.T) {
	u := neu(t)
	a := u.melde(u.kita1, meldung("verkuerzt", "2026-11-18"))
	if a.code != 422 || !strings.Contains(string(a.body), "Beginn und Ende") {
		t.Fatalf("verkürzt ohne Zeiten: %d %s", a.code, a.body)
	}
	if a := u.melde(u.kita1, meldung("geschlossen", "2026-11-18", "datum_bis", "2027-03-01")); a.code != 422 {
		t.Fatalf("zu langer Zeitraum: %d", a.code)
	}
	if a := u.melde(u.kita1, meldung("geschlossen", "2026-10-01")); a.code != 422 {
		t.Fatalf("zu weit zurück: %d", a.code)
	}
	if a := u.melde(u.kita1, meldung("verkuerzt", "2026-11-18", "uhrzeit_von", "08:00", "uhrzeit_bis", "12:30")); a.code != 201 {
		t.Fatalf("gültig: %d %s", a.code, a.body)
	}
	m := meldung("geschlossen", "2026-11-18")
	m["freitext"] = "Frau X ist krank"
	if a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita1)+"/meldungen", m); a.code != 400 {
		t.Fatalf("unbekanntes Feld: %d", a.code)
	}
}

func TestHTTPHaertung(t *testing.T) {
	u := neu(t)
	req := httptest.NewRequest("POST", "/api/v1/link/meldungen", strings.NewReader("status=geschlossen"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	u.h.ServeHTTP(rec, req)
	if rec.Code != 401 && rec.Code != 415 {
		t.Fatalf("Formular statt JSON: %d", rec.Code)
	}
	if a := u.anfrage("POST", "/api/v1/kitas/fehlend", map[string]any{}, "Origin", "https://boese.example"); a.code != 403 {
		t.Fatalf("fremder Origin: %d", a.code)
	}
	a := u.anfrage("GET", "/api/v1/info", nil)
	if !strings.Contains(a.hdr.Get("Content-Security-Policy"), "script-src 'self'") || a.hdr.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("Header fehlen: %v", a.hdr)
	}
}

func TestMeldenPerLink(t *testing.T) {
	u := neu(t)
	token, bis, err := u.d.ErstelleLink(context.Background(), nil, u.kita1, domain.RolleElternbeirat, nil)
	if err != nil || datum.Format(bis) != "2027-07-31" {
		t.Fatalf("%v %v", err, bis)
	}
	auth := []string{"Authorization", "Link " + token}
	var info struct {
		Rolle string `json:"rolle"`
	}
	u.anfrage("GET", "/api/v1/link", nil, auth...).json(t, &info)
	if info.Rolle != "elternbeirat" {
		t.Fatalf("%+v", info)
	}
	a := u.anfrage("POST", "/api/v1/link/meldungen", meldung("verkuerzt", "2026-11-18", "uhrzeit_von", "08:00", "uhrzeit_bis", "13:00"), auth...)
	var det dienst.KitaDetail
	a.json(t, &det)
	if a.code != 201 || det.Tage[0].Stufe != int(domain.StufeElternbeirat) || *det.Tage[0].UhrzeitBis != "13:00" {
		t.Fatalf("%d %+v", a.code, det.Tage[0])
	}
	if a := u.anfrage("GET", "/api/v1/link", nil, "Authorization", "Link falsch"); a.code != 401 {
		t.Fatalf("falsches Token: %d", a.code)
	}
	u.d.Q.WiderrufeLinks(context.Background(), db.WiderrufeLinksParams{KitaID: u.kita1})
	if a := u.anfrage("POST", "/api/v1/link/meldungen", meldung("geschlossen", "2026-11-18"), auth...); a.code != 401 {
		t.Fatalf("widerrufen: %d", a.code)
	}
	abgelaufen := datum.Plus(datum.Heute(u.jetzt), -1)
	token2, _, _ := u.d.ErstelleLink(context.Background(), nil, u.kita1, domain.RolleKita, &abgelaufen)
	if a := u.anfrage("GET", "/api/v1/link", nil, "Authorization", "Link "+token2); a.code != 401 {
		t.Fatalf("abgelaufen: %d", a.code)
	}
}

func TestBerichtigung(t *testing.T) {
	u := neu(t)
	token, _, _ := u.d.ErstelleLink(context.Background(), nil, u.kita1, domain.RolleElternbeirat, nil)
	u.anfrage("POST", "/api/v1/link/meldungen", meldung("geschlossen", "2026-11-18"), "Authorization", "Link "+token)

	m := meldung("notbetreuung", "2026-11-18")
	m["altcha"] = u.altcha()
	a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita1)+"/berichtigungen", m)
	if a.code != 202 || !strings.Contains(string(a.body), "k***@bonn.de") {
		t.Fatalf("%d %s", a.code, a.body)
	}
	mails := u.mails()
	if len(mails) != 1 || mails[0].An != "kita.sonnenschein@bonn.de" {
		t.Fatalf("Mails: %+v", mails)
	}
	bt := tokenAus(t, mails[0].Text, "berichtigung")
	auth := []string{"Authorization", "Berichtigung " + bt}
	if a := u.anfrage("GET", "/api/v1/berichtigung", nil, auth...); a.code != 200 || !strings.Contains(string(a.body), `"status":"notbetreuung"`) {
		t.Fatalf("Info: %d %s", a.code, a.body)
	}
	if d := u.detail(u.kita1); d.Tage[0].Status != "geschlossen" {
		t.Fatal("GET darf nichts ändern")
	}
	if a := u.anfrage("POST", "/api/v1/berichtigung/bestaetigen", nil, auth...); a.code != 200 {
		t.Fatalf("bestätigen: %d %s", a.code, a.body)
	}
	if d := u.detail(u.kita1); d.Tage[0].Status != "notbetreuung" || d.Tage[0].Stufe != int(domain.StufeBerichtigung) {
		t.Fatalf("nach Berichtigung: %+v", d.Tage[0])
	}
	if a := u.anfrage("POST", "/api/v1/berichtigung/bestaetigen", nil, auth...); a.code != 401 {
		t.Fatalf("zweimal: %d", a.code)
	}
	k, _ := u.d.Q.GetKontakt(context.Background(), u.kita1)
	if k.BestaetigtAm == nil {
		t.Fatal("Kontakt sollte jetzt bestätigt sein")
	}
}

func TestBerichtigungOhneKontakt(t *testing.T) {
	u := neu(t)
	m := meldung("regulaer", "2026-11-18")
	m["altcha"] = u.altcha()
	if a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita2)+"/berichtigungen", m); a.code != 409 {
		t.Fatalf("%d", a.code)
	}
	if len(u.mails()) != 0 {
		t.Fatal("es darf keine Mail geben")
	}
}

func TestEinladungMitKontakt(t *testing.T) {
	u := neu(t)
	a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita1)+"/einladungen", map[string]any{"email": "Elternbeirat@Example.org", "altcha": u.altcha()})
	if a.code != 202 || !strings.Contains(string(a.body), `"gesendet"`) {
		t.Fatalf("%d %s", a.code, a.body)
	}
	mails := u.mails()
	if len(mails) != 1 || mails[0].An != "kita.sonnenschein@bonn.de" {
		t.Fatalf("%+v", mails)
	}
	et := tokenAus(t, mails[0].Text, "einladung")
	auth := []string{"Authorization", "Einladung " + et}
	if a := u.anfrage("GET", "/api/v1/einladung", nil, auth...); a.code != 200 {
		t.Fatalf("Info: %d", a.code)
	}
	if a := u.anfrage("POST", "/api/v1/einladung/bestaetigen", map[string]any{"kita_link": true}, auth...); a.code != 200 {
		t.Fatalf("bestätigen: %d %s", a.code, a.body)
	}
	mails = u.mails()
	if len(mails) != 3 || mails[1].An != "elternbeirat@example.org" || mails[2].An != "kita.sonnenschein@bonn.de" {
		t.Fatalf("Links: %+v", mails)
	}
	ebToken := tokenAus(t, mails[1].Text, "m")
	if li, err := u.d.FindeLink(context.Background(), ebToken); err != nil || li.Link.Rolle != "elternbeirat" {
		t.Fatalf("EB-Link: %v %+v", err, li)
	}
	var n int
	u.pool.QueryRow(context.Background(), "SELECT count(*) FROM einladung").Scan(&n)
	if n != 0 {
		t.Fatal("Adresse des Elternbeirats muss gelöscht sein")
	}
	if a := u.anfrage("POST", "/api/v1/einladung/bestaetigen", map[string]any{}, auth...); a.code != 401 {
		t.Fatalf("zweimal: %d", a.code)
	}
}

func TestEinladungOhneKontaktMitPruefung(t *testing.T) {
	u := neu(t)
	body := map[string]any{"email": "eb@example.org", "altcha": u.altcha()}
	if a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita2)+"/einladungen", body); a.code != 422 {
		t.Fatalf("ohne Kita-Adresse: %d", a.code)
	}
	body = map[string]any{"email": "eb@example.org", "kita_email": "anna.schmidt@traeger.de", "altcha": u.altcha()}
	if a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita2)+"/einladungen", body); a.code != 422 {
		t.Fatalf("persönliche Adresse: %d", a.code)
	}
	body = map[string]any{"email": "eb@example.org", "kita_email": "kita-loewenzahn@traeger.de", "altcha": u.altcha()}
	a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita2)+"/einladungen", body)
	if a.code != 202 || !strings.Contains(string(a.body), "pruefung") || len(u.mails()) != 0 {
		t.Fatalf("%d %s", a.code, a.body)
	}
	vs, _ := u.d.Q.ListVorschlaege(context.Background())
	if len(vs) != 1 {
		t.Fatalf("Vorschläge: %+v", vs)
	}
	if err := u.d.VorschlagAnnehmen(context.Background(), vs[0].ID); err != nil {
		t.Fatal(err)
	}
	mails := u.mails()
	if len(mails) != 1 || mails[0].An != "kita-loewenzahn@traeger.de" || !strings.Contains(mails[0].Text, "/einladung#") {
		t.Fatalf("%+v", mails)
	}
	if d := u.detail(u.kita2); !d.KontaktBekannt {
		t.Fatal("Kontakt sollte bekannt sein")
	}
}

func TestEinladungVertrauteDomainOhnePruefung(t *testing.T) {
	u := neu(t)
	body := map[string]any{"email": "eb@example.org", "kita_email": "kita-loewenzahn@stadt-koeln.de", "altcha": u.altcha()}
	a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita2)+"/einladungen", body)
	if a.code != 202 || !strings.Contains(string(a.body), `"gesendet"`) {
		t.Fatalf("%d %s", a.code, a.body)
	}
}

func TestKontaktVorschlagUndFehlendeKita(t *testing.T) {
	u := neu(t)
	if a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita2)+"/kontakt-vorschlaege", map[string]any{"email": "m.mueller@traeger.de", "altcha": u.altcha()}); a.code != 422 {
		t.Fatalf("persönlich: %d", a.code)
	}
	if a := u.anfrage("POST", "/api/v1/kitas/"+itoa(u.kita2)+"/kontakt-vorschlaege", map[string]any{"email": "info@kita-loewenzahn.de", "altcha": u.altcha()}); a.code != 202 {
		t.Fatalf("%d", a.code)
	}
	vs, _ := u.d.Q.ListVorschlaege(context.Background())
	if err := u.d.VorschlagAnnehmen(context.Background(), vs[0].ID); err != nil {
		t.Fatal(err)
	}
	mails := u.mails()
	if len(mails) != 1 || !strings.Contains(mails[0].Text, "/m#") {
		t.Fatalf("Kita-Link erwartet: %+v", mails)
	}
	if a := u.anfrage("POST", "/api/v1/kitas/fehlend", map[string]any{"name": "Kita Neu", "strasse": "Weg 1", "plz": "531", "ort": "Bonn", "altcha": u.altcha()}); a.code != 422 {
		t.Fatalf("PLZ: %d", a.code)
	}
	if a := u.anfrage("POST", "/api/v1/kitas/fehlend", map[string]any{"name": "Kita Neu", "strasse": "Weg 1", "plz": "53111", "ort": "Bonn", "altcha": u.altcha()}); a.code != 202 {
		t.Fatalf("%d", a.code)
	}
}

func TestOeffentlicheAPIOhneKontaktadresse(t *testing.T) {
	u := neu(t)
	for _, pfad := range []string{"/api/v1/kitas/" + itoa(u.kita1), "/api/v1/kitas?q=sonnenschein", "/kita/" + itoa(u.kita1)} {
		if a := u.anfrage("GET", pfad, nil); strings.Contains(string(a.body), "bonn.de") {
			t.Fatalf("%s gibt Kontaktadresse heraus", pfad)
		}
	}
}

func TestAufraeumen(t *testing.T) {
	u := neu(t)
	u.melde(u.kita1, meldung("geschlossen", "2026-11-18"))
	u.jetzt = time.Date(2027, 7, 1, 9, 0, 0, 0, time.UTC)
	r, err := u.d.Aufraeumen(context.Background())
	if err != nil || r.Meldungen != 1 {
		t.Fatalf("%+v %v", r, err)
	}
	var ts, prot int
	u.pool.QueryRow(context.Background(), "SELECT (SELECT count(*) FROM tagesstatus), (SELECT count(*) FROM protokoll)").Scan(&ts, &prot)
	if ts != 1 || prot != 1 {
		t.Fatalf("Statistik muss bleiben: %d %d", ts, prot)
	}
}

func itoa(i int64) string { return strconv.FormatInt(i, 10) }

func TestSPA(t *testing.T) {
	u := neu(t)
	u.melde(u.kita1, meldung("notbetreuung", "2026-11-18"))
	a := u.anfrage("GET", "/kita/"+itoa(u.kita1), nil)
	s := string(a.body)
	if a.code != 200 || !strings.Contains(s, "<title>Kita Sonnenschein (Bonn) – Kita-Ausfall NRW</title>") ||
		!strings.Contains(s, `og:description" content="Heute: Notbetreuung`) || !strings.Contains(s, `<script id="app-data" type="application/json">{"kita_detail":`) {
		t.Fatalf("%d\n%s", a.code, s)
	}
	if a := u.anfrage("GET", "/kita/999999", nil); a.code != 404 {
		t.Fatalf("unbekannte Kita: %d", a.code)
	}
	if a := u.anfrage("GET", "/assets/app.js", nil); a.code != 200 || !strings.Contains(a.hdr.Get("Cache-Control"), "immutable") {
		t.Fatalf("Asset: %d %v", a.code, a.hdr)
	}
	if a := u.anfrage("GET", "/assets/fehlt.js", nil); a.code != 404 {
		t.Fatalf("fehlendes Asset: %d", a.code)
	}
	if a := u.anfrage("GET", "/datenschutz", nil); a.code != 200 || !strings.Contains(string(a.body), "<title>Kita-Ausfall NRW</title>") {
		t.Fatalf("Route: %d", a.code)
	}
	if a := u.anfrage("GET", "/api/v1/unbekannt", nil); a.code != 404 {
		t.Fatalf("API 404: %d", a.code)
	}
}

func TestNamenMitScriptWerdenMaskiert(t *testing.T) {
	u := neu(t)
	id, _ := u.d.KitaAnlegen(context.Background(), u.d.Q, dienst.KitaDaten{Name: `</script><script>alert(1)</script>"><b>`})
	s := string(u.anfrage("GET", "/kita/"+itoa(id), nil).body)
	if strings.Contains(s, "<script>alert") || strings.Contains(s, `"><b>`) {
		t.Fatalf("nicht maskiert:\n%s", s)
	}
}
