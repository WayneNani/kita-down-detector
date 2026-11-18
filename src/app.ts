import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Hono, type Context } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { Mailer } from './mailer.ts';
import { ProofOfWork } from './pow.ts';
import { MelderKennung, maskiereEmail } from './privacy.ts';
import { GRUND_LABEL, STATUS_LABEL } from './domain.ts';
import { datumKurz, heute, istDatum, plusTage } from './dates.ts';
import * as svc from './service.ts';
import * as v from './views.ts';

export interface Deps {
  cfg: Config;
  db: Db;
  mailer: Mailer;
  pow?: ProofOfWork;
  melder?: MelderKennung;
  /** Liefert eine Gerätekennung (IP + User-Agent). Wird nie gespeichert. */
  geraet?: (c: Context) => string;
  jetzt?: () => Date;
}

const require = createRequire(import.meta.url);
const STATIC: Record<string, { body: string; type: string }> = {
  'altcha.js': {
    body: readFileSync(require.resolve('altcha').replace(/altcha\.umd\.cjs$/, 'altcha.i18n.min.js'), 'utf8'),
    type: 'text/javascript; charset=utf-8',
  },
  'app.js': {
    body: readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'),
    type: 'text/javascript; charset=utf-8',
  },
};

function standardGeraet(trustProxy: boolean) {
  return (c: Context): string => {
    let ip = '';
    if (trustProxy) ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
    if (!ip) {
      try {
        ip = getConnInfo(c).remote.address ?? '';
      } catch {
        ip = '';
      }
    }
    return `${ip}\n${c.req.header('user-agent') ?? ''}`;
  };
}

function zusammenfassung(m: svc.MeldungInput): string {
  const zeitraum = m.datum_von === m.datum_bis ? datumKurz(m.datum_von) : `${datumKurz(m.datum_von)} bis ${datumKurz(m.datum_bis)}`;
  const zeiten = m.uhrzeit_von && m.uhrzeit_bis ? `, Betreuung ${m.uhrzeit_von}–${m.uhrzeit_bis} Uhr` : '';
  const grund = m.grund ? `, Grund: ${GRUND_LABEL[m.grund]}` : '';
  return `${STATUS_LABEL[m.status]} – ${zeitraum}${zeiten}${grund}`;
}

function alsWerte(form: Record<string, unknown>): v.FormularWerte {
  const s = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : undefined);
  return {
    status: s('status'),
    datum_von: s('datum_von'),
    datum_bis: s('datum_bis'),
    uhrzeit_von: s('uhrzeit_von'),
    uhrzeit_bis: s('uhrzeit_bis'),
    grund: s('grund'),
  };
}

