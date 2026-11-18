import { createHash, createHmac, randomBytes } from 'node:crypto';
import { heute } from './dates.ts';

/**
 * Erzeugt ein Kennzeichen, mit dem sich mehrere Meldungen desselben Geräts
 * zur selben Kita am selben Tag erkennen lassen – ohne IP-Adressen zu speichern.
 *
 * Das Tagesgeheimnis liegt nur im Arbeitsspeicher und wird täglich ersetzt.
 * Danach lässt sich ein gespeicherter Hash keiner IP mehr zuordnen, auch nicht
 * von den Betreibenden. Weil die Kita-ID eingeht, sind Hashes auch zwischen
 * Kitas nicht verknüpfbar.
 */
export class MelderKennung {
  private tag = '';
  private geheimnis: Buffer = Buffer.alloc(0);
  private readonly jetzt: () => Date;

  constructor(jetzt: () => Date = () => new Date()) {
    this.jetzt = jetzt;
  }

  hash(geraet: string, kitaId: number): string {
    const t = heute(this.jetzt());
    if (t !== this.tag) {
      this.tag = t;
      this.geheimnis = randomBytes(32);
    }
    return createHmac('sha256', this.geheimnis).update(`${kitaId}\n${geraet}`).digest('base64url').slice(0, 22);
  }
}

/** Zufälliges, URL-taugliches Token (256 Bit). */
export function neuesToken(): string {
  return randomBytes(32).toString('base64url');
}

/** In der Datenbank liegen nur Hashes von Tokens. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** k***@stadt.de – um zu zeigen, wohin eine Mail ging, ohne sie komplett anzuzeigen. */
export function maskiereEmail(email: string): string {
  const [lokal, domain] = email.split('@');
  if (!lokal || !domain) return '***';
  return `${lokal[0]}***@${domain}`;
}
