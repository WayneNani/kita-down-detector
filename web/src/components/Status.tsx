import type { TagesStatus } from '../api/client';
import { GRUND_LABEL, STATUS_KURZ, STATUS_LABEL, STUFE_LABEL } from '../lib/texte';

/** Status immer mit Text UND Farbpunkt – nie nur über Farbe. */
export function StatusBadge({ s, kurz = false, gross = false }: { s: TagesStatus; kurz?: boolean; gross?: boolean }) {
  return (
    <span className={`badge s-${s.status}${gross ? ' badge-gross' : ''}`}>
      <span className="punkt" aria-hidden="true" />
      {kurz ? STATUS_KURZ[s.status] : STATUS_LABEL[s.status]}
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
