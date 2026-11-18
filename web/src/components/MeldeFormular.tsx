import { useCallback, useId, useState, type FormEvent } from 'react';
import { ApiError, type FeldFehler, type MeldungInput, type Status } from '../api/client';
import { baueMeldung, LEERER_ZUSTAND, zeigtUhrzeiten, type FormZustand, type Grenzen, type Zeitraum } from '../lib/meldung';
import { datumKurz, plusTage } from '../lib/datum';
import { GRUENDE, GRUND_LABEL, STATUS_HILFE, STATUS_LABEL, STATUS_REIHENFOLGE } from '../lib/texte';
import { PowWidget } from './PowWidget';

export interface MeldeFormularProps {
  heute: string;
  grenzen: Grenzen;
  /** Mit Proof-of-Work (anonym) oder ohne (Melde-Link). */
  mitPow: boolean;
  knopfText: string;
  onSenden: (meldung: MeldungInput, altcha: string | null) => Promise<void>;
}

const ZEITRAEUME: { wert: Zeitraum; label: string }[] = [
  { wert: 'heute', label: 'Heute' },
  { wert: 'morgen', label: 'Morgen' },
  { wert: 'heute_morgen', label: 'Heute + morgen' },
  { wert: 'anders', label: 'Anderer Zeitraum' },
];

