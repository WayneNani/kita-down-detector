import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { GRUND, GRUND_LABEL, STATUS, STATUS_LABEL, STUFE_LABEL, type Stufe } from './domain.ts';
import { datumKurz, istWochenende } from './dates.ts';
import type { Kita, KitaMitStatus, ProtokollEintrag } from './service.ts';
import type { TagesStatus } from './status.ts';

type H = HtmlEscapedString | Promise<HtmlEscapedString>;

const CSS = `
:root{--bg:#fafaf7;--fg:#1d1d1b;--muted:#5d5d58;--card:#fff;--line:#e3e2dc;--accent:#2457a6;
--s-unbekannt:#8a8a84;--s-regulaer:#2e7d32;--s-verkuerzt:#a86a00;--s-notbetreuung:#c2410c;--s-geschlossen:#b91c1c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#a3a29b;--card:#1f1f1d;--line:#34332f;--accent:#8db4ff;
--s-unbekannt:#8a8a84;--s-regulaer:#66bb6a;--s-verkuerzt:#e0a030;--s-notbetreuung:#fb8a4c;--s-geschlossen:#f87171;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main,header .inner,footer .inner{max-width:52rem;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line);background:var(--card)}header .inner{display:flex;gap:1rem;align-items:baseline;padding-block:.75rem}
header a.logo{font-weight:700;color:var(--fg);text-decoration:none}header small{color:var(--muted)}
a{color:var(--accent)}h1{font-size:1.6rem;margin:1.5rem 0 .5rem}h2{font-size:1.2rem;margin:2rem 0 .5rem}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem;margin:1rem 0}
.badge{display:inline-flex;align-items:center;gap:.4em;font-weight:600;white-space:nowrap}
.badge::before{content:"";width:.7em;height:.7em;border-radius:50%;background:var(--c)}
.s-unbekannt{--c:var(--s-unbekannt)}.s-regulaer{--c:var(--s-regulaer)}.s-verkuerzt{--c:var(--s-verkuerzt)}
.s-notbetreuung{--c:var(--s-notbetreuung)}.s-geschlossen{--c:var(--s-geschlossen)}
.s-unbekannt.badge{font-weight:400;color:var(--muted)}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:.45rem .3rem;border-bottom:1px solid var(--line);vertical-align:top}
tr.we td{color:var(--muted)}td:first-child{white-space:nowrap}.stufe{font-size:.85rem;color:var(--muted)}
ul.liste{list-style:none;padding:0;margin:0}ul.liste li{padding:.6rem 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}
form.suche{display:flex;gap:.5rem}input,select,button{font:inherit}
input[type=search],input[type=date],input[type=time],select{padding:.5rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);max-width:100%}
input[type=search]{flex:1;min-width:0}
button{padding:.55rem 1rem;border:0;border-radius:6px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
@media (prefers-color-scheme:dark){button{color:#111}}
fieldset{border:1px solid var(--line);border-radius:8px;margin:0 0 1rem;padding:.75rem}legend{font-weight:600;padding:0 .3rem}
.radios label{display:block;padding:.2rem 0}.reihe{display:flex;gap:1rem;flex-wrap:wrap}.reihe label{display:flex;flex-direction:column;gap:.2rem}
.fehler{border-left:4px solid var(--s-geschlossen);padding:.5rem 1rem;background:var(--card)}
.ok{border-left:4px solid var(--s-regulaer);padding:.5rem 1rem;background:var(--card)}
footer{margin-top:3rem;border-top:1px solid var(--line);font-size:.875rem;color:var(--muted)}footer .inner{padding-block:1rem}
[hidden]{display:none!important}
`;

export function layout(titel: string, inhalt: H, opt: { pow?: boolean } = {}): H {
  return html`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${titel} – Kita-Ausfall NRW</title>
<style>${raw(CSS)}</style>
<script src="/static/app.js" defer></script>
${opt.pow ? html`<script src="/static/altcha.js" type="module" defer></script>` : ''}
</head>
<body>
<header><div class="inner"><a class="logo" href="/">Kita-Ausfall NRW</a><small>Notbetreuung &amp; Einschränkungen in Kitas</small></div></header>
<main>${inhalt}</main>
<footer><div class="inner">
<a href="/datenschutz">Datenschutz &amp; Funktionsweise</a> · <a href="/api/v1/status">Offene Daten (JSON)</a><br>
Kita-Stammdaten © OpenStreetMap-Mitwirkende (ODbL). Angaben ohne Gewähr – maßgeblich sind die Informationen der Kita.
</div></footer>
</body>
</html>`;
}

