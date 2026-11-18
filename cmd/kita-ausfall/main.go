// kita-ausfall – Server und Verwaltungswerkzeug für Kita-Ausfall NRW.
//
//	kita-ausfall serve                      Server starten (führt Migrationen aus)
//	kita-ausfall migrate                    nur Migrationen ausführen
//	kita-ausfall import --quelle bonn --datei kitas.csv [--modus primaer|ergaenzung] ...
//	kita-ausfall zuordnung liste|setzen     ungeklärte Import-Zuordnungen prüfen
//	kita-ausfall link erstellen|widerrufen|liste --kita <id> [--rolle elternbeirat|kita]
//	kita-ausfall kontakt setzen --kita <id> --email <adresse> [--herkunft manuell|ifg|opendata]
//	kita-ausfall vorschlaege liste|annehmen|ablehnen [<id>]
//	kita-ausfall fehlend liste|annehmen|ablehnen [<id>]
//	kita-ausfall aufraeumen
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // Zeitzonen auch im minimalen Container-Image

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/WayneNani/kita-down-detector/internal/config"
	"github.com/WayneNani/kita-down-detector/internal/datum"
	"github.com/WayneNani/kita-down-detector/internal/db"
	"github.com/WayneNani/kita-down-detector/internal/dienst"
	"github.com/WayneNani/kita-down-detector/internal/domain"
	"github.com/WayneNani/kita-down-detector/internal/httpapi"
	"github.com/WayneNani/kita-down-detector/internal/importer"
	"github.com/WayneNani/kita-down-detector/internal/mail"
	"github.com/WayneNani/kita-down-detector/internal/pow"
	"github.com/WayneNani/kita-down-detector/internal/privacy"
	"github.com/WayneNani/kita-down-detector/internal/web"
)

func main() {
	if len(os.Args) < 2 {
		hilfe()
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := ausfuehren(ctx, os.Args[1], os.Args[2:]); err != nil {
		fmt.Fprintln(os.Stderr, "Fehler:", err)
		os.Exit(1)
	}
}

func hilfe() {
	fmt.Fprintln(os.Stderr, `Aufruf: kita-ausfall <befehl> [optionen]

Befehle:
  serve          Server starten (führt vorher Migrationen aus)
  migrate        Datenbankschema aktualisieren
  import         Kita-Verzeichnis importieren (CSV, GeoJSON, Esri-JSON, Overpass-JSON)
  zuordnung      ungeklärte Import-Zuordnungen anzeigen/setzen
  link           Melde-Links erstellen, widerrufen, auflisten
  kontakt        Kontaktadresse einer Kita setzen
  vorschlaege    vorgeschlagene Kita-Adressen prüfen
  fehlend        gemeldete fehlende Kitas prüfen
  aufraeumen     Löschfristen durchsetzen
  health         Bereitschaft prüfen (Container-Healthcheck)

Hilfe zu einem Befehl: kita-ausfall <befehl> -h`)
}

func logger(cfg config.Config) *slog.Logger {
	if cfg.Produktion {
		return slog.New(slog.NewJSONHandler(os.Stderr, nil))
	}
	return slog.New(slog.NewTextHandler(os.Stderr, nil))
}

func verbinden(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	pc.MaxConns = 20
	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("Datenbank nicht erreichbar: %w", err)
	}
	return pool, nil
}

