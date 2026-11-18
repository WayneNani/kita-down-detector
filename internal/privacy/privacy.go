// Package privacy enthält alles, was mit Kennungen zu tun hat: Melder-Hashes
// ohne IP-Speicherung, Tokens, Maskierung, Normalisierung.
package privacy

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"net/netip"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/WayneNani/kita-down-detector/internal/datum"
)

// Tagesgeheimnis liegt nur im Arbeitsspeicher und wird jeden Tag (und bei jedem
// Neustart) neu erzeugt. Danach lassen sich gespeicherte Hashes niemandem mehr
// zuordnen – auch nicht von den Betreibenden.
type Tagesgeheimnis struct {
	mu       sync.Mutex
	tag      time.Time
	schluess []byte
	jetzt    func() time.Time
}

func NeuesTagesgeheimnis(jetzt func() time.Time) *Tagesgeheimnis {
	return &Tagesgeheimnis{jetzt: jetzt}
}

func (t *Tagesgeheimnis) aktuell() []byte {
	t.mu.Lock()
	defer t.mu.Unlock()
	heute := datum.Heute(t.jetzt())
	if !heute.Equal(t.tag) || t.schluess == nil {
		t.tag = heute
		t.schluess = zufall(32)
	}
	return t.schluess
}

func (t *Tagesgeheimnis) mac(teile ...[]byte) []byte {
	h := hmac.New(sha256.New, t.aktuell())
	for _, p := range teile {
		var l [4]byte
		binary.BigEndian.PutUint32(l[:], uint32(len(p)))
		h.Write(l[:])
		h.Write(p)
	}
	return h.Sum(nil)
}

// MelderHash kennzeichnet ein Gerät für eine Kita an einem Tag.
func (t *Tagesgeheimnis) MelderHash(ip netip.Addr, userAgent string, kitaID int64) []byte {
	var id [8]byte
	binary.BigEndian.PutUint64(id[:], uint64(kitaID))
	return t.mac([]byte("melder"), []byte(IPPraefix(ip)), []byte(userAgent), id[:])[:16]
}

// LimitSchluessel kennzeichnet einen Anschluss für Rate-Limits (nur im RAM).
func (t *Tagesgeheimnis) LimitSchluessel(ip netip.Addr) string {
	return string(t.mac([]byte("limit"), []byte(IPPraefix(ip)))[:16])
}

// IPPraefix: IPv4 vollständig, IPv6 auf /64 gekürzt (Privacy Extensions
// wechseln die hinteren 64 Bit regelmäßig).
func IPPraefix(ip netip.Addr) string {
	ip = ip.Unmap()
	if ip.Is6() {
		p, err := ip.Prefix(64)
		if err == nil {
			return p.String()
		}
	}
	return ip.String()
}

func zufall(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

// NeuesToken erzeugt ein URL-taugliches Token mit 256 Bit.
func NeuesToken() string { return base64.RawURLEncoding.EncodeToString(zufall(32)) }

// TokenHash: In der Datenbank liegen nur Hashes von Tokens.
func TokenHash(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// MaskiereEmail: k***@stadt.de
func MaskiereEmail(email string) string {
	lokal, domain, ok := strings.Cut(email, "@")
	if !ok || lokal == "" {
		return "***"
	}
	r := []rune(lokal)
	return string(r[0]) + "***@" + domain
}

var emailRe = regexp.MustCompile(`^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$`)

// NormalisiereEmail prüft grob das Format und gibt die Adresse kleingeschrieben zurück.
func NormalisiereEmail(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) > 254 || !emailRe.MatchString(s) {
		return "", false
	}
	return s, true
}

var (
	personRe   = regexp.MustCompile(`^[a-zäöüß]+[._-][a-zäöüß]+(?:[._-][a-zäöüß]+)?$`)
	initialRe  = regexp.MustCompile(`^[a-z][._-]?[a-zäöüß]{2,}$`)
	funktionRe = regexp.MustCompile(`kita|kiga|kindergarten|kinder|kts|tagesst|familienzentrum|fz|leitung|info|kontakt|verwaltung|buero|office|post|mail|team|einrichtung|haus|villa|nest|zwerg|stern|sonne|regenbogen|kunterbunt|spatz|maus|baer`)
)

// IstFunktionsadresse ist eine Heuristik gegen persönliche Adressen
// (vorname.nachname@, v.nachname@). Im Zweifel lieber verwerfen.
func IstFunktionsadresse(email string) bool {
	lokal, _, ok := strings.Cut(strings.ToLower(email), "@")
	if !ok {
		return false
	}
	if funktionRe.MatchString(lokal) {
		return true
	}
	if personRe.MatchString(lokal) {
		return false
	}
	if initialRe.MatchString(lokal) && strings.ContainsAny(lokal, "._-") {
		return false
	}
	return true
}

var nichtAlnum = regexp.MustCompile(`[^a-z0-9]+`)

var ersetzer = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss", "é", "e", "è", "e")

// Normalisiere: klein, Umlaute ausgeschrieben, Mehrfach-Leerzeichen zusammengefasst.
func Normalisiere(s string) string {
	s = ersetzer.Replace(strings.ToLower(s))
	return strings.Join(strings.Fields(nichtAlnum.ReplaceAllString(s, " ")), " ")
}

var strasseRe = regexp.MustCompile(`(str\.?|strasse|straße)(\s|$)`)

// AdresseNorm erzeugt einen Vergleichsschlüssel „hauptstrasse 5a“.
func AdresseNorm(strasse string) string {
	s := strings.ToLower(strings.TrimSpace(strasse))
	s = strasseRe.ReplaceAllString(s, "strasse ")
	n := Normalisiere(s)
	n = strings.ReplaceAll(n, " strasse", "strasse")
	return strings.ReplaceAll(n, " ", "")
}
