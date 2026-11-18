/**
 * Legt einige erfundene Test-Kitas an (Quelle „testdaten“), damit sich die
 * Anwendung ohne OSM-Import ausprobieren lässt.
 */
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { upsertKita } from '../src/service.ts';

const TESTKITAS = [
  { name: 'Testkita Sonnenblume', strasse: 'Teststraße 1', plz: '40210', ort: 'Düsseldorf', traeger: 'Stadt Düsseldorf (Testdaten)', kontakt_email: 'sonnenblume@kita.example' },
  { name: 'Testkita Regenbogen', strasse: 'Beispielweg 5', plz: '50667', ort: 'Köln', traeger: 'Freier Träger (Testdaten)', kontakt_email: 'regenbogen@kita.example' },
  { name: 'Testkita Löwenzahn', strasse: 'Musterallee 12', plz: '44135', ort: 'Dortmund', traeger: 'Elterninitiative (Testdaten)', kontakt_email: null },
  { name: 'Testkita Pusteblume', strasse: 'Probegasse 3', plz: '48143', ort: 'Münster', traeger: 'Kirchengemeinde (Testdaten)', kontakt_email: 'pusteblume@kita.example' },
  { name: 'Testkita Wirbelwind', strasse: 'Teststraße 99', plz: '45127', ort: 'Essen', traeger: 'Stadt Essen (Testdaten)', kontakt_email: 'wirbelwind@kita.example' },
  { name: 'Testkita Kleine Strolche', strasse: 'Beispielplatz 7', plz: '33602', ort: 'Bielefeld', traeger: 'Freier Träger (Testdaten)', kontakt_email: null },
];

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
TESTKITAS.forEach((k, i) => upsertKita(db, { quelle: 'testdaten', quelle_id: String(i + 1), ...k }));
console.log(`${TESTKITAS.length} Test-Kitas in ${cfg.dbPath} angelegt.`);
