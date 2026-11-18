import { useTitel } from '../lib/titel';
import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type S } from '../api/client';
import { PowWidget } from '../components/PowWidget';
import { Erfolg } from '../components/Seite';
import { FehlerBox } from '../components/Fehler';

type Felder = Omit<S['FehlendeKita'], 'altcha'>;

export default function KitaFehlt() {
  useTitel('Kita fehlt');
  const [f, setF] = useState<Felder>({ name: '', strasse: '', plz: '', ort: '' });
  const [pow, setPow] = useState<string | null>(null);
  const [powNeu, setPowNeu] = useState(0);
  const [fehler, setFehler] = useState<unknown>(null);
  const [sendet, setSendet] = useState(false);
  const [fertig, setFertig] = useState(false);
  const beiPow = useCallback((p: string | null) => setPow(p), []);
  const setze = (k: keyof Felder) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function senden(e: FormEvent) {
    e.preventDefault();
    setFehler(null);
    if (!/^\d{5}$/.test(f.plz.trim())) {
      setFehler(new Error('Bitte eine fünfstellige Postleitzahl angeben.'));
      return;
    }
    if (!pow) {
      setFehler(new Error('Die Sicherheitsprüfung läuft noch – bitte einen Moment warten.'));
      return;
    }
    setSendet(true);
    try {
      await api('/kitas/fehlend', {
        body: { name: f.name.trim(), strasse: f.strasse.trim(), plz: f.plz.trim(), ort: f.ort.trim(), altcha: pow },
      });
      setFertig(true);
    } catch (err) {
      setFehler(err instanceof ApiError ? err : new Error('Unerwarteter Fehler.'));
      setPowNeu((n) => n + 1);
    } finally {
      setSendet(false);
    }
  }

  return (
    <div className="unterseite">
      <p className="zurueck">
        <Link to="/">← Startseite</Link>
      </p>
      <h1>Kita fehlt?</h1>
      {fertig ? (
        <Erfolg titel="Danke!">Wir prüfen die Angaben und nehmen die Kita auf. Das kann einige Tage dauern.</Erfolg>
      ) : (
        <>
          <p>Unsere Liste stammt aus offiziellen Verzeichnissen und kann trotzdem Lücken haben. Melden Sie uns die fehlende Kita:</p>
          <form className="formular" onSubmit={senden} noValidate>
            <label className="feld">
              <span>Name der Kita</span>
              <input required maxLength={200} value={f.name} onChange={setze('name')} />
            </label>
            <label className="feld">
              <span>Straße und Hausnummer</span>
              <input required maxLength={200} autoComplete="street-address" value={f.strasse} onChange={setze('strasse')} />
            </label>
            <div className="reihe">
              <label className="feld feld-plz">
                <span>PLZ</span>
                <input required inputMode="numeric" pattern="\d{5}" maxLength={5} autoComplete="postal-code" value={f.plz} onChange={setze('plz')} />
              </label>
              <label className="feld">
                <span>Ort</span>
                <input required maxLength={100} value={f.ort} onChange={setze('ort')} />
              </label>
            </div>
            <PowWidget onPayload={beiPow} neuStarten={powNeu} />
            <FehlerBox fehler={fehler} />
            <button type="submit" className="knopf knopf-primaer knopf-breit" disabled={sendet}>
              {sendet ? 'Wird gesendet …' : 'Kita melden'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
