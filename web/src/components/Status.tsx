import type { AngezeigterStatus, TagesStatus } from '../api/client';
import { useOhneMeldungAlsRegulaer } from '../lib/einstellungen';
import { GRUND_LABEL, STATUS_KURZ, STATUS_LABEL, STUFE_LABEL } from '../lib/texte';

export interface Anzeige {
  /** Status für Farbe/Form (bei Annahme „regulaer“). */
  status: AngezeigterStatus;
  /** true, wenn „keine Meldung“ nur wegen der lokalen Einstellung als regulär gezeigt wird. */
  angenommen: boolean;
}

/** Wendet die lokale Ansichts-Einstellung an. Die Daten selbst bleiben unverändert. */
export function anzeigeFuer(s: TagesStatus, ohneMeldungAlsRegulaer: boolean): Anzeige {
  if (ohneMeldungAlsRegulaer && s.status === 'unbekannt') return { status: 'regulaer', angenommen: true };
  return { status: s.status, angenommen: false };
}

export function useAnzeige(s: TagesStatus): Anzeige {
  const [annahme] = useOhneMeldungAlsRegulaer();
  return anzeigeFuer(s, annahme);
}

/** Status immer mit Text UND Farbpunkt – nie nur über Farbe. */
export function StatusBadge({ s, kurz = false, gross = false }: { s: TagesStatus; kurz?: boolean; gross?: boolean }) {
  const a = useAnzeige(s);
  const text = a.angenommen
    ? kurz
      ? 'Vermutlich regulär'
      : 'Vermutlich regulär (keine Meldung)'
    : kurz
      ? STATUS_KURZ[a.status]
      : STATUS_LABEL[a.status];
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
