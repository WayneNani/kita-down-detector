import { useCallback, useSyncExternalStore } from 'react';

/**
 * Ansichts-Einstellungen – nur auf diesem Gerät gespeichert, nie an den Server
 * gesendet. Sie ändern ausschließlich die Darstellung, nicht die Daten.
 */
const OHNE_MELDUNG_REGULAER = 'kita-ausfall:ohne-meldung-als-regulaer';

const zuhoerer = new Set<() => void>();
let cache: boolean | null = null;

function lesen(): boolean {
  if (cache !== null) return cache;
  try {
    cache = localStorage.getItem(OHNE_MELDUNG_REGULAER) === '1';
  } catch {
    cache = false;
  }
  return cache;
}

function schreiben(wert: boolean): void {
  cache = wert;
  try {
    if (wert) localStorage.setItem(OHNE_MELDUNG_REGULAER, '1');
    else localStorage.removeItem(OHNE_MELDUNG_REGULAER);
  } catch {
    /* Speicher nicht verfügbar – gilt nur für diese Sitzung */
  }
  zuhoerer.forEach((f) => f());
}

function abonnieren(f: () => void): () => void {
  zuhoerer.add(f);
  const beiSpeicher = (e: StorageEvent) => {
    if (e.key === OHNE_MELDUNG_REGULAER || e.key === null) {
      cache = null;
      f();
    }
  };
  window.addEventListener('storage', beiSpeicher);
  return () => {
    zuhoerer.delete(f);
    window.removeEventListener('storage', beiSpeicher);
  };
}

/** Tage ohne Meldung als „vermutlich regulär“ anzeigen? Standard: nein. */
export function useOhneMeldungAlsRegulaer(): [boolean, (wert: boolean) => void] {
  const wert = useSyncExternalStore(abonnieren, lesen, () => false);
  const setzen = useCallback((w: boolean) => schreiben(w), []);
  return [wert, setzen];
}

/** Nur für Tests. */
export function _zuruecksetzen(): void {
  cache = null;
}
