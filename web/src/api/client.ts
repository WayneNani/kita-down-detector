import type { components } from './schema';

export type S = components['schemas'];
export type Status = S['Status'];
export type AngezeigterStatus = S['AngezeigterStatus'];
export type Grund = S['Grund'];
export type Stufe = S['Stufe'];
export type KitaKurz = S['KitaKurz'];
export type TagesStatus = S['TagesStatus'];
export type KitaUebersicht = S['KitaUebersicht'];
export type KitaDetail = S['KitaDetail'];
export type MeldungInput = S['MeldungInput'];
export type Info = S['Info'];

export interface FeldFehler {
  feld?: string;
  meldung: string;
}

/** Fehler der API (RFC 9457 problem+json) oder Netzwerkfehler (status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly fehler: FeldFehler[];
  constructor(status: number, title: string, detail?: string, fehler: FeldFehler[] = []) {
    super(detail || title);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail || title;
    this.fehler = fehler;
  }
}

const BASIS = '/api/v1';

export type TokenArt = 'Link' | 'Berichtigung' | 'Einladung';

export interface Optionen {
  methode?: 'GET' | 'POST';
  body?: unknown;
  token?: { art: TokenArt; wert: string };
  signal?: AbortSignal;
}

export async function api<T>(pfad: string, opt: Optionen = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opt.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opt.token) headers.Authorization = `${opt.token.art} ${opt.token.wert}`;
  let res: Response;
  try {
    res = await fetch(BASIS + pfad, {
      method: opt.methode ?? (opt.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
      credentials: 'same-origin',
      // Immer beim Server nachfragen – sonst liefert der HTTP-Cache nach einer
      // eigenen Meldung bis zu 90 s lang den alten Stand.
      cache: 'no-cache',
      signal: opt.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Keine Verbindung', 'Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung.');
  }
  const typ = res.headers.get('content-type') ?? '';
  const daten: unknown = typ.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const p = (daten ?? {}) as { title?: string; detail?: string; fehler?: FeldFehler[] };
    throw new ApiError(res.status, p.title ?? `Fehler ${res.status}`, p.detail, Array.isArray(p.fehler) ? p.fehler : []);
  }
  // Antwort kam offline aus dem Service-Worker-Cache: Zeitpunkt merken (nicht serialisiert).
  if (res.headers.get('X-Aus-Cache') && daten && typeof daten === 'object') {
    const zeit = Date.parse(res.headers.get('Date') ?? '');
    Object.defineProperty(daten, AUS_CACHE, { value: Number.isNaN(zeit) ? 0 : zeit, enumerable: false });
  }
  return daten as T;
}

const AUS_CACHE = '__ausCache';

/** Zeitpunkt der zwischengespeicherten Antwort, falls die Daten aus dem Offline-Cache stammen. */
export function ausCacheVom(daten: unknown): number | null {
  if (!daten || typeof daten !== 'object' || !(AUS_CACHE in daten)) return null;
  return (daten as Record<string, number>)[AUS_CACHE] ?? 0;
}
