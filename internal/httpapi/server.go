// Package httpapi stellt die JSON-API und das Frontend bereit.
package httpapi

import (
	"context"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/WayneNani/kita-down-detector/internal/datum"
	"github.com/WayneNani/kita-down-detector/internal/dienst"
	"github.com/WayneNani/kita-down-detector/internal/domain"
	"github.com/WayneNani/kita-down-detector/internal/pow"
	"github.com/WayneNani/kita-down-detector/internal/privacy"
)

type Server struct {
	d         *dienst.Dienst
	pow       *pow.ProofOfWork
	geheimnis *privacy.Tagesgeheimnis
	log       *slog.Logger
	spa       *spa
	origin    string

	limitLesen     *limiter
	limitChallenge *limiter
	limitSchreiben *limiter
	// je Anschluss und Kita: Berichtigungen, Einladungen, Adressvorschläge –
	// damit niemand allein das Tageskontingent einer Kita aufbrauchen kann
	limitKitaAnfragen *limiter
	limitFehlend      *limiter
}

func Neu(d *dienst.Dienst, p *pow.ProofOfWork, g *privacy.Tagesgeheimnis, frontend fs.FS, log *slog.Logger) *Server {
	return &Server{
		d: d, pow: p, geheimnis: g, log: log,
		spa:               neuesSPA(frontend, d, log),
		origin:            d.Cfg.BaseURL,
		limitLesen:        neuerLimiter(600, time.Minute),
		limitChallenge:    neuerLimiter(30, time.Minute),
		limitSchreiben:    neuerLimiter(30, time.Hour),
		limitKitaAnfragen: neuerLimiter(2, 24*time.Hour),
		limitFehlend:      neuerLimiter(5, 24*time.Hour),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	api := func(muster string, limit *limiter, h http.HandlerFunc) {
		mux.Handle(muster, s.begrenze(limit, h))
	}
	api("GET /api/v1/info", s.limitLesen, s.info)
	api("GET /api/v1/kitas", s.limitLesen, s.suche)
	api("GET /api/v1/kitas/nahe", s.limitLesen, s.nahe)
	api("GET /api/v1/kitas/auswahl", s.limitLesen, s.auswahl)
	api("GET /api/v1/kitas/{id}", s.limitLesen, s.detail)
	api("GET /api/v1/status", s.limitLesen, s.status)
	api("GET /api/v1/pow/challenge", s.limitChallenge, s.challenge)
	api("POST /api/v1/kitas/{id}/meldungen", s.limitSchreiben, s.anonymMelden)
	api("GET /api/v1/link", s.limitLesen, s.linkInfo)
	api("POST /api/v1/link/meldungen", s.limitSchreiben, s.linkMelden)
	api("POST /api/v1/kitas/{id}/berichtigungen", s.limitSchreiben, s.berichtigungAnfragen)
	api("GET /api/v1/berichtigung", s.limitLesen, s.berichtigungInfo)
	api("POST /api/v1/berichtigung/bestaetigen", s.limitSchreiben, s.berichtigungBestaetigen)
	api("POST /api/v1/kitas/{id}/einladungen", s.limitSchreiben, s.einladungAnfragen)
	api("GET /api/v1/einladung", s.limitLesen, s.einladungInfo)
	api("POST /api/v1/einladung/bestaetigen", s.limitSchreiben, s.einladungBestaetigen)
	api("POST /api/v1/kitas/{id}/kontakt-vorschlaege", s.limitSchreiben, s.kontaktVorschlag)
	api("POST /api/v1/kitas/fehlend", s.limitSchreiben, s.fehlend)
	mux.HandleFunc("GET /api/", func(w http.ResponseWriter, r *http.Request) {
		schreibeProblem(w, http.StatusNotFound, "Unbekannter Endpunkt.")
	})

	// Nur intern erreichbar (Caddy leitet diese Pfade nicht weiter).
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.d.Pool.Ping(ctx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.Handle("GET /", s.spa)

	return s.sicherheit(s.auffangen(mux))
}

// ---------------------------------------------------------------- Middleware

const csp = "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; img-src 'self' data:; " +
	"connect-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"

func (s *Server) sicherheit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")

		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			// Kein CSRF-Risiko (keine Cookies), trotzdem: fremde Origins ablehnen.
			if o := r.Header.Get("Origin"); o != "" && o != s.origin {
				schreibeProblem(w, http.StatusForbidden, "Fremde Herkunft.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) auffangen(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.log.Error("panic", "pfad", r.URL.Path, "wert", v)
				schreibeProblem(w, http.StatusInternalServerError, "Interner Fehler.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) begrenze(l *limiter, h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.erlaubt(s.geheimnis.LimitSchluessel(s.clientIP(r)), s.d.Jetzt()) {
			w.Header().Set("Retry-After", "60")
			schreibeProblem(w, http.StatusTooManyRequests, "Zu viele Anfragen. Bitte kurz warten.")
			return
		}
		h(w, r)
	})
}

// clientIP: Verbindungsadresse; X-Forwarded-For nur von vertrauten Proxys.
func (s *Server) clientIP(r *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return netip.IPv4Unspecified()
	}
	ip = ip.Unmap()
	if !s.vertraut(ip) {
		return ip
	}
	teile := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(teile) - 1; i >= 0; i-- {
		kandidat, err := netip.ParseAddr(strings.TrimSpace(teile[i]))
		if err != nil {
			break
		}
		kandidat = kandidat.Unmap()
		if !s.vertraut(kandidat) {
			return kandidat
		}
		ip = kandidat
	}
	return ip
}

