import { useId } from 'react';
import { useOhneMeldungAlsRegulaer } from '../lib/einstellungen';

/** Lokaler Schalter: Tage ohne Meldung als „vermutlich regulär“ anzeigen. */
export function AnsichtUmschalter() {
  const [wert, setzen] = useOhneMeldungAlsRegulaer();
  const hinweisId = useId();
  return (
    <div className="umschalter">
      <label>
        <input type="checkbox" role="switch" checked={wert} onChange={(e) => setzen(e.target.checked)} aria-describedby={hinweisId} />
        <span>Tage ohne Meldung als reguläre Betreuung anzeigen</span>
      </label>
      <p id={hinweisId} className="umschalter-hinweis">
        Nur Ihre Ansicht auf diesem Gerät. „Keine Meldung“ heißt nicht sicher, dass regulär betreut wird.
      </p>
    </div>
  );
}
