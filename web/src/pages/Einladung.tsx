import { useTitel } from '../lib/titel';
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type S } from '../api/client';
import { tokenFuerSeite } from '../lib/token';
import { FehlerBox, Laden } from '../components/Fehler';
import { adresse } from '../components/KitaListe';
import { Erfolg } from '../components/Seite';

export default function Einladung() {
  useTitel('Elternbeirat bestätigen');
  const [token] = useState(() => tokenFuerSeite());
  const [kitaLink, setKitaLink] = useState(true);
  const [sendet, setSendet] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);
  const [fertig, setFertig] = useState(false);

  const q = useQuery({
    queryKey: ['einladung', token],
    queryFn: ({ signal }) => api<S['EinladungInfo']>('/einladung', { token: { art: 'Einladung', wert: token! }, signal }),
    enabled: token !== null,
    retry: false,
    gcTime: 0,
  });

  if (!token || (q.isError && q.error instanceof ApiError && q.error.status === 401))
    return (
      <div className="unterseite">
        <h1>Elternbeirat bestätigen</h1>
        <div className="box box-fehler" role="alert">
          Dieser Link ist abgelaufen, wurde bereits verwendet oder ist unvollständig. Bitte öffnen Sie den Link direkt aus der E-Mail.
        </div>
      </div>
    );
  if (q.isPending) return <Laden />;
  if (q.isError) return <FehlerBox fehler={q.error} />;
  const k = q.data.kita;

  if (fertig)
    return (
      <div className="unterseite">
        <h1>Vielen Dank!</h1>
        <Erfolg titel="Bestätigt">
          Der Elternbeirat erhält jetzt seinen Melde-Link per Mail.
          {kitaLink && ' Ihr eigener Melde-Link für die Kita geht an Ihre Adresse.'}
        </Erfolg>
        <p>
          <Link to={`/kita/${k.id}`}>Zur Seite Ihrer Kita</Link>
        </p>
      </div>
    );

  async function bestaetigen() {
    setSendet(true);
    setFehler(null);
    try {
      await api('/einladung/bestaetigen', { body: { kita_link: kitaLink }, token: { art: 'Einladung', wert: token! } });
      setFertig(true);
    } catch (e) {
      setFehler(e);
    } finally {
      setSendet(false);
    }
  }

  return (
    <div className="unterseite">
      <h1>Ist das Ihr Elternbeirat?</h1>
      <p className="kita-adresse">
        <strong>{k.name}</strong>
        <br />
        {adresse(k)}
      </p>
      <div className="box">
        <p>
          Jemand hat für Ihre Kita einen Melde-Link als <strong>Elternbeirat</strong> angefordert. Meldungen über diesen Link werden auf Kita-Ausfall
          NRW als „verifiziert durch Elternbeirat“ angezeigt.
        </p>
        <p>Bitte bestätigen Sie nur, wenn die Anfrage tatsächlich von Ihrem Elternbeirat kommt (zum Beispiel nach Rücksprache).</p>
      </div>
      <label className="check">
        <input type="checkbox" checked={kitaLink} onChange={(e) => setKitaLink(e.target.checked)} />
        <span>
          Auch für unsere Kita einen eigenen Melde-Link senden
          <small>Damit können Sie Einschränkungen selbst melden – angezeigt als „verifiziert durch Kita“.</small>
        </span>
      </label>
      <FehlerBox fehler={fehler} />
      <button type="button" className="knopf knopf-primaer knopf-breit" onClick={bestaetigen} disabled={sendet}>
        {sendet ? 'Wird bestätigt …' : 'Ja, das ist unser Elternbeirat'}
      </button>
      <p className="hinweis">Nicht Ihr Elternbeirat? Dann ignorieren Sie die Mail einfach – es wird kein Link vergeben.</p>
    </div>
  );
}