func (s *Server) vertraut(ip netip.Addr) bool {
	for _, p := range s.d.Cfg.TrustedProxies {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// proKita begrenzt Anfragen je Anschluss, Art und Kita.
func (s *Server) proKita(w http.ResponseWriter, r *http.Request, art string, id int64) bool {
	schluessel := s.geheimnis.LimitSchluessel(s.clientIP(r)) + "|" + art + "|" + strconv.FormatInt(id, 10)
	if !s.limitKitaAnfragen.erlaubt(schluessel, s.d.Jetzt()) {
		schreibeProblem(w, http.StatusTooManyRequests, "Sie haben für diese Kita heute bereits Anfragen gestellt. Bitte nutzen Sie die zuletzt gesendete Mail oder versuchen Sie es morgen.")
		return false
	}
	return true
}

func cacheOeffentlich(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "public, max-age=30, stale-while-revalidate=60")
}

func keinCache(w http.ResponseWriter) { w.Header().Set("Cache-Control", "no-store") }

func token(r *http.Request, schema string) string {
	v := r.Header.Get("Authorization")
	if t, ok := strings.CutPrefix(v, schema+" "); ok {
		return strings.TrimSpace(t)
	}
	return ""
}

func kitaID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

// ---------------------------------------------------------------- Lesen

func (s *Server) info(w http.ResponseWriter, r *http.Request) {
	cacheOeffentlich(w)
	c := s.d.Cfg
	schreibeJSON(w, http.StatusOK, map[string]any{
		"bestaetigungs_schwelle": c.BestaetigungsSchwelle,
		"aufbewahrung_tage":      c.AufbewahrungTage,
		"kontakt_email":          c.KontaktEmail,
		"max_tage_zurueck":       domain.MaxTageZurueck,
		"max_tage_voraus":        domain.MaxTageVoraus,
		"max_zeitraum_tage":      domain.MaxZeitraumTage,
		"heute":                  datum.Format(s.d.Heute()),
	})
}

func (s *Server) suche(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < 2 || len(q) > 100 {
		schreibeProblem(w, http.StatusBadRequest, "Bitte mindestens 2 Zeichen eingeben.")
		return
	}
	kitas, err := s.d.Suche(r.Context(), q)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	cacheOeffentlich(w)
	schreibeJSON(w, http.StatusOK, map[string]any{"kitas": kitas})
}

func (s *Server) nahe(w http.ResponseWriter, r *http.Request) {
	lat, err1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, err2 := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if err1 != nil || err2 != nil {
		schreibeProblem(w, http.StatusBadRequest, "lat und lon fehlen.")
		return
	}
	kitas, err := s.d.Nahe(r.Context(), lat, lon)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	cacheOeffentlich(w)
	schreibeJSON(w, http.StatusOK, map[string]any{"kitas": kitas})
}

func (s *Server) auswahl(w http.ResponseWriter, r *http.Request) {
	var ids []int64
	for _, t := range strings.Split(r.URL.Query().Get("ids"), ",") {
		if t = strings.TrimSpace(t); t == "" {
			continue
		}
		id, err := strconv.ParseInt(t, 10, 64)
		if err != nil || id <= 0 {
			schreibeProblem(w, http.StatusBadRequest, "Ungültige ID.")
			return
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 || len(ids) > 20 {
		schreibeProblem(w, http.StatusBadRequest, "Bitte 1 bis 20 IDs angeben.")
		return
	}
	kitas, err := s.d.Auswahl(r.Context(), ids)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	cacheOeffentlich(w)
	schreibeJSON(w, http.StatusOK, map[string]any{"kitas": kitas})
}

func (s *Server) detail(w http.ResponseWriter, r *http.Request) {
	id, ok := kitaID(r)
	if !ok {
		schreibeProblem(w, http.StatusNotFound, "Nicht gefunden.")
		return
	}
	det, err := s.d.Detail(r.Context(), id)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	cacheOeffentlich(w)
	schreibeJSON(w, http.StatusOK, det)
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	tag := s.d.Heute()
	if v := r.URL.Query().Get("datum"); v != "" {
		t, ok := datum.Parse(v)
		if !ok {
			schreibeProblem(w, http.StatusBadRequest, "datum muss YYYY-MM-DD sein.")
			return
		}
		tag = t
	}
	var ort *string
	if v := strings.TrimSpace(r.URL.Query().Get("ort")); v != "" {
		ort = &v
	}
	liste, err := s.d.Einschraenkungen(r.Context(), tag, ort)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	cacheOeffentlich(w)
	schreibeJSON(w, http.StatusOK, map[string]any{"datum": datum.Format(tag), "kitas": liste})
}

func (s *Server) challenge(w http.ResponseWriter, r *http.Request) {
	ch, err := s.pow.Challenge()
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	keinCache(w)
	schreibeJSON(w, http.StatusOK, ch)
}

// ---------------------------------------------------------------- Schreiben

type anonymeMeldung struct {
	dienst.MeldungInput
	Altcha string `json:"altcha"`
}

func (s *Server) powOK(w http.ResponseWriter, r *http.Request, payload string) bool {
	ok, err := s.pow.Pruefe(r.Context(), payload)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return false
	}
	if !ok {
		schreibeProblem(w, http.StatusForbidden, "Die Sicherheitsprüfung ist fehlgeschlagen. Bitte warten Sie, bis sie abgeschlossen ist, und senden Sie erneut.")
		return false
	}
	return true
}

func (s *Server) anonymMelden(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	id, ok := kitaID(r)
	if !ok {
		schreibeProblem(w, http.StatusNotFound, "Nicht gefunden.")
		return
	}
	var in anonymeMeldung
	if !leseJSON(w, r, &in) || !s.powOK(w, r, in.Altcha) {
		return
	}
	m, err := s.d.PruefeMeldung(in.MeldungInput)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	hash := s.geheimnis.MelderHash(s.clientIP(r), id)
	if err := s.d.SpeichereMeldung(r.Context(), id, m, dienst.Herkunft{Quelle: domain.QuelleAnonym, MelderHash: hash}); err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	s.detailAntwort(w, r, id, http.StatusCreated)
}

func (s *Server) detailAntwort(w http.ResponseWriter, r *http.Request, id int64, code int) {
	det, err := s.d.Detail(r.Context(), id)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	schreibeJSON(w, code, det)
}

func (s *Server) linkInfo(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	li, err := s.d.FindeLink(r.Context(), token(r, "Link"))
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	schreibeJSON(w, http.StatusOK, map[string]any{
		"kita":  dienst.KitaKurz{ID: li.Kita.ID, Name: li.Kita.Name, Traeger: li.Kita.Traeger, Strasse: li.Kita.Strasse, Plz: li.Kita.Plz, Ort: li.Kita.Ort, Lat: li.Kita.Lat, Lon: li.Kita.Lon},
		"rolle": li.Link.Rolle, "gueltig_bis": datum.Format(li.Link.GueltigBis),
	})
}

func (s *Server) linkMelden(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	li, err := s.d.FindeLink(r.Context(), token(r, "Link"))
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	var in dienst.MeldungInput
	if !leseJSON(w, r, &in) {
		return
	}
	m, err := s.d.PruefeMeldung(in)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	if err := s.d.MeldenPerLink(r.Context(), li, m); err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	s.detailAntwort(w, r, li.Kita.ID, http.StatusCreated)
}

func (s *Server) berichtigungAnfragen(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	id, ok := kitaID(r)
	if !ok {
		schreibeProblem(w, http.StatusNotFound, "Nicht gefunden.")
		return
	}
	var in anonymeMeldung
	if !leseJSON(w, r, &in) || !s.powOK(w, r, in.Altcha) {
		return
	}
	m, err := s.d.PruefeMeldung(in.MeldungInput)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	if !s.proKita(w, r, "berichtigung", id) {
		return
	}
	an, err := s.d.BerichtigungAnfragen(r.Context(), id, m)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	schreibeJSON(w, http.StatusAccepted, map[string]string{"gesendet_an": an})
}

func (s *Server) berichtigungInfo(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	b, err := s.d.FindeBerichtigung(r.Context(), token(r, "Berichtigung"))
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	k := b.Kita
	schreibeJSON(w, http.StatusOK, map[string]any{
		"kita":    dienst.KitaKurz{ID: k.ID, Name: k.Name, Traeger: k.Traeger, Strasse: k.Strasse, Plz: k.Plz, Ort: k.Ort, Lat: k.Lat, Lon: k.Lon},
		"meldung": b.Meldung().Input(),
	})
}

func (s *Server) berichtigungBestaetigen(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	id, err := s.d.BerichtigungBestaetigen(r.Context(), token(r, "Berichtigung"))
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	s.detailAntwort(w, r, id, http.StatusOK)
}

func (s *Server) einladungAnfragen(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	id, ok := kitaID(r)
	if !ok {
		schreibeProblem(w, http.StatusNotFound, "Nicht gefunden.")
		return
	}
	var in struct {
		Email     string  `json:"email"`
		KitaEmail *string `json:"kita_email"`
		Altcha    string  `json:"altcha"`
	}
	if !leseJSON(w, r, &in) || !s.powOK(w, r, in.Altcha) || !s.proKita(w, r, "einladung", id) {
		return
	}
	erg, err := s.d.EinladungAnfragen(r.Context(), id, in.Email, in.KitaEmail)
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	antwort := map[string]string{"status": erg.Status}
	if erg.GesendetAn != "" {
		antwort["gesendet_an"] = erg.GesendetAn
	}
	schreibeJSON(w, http.StatusAccepted, antwort)
}

func (s *Server) einladungInfo(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	e, err := s.d.FindeEinladung(r.Context(), token(r, "Einladung"))
	if err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	k := e.Kita
	schreibeJSON(w, http.StatusOK, map[string]any{
		"kita": dienst.KitaKurz{ID: k.ID, Name: k.Name, Traeger: k.Traeger, Strasse: k.Strasse, Plz: k.Plz, Ort: k.Ort, Lat: k.Lat, Lon: k.Lon},
		// Die Kita soll erkennen können, wer anfragt (der Elternbeirat wird darauf hingewiesen).
		"angefragt_von": e.Einladung.EbEmail,
	})
}

func (s *Server) einladungBestaetigen(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	if _, err := s.d.FindeEinladung(r.Context(), token(r, "Einladung")); err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	var in struct {
		KitaLink bool `json:"kita_link"`
	}
	if !leseJSON(w, r, &in) {
		return
	}
	if err := s.d.EinladungBestaetigen(r.Context(), token(r, "Einladung"), in.KitaLink); err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	schreibeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) kontaktVorschlag(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	id, ok := kitaID(r)
	if !ok {
		schreibeProblem(w, http.StatusNotFound, "Nicht gefunden.")
		return
	}
	var in struct {
		Email  string `json:"email"`
		Altcha string `json:"altcha"`
	}
	if !leseJSON(w, r, &in) || !s.powOK(w, r, in.Altcha) || !s.proKita(w, r, "kontakt", id) {
		return
	}
	if err := s.d.KontaktVorschlagen(r.Context(), id, in.Email); err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	schreibeJSON(w, http.StatusAccepted, map[string]string{"status": "pruefung"})
}

func (s *Server) fehlend(w http.ResponseWriter, r *http.Request) {
	keinCache(w)
	var in struct {
		dienst.FehlendeKita
		Altcha string `json:"altcha"`
	}
	if !leseJSON(w, r, &in) || !s.powOK(w, r, in.Altcha) {
		return
	}
	if !s.limitFehlend.erlaubt(s.geheimnis.LimitSchluessel(s.clientIP(r)), s.d.Jetzt()) {
		schreibeProblem(w, http.StatusTooManyRequests, "Zu viele Meldungen. Bitte versuchen Sie es morgen erneut.")
		return
	}
	if err := s.d.FehlendeKitaMelden(r.Context(), in.FehlendeKita); err != nil {
		s.fehlerAntwort(w, r, err)
		return
	}
	schreibeJSON(w, http.StatusAccepted, map[string]string{"status": "pruefung"})
}
