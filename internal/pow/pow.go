// Package pow: Proof-of-Work statt Captcha (ALTCHA v2, selbst gehostet).
// Kein Tracking, keine Cookies, keine Drittanbieter.
package pow

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"math/rand/v2"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go/v2"
)

// Verbraucher markiert eine Challenge als verwendet; false = schon verwendet.
type Verbraucher func(ctx context.Context, nonce string, ablauf time.Time) (bool, error)

type ProofOfWork struct {
	secret                 string
	cost                   int
	counterMin, counterMax int
	gueltigkeit            time.Duration
	verbrauche             Verbraucher
	deriveKey              altcha.DeriveKeyFunc
}

func Neu(secret string, cost, counterMin, counterMax int, verbrauche Verbraucher) *ProofOfWork {
	return &ProofOfWork{
		secret: secret, cost: cost, counterMin: counterMin, counterMax: counterMax,
		gueltigkeit: 10 * time.Minute, verbrauche: verbrauche, deriveKey: altcha.DeriveKeyPBKDF2(),
	}
}

func (p *ProofOfWork) Challenge() (altcha.Challenge, error) {
	counter := p.counterMin + rand.IntN(p.counterMax-p.counterMin)
	ablauf := time.Now().Add(p.gueltigkeit)
	return altcha.CreateChallenge(altcha.CreateChallengeOptions{
		Algorithm:              "PBKDF2/SHA-256",
		DeriveKey:              p.deriveKey,
		HMACSignatureSecret:    p.secret,
		HMACKeySignatureSecret: p.secret,
		Cost:                   p.cost,
		KeyLength:              32,
		Counter:                &counter,
		ExpiresAt:              &ablauf,
	})
}

// Pruefe verifiziert das Feld `altcha` (Base64-JSON vom Widget) und verhindert Wiederverwendung.
func (p *ProofOfWork) Pruefe(ctx context.Context, feld string) (bool, error) {
	if feld == "" || len(feld) > 10_000 {
		return false, nil
	}
	roh, err := base64.StdEncoding.DecodeString(feld)
	if err != nil {
		return false, nil
	}
	var payload altcha.Payload
	if err := json.Unmarshal(roh, &payload); err != nil {
		return false, nil
	}
	if payload.Challenge.Parameters.ExpiresAt == 0 {
		return false, nil // nur eigene, ablaufende Challenges
	}
	res, err := altcha.VerifySolution(altcha.VerifySolutionOptions{
		Challenge:              payload.Challenge,
		Solution:               payload.Solution,
		DeriveKey:              p.deriveKey,
		HMACSignatureSecret:    p.secret,
		HMACKeySignatureSecret: p.secret,
	})
	if err != nil || !res.Verified {
		return false, nil
	}
	ablauf := time.Unix(payload.Challenge.Parameters.ExpiresAt, 0)
	return p.verbrauche(ctx, payload.Challenge.Parameters.Nonce, ablauf)
}

// Loese löst eine Challenge (nur für Tests und Werkzeuge).
func Loese(ch altcha.Challenge) (string, error) {
	sol, err := altcha.SolveChallenge(altcha.SolveChallengeOptions{Challenge: ch, DeriveKey: altcha.DeriveKeyPBKDF2()})
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(altcha.Payload{Challenge: ch, Solution: *sol})
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}
