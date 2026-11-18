import { useCallback, useState, type FormEvent } from 'react';
import { api, ApiError, type S } from '../api/client';
import { PowWidget } from '../components/PowWidget';
import { Erfolg, KitaUnterseite } from '../components/Seite';
import { FehlerBox } from '../components/Fehler';

export default function Elternbeirat() {
  const [email, setEmail] = useState('');
  const [kitaEmail, setKitaEmail] = useState('');
  const [pow, setPow] = useState<string | null>(null);
  const [powNeu, setPowNeu] = useState(0);
  const [fehler, setFehler] = useState<unknown>(null);
  const [sendet, setSendet] = useState(false);
  const [ergebnis, setErgebnis] = useState<S['EinladungAntwort'] | null>(null);
  const beiPow = useCallback((p: string | null) => setPow(p), []);

  return (
    <KitaUnterseite titel="Melde-Link für den Elternbeirat">
      {(d) => {
        if (ergebnis?.status === 'gesendet')
          return (
            <Erfolg titel="Anfrage an die Kita gesendet">
              Die Kita ({ergebnis.gesendet_an}) bekommt eine Mail und bestätigt, dass Sie zum Elternbeirat gehören. Danach erhalten Sie Ihren
              Melde-Link per Mail. Ihre Adresse löschen wir, sobald der Link verschickt ist.
            </Erfolg>
          );
        if (ergebnis?.status === 'pruefung')
          return (
            <Erfolg titel="Anfrage eingegangen">
              Wir prüfen die angegebene Kita-Adresse. Danach geht die Bestätigungsanfrage an die Kita und anschließend Ihr Melde-Link an Sie.
            </Erfolg>
          );
        async function senden(e: FormEvent) {
          e.preventDefault();
          setFehler(null);
          if (!pow) {
            setFehler(new Error('Die Sicherheitsprüfung läuft noch – bitte einen Moment warten.'));
            return;
          }
          setSendet(true);
          try {
            const body: S['EinladungAnfrage'] = { email: email.trim(), altcha: pow };
            if (!d.kontakt_bekannt) body.kita_email = kitaEmail.trim() || null;
            setErgebnis(await api<S['EinladungAntwort']>(`/kitas/${d.kita.id}/einladungen`, { body }));
          } catch (err) {
            setFehler(err instanceof ApiError ? err : new Error('Unerwarteter Fehler.'));
            setPowNeu((n) => n + 1);
          } finally {
            setSendet(false);
          }
        }
        return (
          <>
            <p>
              Mit dem Melde-Link werden Ihre Meldungen als <strong>„verifiziert durch Elternbeirat“</strong> angezeigt. Weil nur die Kita weiß,
              wer zum Elternbeirat gehört, bestätigt sie Ihre Anfrage per Mail.
            </p>
            <form className="formular" onSubmit={senden} noValidate>
              <label className="feld">
                <span>Ihre E-Mail-Adresse (für den Link)</span>
                <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                <small>Wird nur bis zum Versand des Links gespeichert.</small>
              </label>
              {!d.kontakt_bekannt && (
                <label className="feld">
                  <span>Allgemeine E-Mail-Adresse der Kita</span>
                  <input type="email" inputMode="email" required value={kitaEmail} onChange={(e) => setKitaEmail(e.target.value)} />
                  <small>
                    Für diese Kita ist noch keine Adresse hinterlegt. Bitte die Funktionsadresse der Einrichtung (z. B. kita-name@träger.de), keine
                    persönliche Adresse. Wir prüfen sie, bevor wir dorthin schreiben.
                  </small>
                </label>
              )}
              <PowWidget onPayload={beiPow} neuStarten={powNeu} />
              <FehlerBox fehler={fehler} />
              <button type="submit" className="knopf knopf-primaer knopf-breit" disabled={sendet}>
                {sendet ? 'Wird gesendet …' : 'Melde-Link anfordern'}
              </button>
            </form>
          </>
        );
      }}
    </KitaUnterseite>
  );
}
