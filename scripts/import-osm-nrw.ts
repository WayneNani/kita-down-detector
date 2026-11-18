/**
 * Importiert Kitas in NRW aus OpenStreetMap (amenity=kindergarten).
 *
 *   npm run import:osm                 # lädt live von der Overpass-API
 *   npm run import:osm -- --datei x.json   # importiert eine gespeicherte Overpass-Antwort
 *
 * Hinweis: OSM ist nicht vollständig. Später sollten offizielle Verzeichnisse
 * (Landesjugendämter LVR/LWL, Open-Data-Portale der Kommunen) ergänzt werden.
 * Die Daten stehen unter ODbL – Namensnennung „© OpenStreetMap-Mitwirkende“.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { upsertKita } from '../src/service.ts';

const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const QUERY = `
[out:json][timeout:600];
area["ISO3166-2"="DE-NW"]["admin_level"="4"]->.nrw;
nwr["amenity"="kindergarten"](area.nrw);
out center tags;
`;

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const { values } = parseArgs({ options: { datei: { type: 'string' } } });

async function laden(): Promise<{ elements: OsmElement[] }> {
  if (values.datei) return JSON.parse(readFileSync(values.datei, 'utf8'));
  console.log(`Lade Daten von ${OVERPASS_URL} … (kann einige Minuten dauern)`);
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'kita-down-detector (OSM-Import)' },
    body: new URLSearchParams({ data: QUERY }),
  });
  if (!res.ok) throw new Error(`Overpass antwortet mit ${res.status}`);
  return (await res.json()) as { elements: OsmElement[] };
}

function email(tags: Record<string, string>): string | null {
  const e = (tags['contact:email'] ?? tags.email ?? '').split(';')[0]?.trim();
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e.toLowerCase() : null;
}

const daten = await laden();
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
let n = 0;
let ohneName = 0;
db.exec('BEGIN');
for (const el of daten.elements) {
  const t = el.tags ?? {};
  if (!t.name) {
    ohneName++;
    continue;
  }
  const strasse = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null;
  upsertKita(db, {
    quelle: 'osm',
    quelle_id: `${el.type}/${el.id}`,
    name: t.name,
    traeger: t.operator ?? null,
    strasse,
    plz: t['addr:postcode'] ?? null,
    ort: t['addr:city'] ?? null,
    lat: el.lat ?? el.center?.lat ?? null,
    lon: el.lon ?? el.center?.lon ?? null,
    kontakt_email: email(t),
  });
  n++;
}
db.exec('COMMIT');
console.log(`${n} Kitas importiert, ${ohneName} Einträge ohne Namen übersprungen.`);
