import { useOhneMeldungAlsRegulaer } from '../lib/einstellungen';

/** Lokaler Schalter: Werktage ohne Meldung als „vermutlich regulär“ anzeigen. */
export function AnsichtUmschalter() {
  const [wert, setzen] = useOhneMeldungAlsRegulaer();
  return (
    <label className="check umschalter">
      <input type="checkbox" role="switch" checked={wert} onChange={(e) => setzen(e.target.checked)} />
      <span>
        Tage ohne Meldung als reguläre Betreuung anzeigen
        <small>Nur Ihre Ansicht auf diesem Gerät, nur Werktage. „Keine Meldung“ heißt nicht sicher, dass regulär betreut wird.</small>
      </span>
    </label>
  );
}
