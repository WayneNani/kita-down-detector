import { useTitel } from '../lib/titel';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type KitaDetail, type S } from '../api/client';
import { schluessel } from '../api/queries';
import { tokenFuerSeite } from '../lib/token';
import { FehlerBox, Laden } from '../components/Fehler';
import { adresse } from '../components/KitaListe';
import { datumKurz } from '../lib/datum';
import { GRUND_LABEL, STATUS_LABEL } from '../lib/texte';
import { useToast } from '../lib/toast';

export function zusammenfassung(m: S['MeldungInput']): string {
  const bis = m.datum_bis ?? m.datum_von;
  const zeitraum = bis === m.datum_von ? datumKurz(m.datum_von) : `${datumKurz(m.datum_von)} bis ${datumKurz(bis)}`;
  const zeiten = m.uhrzeit_von && m.uhrzeit_bis ? `, Betreuung ${m.uhrzeit_von}–${m.uhrzeit_bis} Uhr` : '';
  const grund = m.grund ? `, Grund: ${GRUND_LABEL[m.grund]}` : '';
  return `${STATUS_LABEL[m.status]} – ${zeitraum}${zeiten}${grund}`;
}

export default function BerichtigungBestaetigen() {
  useTitel('Berichtigung bestätigen');
  const [token] = useState(() => tokenFuerSeite());
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [sendet, setSendet] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);

  const q = useQuery({
    queryKey: ['berichtigung', token],
    queryFn: ({ signal }) => api<S['BerichtigungInfo']>('/berichtigung', { token: { art: 'Berichtigung', wert: token! }, signal }),
    enabled: token !== null,
    retry: false,
    gcTime: 0,
  });

  if (!token || (q.isError && q.error instanceof ApiError && q.error.status === 401))
    return (
      <div className="unterseite">
        <h1>Berichtigung bestätigen</h1>
        <div className="box box-fehler" role="alert">
          Dieser Bestätigungslink ist abgelaufen, wurde bereits verwendet oder ist unvollständig. Bitte öffnen Sie den Link direkt aus der E-Mail.
        </div>
      </div>
    );
  if (q.isPending) return <Laden />;
  if (q.isError) return <FehlerBox fehler={q.error} />;

  async function bestaetigen() {
    setSendet(true);
    setFehler(null);
    try {
      const d = await api<KitaDetail>('/berichtigung/bestaetigen', { methode: 'POST', body: {}, token: { art: 'Berichtigung', wert: token! } });
      qc.setQueryData(schluessel.kita(d.kita.id), d);
      toast('Berichtigung übernommen.');
      navigate(`/kita/${d.kita.id}`);
    } catch (e) {
      setFehler(e);
    } finally {
      setSendet(false);
    }
  }

  return (
    <div className="unterseite">
      <h1>Berichtigung bestätigen</h1>
      <p className="kita-adresse">
        <strong>{q.data.kita.name}</strong>
        <br />
        {adresse(q.data.kita)}
      </p>
      <div className="box">
        <p>Für Ihre Einrichtung wurde folgende Berichtigung angefragt:</p>
        <p>
          <strong>{zusammenfassung(q.data.meldung)}</strong>
        </p>
        <p>Nach der Bestätigung wird sie als „berichtigt durch Kita“ angezeigt und hat Vorrang vor allen anderen Meldungen.</p>
      </div>
      <FehlerBox fehler={fehler} />
      <button type="button" className="knopf knopf-primaer knopf-breit" onClick={bestaetigen} disabled={sendet}>
        {sendet ? 'Wird bestätigt …' : 'Jetzt bestätigen'}
      </button>
      <p className="hinweis">Sie haben diese Berichtigung nicht angefragt? Dann ignorieren Sie die Mail einfach – es passiert nichts.</p>
    </div>
  );
}
