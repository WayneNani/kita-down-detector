import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  dbPath: string;
  /** Öffentliche Basis-URL, z. B. https://kita-ausfall.example – für Links in Mails. */
  baseUrl: string;
  /** Geheimnis zum Signieren der Proof-of-Work-Challenges. */
  altchaSecret: string;
  /** PBKDF2-Iterationen pro Versuch. */
  altchaCost: number;
  /** Bereich, aus dem die Anzahl der nötigen Versuche gezogen wird. */
  altchaCounterMin: number;
  altchaCounterMax: number;
  /** Ab wie vielen unabhängigen anonymen Meldungen gilt ein Status als bestätigt. */
  bestaetigungsSchwelle: number;
  /** Max. anonyme Meldungen pro Gerät, Kita und Tag. */
  maxMeldungenProTag: number;
  /** Nach wie vielen Tagen (ab Ende des gemeldeten Zeitraums) Einzelmeldungen gelöscht werden. */
  aufbewahrungTage: number;
  /** Nur setzen, wenn ein Reverse-Proxy X-Forwarded-For zuverlässig setzt. */
  trustProxy: boolean;
  smtpUrl: string | undefined;
  mailFrom: string;
  /** Kontaktadresse der Betreiber:innen (Impressum, manuelle Berichtigungen). */
  kontaktEmail: string;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} muss eine Zahl sein`);
  return n;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const production = process.env.NODE_ENV === 'production';
  let altchaSecret = process.env.ALTCHA_HMAC_SECRET ?? '';
  if (!altchaSecret) {
    if (production) throw new Error('ALTCHA_HMAC_SECRET muss in Produktion gesetzt sein');
    altchaSecret = randomBytes(32).toString('hex');
  }
  const port = int('PORT', 3000);
  return {
    port,
    dbPath: process.env.DB_PATH ?? 'data/kita.db',
    baseUrl: (process.env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    altchaSecret,
    altchaCost: int('ALTCHA_COST', 5000),
    altchaCounterMin: int('ALTCHA_COUNTER_MIN', 2000),
    altchaCounterMax: int('ALTCHA_COUNTER_MAX', 5000),
    bestaetigungsSchwelle: int('BESTAETIGUNG_SCHWELLE', 2),
    maxMeldungenProTag: int('MAX_MELDUNGEN_PRO_TAG', 3),
    aufbewahrungTage: int('AUFBEWAHRUNG_TAGE', 180),
    trustProxy: process.env.TRUST_PROXY === '1',
    smtpUrl: process.env.SMTP_URL || undefined,
    mailFrom: process.env.MAIL_FROM ?? 'Kita-Ausfall NRW <noreply@localhost>',
    kontaktEmail: process.env.KONTAKT_EMAIL ?? 'kontakt@localhost',
    ...overrides,
  };
}