func ausfuehren(ctx context.Context, befehl string, args []string) error {
	cfg, err := config.Laden()
	if err != nil {
		return err
	}
	switch befehl {
	case "serve":
		return serve(ctx, cfg)
	case "migrate":
		return migrieren(ctx, cfg)
	case "health":
		// Für den Container-Healthcheck (das Image enthält kein curl).
		c := http.Client{Timeout: 3 * time.Second}
		res, err := c.Get("http://127.0.0.1" + cfg.Adresse + "/readyz")
		if err != nil {
			return err
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNoContent {
			return fmt.Errorf("nicht bereit: %s", res.Status)
		}
		return nil
	case "-h", "--help", "help", "hilfe":
		hilfe()
		return nil
	}
	pool, err := verbinden(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	d := dienst.Neu(pool, cfg, nil)
	switch befehl {
	case "import":
		return importieren(ctx, d, args)
	case "zuordnung":
		return zuordnung(ctx, d, args)
	case "link":
		return link(ctx, d, args)
	case "kontakt":
		return kontakt(ctx, d, args)
	case "vorschlaege":
		return vorschlaege(ctx, d, args)
	case "fehlend":
		return fehlend(ctx, d, args)
	case "aufraeumen":
		r, err := d.Aufraeumen(ctx)
		fmt.Printf("%+v\n", r)
		return err
	}
	hilfe()
	return fmt.Errorf("unbekannter Befehl %q", befehl)
}

// Migrationen laufen mit eigener Rolle (MIGRATE_DATABASE_URL), die App nur mit DML-Rechten.
func migrieren(ctx context.Context, cfg config.Config) error {
	url, err := migrateURL()
	if err != nil {
		return err
	}
	if url == "" {
		url = cfg.DatabaseURL
	}
	pool, err := verbinden(ctx, url)
	if err != nil {
		return err
	}
	defer pool.Close()
	return db.Migrieren(ctx, pool)
}

func serve(ctx context.Context, cfg config.Config) error {
	log := logger(cfg)
	if u, _ := migrateURL(); u != "" || !cfg.Produktion {
		if err := migrieren(ctx, cfg); err != nil {
			return fmt.Errorf("Migration: %w", err)
		}
	}
	pool, err := verbinden(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	d := dienst.Neu(pool, cfg, nil)
	var sender mail.Sender = mail.LogSender{}
	if cfg.SMTPURL != "" {
		if sender, err = mail.NeuSMTP(cfg.SMTPURL, cfg.MailFrom); err != nil {
			return err
		}
	} else {
		log.Warn("SMTP_URL nicht gesetzt – Mails werden nur auf der Konsole ausgegeben")
	}
	go d.Hintergrund(ctx, sender, log)

	p := pow.Neu(cfg.AltchaSecret, cfg.AltchaCost, cfg.AltchaCounterMin, cfg.AltchaCounterMax, d.PowVerbrauchen)
	srv := &http.Server{
		Addr:              cfg.Adresse,
		Handler:           httpapi.Neu(d, p, privacy.NeuesTagesgeheimnis(time.Now), web.Dist(), log).Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		// Kein Request-Log: IP-Adressen sollen nirgends landen.
		ErrorLog: slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	log.Info("Kita-Ausfall NRW läuft", "adresse", cfg.Adresse, "url", cfg.BaseURL)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// ---------------------------------------------------------------- Import

type spaltenFlag map[importer.Feld]string

func (s spaltenFlag) String() string { return fmt.Sprint(map[importer.Feld]string(s)) }
func (s spaltenFlag) Set(v string) error {
	feld, spalte, ok := strings.Cut(v, "=")
	if !ok {
		return fmt.Errorf("Format: feld=Spalte")
	}
	s[importer.Feld(feld)] = spalte
	return nil
}

func importieren(ctx context.Context, d *dienst.Dienst, args []string) error {
	fs := flag.NewFlagSet("import", flag.ExitOnError)
	quelle := fs.String("quelle", "", "Name der Quelle, z. B. kibiz, bonn, koeln, osm (Pflicht)")
	datei := fs.String("datei", "", "Datei (CSV, GeoJSON, Esri-JSON, Overpass-JSON) (Pflicht)")
	modus := fs.String("modus", "ergaenzung", "primaer (maßgebliches Verzeichnis) oder ergaenzung (nur abgleichen)")
	anlegen := fs.Bool("anlegen", false, "bei Ergänzung: nicht zuordenbare Kitas trotzdem anlegen")
	crs := fs.String("crs", "auto", "Koordinatensystem: auto, 4326 (WGS84) oder 25832 (UTM 32N)")
	ort := fs.String("ort", "", "Ort, falls die Datei keinen enthält (z. B. Bonn)")
	herkunft := fs.String("herkunft", "opendata", "Herkunft der E-Mail-Adressen: opendata, osm, ifg")
	trocken := fs.Bool("trockenlauf", false, "nur anzeigen, nichts speichern")
	spalten := spaltenFlag{}
	fs.Var(spalten, "spalte", "Spaltenzuordnung feld=Spalte (mehrfach), Felder: id name traeger strasse hausnummer plz ort email lat lon x y")
	_ = fs.Parse(args)
	if *quelle == "" || *datei == "" {
		fs.Usage()
		return fmt.Errorf("--quelle und --datei sind Pflicht")
	}
	if *modus != string(importer.Primaer) && *modus != string(importer.Ergaenzung) {
		return fmt.Errorf("--modus muss primaer oder ergaenzung sein")
	}
	st, err := importer.Importieren(ctx, d, *datei, importer.Optionen{
		Quelle: *quelle, Modus: importer.Modus(*modus), Anlegen: *anlegen, Spalten: spalten,
		CRS: *crs, Ort: *ort, Herkunft: *herkunft, Trockenlauf: *trocken,
	})
	fmt.Print(st.String())
	if *trocken && err == nil {
		fmt.Println("Trockenlauf – nichts gespeichert.")
	}
	return err
}

func zuordnung(ctx context.Context, d *dienst.Dienst, args []string) error {
	if len(args) == 0 || args[0] == "liste" {
		offen, err := d.Q.OffeneZuordnungen(ctx, 200)
		if err != nil {
			return err
		}
		for _, z := range offen {
			fmt.Printf("%s %s  %s\n", z.Quelle, z.QuelleID, z.Daten)
		}
		fmt.Printf("%d offen. Zuordnen: kita-ausfall zuordnung setzen --quelle Q --id ID --kita <kita-id|neu>\n", len(offen))
		return nil
	}
	fs := flag.NewFlagSet("zuordnung setzen", flag.ExitOnError)
	quelle := fs.String("quelle", "", "")
	id := fs.String("id", "", "Quell-ID")
	kita := fs.String("kita", "", "Kita-ID oder „neu“")
	_ = fs.Parse(args[1:])
	z, err := d.Q.GetZuordnung(ctx, db.GetZuordnungParams{Quelle: *quelle, QuelleID: *id})
	if err != nil {
		return fmt.Errorf("Zuordnung nicht gefunden")
	}
	var kitaID int64
	if *kita == "neu" {
		var k struct {
			Name                       string
			Traeger, Strasse, Plz, Ort *string
			Lat, Lon                   *float64
		}
		if err := jsonUnmarshal(z.Daten, &k); err != nil {
			return err
		}
		if kitaID, err = d.KitaAnlegen(ctx, d.Q, dienst.KitaDaten{Name: k.Name, Traeger: k.Traeger, Strasse: k.Strasse, Plz: k.Plz, Ort: k.Ort, Lat: k.Lat, Lon: k.Lon}); err != nil {
			return err
		}
	} else if kitaID, err = strconv.ParseInt(*kita, 10, 64); err != nil {
		return fmt.Errorf("--kita muss eine ID oder „neu“ sein")
	}
	return d.Q.SetzeZuordnung(ctx, db.SetzeZuordnungParams{Quelle: *quelle, QuelleID: *id, KitaID: &kitaID})
}

// ---------------------------------------------------------------- Links & Kontakte

func link(ctx context.Context, d *dienst.Dienst, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("link erstellen|widerrufen|liste --kita <id> [--rolle elternbeirat|kita] [--gueltig-bis JJJJ-MM-TT]")
	}
	fs := flag.NewFlagSet("link", flag.ExitOnError)
	kitaID := fs.Int64("kita", 0, "Kita-ID")
	rolle := fs.String("rolle", "", "elternbeirat oder kita")
	bis := fs.String("gueltig-bis", "", "Ablaufdatum (Standard: Ende des Kita-Jahres, 31.07.)")
	_ = fs.Parse(args[1:])
	k, err := d.Q.GetKita(ctx, *kitaID)
	if err != nil {
		return fmt.Errorf("Kita %d nicht gefunden", *kitaID)
	}
	switch args[0] {
	case "erstellen":
		r := domain.Rolle(*rolle)
		if !r.Gueltig() {
			return fmt.Errorf("--rolle muss elternbeirat oder kita sein")
		}
		var gb *time.Time
		if *bis != "" {
			t, ok := datum.Parse(*bis)
			if !ok {
				return fmt.Errorf("--gueltig-bis muss JJJJ-MM-TT sein")
			}
			gb = &t
		}
		token, g, err := d.ErstelleLink(ctx, nil, k.ID, r, gb)
		if err != nil {
			return err
		}
		fmt.Printf("Melde-Link (%s) für „%s“, gültig bis %s:\n%s/m#%s\n", r, k.Name, datum.Format(g), d.Cfg.BaseURL, token)
	case "widerrufen":
		var r *string
		if *rolle != "" {
			r = rolle
		}
		n, err := d.Q.WiderrufeLinks(ctx, db.WiderrufeLinksParams{KitaID: k.ID, Rolle: r})
		if err != nil {
			return err
		}
		fmt.Printf("%d Link(s) für „%s“ widerrufen.\n", n, k.Name)
	case "liste":
		links, err := d.Q.ListLinks(ctx, k.ID)
		if err != nil {
			return err
		}
		for _, l := range links {
			fmt.Printf("#%d %-12s gültig bis %s widerrufen=%v\n", l.ID, l.Rolle, datum.Format(l.GueltigBis), l.Widerrufen)
		}
	default:
		return fmt.Errorf("unbekannt: link %s", args[0])
	}
	return nil
}

func kontakt(ctx context.Context, d *dienst.Dienst, args []string) error {
	fs := flag.NewFlagSet("kontakt setzen", flag.ExitOnError)
	kitaID := fs.Int64("kita", 0, "Kita-ID")
	email := fs.String("email", "", "Funktionsadresse der Kita")
	herkunft := fs.String("herkunft", "manuell", "manuell, ifg, opendata")
	if len(args) == 0 || args[0] != "setzen" {
		return fmt.Errorf("kontakt setzen --kita <id> --email <adresse>")
	}
	_ = fs.Parse(args[1:])
	if !privacy.IstFunktionsadresse(*email) {
		fmt.Println("Warnung: Die Adresse sieht persönlich aus (vorname.nachname@). Bitte nur Funktionsadressen hinterlegen.")
	}
	return d.KontaktSetzen(ctx, *kitaID, *email, *herkunft)
}

func idArg(args []string) (int64, error) {
	if len(args) < 2 {
		return 0, fmt.Errorf("ID fehlt")
	}
	return strconv.ParseInt(args[1], 10, 64)
}

func vorschlaege(ctx context.Context, d *dienst.Dienst, args []string) error {
	if len(args) == 0 || args[0] == "liste" {
		liste, err := d.Q.ListVorschlaege(ctx)
		if err != nil {
			return err
		}
		for _, v := range liste {
			fmt.Printf("#%d  %s  →  %s (%s)  Anlass: %s, %s\n", v.ID, v.Email, v.KitaName, deref(v.KitaOrt), v.Anlass, datum.Format(v.ErstelltAm))
		}
		fmt.Printf("%d offen. Prüfen Sie, ob die Adresse zur Kita gehört (Website, Träger), dann: vorschlaege annehmen|ablehnen <id>\n", len(liste))
		return nil
	}
	id, err := idArg(args)
	if err != nil {
		return err
	}
	switch args[0] {
	case "annehmen":
		return d.VorschlagAnnehmen(ctx, id)
	case "ablehnen":
		return d.VorschlagAblehnen(ctx, id)
	}
	return fmt.Errorf("vorschlaege liste|annehmen|ablehnen <id>")
}

func fehlend(ctx context.Context, d *dienst.Dienst, args []string) error {
	if len(args) == 0 || args[0] == "liste" {
		liste, err := d.Q.ListFehlendeKitas(ctx)
		if err != nil {
			return err
		}
		for _, f := range liste {
			fmt.Printf("#%d  %s, %s, %s %s (%s)\n", f.ID, f.Name, f.Strasse, f.Plz, f.Ort, datum.Format(f.ErstelltAm))
		}
		fmt.Printf("%d offen. fehlend annehmen|ablehnen <id>\n", len(liste))
		return nil
	}
	id, err := idArg(args)
	if err != nil {
		return err
	}
	switch args[0] {
	case "annehmen":
		kitaID, err := d.FehlendeAnnehmen(ctx, id)
		if err == nil {
			fmt.Printf("Kita angelegt: %s/kita/%d\n", d.Cfg.BaseURL, kitaID)
		}
		return err
	case "ablehnen":
		return d.Q.DeleteFehlendeKita(ctx, id)
	}
	return fmt.Errorf("fehlend liste|annehmen|ablehnen <id>")
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

// migrateURL liest MIGRATE_DATABASE_URL oder MIGRATE_DATABASE_URL_FILE (Docker-Secret).
func migrateURL() (string, error) {
	if p := os.Getenv("MIGRATE_DATABASE_URL_FILE"); p != "" {
		b, err := os.ReadFile(p)
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(b)), nil
	}
	return os.Getenv("MIGRATE_DATABASE_URL"), nil
}
