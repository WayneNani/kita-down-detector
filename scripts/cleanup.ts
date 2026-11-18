/** Setzt die Aufbewahrungsfristen durch (läuft im Server auch täglich automatisch). */
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { aufraeumen } from '../src/service.ts';

const cfg = loadConfig();
console.log(aufraeumen(openDb(cfg.dbPath), cfg));
