const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Heutiges Datum in Deutschland (YYYY-MM-DD). */
export function heuteBerlin(jetzt: Date = new Date()): string {
  return berlin.format(jetzt);
}

export function plusTage(datum: string, tage: number): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

export function tageZwischen(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);
}

export function istDatum(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function istUhrzeit(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WT_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function wochentag(datum: string): number {
  return new Date(`${datum}T00:00:00Z`).getUTCDay();
}

/** „Mo, 18.11.“ */
export function datumKurz(datum: string): string {
  return `${WT[wochentag(datum)]}, ${datum.slice(8, 10)}.${datum.slice(5, 7)}.`;
}

/** „Montag, 18.11.“ */
export function datumLang(datum: string): string {
  return `${WT_LANG[wochentag(datum)]}, ${datum.slice(8, 10)}.${datum.slice(5, 7)}.`;
}

/** „Heute“, „Morgen“ oder „Mo, 18.11.“ */
export function datumRelativ(datum: string, heute: string): string {
  if (datum === heute) return 'Heute';
  if (datum === plusTage(heute, 1)) return 'Morgen';
  return datumKurz(datum);
}

export function istWochenende(datum: string): boolean {
  const w = wochentag(datum);
  return w === 0 || w === 6;
}

export function uhrzeitAus(ms: number): string {
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(ms);
}
