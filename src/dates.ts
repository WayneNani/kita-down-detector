const berlinFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Heutiges Datum in Deutschland als YYYY-MM-DD. */
export function heute(now: Date = new Date()): string {
  return berlinFmt.format(now);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function istDatum(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function plusTage(datum: string, tage: number): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

export function tageZwischen(von: string, bis: string): number {
  return Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);
}

export function tageImBereich(von: string, bis: string): string[] {
  const out: string[] = [];
  for (let d = von; d <= bis; d = plusTage(d, 1)) out.push(d);
  return out;
}

const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;
export function istUhrzeit(s: string): boolean {
  return UHRZEIT.test(s);
}

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** „Mo, 18.11.“ */
export function datumKurz(datum: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  return `${WOCHENTAG[d.getUTCDay()]}, ${datum.slice(8, 10)}.${datum.slice(5, 7)}.`;
}

export function istWochenende(datum: string): boolean {
  const wd = new Date(`${datum}T00:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

/** Ende des Kita-Jahres in NRW (31.07.) – Elternbeiräte wechseln danach. */
export function endeKitaJahr(datum: string): string {
  const jahr = Number(datum.slice(0, 4));
  const ende = `${jahr}-07-31`;
  return datum <= ende ? ende : `${jahr + 1}-07-31`;
}
