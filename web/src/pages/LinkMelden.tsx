import { useTitel } from '../lib/titel';
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type KitaDetail, type MeldungInput, type S } from '../api/client';
import { schluessel, useInfo } from '../api/queries';
import { gemerkterLink, merkeLink, tokenFuerSeite } from '../lib/token';
import { MeldeFormular } from '../components/MeldeFormular';
import { FehlerBox, Laden } from '../components/Fehler';
import { StatusBadge, StatusDetails } from '../components/Status';
import { adresse } from '../components/KitaListe';
import { useToast } from '../lib/toast';
import { datumRelativ } from '../lib/datum';

export default function LinkMelden() {
  useTitel('Verifiziert melden');
  const [token, setToken] = useState<string | null>(() => tokenFuerSeite() ?? gemerkterLink());
  const [gemerkt, setGemerkt] = useState<boolean>(() => token !== null && gemerkterLink() === token);
  const { info } = useInfo();
  const qc = useQueryClient();
  const toast = useToast();
  const [letzte, setLetzte] = useState<KitaDetail | null>(null);

  const link = useQuery({
    queryKey: ['link', token],
    queryFn: ({ signal }) => api<S['LinkInfo']>('/link', { token: { art: 'Link', wert: token! }, signal }),
    enabled: token !== null,
    retry: false,
    gcTime: 0,
  });

  if (!token)
    return (
      <div className="unterseite">
        <h1>Melde-Link</h1>
        <div className="box">
          <p>Bitte öffnen Sie den persönlichen Link aus Ihrer E-Mail. Er sieht so aus: …/m#abc123…</p>
          <p>
            Noch keinen Link? Auf der Seite Ihrer Kita unter „Wir sind der Elternbeirat“ können Sie einen anfordern. <Link to="/">Kita suchen</Link>
          </p>
        </div>
      </div>
    );
  if (link.isPending) return <Laden />;
  if (link.isError) {
    const abgelaufen = link.error instanceof ApiError && link.error.status === 401;
    return (
      <div className="unterseite">
        <h1>Melde-Link</h1>
        {abgelaufen ? (
          <div className="box box-fehler" role="alert">
            <strong>Dieser Link ist abgelaufen oder wurde widerrufen.</strong>
            <p>Links gelten bis zum Ende des Kita-Jahres (31. Juli). Fordern Sie auf der Seite Ihrer Kita einen neuen an.</p>
          </div>
        ) : (
          <FehlerBox fehler={link.error} />
        )}
        {gemerkt && (
          <button
            type="button"
            className="knopf knopf-sekundaer"
            onClick={() => {
              merkeLink(null);
              setGemerkt(false);
              setToken(null);
            }}
          >
            Gemerkten Link von diesem Gerät löschen
          </button>
        )}
      </div>
    );
  }

  const l = link.data;
  const rolle = l.rolle === 'kita' ? 'die Kita' : 'den Elternbeirat';

  async function melden(m: MeldungInput) {
    const neu = await api<KitaDetail>('/link/meldungen', { body: m, token: { art: 'Link', wert: token! } });
    qc.setQueryData(schluessel.kita(neu.kita.id), neu);
    setLetzte(neu);
    toast('Danke! Die Meldung ist gespeichert und wird als verifiziert angezeigt.');
  }

  return (
    <div className="unterseite">
      <h1>{l.kita.name}</h1>
      <p className="kita-adresse">{adresse(l.kita)}</p>
      <div className="box">
        Persönlicher Melde-Link für <strong>{rolle}</strong>, gültig bis {l.gueltig_bis.split('-').reverse().join('.')}. Meldungen über diesen
        Link werden als verifiziert angezeigt. Bitte nicht weitergeben.
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={gemerkt}
          onChange={(e) => {
            merkeLink(e.target.checked ? token : null);
            setGemerkt(e.target.checked);
          }}
        />
        <span>
          Auf diesem Gerät merken
          <small>Dann reicht es, die Seite …/m zu öffnen. Jederzeit wieder abwählbar.</small>
        </span>
      </label>

      {letzte && (
        <section className="kurz-status" aria-label="Aktueller Status">
          {letzte.tage.slice(0, 3).map((t) => (
            <p key={t.datum}>
              <span className="tag-label">{datumRelativ(t.datum, info.heute)}</span> <StatusBadge s={t} /> <StatusDetails s={t} />
            </p>
          ))}
          <Link to={`/kita/${letzte.kita.id}`}>Zur Seite der Kita</Link>
        </section>
      )}

      <h2>Einschränkung melden</h2>
      <MeldeFormular heute={info.heute} grenzen={info} mitPow={false} knopfText="Verifizierte Meldung absenden" onSenden={melden} />
    </div>
  );
}
