import type { AngezeigterStatus, Grund, Stufe } from '../api/client';

export const STATUS_LABEL: Record<AngezeigterStatus, string> = {
  unbekannt: 'Keine Meldung',
  regulaer: 'Reguläre Betreuung',
  verkuerzt: 'Verkürzte Betreuungszeiten',
  notbetreuung: 'Notbetreuung',
  geschlossen: 'Keine Betreuung möglich',
};

export const STATUS_KURZ: Record<AngezeigterStatus, string> = {
  unbekannt: 'Keine Meldung',
  regulaer: 'Regulär',
  verkuerzt: 'Verkürzt',
  notbetreuung: 'Notbetreuung',
  geschlossen: 'Geschlossen',
};

/** Lokale Ansicht: Werktag ohne Meldung, als regulär angenommen. */
export const STATUS_ANGENOMMEN = 'Vermutlich regulär (keine Meldung)';

export const STATUS_HILFE: Record<Exclude<AngezeigterStatus, 'unbekannt'>, string> = {
  regulaer: 'Alles normal – z. B. um eine Falschmeldung richtigzustellen',
  verkuerzt: 'Betreuung nur zu kürzeren Zeiten',
  notbetreuung: 'Nur Kinder mit dringendem Bedarf',
  geschlossen: 'Kein Kind kann betreut werden',
};

export const STUFE_LABEL: Record<Stufe, string> = {
  0: '',
  10: 'unbestätigt (Einzelmeldung)',
  20: 'von mehreren Eltern bestätigt',
  30: 'verifiziert durch Elternbeirat',
  40: 'verifiziert durch Kita',
  50: 'berichtigt durch Kita',
};

export const GRUND_LABEL: Record<Grund, string> = {
  personalmangel: 'Personalmangel',
  krankheitswelle: 'Krankheitswelle',
  streik: 'Streik',
  schliesstag: 'Geplanter Schließtag',
  sonstiges: 'Sonstiges',
};

export const STATUS_REIHENFOLGE = ['geschlossen', 'notbetreuung', 'verkuerzt', 'regulaer'] as const;
export const GRUENDE: Grund[] = ['personalmangel', 'krankheitswelle', 'streik', 'schliesstag', 'sonstiges'];
