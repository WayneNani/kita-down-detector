/**
 * Persönliche Melde-Links verwalten.
 *
 *   npm run link:create -- --kita 12 --rolle elternbeirat
 *   npm run link:create -- --kita 12 --rolle kita --gueltig-bis 2027-07-31
 *   npm run link:create -- --kita 12 --widerrufen [--rolle elternbeirat]
 *
 * Der Link wird nur einmal angezeigt; gespeichert wird nur sein Hash.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { LINK_ROLLE, type LinkRolle } from '../src/domain.ts';
import { istDatum } from '../src/dates.ts';
import { erstelleLink, getKita, widerrufeLinks } from '../src/service.ts';

const { values } = parseArgs({
  options: {
    kita: { type: 'string' },
    rolle: { type: 'string' },
    'gueltig-bis': { type: 'string' },
    widerrufen: { type: 'boolean', default: false },
  },
});

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const kita = getKita(db, Number(values.kita));
if (!kita) {
  console.error('Kita nicht gefunden. Aufruf: --kita <id> --rolle elternbeirat|kita');
  process.exit(1);
}
const rolle = values.rolle as LinkRolle | undefined;
if (rolle !== undefined && !LINK_ROLLE.includes(rolle)) {
  console.error('--rolle muss elternbeirat oder kita sein');
  process.exit(1);
}

if (values.widerrufen) {
  const n = widerrufeLinks(db, kita.id, rolle);
  console.log(`${n} Link(s) für „${kita.name}“ widerrufen.`);
} else {
  if (!rolle) {
    console.error('--rolle fehlt');
    process.exit(1);
  }
  const bis = values['gueltig-bis'];
  if (bis !== undefined && !istDatum(bis)) {
    console.error('--gueltig-bis muss YYYY-MM-DD sein');
    process.exit(1);
  }
  const link = erstelleLink(db, kita.id, rolle, bis);
  console.log(`Melde-Link (${rolle}) für „${kita.name}“, gültig bis ${link.gueltig_bis}:\n${cfg.baseUrl}/m/${link.token}`);
}