export function createApp(deps: Deps): Hono {
  const { cfg, db, mailer } = deps;
  const pow = deps.pow ?? new ProofOfWork(cfg);
  const jetzt = deps.jetzt ?? (() => new Date());
  const melder = deps.melder ?? new MelderKennung(jetzt);
  const geraet = deps.geraet ?? standardGeraet(cfg.trustProxy);

  const app = new Hono();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Das ALTCHA-Widget setzt Inline-Styles und startet Worker aus Blob-URLs.
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", 'blob:'],
        imgSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
      referrerPolicy: 'no-referrer',
      crossOriginEmbedderPolicy: false,
    }),
  );

  const kitaAusParam = (c: Context) => {
    const id = Number(c.req.param('id'));
    return Number.isInteger(id) ? svc.getKita(db, id) : undefined;
  };

  const nichtGefunden = (c: Context) => c.html(v.hinweisSeite('Nicht gefunden', 'Diese Seite gibt es nicht (mehr).', 'fehler'), 404);

  // ---------------------------------------------------------------- Öffentliche Seiten

  app.get('/', (c) => {
    const t = heute(jetzt());
    const q = (c.req.query('q') ?? '').slice(0, 100);
    let treffer: svc.KitaMitStatus[] | null = null;
    if (q.trim().length >= 2) {
      const kitas = svc.sucheKitas(db, q);
      const st = svc.statusFuerKitas(db, cfg, kitas.map((k) => k.id), t);
      treffer = kitas.map((kita) => ({ kita, status: st.get(kita.id)! }));
    }
    return c.html(v.startseite(q, treffer, svc.einschraenkungenAm(db, cfg, t), t));
  });

  const renderKita = (c: Context, kita: svc.Kita, werte: v.FormularWerte, fehler: string[], status: 200 | 400 | 429 = 200) => {
    const t = heute(jetzt());
    const verlauf = svc.statusVerlauf(db, cfg, kita.id, t, plusTage(t, 13));
    const formular = v.meldeFormular(`/kita/${kita.id}/meldung`, werte, fehler, { pow: true, knopf: 'Meldung absenden' });
    const hinweis = c.req.query('gemeldet') ? v.okBox('Danke! Ihre Meldung ist eingegangen.') : undefined;
    return c.html(v.kitaSeite(kita, verlauf, svc.protokoll(db, kita.id), formular, hinweis), status);
  };

  app.get('/kita/:id', (c) => {
    const kita = kitaAusParam(c);
    if (!kita) return nichtGefunden(c);
    return renderKita(c, kita, { datum_von: heute(jetzt()) }, []);
  });

  app.post('/kita/:id/meldung', async (c) => {
    const kita = kitaAusParam(c);
    if (!kita) return nichtGefunden(c);
    const form = await c.req.parseBody();
    const werte = alsWerte(form);
    if (!(await pow.pruefe(form.altcha))) {
      return renderKita(c, kita, werte, ['Die Sicherheitsprüfung ist fehlgeschlagen. Bitte warten Sie, bis sie abgeschlossen ist, und senden Sie erneut.'], 400);
    }
    const geprueft = svc.pruefeMeldung(form, jetzt());
    if (!geprueft.ok) return renderKita(c, kita, werte, geprueft.fehler, 400);
    const hash = melder.hash(geraet(c), kita.id);
    if (svc.meldungenHeute(db, kita.id, hash, jetzt()) >= cfg.maxMeldungenProTag) {
      return renderKita(c, kita, werte, ['Sie haben für diese Kita heute schon mehrere Meldungen abgegeben. Bitte versuchen Sie es morgen wieder.'], 429);
    }
    svc.speichereMeldung(db, cfg, kita.id, geprueft.wert, { quelle: 'anonym', melderHash: hash, jetzt: jetzt() });
    return c.redirect(`/kita/${kita.id}?gemeldet=1#melden`, 303);
  });

  app.get('/pow/challenge', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await pow.challenge());
  });

  app.get('/datenschutz', (c) => c.html(v.datenschutzSeite(cfg.kontaktEmail, cfg.bestaetigungsSchwelle, cfg.aufbewahrungTage)));

  // ---------------------------------------------------------------- Persönliche Melde-Links

  const renderLink = (c: Context, link: svc.Link, kita: svc.Kita, werte: v.FormularWerte, fehler: string[], hinweis?: ReturnType<typeof v.okBox>) => {
    const formular = v.meldeFormular(`/m/${c.req.param('token')}`, werte, fehler, { pow: false, knopf: 'Verifizierte Meldung absenden' });
    return c.html(v.linkSeite(kita, link.rolle, formular, hinweis), fehler.length ? 400 : 200);
  };

  app.get('/m/:token', (c) => {
    c.header('Cache-Control', 'no-store');
    const link = svc.findeLink(db, c.req.param('token'), jetzt());
    const kita = link && svc.getKita(db, link.kita_id);
    if (!link || !kita) return c.html(v.hinweisSeite('Link ungültig', 'Dieser Melde-Link ist abgelaufen oder wurde widerrufen.', 'fehler'), 404);
    const hinweis = c.req.query('gemeldet') ? v.okBox('Danke! Die Meldung ist gespeichert und wird als verifiziert angezeigt.') : undefined;
    return renderLink(c, link, kita, { datum_von: heute(jetzt()) }, [], hinweis);
  });

  app.post('/m/:token', async (c) => {
    const token = c.req.param('token');
    const link = svc.findeLink(db, token, jetzt());
    const kita = link && svc.getKita(db, link.kita_id);
    if (!link || !kita) return c.html(v.hinweisSeite('Link ungültig', 'Dieser Melde-Link ist abgelaufen oder wurde widerrufen.', 'fehler'), 404);
    const form = await c.req.parseBody();
    const geprueft = svc.pruefeMeldung(form, jetzt());
    if (!geprueft.ok) return renderLink(c, link, kita, alsWerte(form), geprueft.fehler);
    svc.speichereMeldung(db, cfg, kita.id, geprueft.wert, { quelle: link.rolle, linkId: link.id, jetzt: jetzt() });
    return c.redirect(`/m/${token}?gemeldet=1`, 303);
  });

  // ---------------------------------------------------------------- Berichtigung durch die Kita

  const MAX_BERICHTIGUNGEN_PRO_TAG = 3;

  const renderBerichtigung = (c: Context, kita: svc.Kita, werte: v.FormularWerte, fehler: string[], status: 200 | 400 | 429 = 200) => {
    const formular = kita.kontakt_email
      ? v.meldeFormular(`/kita/${kita.id}/berichtigung`, werte, fehler, { pow: true, knopf: 'Bestätigungslink anfordern' })
      : null;
    return c.html(v.berichtigungSeite(kita, formular, cfg.kontaktEmail), status);
  };

  app.get('/kita/:id/berichtigung', (c) => {
    const kita = kitaAusParam(c);
    if (!kita) return nichtGefunden(c);
    return renderBerichtigung(c, kita, { datum_von: heute(jetzt()) }, []);
  });

  app.post('/kita/:id/berichtigung', async (c) => {
    const kita = kitaAusParam(c);
    if (!kita) return nichtGefunden(c);
    if (!kita.kontakt_email) return renderBerichtigung(c, kita, {}, [], 400);
    const form = await c.req.parseBody();
    const werte = alsWerte(form);
    if (!(await pow.pruefe(form.altcha))) {
      return renderBerichtigung(c, kita, werte, ['Die Sicherheitsprüfung ist fehlgeschlagen. Bitte erneut versuchen.'], 400);
    }
    const geprueft = svc.pruefeMeldung(form, jetzt());
    if (!geprueft.ok) return renderBerichtigung(c, kita, werte, geprueft.fehler, 400);
    const heuteAngefragt = db
      .prepare('SELECT COUNT(*) AS n FROM berichtigungen WHERE kita_id = ? AND erstellt_am = ?')
      .get(kita.id, heute(jetzt())) as { n: number };
    if (heuteAngefragt.n >= MAX_BERICHTIGUNGEN_PRO_TAG) {
      return renderBerichtigung(c, kita, werte, ['Für diese Kita wurden heute bereits mehrere Berichtigungen angefragt. Bitte nutzen Sie die zuletzt gesendete Mail.'], 429);
    }
    const token = svc.erstelleBerichtigung(db, kita.id, geprueft.wert, jetzt());
    await mailer.senden({
      an: kita.kontakt_email,
      betreff: `Bitte bestätigen: Berichtigung für ${kita.name}`,
      text: [
        'Guten Tag,',
        '',
        `für Ihre Einrichtung „${kita.name}“ wurde auf Kita-Ausfall NRW folgende Berichtigung angefragt:`,
        '',
        `  ${zusammenfassung(geprueft.wert)}`,
        '',
        `Wenn diese Angabe stimmt, bestätigen Sie sie bitte innerhalb von ${svc.BERICHTIGUNG_GUELTIG_TAGE} Tagen hier:`,
        `${cfg.baseUrl}/berichtigung/${token}`,
        '',
        'Wenn Sie die Anfrage nicht gestellt haben, ignorieren Sie diese Mail einfach.',
        `Gern richten wir Ihnen auch einen dauerhaften Melde-Link ein – antworten Sie dazu an ${cfg.kontaktEmail}.`,
      ].join('\n'),
    });
    return c.html(
      v.hinweisSeite(
        'Bestätigungslink gesendet',
        `Wir haben einen Bestätigungslink an die öffentliche Adresse der Einrichtung (${maskiereEmail(kita.kontakt_email)}) gesendet. Die Berichtigung wird nach der Bestätigung übernommen.`,
      ),
    );
  });

  app.get('/berichtigung/:token', (c) => {
    c.header('Cache-Control', 'no-store');
    const token = c.req.param('token');
    const b = svc.findeBerichtigung(db, token, jetzt());
    const kita = b && svc.getKita(db, b.kita_id);
    if (!b || !kita) return c.html(v.hinweisSeite('Link ungültig', 'Dieser Bestätigungslink ist abgelaufen oder wurde bereits verwendet.', 'fehler'), 404);
    // Bestätigung erst per Klick (POST), damit Link-Scanner in Mailprogrammen nichts auslösen.
    return c.html(v.bestaetigungSeite(kita, zusammenfassung(b), token));
  });

  app.post('/berichtigung/:token', (c) => {
    const b = svc.findeBerichtigung(db, c.req.param('token'), jetzt());
    const kita = b && svc.getKita(db, b.kita_id);
    if (!b || !kita) return c.html(v.hinweisSeite('Link ungültig', 'Dieser Bestätigungslink ist abgelaufen oder wurde bereits verwendet.', 'fehler'), 404);
    svc.bestaetigeBerichtigung(db, cfg, b, jetzt());
    return c.redirect(`/kita/${kita.id}`, 303);
  });

  // ---------------------------------------------------------------- Offene Daten (nur aggregiert)

  app.get('/api/v1/status', (c) => {
    const datum = c.req.query('datum') ?? heute(jetzt());
    if (!istDatum(datum)) return c.json({ fehler: 'datum muss YYYY-MM-DD sein' }, 400);
    return c.json({
      datum,
      hinweis: 'Nur Kitas mit gemeldeter Einschränkung. Fehlende Kitas bedeuten „keine Meldung“, nicht „regulär“.',
      kitas: svc.einschraenkungenAm(db, cfg, datum).map(({ kita, status }) => ({
        id: kita.id,
        name: kita.name,
        plz: kita.plz,
        ort: kita.ort,
        status: status.status,
        stufe: status.stufe,
        uhrzeit_von: status.uhrzeit_von,
        uhrzeit_bis: status.uhrzeit_bis,
        grund: status.grund,
      })),
    });
  });

  app.get('/api/v1/kitas/:id', (c) => {
    const kita = kitaAusParam(c);
    if (!kita) return c.json({ fehler: 'nicht gefunden' }, 404);
    const t = heute(jetzt());
    const { kontakt_email: _ignoriert, ...oeffentlich } = kita;
    return c.json({ kita: oeffentlich, tage: svc.statusVerlauf(db, cfg, kita.id, t, plusTage(t, 13)) });
  });

  // ---------------------------------------------------------------- Statische Dateien

  app.get('/static/:datei', (c) => {
    const f = STATIC[c.req.param('datei')];
    if (!f) return c.notFound();
    c.header('Content-Type', f.type);
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(f.body);
  });

  app.notFound(nichtGefunden);

  return app;
}
