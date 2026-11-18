import { useEffect, useRef, useState } from 'react';
import type {} from 'altcha/types/react';

type Widget = HTMLElement & { reset?: () => void; verify?: () => void; getState?: () => string };

const KONFIG = JSON.stringify({ hideLogo: true, hideFooter: true, humanInteractionSignature: false });

/**
 * Proof-of-Work statt Captcha (ALTCHA, selbst gehostet). Startet sofort beim
 * Anzeigen und rechnet, während das Formular ausgefüllt wird.
 * `neuStarten` hochzählen, um nach einem Absenden eine neue Prüfung zu starten
 * (jede Lösung ist nur einmal gültig).
 */
export function PowWidget({ onPayload, neuStarten = 0 }: { onPayload: (p: string | null) => void; neuStarten?: number }) {
  const ref = useRef<Widget>(null);
  const [bereit, setBereit] = useState(false);
  const [ladefehler, setLadefehler] = useState(false);
  const cb = useRef(onPayload);
  cb.current = onPayload;

  useEffect(() => {
    let aktiv = true;
    import('../lib/altcha-setup')
      .then(() => aktiv && setBereit(true))
      .catch(() => aktiv && setLadefehler(true));
    return () => {
      aktiv = false;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!bereit || !el) return;
    const beiAenderung = (e: Event) => {
      const d = (e as CustomEvent<{ state?: string; payload?: string }>).detail ?? {};
      cb.current(d.state === 'verified' && d.payload ? d.payload : null);
      // Challenges gelten 10 Minuten. Wer zwischendurch abgelenkt war, soll nicht hängen bleiben.
      if (d.state === 'expired') setTimeout(() => el.verify?.(), 0);
    };
    const beiVerifiziert = (e: Event) => {
      const d = (e as CustomEvent<{ payload?: string }>).detail ?? {};
      if (d.payload) cb.current(d.payload);
    };
    el.addEventListener('statechange', beiAenderung);
    el.addEventListener('verified', beiVerifiziert);
    return () => {
      el.removeEventListener('statechange', beiAenderung);
      el.removeEventListener('verified', beiVerifiziert);
    };
  }, [bereit]);

  useEffect(() => {
    if (neuStarten === 0) return;
    const el = ref.current;
    cb.current(null);
    el?.reset?.();
    el?.verify?.();
  }, [neuStarten]);

  if (ladefehler) return <p className="hinweis fehler-text">Die Sicherheitsprüfung konnte nicht geladen werden. Bitte Seite neu laden.</p>;
  return (
    <div className="pow">
      {bereit ? (
        <altcha-widget ref={ref} challenge="/api/v1/pow/challenge" language="de" auto="onload" name="altcha" configuration={KONFIG} />
      ) : (
        <p className="hinweis">Sicherheitsprüfung wird geladen …</p>
      )}
      <p className="hinweis">Statt eines Captchas rechnet Ihr Gerät kurz eine Aufgabe. Keine Cookies, kein Tracking.</p>
    </div>
  );
}
