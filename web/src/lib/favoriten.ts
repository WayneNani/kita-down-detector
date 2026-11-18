import { useCallback, useSyncExternalStore } from 'react';

/** „Meine Kitas“ – nur auf diesem Gerät gespeichert, nie auf dem Server. */
const SCHLUESSEL = 'kita-ausfall:favoriten';
const MAX = 20;
const zuhoerer = new Set<() => void>();
let cache: number[] | null = null;

function lesen(): number[] {
  if (cache) return cache;
  try {
    const roh: unknown = JSON.parse(localStorage.getItem(SCHLUESSEL) ?? '[]');
    cache = Array.isArray(roh) ? roh.filter((x): x is number => Number.isInteger(x) && x > 0).slice(0, MAX) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function schreiben(ids: number[]): void {
  cache = ids.slice(0, MAX);
  try {
    localStorage.setItem(SCHLUESSEL, JSON.stringify(cache));
  } catch {
    /* Speicher nicht verfügbar – bleibt nur für diese Sitzung */
  }
  zuhoerer.forEach((f) => f());
}

function abonnieren(f: () => void): () => void {
  zuhoerer.add(f);
  const beiSpeicher = (e: StorageEvent) => {
    if (e.key === SCHLUESSEL) {
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

export function useFavoriten() {
  const ids = useSyncExternalStore(abonnieren, lesen, () => []);
  const umschalten = useCallback((id: number) => {
    const aktuell = lesen();
    schreiben(aktuell.includes(id) ? aktuell.filter((x) => x !== id) : [id, ...aktuell]);
  }, []);
  return { ids, umschalten, istFavorit: (id: number) => ids.includes(id) };
}
