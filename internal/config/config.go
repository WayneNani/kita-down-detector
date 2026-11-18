// Package config liest die Konfiguration aus Umgebungsvariablen und bricht
// in Produktion ab, wenn Pflichtwerte fehlen oder unsicher sind.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/netip"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Produktion   bool
	Adresse      string // z. B. ":8080"
	DatabaseURL  string
	BaseURL      string // öffentliche URL ohne Slash am Ende
	KontaktEmail string

	AltchaSecret     string
	AltchaCost       int
	AltchaCounterMin int
	AltchaCounterMax int

	BestaetigungsSchwelle int
	MaxMeldungenProTag    int
	AufbewahrungTage      int

	TrustedProxies []netip.Prefix

	SMTPURL  string
	MailFrom string

	// Domains von Trägern, deren Adressen ohne manuelle Prüfung akzeptiert werden.
	VertrauteDomains []string
}

func Laden() (Config, error) {
	c := Config{
		Produktion:            os.Getenv("APP_ENV") == "production",
		Adresse:               env("ADDR", ":8080"),
		DatabaseURL:           env("DATABASE_URL", "postgres://kita_app:dev@localhost:5432/kita?sslmode=disable"),
		KontaktEmail:          env("KONTAKT_EMAIL", "kontakt@localhost"),
		AltchaCost:            envInt("ALTCHA_COST", 5000),
		AltchaCounterMin:      envInt("ALTCHA_COUNTER_MIN", 2000),
		AltchaCounterMax:      envInt("ALTCHA_COUNTER_MAX", 5000),
		BestaetigungsSchwelle: envInt("BESTAETIGUNG_SCHWELLE", 2),
		MaxMeldungenProTag:    envInt("MAX_MELDUNGEN_PRO_TAG", 3),
		AufbewahrungTage:      envInt("AUFBEWAHRUNG_TAGE", 180),
		SMTPURL:               os.Getenv("SMTP_URL"),
		MailFrom:              env("MAIL_FROM", "Kita-Ausfall NRW <noreply@localhost>"),
	}
	c.BaseURL = strings.TrimRight(env("BASE_URL", "http://localhost"+c.Adresse), "/")

	secret, err := envOderDatei("ALTCHA_HMAC_SECRET")
	if err != nil {
		return c, err
	}
	c.AltchaSecret = secret
	if c.DatabaseURL, err = envOderDateiMitStandard("DATABASE_URL", c.DatabaseURL); err != nil {
		return c, err
	}
	if c.SMTPURL, err = envOderDateiMitStandard("SMTP_URL", c.SMTPURL); err != nil {
		return c, err
	}

	for _, s := range splitListe(os.Getenv("TRUSTED_PROXY_CIDRS")) {
		p, err := netip.ParsePrefix(s)
		if err != nil {
			return c, fmt.Errorf("TRUSTED_PROXY_CIDRS: %w", err)
		}
		c.TrustedProxies = append(c.TrustedProxies, p)
	}
	for _, d := range splitListe(os.Getenv("VERTRAUTE_DOMAINS")) {
		c.VertrauteDomains = append(c.VertrauteDomains, strings.ToLower(strings.TrimPrefix(d, "@")))
	}

	if c.Produktion {
		switch {
		case len(c.AltchaSecret) < 32:
			return c, fmt.Errorf("ALTCHA_HMAC_SECRET muss mindestens 32 Zeichen haben")
		case !strings.HasPrefix(c.BaseURL, "https://"):
			return c, fmt.Errorf("BASE_URL muss in Produktion mit https:// beginnen")
		case c.SMTPURL == "":
			return c, fmt.Errorf("SMTP_URL muss in Produktion gesetzt sein")
		}
	} else if c.AltchaSecret == "" {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		c.AltchaSecret = hex.EncodeToString(b)
	}
	if c.AltchaCounterMax <= c.AltchaCounterMin {
		return c, fmt.Errorf("ALTCHA_COUNTER_MAX muss größer als ALTCHA_COUNTER_MIN sein")
	}
	return c, nil
}

func env(name, standard string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return standard
}

func envInt(name string, standard int) int {
	v := os.Getenv(name)
	if v == "" {
		return standard
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		panic(fmt.Sprintf("%s muss eine Zahl sein", name))
	}
	return n
}

// envOderDatei liest NAME oder den Inhalt der Datei aus NAME_FILE (Docker-Secrets).
func envOderDatei(name string) (string, error) {
	return envOderDateiMitStandard(name, os.Getenv(name))
}

func envOderDateiMitStandard(name, standard string) (string, error) {
	if pfad := os.Getenv(name + "_FILE"); pfad != "" {
		b, err := os.ReadFile(pfad)
		if err != nil {
			return "", fmt.Errorf("%s_FILE: %w", name, err)
		}
		return strings.TrimSpace(string(b)), nil
	}
	return standard, nil
}

func splitListe(s string) []string {
	var out []string
	for _, t := range strings.Split(s, ",") {
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}
