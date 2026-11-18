# Konzept: Kita-Ausfall NRW

Ziel: sichtbar machen, welche Kitas wann **verkürzte Betreuungszeiten**, **Notbetreuung** oder **keine Betreuung** haben – so **datensparsam** wie möglich und mit **möglichst guter Datenqualität**. Kitas können Angaben jederzeit berichtigen lassen.

Startregion: **Nordrhein-Westfalen**.

## 1. Statusmodell

| Status | Bedeutung | Pflichtangaben |
|---|---|---|
| `regulaer` | Reguläre Betreuung (z. B. um eine Falschmeldung zu widerlegen) | – |
| `verkuerzt` | Verkürzte Betreuungszeiten | Beginn + Ende der Betreuung |
| `notbetreuung` | Nur Notbetreuung | Uhrzeiten optional |
| `geschlossen` | Keine Betreuung möglich | – |
| *(unbekannt)* | Keine Meldung – **nicht** gleichbedeutend mit „regulär“ | – |

Jede Meldung umfasst einen Zeitraum (max. 31 Tage, max. 7 Tage rückwirkend, max. 90 Tage im Voraus) und optional einen Grund aus einer festen Liste: Personalmangel, Krankheitswelle, Streik, geplanter Schließtag, Sonstiges.

**Kein Freitext.** In Freitext landen schnell Namen und Gesundheitsdaten von Beschäftigten („Frau X ist krank“). Feste Felder verhindern das konstruktiv.

## 2. Vertrauensstufen

Statt sich für *eine* Verifikationsmethode zu entscheiden, bekommt jede Meldung eine Quelle. Der angezeigte Status je Kita und Tag ergibt sich aus der stärksten Quelle; bei gleicher Stufe gewinnt die neueste Meldung.

| Stufe | Quelle | Anzeige | Status |
|---|---|---|---|
| 50 | Berichtigung durch Kita (bestätigt über öffentliche Kita-Adresse) | „berichtigt durch Kita“ | ✅ umgesetzt |
| 40 | Persönlicher Melde-Link der Kita | „verifiziert durch Kita“ | ✅ umgesetzt |
| 30 | Persönlicher Melde-Link des Elternbeirats | „verifiziert durch Elternbeirat“ | ✅ umgesetzt |
| 25 | Kita-Mail mit DKIM-Nachweis (Server prüft und löscht sofort) | „verifiziert per Kita-Mail“ | 🔜 geplant |
| 20 | ≥ 2 unabhängige anonyme Meldungen mit gleichem Status | „von mehreren Eltern bestätigt“ | ✅ umgesetzt |
| 10 | Einzelne anonyme Meldung | „unbestätigt“ | ✅ umgesetzt |

Bei anonymen Meldungen gewinnt der Status mit den meisten unabhängigen Meldenden (bei Gleichstand der neueste). Die Schwelle ist über `BESTAETIGUNG_SCHWELLE` einstellbar.

## 3. Datensparsamkeit

| Was | Wie |
|---|---|
| IP-Adressen | Werden **nicht gespeichert** und nicht geloggt. |
| Mehrfachmeldungen erkennen | `HMAC(Tagesgeheimnis, IP + User-Agent + Kita-ID)`. Das Tagesgeheimnis liegt nur im RAM und wird täglich neu erzeugt. Danach kann niemand einen Hash einer Person zuordnen; über Kitas hinweg sind Hashes nicht verknüpfbar. |
| Zeitstempel | Nur Datum, keine Uhrzeit. |
| Konten / Cookies / Tracking | Keine. Keine externen Ressourcen (Widget, Schriften, Skripte werden selbst ausgeliefert). |
| Melde-Links | Pro Kita und Rolle, **nicht pro Person**. Gespeichert wird nur der SHA-256-Hash des Tokens. Gültig bis Ende des Kita-Jahres (31.07.), widerrufbar. |
| Kita-Kontaktadressen | Nur öffentlich bekannte Funktionsadressen (aus OSM/Open Data), nie über die API ausgegeben. |
| Aufbewahrung | Einzelmeldungen werden `AUFBEWAHRUNG_TAGE` (Standard 180) nach Ende des Zeitraums gelöscht. Es bleibt nur das öffentliche Änderungsprotokoll (Kita, Tag, alter/neuer Status, Stufe) – nützlich für Statistik, ohne Melderdaten. |

## 4. Missbrauchsschutz

