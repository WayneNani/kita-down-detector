package httpapi

import (
	"bytes"
	"encoding/json"
	"html"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/WayneNani/kita-down-detector/internal/dienst"
	"github.com/WayneNani/kita-down-detector/internal/domain"
)

const ersatzIndex = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><!--app-head--></head>
<body><p>Das Frontend ist nicht gebaut. Bitte <code>npm --prefix web run build</code> ausführen.</p><!--app-data--></body></html>`

// spa liefert das React-Frontend aus und setzt pro Seite Titel, Vorschau (Open Graph)
// und – auf Kita-Seiten – die Seitendaten als JSON, damit die erste Anzeige ohne
// zweite Netzwerkrunde auskommt (wichtig auf dem Handy).
type spa struct {
	dateien fs.FS
	index   []byte
	d       *dienst.Dienst
	log     *slog.Logger
}

func neuesSPA(dateien fs.FS, d *dienst.Dienst, log *slog.Logger) *spa {
	index, err := fs.ReadFile(dateien, "index.html")
	if err != nil {
		index = []byte(ersatzIndex)
	}
	return &spa{dateien: dateien, index: index, d: d, log: log}
}

func (s *spa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if p != "" && p != "index.html" {
		if f, err := fs.Stat(s.dateien, p); err == nil && !f.IsDir() {
			switch {
			case strings.HasPrefix(p, "assets/"):
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			case p == "sw.js" || p == "manifest.webmanifest":
				w.Header().Set("Cache-Control", "no-cache")
			default:
				w.Header().Set("Cache-Control", "public, max-age=3600")
			}
			http.ServeFileFS(w, r, s.dateien, p)
			return
		}
		if strings.HasPrefix(p, "assets/") || path.Ext(p) != "" {
			http.NotFound(w, r)
			return
		}
	}
	s.seite(w, r, p)
}

type kopf struct {
	titel, beschreibung string
	daten               any
}

func (s *spa) seite(w http.ResponseWriter, r *http.Request, p string) {
	k := kopf{titel: "Kita-Ausfall NRW", beschreibung: "Welche Kitas haben heute Notbetreuung oder verkürzte Zeiten? Eltern melden, Elternbeiräte und Kitas bestätigen – ohne Anmeldung, ohne Tracking."}
	code := http.StatusOK
	if rest, ok := strings.CutPrefix(p, "kita/"); ok && !strings.Contains(rest, "/") {
		id, err := strconv.ParseInt(rest, 10, 64)
		det, derr := s.d.Detail(r.Context(), id)
		if err != nil || derr != nil {
			code = http.StatusNotFound
		} else {
			heute := det.Tage[0]
			ort := ""
			if det.Kita.Ort != nil {
				ort = " (" + *det.Kita.Ort + ")"
			}
			k.titel = det.Kita.Name + ort + " – Kita-Ausfall NRW"
			k.beschreibung = "Heute: " + domain.Status(heute.Status).Label()
			if heute.UhrzeitVon != nil && heute.UhrzeitBis != nil {
				k.beschreibung += " (" + *heute.UhrzeitVon + "–" + *heute.UhrzeitBis + " Uhr)"
			}
			k.beschreibung += ". Aktueller Betreuungsstatus und Meldungen der nächsten 14 Tage."
			k.daten = map[string]any{"kita_detail": det}
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(code)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(s.render(k, s.d.Cfg.BaseURL+r.URL.Path))
}

func (s *spa) render(k kopf, url string) []byte {
	e := html.EscapeString
	var head strings.Builder
	head.WriteString("<title>" + e(k.titel) + "</title>\n")
	head.WriteString(`<meta name="description" content="` + e(k.beschreibung) + `">` + "\n")
	head.WriteString(`<meta property="og:title" content="` + e(k.titel) + `">` + "\n")
	head.WriteString(`<meta property="og:description" content="` + e(k.beschreibung) + `">` + "\n")
	head.WriteString(`<meta property="og:type" content="website">` + "\n")
	head.WriteString(`<meta property="og:url" content="` + e(url) + `">` + "\n")
	head.WriteString(`<meta property="og:site_name" content="Kita-Ausfall NRW">` + "\n")
	head.WriteString(`<meta property="og:locale" content="de_DE">`)

	daten := ""
	if k.daten != nil {
		// json.Marshal maskiert <, > und & – damit kann der Inhalt das Script-Tag nicht verlassen.
		b, err := json.Marshal(k.daten)
		if err == nil {
			daten = `<script id="app-data" type="application/json">` + string(b) + `</script>`
		}
	}
	out := bytes.Replace(s.index, []byte("<!--app-head-->"), []byte(head.String()), 1)
	return bytes.Replace(out, []byte("<!--app-data-->"), []byte(daten), 1)
}
