/**
 * Gesetzliche Feiertage in NRW. An Wochenenden und Feiertagen haben Kitas
 * regulär geschlossen – „keine Meldung“ darf dort nicht als „regulär“ gelten.
 */

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function plus(d: Date, tage: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + tage);
  return x;
}

/** Ostersonntag (Gauß/Meeus, gregorianisch). */
export function ostersonntag(jahr: number): Date {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

const cache = new Map<number, Set<string>>();

export function feiertageNRW(jahr: number): Set<string> {
  let s = cache.get(jahr);
  if (s) return s;
  const ostern = ostersonntag(jahr);
  const fest = (m: number, t: number) => iso(new Date(Date.UTC(jahr, m - 1, t)));
  s = new Set([
    fest(1, 1), // Neujahr
    iso(plus(ostern, -2)), // Karfreitag
    iso(plus(ostern, 1)), // Ostermontag
    fest(5, 1), // Tag der Arbeit
    iso(plus(ostern, 39)), // Christi Himmelfahrt
    iso(plus(ostern, 50)), // Pfingstmontag
    iso(plus(ostern, 60)), // Fronleichnam
    fest(10, 3), // Tag der Deutschen Einheit
    fest(11, 1), // Allerheiligen
    fest(12, 25),
    fest(12, 26),
  ]);
  cache.set(jahr, s);
  return s;
}

/** Wochenende oder gesetzlicher Feiertag in NRW (Datum als YYYY-MM-DD). */
export function istRegulaerGeschlossen(datum: string): boolean {
  const d = new Date(`${datum}T00:00:00Z`);
  const w = d.getUTCDay();
  return w === 0 || w === 6 || feiertageNRW(d.getUTCFullYear()).has(datum);
}
