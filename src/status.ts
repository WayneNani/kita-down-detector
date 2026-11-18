import type { Grund, Quelle, Status, Stufe } from './domain.ts';
import { QUELLE_STUFE, STUFE } from './domain.ts';

export interface Meldung {
  id: number;
  kita_id: number;
  status: Status;
  datum_von: string;
  datum_bis: string;
  uhrzeit_von: string | null;
  uhrzeit_bis: string | null;
  grund: Grund | null;
  quelle: Quelle;
  melder_hash: string | null;
}

export interface TagesStatus {
  datum: string;
  status: Status | 'unbekannt';
  stufe: Stufe;
  uhrzeit_von: string | null;
  uhrzeit_bis: string | null;
  grund: Grund | null;
  /** Anzahl unabhängiger Meldungen für den angezeigten Status (nur anonym). */
  anzahl: number;
}

const UNBEKANNT = (datum: string): TagesStatus => ({
  datum,
  status: 'unbekannt',
  stufe: STUFE.keine,
  uhrzeit_von: null,
  uhrzeit_bis: null,
  grund: null,
  anzahl: 0,
});

function aus(m: Meldung, datum: string, stufe: Stufe, anzahl: number): TagesStatus {
  return {
    datum,
    status: m.status,
    stufe,
    uhrzeit_von: m.uhrzeit_von,
    uhrzeit_bis: m.uhrzeit_bis,
    grund: m.grund,
    anzahl,
  };
}

/**
 * Bestimmt den angezeigten Status einer Kita für einen Tag.
 *
 * 1. Gibt es verifizierte Meldungen (Link, Berichtigung), gewinnt die höchste
 *    Stufe, bei Gleichstand die neueste.
 * 2. Sonst zählen anonyme Meldungen: Der Status mit den meisten unabhängigen
 *    Meldenden gewinnt (Gleichstand: neueste Meldung). Ab `schwelle`
 *    unabhängigen Meldungen gilt er als bestätigt.
 */
export function berechneTagesStatus(meldungen: Meldung[], datum: string, schwelle: number): TagesStatus {
  const relevant = meldungen.filter((m) => m.datum_von <= datum && datum <= m.datum_bis);
  if (relevant.length === 0) return UNBEKANNT(datum);

  let bestVerifiziert: { m: Meldung; stufe: Stufe } | undefined;
  for (const m of relevant) {
    if (m.quelle === 'anonym') continue;
    const stufe = QUELLE_STUFE[m.quelle];
    if (!bestVerifiziert || stufe > bestVerifiziert.stufe || (stufe === bestVerifiziert.stufe && m.id > bestVerifiziert.m.id)) {
      bestVerifiziert = { m, stufe };
    }
  }
  if (bestVerifiziert) return aus(bestVerifiziert.m, datum, bestVerifiziert.stufe, 0);

  const proStatus = new Map<Status, { melder: Set<string>; neueste: Meldung }>();
  for (const m of relevant) {
    let e = proStatus.get(m.status);
    if (!e) {
      e = { melder: new Set(), neueste: m };
      proStatus.set(m.status, e);
    }
    // Meldungen ohne Hash (z. B. Altdaten) zählen jeweils einzeln.
    e.melder.add(m.melder_hash ?? `#${m.id}`);
    if (m.id > e.neueste.id) e.neueste = m;
  }

  let best: { melder: Set<string>; neueste: Meldung } | undefined;
  for (const e of proStatus.values()) {
    if (!best || e.melder.size > best.melder.size || (e.melder.size === best.melder.size && e.neueste.id > best.neueste.id)) {
      best = e;
    }
  }
  const b = best!;
  const stufe = b.melder.size >= schwelle ? STUFE.bestaetigt : STUFE.unbestaetigt;
  return aus(b.neueste, datum, stufe, b.melder.size);
}