export function badge(s: TagesStatus): H {
  return html`<span class="badge s-${s.status}">${STATUS_LABEL[s.status]}${zeiten(s)}</span>`;
}

function zeiten(s: TagesStatus): string {
  if (s.uhrzeit_von && s.uhrzeit_bis) return ` (${s.uhrzeit_von}–${s.uhrzeit_bis} Uhr)`;
  return '';
}

function stufe(s: TagesStatus): H {
  if (!s.stufe) return html``;
  return html`<span class="stufe">${STUFE_LABEL[s.stufe as Stufe]}</span>`;
}

function adresse(k: Kita): string {
  return [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function fehlerBox(fehler: string[]): H {
  if (!fehler.length) return html``;
  return html`<div class="fehler" role="alert"><strong>Bitte prüfen:</strong><ul>${fehler.map((f) => html`<li>${f}</li>`)}</ul></div>`;
}

// ---------------------------------------------------------------- Startseite

export function startseite(q: string, treffer: KitaMitStatus[] | null, heuteListe: KitaMitStatus[], datum: string): H {
  return layout(
    'Start',
    html`
<h1>Welche Kitas haben heute Notbetreuung?</h1>
<p class="muted">Eltern melden Einschränkungen, Elternbeiräte und Kitas bestätigen sie. Ohne Anmeldung, ohne Tracking.</p>
<form class="suche" action="/" method="get" role="search">
  <input type="search" name="q" value="${q}" placeholder="Name, Ort, Straße oder PLZ" aria-label="Kita suchen" minlength="2">
  <button>Suchen</button>
</form>
${
  treffer === null
    ? ''
    : html`<h2>Suchergebnisse</h2>${
        treffer.length
          ? html`<ul class="liste">${treffer.map(kitaZeile)}</ul>`
          : html`<p class="muted">Keine Kita gefunden. Fehlt eine Kita? Schreiben Sie uns über die Kontaktadresse unter „Datenschutz“.</p>`
      }`
}
<h2>Gemeldete Einschränkungen am ${datumKurz(datum)}</h2>
${heuteListe.length ? html`<ul class="liste">${heuteListe.map(kitaZeile)}</ul>` : html`<p class="muted">Für heute liegen keine Meldungen vor.</p>`}
`,
  );
}

function kitaZeile({ kita, status }: KitaMitStatus): H {
  return html`<li><span><a href="/kita/${kita.id}">${kita.name}</a><br><span class="muted">${adresse(kita)}</span></span>
<span>${badge(status)}<br>${stufe(status)}</span></li>`;
}

// ---------------------------------------------------------------- Kita-Seite

export function kitaSeite(kita: Kita, verlauf: TagesStatus[], prot: ProtokollEintrag[], formular: H, hinweis?: H): H {
  return layout(
    kita.name,
    html`
<h1>${kita.name}</h1>
<p class="muted">${adresse(kita)}${kita.traeger ? html`<br>Träger: ${kita.traeger}` : ''}</p>
${hinweis ?? ''}
<h2>Status der nächsten Tage</h2>
<table>
<thead><tr><th>Tag</th><th>Status</th></tr></thead>
<tbody>${verlauf.map(
      (s) => html`<tr class="${istWochenende(s.datum) ? 'we' : ''}"><td>${datumKurz(s.datum)}</td><td>${badge(s)}<br>${stufe(s)}</td></tr>`,
    )}</tbody>
</table>
<h2 id="melden">Einschränkung melden</h2>
${formular}
<p><a href="/kita/${kita.id}/berichtigung">Sie sind die Kita-Leitung oder der Träger? Angaben berichtigen</a></p>
<h2>Änderungsprotokoll</h2>
${
  prot.length
    ? html`<table><thead><tr><th>Gemeldet am</th><th>Für Tag</th><th>Änderung</th></tr></thead><tbody>${prot.map(
        (p) =>
          html`<tr><td>${datumKurz(p.erstellt_am)}</td><td>${datumKurz(p.datum)}</td><td>${STATUS_LABEL[p.alt_status as keyof typeof STATUS_LABEL]} → ${
            STATUS_LABEL[p.neu_status as keyof typeof STATUS_LABEL]
          }<br><span class="stufe">${STUFE_LABEL[p.neu_stufe as Stufe]}</span></td></tr>`,
      )}</tbody></table>`
    : html`<p class="muted">Noch keine Änderungen.</p>`
}
`,
    { pow: true },
  );
}

export interface FormularWerte {
  status?: string;
  datum_von?: string;
  datum_bis?: string;
  uhrzeit_von?: string;
  uhrzeit_bis?: string;
  grund?: string;
}

export function meldeFormular(action: string, werte: FormularWerte, fehler: string[], opt: { pow: boolean; knopf: string }): H {
  return html`
${fehlerBox(fehler)}
<form method="post" action="${action}" class="card meldung">
<fieldset class="radios"><legend>Was gilt?</legend>
${STATUS.map(
  (s) =>
    html`<label><input type="radio" name="status" value="${s}" ${werte.status === s ? 'checked' : ''} required> <span class="badge s-${s}">${STATUS_LABEL[s]}</span></label>`,
)}
</fieldset>
<fieldset><legend>Zeitraum</legend><div class="reihe">
<label>Von <input type="date" name="datum_von" value="${werte.datum_von ?? ''}" required></label>
<label>Bis (optional) <input type="date" name="datum_bis" value="${werte.datum_bis ?? ''}"></label>
</div></fieldset>
<fieldset data-zeiten><legend>Betreuungszeit an diesen Tagen</legend><div class="reihe">
<label>Beginn <input type="time" name="uhrzeit_von" value="${werte.uhrzeit_von ?? ''}"></label>
<label>Ende <input type="time" name="uhrzeit_bis" value="${werte.uhrzeit_bis ?? ''}"></label>
</div><p class="muted">Bei verkürzten Zeiten Pflicht, bei Notbetreuung optional.</p></fieldset>
<fieldset><legend>Grund (optional)</legend>
<select name="grund"><option value="">– keine Angabe –</option>
${GRUND.map((g) => html`<option value="${g}" ${werte.grund === g ? 'selected' : ''}>${GRUND_LABEL[g]}</option>`)}
</select>
<p class="muted">Bitte keine Namen oder Details zu Personen – deshalb gibt es kein Freitextfeld.</p>
</fieldset>
${
  opt.pow
    ? html`<altcha-widget challenge="/pow/challenge" language="de" name="altcha" auto="onload" hidelogo configuration='{"humanInteractionSignature":false}'></altcha-widget>
<p class="muted">Statt eines Captchas rechnet Ihr Browser kurz eine Aufgabe (Proof-of-Work). Es werden keine Cookies gesetzt.</p>`
    : ''
}
<p><button type="submit">${opt.knopf}</button></p>
</form>`;
}

// ---------------------------------------------------------------- Link-Seite

export function linkSeite(kita: Kita, rolle: string, formular: H, hinweis?: H): H {
  const wer = rolle === 'kita' ? 'die Kita' : 'den Elternbeirat';
  return layout(
    `Meldung für ${kita.name}`,
    html`
<h1>${kita.name}</h1>
<p class="muted">Persönlicher Melde-Link für ${wer}. Meldungen über diesen Link werden als verifiziert angezeigt.
Bitte geben Sie den Link nicht weiter. <a href="/kita/${kita.id}">Öffentliche Seite der Kita</a></p>
${hinweis ?? ''}
${formular}`,
  );
}

// ---------------------------------------------------------------- Berichtigung

export function berichtigungSeite(kita: Kita, formular: H | null, kontaktEmail: string, hinweis?: H): H {
  return layout(
    `Berichtigung – ${kita.name}`,
    html`
<h1>Angaben berichtigen</h1>
<p><strong>${kita.name}</strong><br><span class="muted">${adresse(kita)}</span></p>
${hinweis ?? ''}
${
  formular
    ? html`<p>Tragen Sie ein, was tatsächlich gilt. Wir senden einen Bestätigungslink an die <strong>öffentlich bekannte E-Mail-Adresse</strong> der Einrichtung.
Erst nach Bestätigung wird die Angabe übernommen und als „berichtigt durch Kita“ angezeigt. Sie hat Vorrang vor allen anderen Meldungen.</p>
${formular}`
    : html`<p>Für diese Einrichtung ist uns keine öffentliche E-Mail-Adresse bekannt. Bitte schreiben Sie von der dienstlichen Adresse der Kita oder des Trägers an
<a href="mailto:${kontaktEmail}">${kontaktEmail}</a>. Wir prüfen die Anfrage und richten Ihnen gern einen dauerhaften Melde-Link ein.</p>`
}
<p><a href="/kita/${kita.id}">Zurück zur Kita</a></p>`,
    { pow: true },
  );
}

export function bestaetigungSeite(kita: Kita, zusammenfassung: string, token: string): H {
  return layout(
    'Berichtigung bestätigen',
    html`
<h1>Berichtigung bestätigen</h1>
<p><strong>${kita.name}</strong></p>
<p>${zusammenfassung}</p>
<form method="post" action="/berichtigung/${token}"><button type="submit">Jetzt bestätigen</button></form>`,
  );
}

export function hinweisSeite(titel: string, text: H | string, status: 'ok' | 'fehler' = 'ok'): H {
  return layout(titel, html`<h1>${titel}</h1><div class="${status}">${text}</div><p><a href="/">Zur Startseite</a></p>`);
}

export function okBox(text: H | string): H {
  return html`<div class="ok" role="status">${text}</div>`;
}

// ---------------------------------------------------------------- Datenschutz

export function datenschutzSeite(kontaktEmail: string, schwelle: number, aufbewahrungTage: number): H {
  return layout(
    'Datenschutz & Funktionsweise',
    html`
<h1>Datenschutz &amp; Funktionsweise</h1>
<h2>Was wir speichern</h2>
<ul>
<li>Pro Meldung: Kita, Status, Zeitraum, ggf. Betreuungszeiten und Grund aus einer festen Liste sowie das Datum der Meldung (ohne Uhrzeit).</li>
<li>Kein Freitext, keine Namen, keine Konten, keine Cookies, kein Tracking, keine externen Dienste.</li>
<li><strong>Keine IP-Adressen.</strong> Um Mehrfachmeldungen zu erkennen, bilden wir aus Verbindungsdaten und Kita einen Hash mit einem Tagesschlüssel,
der nur im Arbeitsspeicher liegt und täglich verworfen wird. Danach kann niemand – auch wir nicht – den Hash einer Person zuordnen.</li>
<li>Einzelmeldungen löschen wir ${aufbewahrungTage} Tage nach Ende des gemeldeten Zeitraums. Erhalten bleibt nur das öffentliche Änderungsprotokoll je Kita und Tag.</li>
</ul>
<h2>Wie der angezeigte Status entsteht</h2>
<ol>
<li><strong>Berichtigt durch Kita</strong> – von der Einrichtung über ihre öffentliche E-Mail-Adresse bestätigt. Hat immer Vorrang.</li>
<li><strong>Verifiziert durch Kita / Elternbeirat</strong> – Meldung über einen persönlichen Melde-Link (pro Kita, gültig bis Ende des Kita-Jahres).</li>
<li><strong>Von mehreren Eltern bestätigt</strong> – mindestens ${schwelle} unabhängige anonyme Meldungen mit gleichem Status.</li>
<li><strong>Unbestätigt</strong> – eine einzelne anonyme Meldung.</li>
</ol>
<p>„Keine Meldung“ bedeutet <em>nicht</em>, dass regulär betreut wird – nur, dass uns nichts gemeldet wurde.</p>
<h2>Schutz vor Missbrauch</h2>
<p>Statt eines Captchas löst Ihr Browser eine kleine Rechenaufgabe (Proof-of-Work, selbst gehostet mit ALTCHA). Zusätzlich ist die Zahl der Meldungen pro Gerät, Kita und Tag begrenzt.</p>
<h2>Berichtigung</h2>
<p>Kitas und Träger können Angaben jederzeit über den Link „Angaben berichtigen“ auf der Kita-Seite korrigieren oder sich an <a href="mailto:${kontaktEmail}">${kontaktEmail}</a> wenden.</p>
`,
  );
}
