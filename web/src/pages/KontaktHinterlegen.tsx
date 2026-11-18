import { useCallback, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { PowWidget } from '../components/PowWidget';
import { Erfolg, KitaUnterseite } from '../components/Seite';
import { FehlerBox } from '../components/Fehler';

export default function KontaktHinterlegen() {
  const [email, setEmail] = useState('');
  const [pow, setPow] = useState<string | null>(null);
  const [powNeu, setPowNeu] = useState(0);
  const [fehler, setFehler] = useState<unknown>(null);
  const [sendet, setSendet] = useState(false);
  const [fertig, setFertig] = useState(false);
  const beiPow = useCallback((p: string | null) => setPow(p), []);

  return (
    <KitaUnterseite titel="Adresse der Kita hinterlegen">
      {(d) => {
        if (fertig)
          return (
            <Erfolg titel="Vielen Dank!">
              Wir prüfen die Adresse. Danach erhalten Sie dort einen eigenen Melde-Link für Ihre Kita – damit können Sie Einschränkungen direkt
              und verifiziert melden und Angaben berichtigen.
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
            await api(`/kitas/${d.kita.id}/kontakt-vorschlaege`, { body: { email: email.trim(), altcha: pow } });
            setFertig(true);
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
              Hinterlegen Sie die <strong>allgemeine E-Mail-Adresse Ihrer Einrichtung</strong> (Funktionsadresse, z. B. kita-name@träger.de –
              keine persönliche Adresse). Sie wird nie veröffentlicht und nur genutzt für Berichtigungen, Bestätigungen von Elternbeiräten und
              Ihren eigenen Melde-Link.
            </p>
            <form className="formular" onSubmit={senden} noValidate>
              <label className="feld">
                <span>E-Mail-Adresse der Kita</span>
                <input type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <PowWidget onPayload={beiPow} neuStarten={powNeu} />
              <FehlerBox fehler={fehler} />
              <button type="submit" className="knopf knopf-primaer knopf-breit" disabled={sendet}>
                {sendet ? 'Wird gesendet …' : 'Adresse zur Prüfung senden'}
              </button>
            </form>
          </>
        );
      }}
    </KitaUnterseite>
  );
}