- **Proof-of-Work** statt Captcha ([ALTCHA](https://altcha.org), selbst gehostet, PBKDF2/SHA-256): Der Browser rechnet ein paar Sekunden. Das ist für Menschen kaum spürbar (die Rechnung startet beim Laden der Seite), macht Massenmeldungen aber teuer. Challenges sind signiert, laufen nach 10 Minuten ab und können nicht wiederverwendet werden. Die „Human Interaction Signature“ des Widgets ist abgeschaltet.
- **Rate-Limit**: max. `MAX_MELDUNGEN_PRO_TAG` (Standard 3) anonyme Meldungen je Gerät, Kita und Tag.
- **Berichtigungsmails**: max. 3 Anfragen pro Kita und Tag, damit niemand Kitas mit Mails überschwemmen kann.
- **Mehrheitsprinzip** und Vertrauensstufen: einzelne Falschmeldungen bleiben als „unbestätigt“ erkennbar und werden von verifizierten Quellen überstimmt.

## 5. Berichtigung durch Kitas

1. Auf der Kita-Seite: „Angaben berichtigen“ → Formular mit denselben festen Feldern.
2. Der Bestätigungslink geht **an die öffentlich bekannte Adresse der Einrichtung**, nicht an eine frei eingegebene Adresse.
3. Bestätigung erst per Klick auf einen Button (POST), damit Link-Scanner in Mailprogrammen nichts auslösen. Einmal verwendbar, 7 Tage gültig.
4. Die Berichtigung hat Vorrang vor allen anderen Meldungen und wird als „berichtigt durch Kita“ angezeigt.
5. Ist keine Adresse bekannt: Kontakt über die Betreiber-Adresse (`KONTAKT_EMAIL`); nach manueller Prüfung bekommt die Kita einen dauerhaften Melde-Link.

Zusätzlich ist das **Änderungsprotokoll** je Kita öffentlich – das schafft Nachvollziehbarkeit gegenüber Kitas und Trägern.

## 6. Melde-Links für Elternbeiräte und Kitas

- Erzeugung per CLI: `npm run link:create -- --kita <id> --rolle elternbeirat|kita`.
- Jährliche Rotation (Ende Kita-Jahr), Widerruf jederzeit: `npm run link:create -- --kita <id> --widerrufen`.

**Ausgabe an den Elternbeirat – Vorschlag „Die Kita lädt ein“:** Der Elternbeirat beantragt den Link auf der Kita-Seite. Die Kita bestätigt per Mail, dass die Person zum Elternbeirat gehört. Damit beantwortet sich auch, wer überhaupt Elternbeirat ist: Das weiß nur die Kita.

1. Elternbeirat klickt auf der Kita-Seite „Wir sind der Elternbeirat“ und gibt eine eigene E-Mail-Adresse an, an die der Link später gehen soll (wird nach Versand gelöscht).
2. Ist für die Kita eine Adresse hinterlegt, geht eine Bestätigungsanfrage dorthin. Ist keine hinterlegt, trägt der Elternbeirat die Funktionsadresse der Kita ein (siehe 8.2).
3. Die Kita klickt „Ja, das ist unser Elternbeirat“. Dann geht der Link an den Elternbeirat, und die Kita-Adresse gilt als bestätigt. Auf Wunsch bekommt die Kita im selben Schritt ihren eigenen Link.

Ergänzend: Kooperation mit Jugendamtselternbeiräten (JAEB) und dem Landeselternbeirat NRW, die den Weg in ihren Netzwerken bekannt machen.

## 7. Spätere Ausbaustufe: Kita-Mails mit Herkunftsnachweis

**ZK-Email** (Zero-Knowledge-Beweis über die DKIM-Signatur, Server sieht nur den relevanten Text) ist technisch möglich, aber für den Start zu aufwendig:

- Viele Kitas informieren per App, Aushang oder Messenger – dann gibt es keine DKIM-Signatur.
- DKIM beweist nur die **Domain**. Bei `@gmail.com`/`@web.de` ist nichts bewiesen; man bräuchte eine Zuordnung Absender ↔ Kita (wieder personenbezogen).
- Eltern müssten die Original-`.eml` exportieren (Weiterleiten reicht nicht).
- Freitext-Extraktion per Regex im Circuit ist fehleranfällig; Beweiserzeugung im Browser ist schwergewichtig.

**Pragmatische Zwischenstufe (Stufe 25):** Eltern laden die `.eml` hoch, der Server prüft DKIM gegen eine Liste bekannter Träger-Domains (z. B. `@stadt-koeln.de`), extrahiert Kita/Datum/Status, zeigt das Ergebnis zur Bestätigung und **löscht die Mail sofort** (nur im RAM verarbeitet). Datensparsam durch Löschung statt durch Kryptografie. ZK kann man danach ergänzen, wenn sich der Bedarf zeigt.

## 8. Kita-Stammdaten für NRW

Wir brauchen zwei Dinge: eine **vollständige Liste aller Kitas** (Name, Adresse, Ort) und für möglichst viele davon eine **Kontaktadresse** für Berichtigungen und Einladungen. Das sind zwei unterschiedlich schwere Probleme.

### 8.1 Die Liste aller Kitas: Landesdatensatz

Das Land veröffentlicht den Datensatz **„Kindertageseinrichtungen in NRW“** (GEOportal.NRW, auch auf open.nrw). Er stammt aus **KiBiz.web**, dem Verwaltungssystem, in dem die Einrichtungen selbst ihre Daten pflegen, und wird **monatlich** aktualisiert. Lizenz laut Katalog: Datenlizenz Deutschland – Namensnennung 2.0.

- Inhalt laut Beschreibung: Name, Adresse, Anzahl Gruppen und Plätze. Damit haben wir **alle Kitas mit Betriebserlaubnis**, nicht nur die in OSM erfassten.
- Monatlicher Import. Kitas, die verschwinden, werden ausgeblendet statt gelöscht.
- OSM (`npm run import:osm`) bleibt nur als Ergänzung (Koordinaten, gelegentlich E-Mail).
- **Noch zu prüfen:** genaue Felder, ob es eine stabile Einrichtungs-ID gibt, ob Träger enthalten ist. Aus der Entwicklungsumgebung waren die Portale nicht erreichbar.

### 8.2 Kontaktadressen: mehrere Quellen, eine Regel

Der Landesdatensatz enthält nach Katalogbeschreibung **keine E-Mail-Adressen**. Es gibt keine einzelne Quelle dafür, deshalb kombinieren wir:

| Quelle | Abdeckung | Aufwand | Bemerkung |
|---|---|---|---|
| **Kommunale Open Data** (z. B. Düsseldorf, Bonn, Münster, Wuppertal, Köln, Ennepe-Ruhr-Kreis, Rhein-Kreis Neuss) | einige Großstädte/Kreise | gering, einmal pro Quelle | Felder und Lizenz je Datensatz prüfen; teils nur Website statt E-Mail |
| **IFG-Anfragen** an die Jugendämter (NRW hat rund 186) bzw. Landesjugendämter LVR/LWL, z. B. über FragDenStaat | potenziell flächendeckend | mittel, lange Laufzeit | Nach Funktionsadressen der Einrichtungen fragen; bei freien Trägern gibt die Behörde ggf. nicht alles heraus |
| **Selbstauskunft / Einladung** (Kita trägt sich ein oder wird vom Elternbeirat eingeladen, siehe Abschnitt 6) | wächst mit der Nutzung | gering | Beste Qualität: Die Adresse ist **bestätigt**. Langfristig die Hauptquelle |
| **OSM** (`email`/`contact:email`) | gering | keiner | Als Startwert |
| **Städtische PDF-Übersichten** (viele Jugendämter veröffentlichen Kita-Listen mit Kontaktdaten) | lückenhaft | hoch (manuell) | Nur gezielt für Pilotstädte |

**Nicht vorgesehen** ist das massenhafte automatische Auslesen von Kita-Websites: Rechtlich und ethisch ist das grenzwertig, und man bekommt viele Personenadressen.

**Regeln für alle Quellen:**
- Nur **Funktionsadressen** (z. B. `kita.sonnenschein@stadt.de`). Adressen nach dem Muster `vorname.nachname@` werden verworfen: Sie sind personenbezogen und veralten beim Personalwechsel.
- Zu jeder Adresse wird die **Herkunft** gespeichert und ob die Kita sie **bestätigt** hat. Unbestätigte Adressen werden nur für Berichtigungsanfragen und Einladungen genutzt, deren Mail immer erklärt, woher die Adresse stammt, und wie man sie löschen lässt.
- Kontaktadressen erscheinen nie auf der Website oder in der API.

### 8.3 Empfohlenes Vorgehen

1. Landesdatensatz importieren → alle Kitas sind suchbar, und es kann für jede gemeldet werden, auch ohne Kontaktadresse.
2. **Pilotstädte** wählen (z. B. 2–3 Städte mit offenen Kita-Daten inkl. Kontakt) und dort Adressen importieren. Dort gezielt Elternbeiräte und JAEB ansprechen.
3. Parallel eine **IFG-Anfrage** an LVR und LWL bzw. an die Jugendämter der Pilotregionen stellen.
4. Ab dann wächst die Abdeckung über den Einladungsweg (Abschnitt 6).

Fehlende Kitas können über ein Formular „Kita fehlt“ gemeldet werden und werden nach Prüfung ergänzt.

## 9. Offene Punkte / nächste Schritte

- [ ] Hosting in der EU, Reverse-Proxy **ohne** Access-Logs (oder mit gekürzten IPs), `TRUST_PROXY=1`.
- [ ] Impressum, Datenschutzerklärung juristisch prüfen lassen (Verantwortliche:r, Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO für die Hash-Bildung).
- [ ] Einladungsweg für Elternbeirat-Links umsetzen (s. 6.) und mit 1–2 Elternbeiräten testen.
- [ ] Landesdatensatz prüfen (Felder, ID, Lizenz) und Pilotstädte auswählen (s. 8.3).
- [ ] IFG-Anfrage zu Funktionsadressen der Kitas stellen (s. 8.2).
- [ ] Optional: Bereich (U3 / Ü3 / Hort) je Meldung.
- [ ] Optional: Benachrichtigungen (z. B. RSS/ICS-Feed pro Kita – ohne Konten).
- [ ] DKIM-Stufe (s. 7.).
- [ ] Auswertungen aus dem Änderungsprotokoll (z. B. Ausfalltage je Kreis), veröffentlicht als offene Daten.
