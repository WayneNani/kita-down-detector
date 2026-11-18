/**
 * Fachliche Begriffe. Bewusst nur feste Werte – kein Freitext, damit keine
 * personenbezogenen Daten (z. B. „Frau X ist krank“) ins System gelangen.
 */

export const STATUS = ['regulaer', 'verkuerzt', 'notbetreuung', 'geschlossen'] as const;
export type Status = (typeof STATUS)[number];

export const STATUS_LABEL: Record<Status | 'unbekannt', string> = {
  unbekannt: 'Keine Meldung',
  regulaer: 'Reguläre Betreuung',
  verkuerzt: 'Verkürzte Betreuungszeiten',
  notbetreuung: 'Notbetreuung',
  geschlossen: 'Keine Betreuung möglich',
};

export const GRUND = ['personalmangel', 'krankheitswelle', 'streik', 'schliesstag', 'sonstiges'] as const;
export type Grund = (typeof GRUND)[number];

export const GRUND_LABEL: Record<Grund, string> = {
  personalmangel: 'Personalmangel',
  krankheitswelle: 'Krankheitswelle',
  streik: 'Streik',
  schliesstag: 'Geplanter Schließtag',
  sonstiges: 'Sonstiges',
};

/** Woher eine Meldung stammt. Bestimmt die Vertrauensstufe. */
export const QUELLE = ['anonym', 'elternbeirat', 'kita', 'kita_berichtigung'] as const;
export type Quelle = (typeof QUELLE)[number];

/**
 * Vertrauensstufen (höher = vertrauenswürdiger). Die Zahlen lassen Platz für
 * spätere Quellen, z. B. per DKIM verifizierte Kita-Mails zwischen 20 und 30.
 */
export const STUFE = {
  keine: 0,
  unbestaetigt: 10,
  bestaetigt: 20,
  elternbeirat: 30,
  kita: 40,
  berichtigung: 50,
} as const;
export type Stufe = (typeof STUFE)[keyof typeof STUFE];

export const STUFE_LABEL: Record<Stufe, string> = {
  0: '',
  10: 'unbestätigt (Einzelmeldung)',
  20: 'von mehreren Eltern bestätigt',
  30: 'verifiziert durch Elternbeirat',
  40: 'verifiziert durch Kita',
  50: 'berichtigt durch Kita',
};

export const QUELLE_STUFE: Record<Exclude<Quelle, 'anonym'>, Stufe> = {
  elternbeirat: STUFE.elternbeirat,
  kita: STUFE.kita,
  kita_berichtigung: STUFE.berichtigung,
};

export const LINK_ROLLE = ['elternbeirat', 'kita'] as const;
export type LinkRolle = (typeof LINK_ROLLE)[number];

/** Längster Zeitraum, der mit einer Meldung abgedeckt werden kann. */
export const MAX_ZEITRAUM_TAGE = 31;
/** Wie weit Meldungen in die Vergangenheit/Zukunft reichen dürfen. */
export const MAX_TAGE_ZURUECK = 7;
export const MAX_TAGE_VORAUS = 90;
