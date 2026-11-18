import { useTitel } from '../lib/titel';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { useAuswahl, useEinschraenkungen, useNahe, useSuche } from '../api/queries';
import { useFavoriten } from '../lib/favoriten';
import { standortErmitteln } from '../lib/geo';
import { KitaListe } from '../components/KitaListe';
import { FehlerBox, Laden } from '../components/Fehler';
import { IconOrt, IconSuche } from '../components/Icons';
import { StatusBadge, StatusDetails } from '../components/Status';
import { AnsichtUmschalter } from '../components/AnsichtUmschalter';
import { useOhneMeldungAlsRegulaer } from '../lib/einstellungen';
import { Stand } from '../components/Stand';
import { adresse } from '../components/KitaListe';

const ORTE = ['', 'Bonn', 'Köln'];

export default function Start() {
  useTitel('');
  const { ids } = useFavoriten();
  const [ohneMeldungAlsRegulaer] = useOhneMeldungAlsRegulaer();
  const meine = useAuswahl(ids);
  const [q, setQ] = useState('');
  const qVerzoegert = useDeferredValue(q);
  const suche = useSuche(qVerzoegert);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [posFehler, setPosFehler] = useState<string | null>(null);
  const [posLaedt, setPosLaedt] = useState(false);
  const nahe = useNahe(pos);
  const [ort, setOrt] = useState('');
  const einschr = useEinschraenkungen(ort);
  const [alle, setAlle] = useState(false);

  async function standort() {
    setPosFehler(null);
    setPosLaedt(true);
    try {
      setPos(await standortErmitteln());
    } catch (e) {
      setPosFehler(e instanceof Error ? e.message : 'Standort nicht verfügbar.');
    } finally {
      setPosLaedt(false);
    }
  }

  // Favoriten in gespeicherter Reihenfolge
  const meineSortiert = ids.map((id) => meine.data?.kitas.find((k) => k.kita.id === id)).filter((k) => k !== undefined);
  const einschrListe = einschr.data?.kitas ?? [];
  const sichtbar = alle ? einschrListe : einschrListe.slice(0, 30);

  return (
    <div className="start">
      {ids.length > 0 && (
        <section aria-labelledby="meine">
          <h2 id="meine">Meine Kitas</h2>
          <AnsichtUmschalter />
          {meine.isPending && <Laden />}
          {meine.isError && !meine.data && <FehlerBox fehler={meine.error} />}
          <KitaListe eintraege={meineSortiert} annahme={ohneMeldungAlsRegulaer} />
          <Stand aktualisiert={meine.dataUpdatedAt} />
        </section>
      )}

      <section aria-labelledby="finden">
        <h1 id="finden" className={ids.length ? 'h2' : ''}>
          {ids.length ? 'Kita finden' : 'Hat meine Kita heute Notbetreuung?'}
        </h1>
        {ids.length === 0 && (
          <p className="einleitung">
            Eltern melden Einschränkungen, Elternbeiräte und Kitas bestätigen sie. Ohne Anmeldung, ohne Tracking. Markieren Sie
            Ihre Kita mit dem Stern – dann sehen Sie sie hier sofort.
          </p>
        )}
        <form className="suche" role="search" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="suche" className="sr-only">
            Kita suchen
          </label>
          <IconSuche className="suche-icon" />
          <input
            id="suche"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Name, Ort, Straße oder PLZ"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
        <button type="button" className="knopf knopf-sekundaer knopf-breit" onClick={standort} disabled={posLaedt}>
          <IconOrt /> {posLaedt ? 'Standort wird bestimmt …' : 'Kitas in meiner Nähe'}
        </button>
        <p className="hinweis">Ihr Standort wird schon auf Ihrem Gerät auf ca. 1 km gerundet und nicht gespeichert.</p>
        {posFehler && <p className="box box-fehler">{posFehler}</p>}

        {q.trim().length >= 2 && (
          <div className="ergebnisse" aria-live="polite">
            <h2>Suchergebnisse</h2>
            {suche.isPending ? <Laden /> : suche.isError ? <FehlerBox fehler={suche.error} /> : null}
            {suche.data && (
              <KitaListe eintraege={suche.data.kitas} leer="Keine Kita gefunden. Fehlt Ihre Kita? Unten können Sie sie melden." />
            )}
          </div>
        )}
        {pos && (
          <div className="ergebnisse" aria-live="polite">
            <h2>In Ihrer Nähe</h2>
            {nahe.isPending ? <Laden /> : nahe.isError ? <FehlerBox fehler={nahe.error} /> : null}
            {nahe.data && <KitaListe eintraege={nahe.data.kitas} leer="Keine Kitas im Umkreis von 3 km gefunden." />}
          </div>
        )}
      </section>

      <section aria-labelledby="heute">
        <h2 id="heute">Einschränkungen heute</h2>
        <div className="chips" role="radiogroup" aria-label="Ort filtern">
          {ORTE.map((o) => (
            <label key={o || 'alle'} className={`chip${ort === o ? ' gewaehlt' : ''}`}>
              <input type="radio" name="ort" checked={ort === o} onChange={() => setOrt(o)} />
              {o || 'Alle'}
            </label>
          ))}
        </div>
        {einschr.isPending && <Laden />}
        {einschr.isError && !einschr.data && <FehlerBox fehler={einschr.error} />}
        {einschr.data &&
          (einschrListe.length === 0 ? (
            <p className="leer">Für heute liegen keine Meldungen vor{ort ? ` in ${ort}` : ''}.</p>
          ) : (
            <ul className="kita-liste">
              {sichtbar.map(({ kita, status }) => (
                <li key={kita.id}>
                  <Link to={`/kita/${kita.id}`} className="kita-zeile">
                    <span className="kita-zeile-text">
                      <span className="kita-name">{kita.name}</span>
                      <span className="kita-adresse">{adresse(kita)}</span>
                      <StatusBadge s={status} />
                      <StatusDetails s={status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
        {einschrListe.length > sichtbar.length && (
          <button type="button" className="knopf knopf-text" onClick={() => setAlle(true)}>
            Alle {einschrListe.length} anzeigen
          </button>
        )}
        <Stand aktualisiert={einschr.dataUpdatedAt} />
        <p className="hinweis">„Keine Meldung“ heißt nicht automatisch reguläre Betreuung – nur, dass uns nichts gemeldet wurde.</p>
      </section>

      <p className="unten-link">
        <Link to="/kita-fehlt">Ihre Kita fehlt? Hier melden</Link>
      </p>
    </div>
  );
}
