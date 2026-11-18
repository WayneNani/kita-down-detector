import { useTitel } from '../lib/titel';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, type KitaDetail, type MeldungInput, type TagesStatus } from '../api/client';
import { aktuellesHeute, schluessel, useInfo, useKita } from '../api/queries';
import { useFavoriten } from '../lib/favoriten';
import { useToast } from '../lib/toast';
import { datumLang, datumRelativ, heuteBerlin, istWochenende, uhrzeitAus } from '../lib/datum';
import { STATUS_LABEL, STUFE_LABEL } from '../lib/texte';
import { BottomSheet } from '../components/BottomSheet';
import { MeldeFormular } from '../components/MeldeFormular';
import { StatusBadge, StatusDetails, anzeigeFuer } from '../components/Status';
import { useOhneMeldungAlsRegulaer } from '../lib/einstellungen';
import { useOnline } from '../lib/online';
import { AnsichtUmschalter } from '../components/AnsichtUmschalter';
import { FehlerBox, Laden } from '../components/Fehler';
import { IconPlus, IconStern, IconTeilen } from '../components/Icons';
import { Stand } from '../components/Stand';
import { adresse } from '../components/KitaListe';
import NichtGefunden from './NichtGefunden';
import { ApiError } from '../api/client';

export default function Kita() {
  const id = Number(useParams().id);
  const kita = useKita(id);
  const kk = kita.data?.kita;
  useTitel(kk ? `${kk.name}${kk.ort ? ` (${kk.ort})` : ''}` : null);
  const { info } = useInfo();
  const { istFavorit, umschalten } = useFavoriten();
  const [ohneMeldungAlsRegulaer] = useOhneMeldungAlsRegulaer();
  const online = useOnline();
  const [sheet, setSheet] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const leiste = useRef<HTMLDivElement>(null);
  const [statisch, setStatisch] = useState(false);

  // Bei sehr großer Schrift würde die feste Leiste zu viel verdecken – dann im Fluss anzeigen.
  useEffect(() => {
    const el = leiste.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // Hysterese, damit die Leiste nicht zwischen beiden Zuständen springt.
    const pruefen = () => setStatisch((vorher) => el.offsetHeight > window.innerHeight * (vorher ? 0.12 : 0.2));
    const ro = new ResizeObserver(pruefen);
    ro.observe(el);
    window.addEventListener('resize', pruefen);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', pruefen);
    };
  }, [kita.data]);

  if (!(Number.isInteger(id) && id > 0)) return <NichtGefunden />;
  if (kita.isError && kita.error instanceof ApiError && kita.error.status === 404) return <NichtGefunden />;
  if (kita.isPending && !online)
    return (
      <div className="box box-fehler" role="alert">
        Sie sind offline, und diese Kita wurde auf diesem Gerät noch nicht geladen. Bitte versuchen Sie es mit Verbindung erneut.
      </div>
    );
  if (kita.isPending) return <Laden />;
  if (!kita.data) return <FehlerBox fehler={kita.error} />;

  const d = kita.data;
  const k = d.kita;
  const heute = d.tage[0];
  const weitere = d.tage.slice(1);
  const fav = istFavorit(k.id);

  async function teilen() {
    const url = `${window.location.origin}/kita/${k.id}`;
    const text = heute ? `${k.name}: heute ${STATUS_LABEL[heute.status]}` : k.name;
    try {
      if (navigator.share) {
        await navigator.share({ title: k.name, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('Link kopiert – jetzt z. B. in der Eltern-Gruppe einfügen.');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // Teilen abgebrochen
      toast('Teilen nicht möglich. Bitte die Adresse aus der Adresszeile kopieren.', 'fehler');
    }
  }

  async function melden(m: MeldungInput, altcha: string | null) {
    const neu = await api<KitaDetail>(`/kitas/${k.id}/meldungen`, { body: { ...m, altcha } });
    qc.setQueryData(schluessel.kita(k.id), neu);
    void qc.invalidateQueries({ queryKey: ['auswahl'] });
    void qc.invalidateQueries({ queryKey: ['status'] });
    setSheet(false);
    toast('Danke! Ihre Meldung ist eingegangen.');
  }

  return (
    <div className="kita-seite">
      <div className="kita-kopf">
        <div>
          <h1>{k.name}</h1>
          <p className="kita-adresse">{adresse(k)}</p>
          {k.traeger && <p className="kita-traeger">Träger: {k.traeger}</p>}
        </div>
        <div className="kita-aktionen">
          <button type="button" className={`icon-knopf${fav ? ' aktiv' : ''}`} onClick={() => umschalten(k.id)} aria-pressed={fav} aria-label={fav ? 'Aus „Meine Kitas“ entfernen' : 'Zu „Meine Kitas“ hinzufügen'}>
            <IconStern voll={fav} />
          </button>
          <button type="button" className="icon-knopf" onClick={teilen} aria-label="Teilen">
            <IconTeilen />
          </button>
        </div>
      </div>
      {!fav && (
        <button type="button" className="knopf knopf-text stern-hinweis" onClick={() => umschalten(k.id)}>
          <IconStern /> Zu „Meine Kitas“ hinzufügen
        </button>
      )}

      <Stand aktualisiert={kita.dataUpdatedAt} daten={kita.data} fehlgeschlagen={kita.isRefetchError} />

      {heute && <HeuteKarte heute={heute} annahme={ohneMeldungAlsRegulaer} veraltet={heute.datum < heuteBerlin()} />}

      <section aria-labelledby="tage-titel">
        <h2 id="tage-titel">Nächste Tage</h2>
        <AnsichtUmschalter />
        <ul className="tage-liste">
          {weitere.map((t) => (
            <li key={t.datum} className={istWochenende(t.datum) ? 'wochenende' : ''}>
              <span className="tag">{datumRelativ(t.datum, heute?.datum ?? info.heute)}</span>
              <span className="tag-status">
                <StatusBadge s={t} annahme={ohneMeldungAlsRegulaer} />
                <StatusDetails s={t} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <details className="protokoll">
        <summary>Änderungsprotokoll ({d.protokoll.length})</summary>
        {d.protokoll.length === 0 ? (
          <p className="leer">Noch keine Änderungen.</p>
        ) : (
          <ul>
            {d.protokoll.map((p, i) => (
              <li key={i}>
                <span className="protokoll-datum">
                  Gemeldet {datumRelativ(p.erstellt_am, info.heute)} für {datumRelativ(p.datum, info.heute)}
                </span>
                <span>
                  {STATUS_LABEL[p.alt_status]} → <strong>{STATUS_LABEL[p.neu_status]}</strong>
                </span>
                {p.neu_stufe > 0 && <span className="stufe">{STUFE_LABEL[p.neu_stufe]}</span>}
              </li>
            ))}
          </ul>
        )}
      </details>

      <section className="weitere-links" aria-labelledby="mitmachen">
        <h2 id="mitmachen">Für Elternbeirat und Kita</h2>
        <ul>
          <li>
            <Link to={`/kita/${k.id}/elternbeirat`}>Wir sind der Elternbeirat – Melde-Link anfordern</Link>
          </li>
          <li>
            <Link to={`/kita/${k.id}/berichtigung`}>Sie sind die Kita? Angaben berichtigen</Link>
          </li>
          {!d.kontakt_bekannt && (
            <li>
              <Link to={`/kita/${k.id}/kontakt`}>Sie sind die Kita? Adresse hinterlegen</Link>
            </li>
          )}
        </ul>
        <p className="hinweis">Zuletzt geladen um {uhrzeitAus(kita.dataUpdatedAt)} Uhr.</p>
      </section>

      <div ref={leiste} className={`leiste-unten${statisch ? ' statisch' : ''}`}>
        <button type="button" className="knopf knopf-primaer knopf-breit" onClick={() => setSheet(true)}>
          <IconPlus /> Einschränkung melden
        </button>
      </div>

      <BottomSheet offen={sheet} onSchliessen={() => setSheet(false)} titel={`Meldung für ${k.name}`}>
        <MeldeFormular heute={aktuellesHeute(info.heute)} grenzen={info} mitPow knopfText="Meldung absenden" onSenden={melden} />
      </BottomSheet>
    </div>
  );
}

function HeuteKarte({ heute, annahme, veraltet }: { heute: TagesStatus; annahme: boolean; veraltet: boolean }) {
  const a = anzeigeFuer(heute, annahme);
  return (
    <section className={`heute-karte s-${a.status}${a.angenommen ? ' angenommen' : ''}`} aria-labelledby="heute-titel">
      {/* Alte, zwischengespeicherte Daten nie als „Heute“ bezeichnen */}
      <h2 id="heute-titel">{veraltet ? `Nicht aktuell – Stand für ${datumLang(heute.datum)}` : `Heute, ${datumLang(heute.datum).split(', ')[1]}`}</h2>
      <StatusBadge s={heute} gross annahme={annahme} />
      <StatusDetails s={heute} />
      {a.status === 'unbekannt' && <p className="hinweis">Keine Meldung heißt nicht automatisch reguläre Betreuung.</p>}
      {a.angenommen && <p className="hinweis">Es liegt keine Meldung vor – angezeigt nach Ihrer Einstellung.</p>}
    </section>
  );
}
