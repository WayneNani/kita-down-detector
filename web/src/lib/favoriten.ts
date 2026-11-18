import { useCallback } from 'react';
import { lokalerWert } from './lokalerSpeicher';

/** „Meine Kitas“ – nur auf diesem Gerät gespeichert, nie auf dem Server. */
const MAX = 20;

const favoriten = lokalerWert<number[]>(
  'kita-ausfall:favoriten',
  [],
  (roh) => {
    const x: unknown = JSON.parse(roh);
    return Array.isArray(x) ? x.filter((v): v is number => Number.isInteger(v) && v > 0).slice(0, MAX) : [];
  },
  (ids) => JSON.stringify(ids.slice(0, MAX)),
);

export function useFavoriten() {
  const ids = favoriten.useWert();
  const umschalten = useCallback((id: number) => {
    const aktuell = favoriten.lesen();
    favoriten.schreiben(aktuell.includes(id) ? aktuell.filter((x) => x !== id) : [id, ...aktuell].slice(0, MAX));
  }, []);
  return { ids, umschalten, istFavorit: (id: number) => ids.includes(id) };
}
