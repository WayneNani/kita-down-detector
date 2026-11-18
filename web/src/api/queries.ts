import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Info, type KitaDetail, type KitaUebersicht, type S } from './client';
import { startDatenFuerKita } from '../lib/appData';
import { STANDARD_GRENZEN } from '../lib/meldung';
import { heuteBerlin } from '../lib/datum';

export const schluessel = {
  info: ['info'] as const,
  kita: (id: number) => ['kita', id] as const,
  auswahl: (ids: number[]) => ['auswahl', ids.join(',')] as const,
  suche: (q: string) => ['suche', q] as const,
  nahe: (lat: number, lon: number) => ['nahe', lat, lon] as const,
  status: (ort: string) => ['status', ort] as const,
};

const STANDARD_INFO: Info = {
  ...STANDARD_GRENZEN,
  bestaetigungs_schwelle: 2,
  aufbewahrung_tage: 180,
  kontakt_email: '',
  heute: heuteBerlin(),
};

export function useInfo() {
  const q = useQuery({
    queryKey: schluessel.info,
    queryFn: ({ signal }) => api<Info>('/info', { signal }),
    staleTime: 60 * 60_000,
  });
  return { ...q, info: q.data ?? STANDARD_INFO };
}

export function useKita(id: number) {
  return useQuery({
    queryKey: schluessel.kita(id),
    queryFn: ({ signal }) => api<KitaDetail>(`/kitas/${id}`, { signal }),
    initialData: () => startDatenFuerKita(id),
    initialDataUpdatedAt: () => Date.now(),
    staleTime: 30_000,
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useAuswahl(ids: number[]) {
  return useQuery({
    queryKey: schluessel.auswahl(ids),
    queryFn: ({ signal }) => api<S['KitaListe']>(`/kitas/auswahl?ids=${ids.join(',')}`, { signal }),
    enabled: ids.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useSuche(q: string) {
  const begriff = q.trim();
  return useQuery({
    queryKey: schluessel.suche(begriff),
    queryFn: ({ signal }) => api<S['KitaListe']>(`/kitas?q=${encodeURIComponent(begriff)}`, { signal }),
    enabled: begriff.length >= 2,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useNahe(pos: { lat: number; lon: number } | null) {
  return useQuery({
    queryKey: pos ? schluessel.nahe(pos.lat, pos.lon) : ['nahe', 'aus'],
    queryFn: ({ signal }) => api<S['KitaListe']>(`/kitas/nahe?lat=${pos!.lat}&lon=${pos!.lon}`, { signal }),
    enabled: pos !== null,
    staleTime: 60_000,
  });
}

export function useEinschraenkungen(ort: string) {
  return useQuery({
    queryKey: schluessel.status(ort),
    queryFn: ({ signal }) =>
      api<S['Einschraenkungen']>(`/status${ort ? `?ort=${encodeURIComponent(ort)}` : ''}`, { signal }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export type { KitaUebersicht };
