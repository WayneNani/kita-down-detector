import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type MeldungInput, type S } from '../api/client';
import { useInfo, aktuellesHeute } from '../api/queries';
import { MeldeFormular } from '../components/MeldeFormular';
import { Erfolg, KitaUnterseite } from '../components/Seite';

export default function BerichtigungAnfragen() {
  const { info } = useInfo();
  const [gesendetAn, setGesendetAn] = useState<string | null>(null);
  const [ohneKontakt, setOhneKontakt] = useState(false);

  return (
    <KitaUnterseite titel="Angaben berichtigen">
      {(d) => {
        if (gesendetAn)
          return (
            <Erfolg titel="Bestätigungslink gesendet">
              Wir haben einen Link an die hinterlegte Adresse der Einrichtung ({gesendetAn}) gesendet. Die Berichtigung wird übernommen, sobald
              sie dort bestätigt wird.
            </Erfolg>
          );
        if (!d.kontakt_bekannt || ohneKontakt)
          return (
            <div className="box">
              <p>Für diese Kita ist noch keine Adresse hinterlegt, an die wir einen Bestätigungslink senden können.</p>
              <p>
                <Link to={`/kita/${d.kita.id}/kontakt`}>Jetzt die allgemeine Adresse der Kita hinterlegen</Link> – nach Prüfung erhalten Sie
                einen eigenen Melde-Link.
              </p>
            </div>
          );
        async function senden(m: MeldungInput, altcha: string | null) {
          try {
            const r = await api<S['Gesendet']>(`/kitas/${d.kita.id}/berichtigungen`, { body: { ...m, altcha } });
            setGesendetAn(r.gesendet_an);
          } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
              setOhneKontakt(true);
              return;
            }
            throw e;
          }
        }
        return (
          <>
            <p>
              Tragen Sie ein, was tatsächlich gilt. Wir senden einen Bestätigungslink an die <strong>hinterlegte Adresse der Einrichtung</strong>.
              Erst nach Bestätigung wird die Angabe übernommen und als „berichtigt durch Kita“ angezeigt. Sie hat Vorrang vor allen anderen
              Meldungen.
            </p>
            <MeldeFormular heute={aktuellesHeute(info.heute)} grenzen={info} mitPow knopfText="Bestätigungslink anfordern" onSenden={senden} />
          </>
        );
      }}
    </KitaUnterseite>
  );
}
