import type { AngezeigterStatus, TagesStatus } from '../api/client';
import { istRegulaerGeschlossen } from '../lib/feiertage';
import { GRUND_LABEL, STATUS_ANGENOMMEN, STATUS_KURZ, STATUS_LABEL, STUFE_LABEL } from '../lib/texte';

export interface Anzeige {
  /** Status für Farbe/Form (bei Annahme „regulaer“). */
  status: AngezeigterStatus;
  /** true, wenn „keine Meldung“ nur wegen der lokalen Einstellung als regulär gezeigt wird. */
  angenommen: boolean;
}

/**
 * Wendet die lokale Ansichts-Einstellung an; die Daten selbst bleiben unverändert.
 * Nur Werktage: An Wochenenden und NRW-Feiertagen haben Kitas regulär geschlossen.
 */
export function anzeigeFuer(s: TagesStatus, ohneMeldungAlsRegulaer: boolean): Anzeige {
  if (ohneMeldungAlsRegulaer && s.status === 'unbekannt' && !istRegulaerGeschlossen(s.datum)) {
    return { status: 'regulaer', angenommen: true };
  }
  return { status: s.status, angenommen: false };
}

/**
 * Status immer mit Text UND Farbpunkt – nie nur über Farbe.
 * `annahme` setzen nur Seiten, die den Ansichts-Schalter zeigen.
 */
export function StatusBadge({ s, kurz = false, gross = false, annahme = false }: { s: TagesStatus; kurz?: boolean; gross?: boolean; annahme?: boolean }) {
  const a = anzeigeFuer(s, annahme);
  const text = a.angenommen ? STATUS_ANGENOMMEN : kurz ? STATUS_KURZ[a.status] : STATUS_LABEL[a.status];
  return (
    <span className={`badge s-${a.status}${a.angenommen ? ' angenommen' : ''}${gross ? ' badge-gross' : ''}`}>
      <span className="punkt" aria-hidden="true" />
      {text}
    </span>
  );
}

export function StatusDetails({ s }: { s: TagesStatus }) {
  const teile: string[] = [];
  if (s.uhrzeit_von && s.uhrzeit_bis) teile.push(`Betreuung ${s.uhrzeit_von}–${s.uhrzeit_bis} Uhr`);
  if (s.grund) teile.push(GRUND_LABEL[s.grund]);
  return (
    <>
      {teile.length > 0 && <span className="details">{teile.join(' · ')}</span>}
      {s.stufe > 0 && <span className={`stufe stufe-${s.stufe}`}>{STUFE_LABEL[s.stufe]}</span>}
    </>
  );
}
