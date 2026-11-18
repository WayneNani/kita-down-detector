package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/WayneNani/kita-down-detector/internal/dienst"
)

type problem struct {
	Title  string              `json:"title"`
	Status int                 `json:"status"`
	Detail string              `json:"detail,omitempty"`
	Fehler []dienst.FeldFehler `json:"fehler,omitempty"`
}

func schreibeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func schreibeProblem(w http.ResponseWriter, status int, detail string, fehler ...dienst.FeldFehler) {
	w.Header().Set("Content-Type", "application/problem+json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(problem{Title: http.StatusText(status), Status: status, Detail: detail, Fehler: fehler})
}

// fehlerAntwort übersetzt Fehler der Fachschicht in HTTP-Antworten.
func (s *Server) fehlerAntwort(w http.ResponseWriter, r *http.Request, err error) {
	var v dienst.Validierungsfehler
	switch {
	case errors.As(err, &v):
		schreibeProblem(w, http.StatusUnprocessableEntity, "Bitte prüfen Sie Ihre Angaben.", v...)
	case errors.Is(err, dienst.ErrNichtGefunden):
		schreibeProblem(w, http.StatusNotFound, "Nicht gefunden.")
	case errors.Is(err, dienst.ErrUngueltig):
		schreibeProblem(w, http.StatusUnauthorized, "Dieser Link ist abgelaufen, wurde bereits verwendet oder widerrufen.")
	case errors.Is(err, dienst.ErrZuViele):
		schreibeProblem(w, http.StatusTooManyRequests, "Zu viele Anfragen. Bitte versuchen Sie es später erneut.")
	case errors.Is(err, dienst.ErrKeinKontakt):
		schreibeProblem(w, http.StatusConflict, "Für diese Kita ist keine Kontaktadresse hinterlegt.")
	default:
		s.log.Error("interner Fehler", "pfad", r.URL.Path, "fehler", err)
		schreibeProblem(w, http.StatusInternalServerError, "Interner Fehler. Bitte später erneut versuchen.")
	}
}

const maxBody = 8 << 10

// leseJSON liest den Body streng: max. 8 KB, nur JSON, keine unbekannten Felder.
func leseJSON(w http.ResponseWriter, r *http.Request, ziel any) bool {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		schreibeProblem(w, http.StatusUnsupportedMediaType, "Bitte als JSON senden.")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(ziel); err != nil {
		schreibeProblem(w, http.StatusBadRequest, "Ungültige Anfrage.")
		return false
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		schreibeProblem(w, http.StatusBadRequest, "Ungültige Anfrage.")
		return false
	}
	return true
}
