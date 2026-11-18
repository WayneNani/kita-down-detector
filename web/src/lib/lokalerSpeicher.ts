import { useSyncExternalStore } from 'react';

/**
 * Ein Wert im localStorage dieses Browsers – nie an den Server gesendet.
 * Eine einzige, dauerhaft registrierte Storage-Abfrage hält den Zwischenspeicher
 * auch dann aktuell, wenn gerade keine Komponente zuhört (Änderung in anderem Tab).
 */
export interface LokalerWert<T> {
  lesen(): T;
  schreiben(wert: T): void;
  useWert(): T;
  /** Nur für Tests. */
  _zuruecksetzen(): void;
}

export function lokalerWert<T>(schluessel: string, standard: T, parse: (roh: string) => T, serialisieren: (wert: T) => string | null): LokalerWert<T> {
  const zuhoerer = new Set<() => void>();
  let cache: { wert: T } | null = null;

  const lesen = (): T => {
    if (cache) return cache.wert;
    let wert = standard;
    try {
      const roh = localStorage.getItem(schluessel);
      if (roh !== null) wert = parse(roh);
    } catch {
      /* Speicher nicht verfügbar oder ungültig – Standardwert */
    }
    cache = { wert };
    return wert;
  };

  const benachrichtigen = () => zuhoerer.forEach((f) => f());

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === schluessel || e.key === null) {
        cache = null;
        benachrichtigen();
      }
    });
  }

  return {
    lesen,
    schreiben(wert: T) {
      cache = { wert };
      try {
        const roh = serialisieren(wert);
        if (roh === null) localStorage.removeItem(schluessel);
        else localStorage.setItem(schluessel, roh);
      } catch {
        /* nur für diese Sitzung */
      }
      benachrichtigen();
    },
    useWert() {
      return useSyncExternalStore(
        (f) => {
          zuhoerer.add(f);
          return () => zuhoerer.delete(f);
        },
        lesen,
        () => standard,
      );
    },
    _zuruecksetzen() {
      cache = null;
    },
  };
}
