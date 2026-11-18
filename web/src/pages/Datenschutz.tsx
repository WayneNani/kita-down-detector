import { useTitel } from '../lib/titel';
import { useInfo } from '../api/queries';

export default function Datenschutz() {
  useTitel('Datenschutz & Funktionsweise');
  const { info } = useInfo();
  return (
    <article className="text-seite">
      <h1>Datenschutz &amp; Funktionsweise</h1>

      <h2>Was wir speichern</h2>
      <ul>
        <li>
          Pro Meldung: Kita, Status, Zeitraum, ggf. Betreuungszeiten und ein Grund aus einer festen Liste sowie das Datum der Meldung (ohne
          Uhrzeit).
        </li>
        <li>Kein Freitext, keine Namen, keine Konten, keine Cookies, kein Tracking, keine externen Dienste oder Schriftarten.</li>
        <li>
          <strong>Keine IP-Adressen.</strong> Um Mehrfachmeldungen zu erkennen, bilden wir aus Ihrem Internet-Anschluss (IP-Adresse, bei IPv6 nur der
          Anschluss-Teil) und der Kita einen Hash mit einem Tagesschlüssel, der nur im Arbeitsspeicher liegt und täglich verworfen wird. Mehrere Personen
          am selben Anschluss zählen deshalb als eine Meldung. Danach kann niemand – auch wir nicht – den Hash einer Person
          zuordnen.
        </li>
        <li>
          Einzelmeldungen löschen wir {info.aufbewahrung_tage} Tage nach Ende des gemeldeten Zeitraums. Erhalten bleibt nur der angezeigte Status je
          Kita und Tag sowie das öffentliche Änderungsprotokoll.
        </li>
      </ul>

      <h2>Was nur auf Ihrem Gerät bleibt</h2>
      <ul>
        <li>
          <strong>„Meine Kitas“</strong> speichern wir ausschließlich im Speicher Ihres Browsers. Wir erfahren nicht, welche Kitas Sie sich merken.
        </li>
        <li>
          <strong>„Tage ohne Meldung als reguläre Betreuung anzeigen“</strong> ist eine reine Ansichts-Einstellung, die nur in Ihrem Browser gespeichert
          wird. Sie verändert keine Daten und wird nicht übertragen.
        </li>
        <li>
          <strong>„Kitas in meiner Nähe“:</strong> Ihr Standort wird schon auf Ihrem Gerät auf ca. 1 km gerundet, bevor er gesendet wird, und auf dem
          Server nicht gespeichert.
        </li>
        <li>Einen Melde-Link können Sie auf Wunsch auf Ihrem Gerät merken lassen – und jederzeit wieder löschen.</li>
        <li>Die App kann offline den zuletzt geladenen Stand anzeigen. Dafür speichert Ihr Browser die Seiten zwischen.</li>
      </ul>

      <h2>Wie der angezeigte Status entsteht</h2>
      <ol>
        <li>
          <strong>Berichtigt durch Kita</strong> – von der Einrichtung über ihre hinterlegte E-Mail-Adresse bestätigt. Hat immer Vorrang.
        </li>
        <li>
          <strong>Verifiziert durch Kita / Elternbeirat</strong> – Meldung über einen persönlichen Melde-Link (pro Kita, gültig bis Ende des
          Kita-Jahres). Den Link für den Elternbeirat bestätigt die Kita.
        </li>
        <li>
          <strong>Von mehreren Eltern bestätigt</strong> – mindestens {info.bestaetigungs_schwelle} unabhängige anonyme Meldungen mit gleichem
          Status.
        </li>
        <li>
          <strong>Unbestätigt</strong> – eine einzelne anonyme Meldung.
        </li>
      </ol>
      <p>„Keine Meldung“ bedeutet nicht, dass regulär betreut wird – nur, dass uns nichts gemeldet wurde.</p>

      <h2>Schutz vor Missbrauch</h2>
      <p>
        Statt eines Captchas löst Ihr Gerät eine kleine Rechenaufgabe (Proof-of-Work, selbst gehostet mit ALTCHA). Das dauert wenige Sekunden und
        macht massenhafte Falschmeldungen teuer. Zusätzlich ist die Zahl der Meldungen pro Gerät, Kita und Tag begrenzt.
      </p>

      <h2>Kontaktadressen der Kitas</h2>
      <p>
        Wir speichern nur allgemeine Funktionsadressen von Einrichtungen (keine persönlichen Adressen). Sie werden nie veröffentlicht und nur für
        Berichtigungen, Bestätigungen und Melde-Links genutzt. Neue Adressen prüfen wir von Hand, bevor wir sie verwenden. Die Adresse eines
        Elternbeirats zeigen wir der Kita in der Bestätigungsanfrage, damit sie die Anfrage zuordnen kann, und speichern sie nur, bis der Link
        versendet ist (höchstens 30 Tage, wenn die Anfrage unbeantwortet bleibt). Ausgehende Mails liegen bis zum Versand in einer
        Warteschlange. Verschlüsselte Datensicherungen bewahren wir 14 Tage auf; danach sind gelöschte Daten auch dort entfernt.
      </p>

      <h2>Berichtigung und Kontakt</h2>
      <p>
        Kitas und Träger können Angaben jederzeit über „Angaben berichtigen“ auf der Kita-Seite korrigieren
        {info.kontakt_email && (
          <>
            {' '}
            oder sich an <a href={`mailto:${info.kontakt_email}`}>{info.kontakt_email}</a> wenden
          </>
        )}
        .
      </p>
    </article>
  );
}