export function MeldeFormular({ heute, grenzen, mitPow, knopfText, onSenden }: MeldeFormularProps) {
  const id = useId();
  const [z, setZ] = useState<FormZustand>(LEERER_ZUSTAND);
  const [fehler, setFehler] = useState<FeldFehler[]>([]);
  const [serverFehler, setServerFehler] = useState<string | null>(null);
  const [sendet, setSendet] = useState(false);
  const [pow, setPow] = useState<string | null>(null);
  const [powNeu, setPowNeu] = useState(0);
  const beiPow = useCallback((p: string | null) => setPow(p), []);

  const setze = <K extends keyof FormZustand>(k: K, v: FormZustand[K]) => setZ((alt) => ({ ...alt, [k]: v }));
  const fehlerFuer = (...felder: string[]) => fehler.filter((f) => f.feld && felder.includes(f.feld));

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setServerFehler(null);
    const erg = baueMeldung(z, heute, grenzen);
    if (!erg.ok) {
      setFehler(erg.fehler);
      return;
    }
    setFehler([]);
    if (mitPow && !pow) {
      setServerFehler('Die Sicherheitsprüfung läuft noch – bitte einen Moment warten und erneut senden.');
      return;
    }
    setSendet(true);
    try {
      await onSenden(erg.meldung, pow);
      setZ(LEERER_ZUSTAND);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerFehler(err.detail);
        setFehler(err.fehler);
      } else {
        setServerFehler('Unerwarteter Fehler. Bitte erneut versuchen.');
      }
    } finally {
      setSendet(false);
      if (mitPow) setPowNeu((n) => n + 1); // jede Lösung ist nur einmal gültig
    }
  }

  const minDatum = plusTage(heute, -grenzen.max_tage_zurueck);
  const maxDatum = plusTage(heute, grenzen.max_tage_voraus);
  const ohneFeld = fehler.filter((f) => !f.feld || !['status', 'datum_von', 'datum_bis', 'uhrzeit_von', 'uhrzeit_bis'].includes(f.feld));

  return (
    <form className="melde-formular" onSubmit={absenden} noValidate>
      <fieldset className="gruppe">
        <legend>Was gilt?</legend>
        <div className="status-karten">
          {STATUS_REIHENFOLGE.map((s: Status) => (
            <label key={s} className={`status-karte s-${s}${z.status === s ? ' gewaehlt' : ''}`}>
              <input type="radio" name={`${id}-status`} value={s} checked={z.status === s} onChange={() => setze('status', s)} />
              <span className="punkt" aria-hidden="true" />
              <span className="status-karte-text">
                <strong>{STATUS_LABEL[s]}</strong>
                <small>{STATUS_HILFE[s]}</small>
              </span>
            </label>
          ))}
        </div>
        <FeldFehlerListe fehler={fehlerFuer('status')} />
      </fieldset>

      <fieldset className="gruppe">
        <legend>Wann?</legend>
        <div className="chips" role="radiogroup" aria-label="Zeitraum">
          {ZEITRAEUME.map((t) => (
            <label key={t.wert} className={`chip${z.zeitraum === t.wert ? ' gewaehlt' : ''}`}>
              <input type="radio" name={`${id}-zeitraum`} value={t.wert} checked={z.zeitraum === t.wert} onChange={() => setze('zeitraum', t.wert)} />
              {t.label}
            </label>
          ))}
        </div>
        {z.zeitraum === 'anders' ? (
          <div className="reihe">
            <label className="feld">
              <span>Von</span>
              <input type="date" value={z.datumVon} min={minDatum} max={maxDatum} onChange={(e) => setze('datumVon', e.target.value)} required />
            </label>
            <label className="feld">
              <span>Bis (optional)</span>
              <input type="date" value={z.datumBis} min={z.datumVon || minDatum} max={maxDatum} onChange={(e) => setze('datumBis', e.target.value)} />
            </label>
          </div>
        ) : (
          <p className="hinweis">
            {z.zeitraum === 'heute' && datumKurz(heute)}
            {z.zeitraum === 'morgen' && datumKurz(plusTage(heute, 1))}
            {z.zeitraum === 'heute_morgen' && `${datumKurz(heute)} und ${datumKurz(plusTage(heute, 1))}`}
          </p>
        )}
        <FeldFehlerListe fehler={fehlerFuer('datum_von', 'datum_bis')} />
      </fieldset>

      {zeigtUhrzeiten(z.status) && (
        <fieldset className="gruppe">
          <legend>Betreuungszeit{z.status === 'notbetreuung' ? ' (optional)' : ''}</legend>
          <div className="reihe">
            <label className="feld">
              <span>Beginn</span>
              <input type="time" value={z.uhrzeitVon} onChange={(e) => setze('uhrzeitVon', e.target.value)} />
            </label>
            <label className="feld">
              <span>Ende</span>
              <input type="time" value={z.uhrzeitBis} onChange={(e) => setze('uhrzeitBis', e.target.value)} />
            </label>
          </div>
          <FeldFehlerListe fehler={fehlerFuer('uhrzeit_von', 'uhrzeit_bis')} />
        </fieldset>
      )}

      <fieldset className="gruppe">
        <legend>Grund (optional)</legend>
        <div className="chips">
          {GRUENDE.map((g) => (
            <label key={g} className={`chip${z.grund === g ? ' gewaehlt' : ''}`}>
              <input
                type="checkbox"
                checked={z.grund === g}
                onChange={() => setze('grund', z.grund === g ? '' : g)}
              />
              {GRUND_LABEL[g]}
            </label>
          ))}
        </div>
        <p className="hinweis">Bewusst ohne Freitext – bitte keine Namen oder Details zu Personen.</p>
      </fieldset>

      {mitPow && <PowWidget onPayload={beiPow} neuStarten={powNeu} />}

      {(serverFehler || ohneFeld.length > 0) && (
        <div className="box box-fehler" role="alert">
          {serverFehler && <strong>{serverFehler}</strong>}
          <FeldFehlerListe fehler={ohneFeld} />
        </div>
      )}

      <button type="submit" className="knopf knopf-primaer knopf-breit" disabled={sendet}>
        {sendet ? 'Wird gesendet …' : knopfText}
      </button>
    </form>
  );
}

function FeldFehlerListe({ fehler }: { fehler: FeldFehler[] }) {
  if (!fehler.length) return null;
  return (
    <ul className="feld-fehler" role="alert">
      {fehler.map((f, i) => (
        <li key={i}>{f.meldung}</li>
      ))}
    </ul>
  );
}
