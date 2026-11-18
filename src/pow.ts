import { createChallenge, randomInt, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import type { Config } from './config.ts';

/**
 * Proof-of-Work statt Captcha (ALTCHA, selbst gehostet): kein Tracking, keine
 * Cookies, keine Drittanbieter. Der Browser rechnet ein paar Sekunden, was
 * massenhaftes automatisiertes Melden teuer macht.
 */
export class ProofOfWork {
  private readonly cfg: Config;
  /** Bereits verwendete Challenges (gegen Wiederverwendung). */
  private readonly verwendet = new Map<string, number>();

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  async challenge(): Promise<unknown> {
    return createChallenge({
      algorithm: 'PBKDF2/SHA-256',
      cost: this.cfg.altchaCost,
      counter: randomInt(this.cfg.altchaCounterMin, this.cfg.altchaCounterMax),
      deriveKey,
      hmacSignatureSecret: this.cfg.altchaSecret,
      hmacKeySignatureSecret: this.cfg.altchaSecret,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  }

  /** Prüft das vom Widget gesendete Feld `altcha` (Base64-JSON). */
  async pruefe(feld: unknown): Promise<boolean> {
    if (typeof feld !== 'string' || feld.length === 0 || feld.length > 10_000) return false;
    let payload: { challenge?: { parameters?: { nonce?: string; expiresAt?: number } }; solution?: unknown };
    try {
      payload = JSON.parse(Buffer.from(feld, 'base64').toString('utf8'));
    } catch {
      return false;
    }
    if (!payload?.challenge || !payload.solution) return false;
    let ergebnis;
    try {
      ergebnis = await verifySolution({
        challenge: payload.challenge as Parameters<typeof verifySolution>[0]['challenge'],
        solution: payload.solution as Parameters<typeof verifySolution>[0]['solution'],
        deriveKey,
        hmacSignatureSecret: this.cfg.altchaSecret,
        hmacKeySignatureSecret: this.cfg.altchaSecret,
      });
    } catch {
      return false;
    }
    if (!ergebnis.verified) return false;

    const nonce = payload.challenge.parameters?.nonce ?? '';
    this.aufraeumen();
    if (this.verwendet.has(nonce)) return false;
    this.verwendet.set(nonce, (payload.challenge.parameters?.expiresAt ?? Date.now() / 1000 + 600) * 1000);
    return true;
  }

  private aufraeumen(): void {
    const jetzt = Date.now();
    for (const [k, ablauf] of this.verwendet) if (ablauf < jetzt) this.verwendet.delete(k);
  }
}
