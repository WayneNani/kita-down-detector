import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { erstelleMailer } from './mailer.ts';
import { aufraeumen } from './service.ts';

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const app = createApp({ cfg, db, mailer: erstelleMailer(cfg) });

// Aufbewahrungsfristen täglich durchsetzen.
const raeumeAuf = () => {
  const r = aufraeumen(db, cfg);
  if (r.meldungen || r.berichtigungen || r.links) console.log('Aufgeräumt:', r);
};
raeumeAuf();
setInterval(raeumeAuf, 24 * 60 * 60 * 1000).unref();

// Bewusst kein Request-Logging: IP-Adressen sollen nirgends landen.
serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`Kita-Ausfall NRW läuft auf http://localhost:${info.port}`);
});
