import type { Format, Groesse, Unterzeile } from "./kopf";

/**
 * Die Uhr im Kopfbereich.
 *
 * Stand vorher dreimal wortgleich in App.tsx (Uebersicht, Modulansicht,
 * Profil). Als sie einstellbar wurde, waeren daraus drei Stellen geworden,
 * die man beim naechsten Mal getrennt vergisst.
 *
 * Modulansichten bekommen bewusst KEINE Optionen mitgegeben: dort arbeitet
 * man, dort soll die Uhr immer gleich aussehen.
 */

const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONATE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export const datumsZeile = (d: Date) =>
  `${WOCHENTAGE[d.getDay()]}, ${d.getDate()}. ${MONATE[d.getMonth()]} ${d.getFullYear()}`;

/** Kurzfassung fuer die Unterzeile — die lange Form waere dort zu breit. */
const kurzesDatum = (d: Date) =>
  d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

export function zeitText(d: Date, format: Format, sekunden: boolean): string {
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    ...(sekunden ? { second: "2-digit" } : {}),
    // `hourCycle` statt `hour12`: letzteres wird von manchen Browsern bei
    // deutscher Sprache stillschweigend ignoriert.
    hourCycle: format === "12" ? "h12" : "h23",
  });
}

export function Uhr({
  jetzt,
  format = "24",
  sekunden = true,
  unterzeile = "ortszeit",
  groesse = "gross",
}: {
  jetzt: Date;
  format?: Format;
  sekunden?: boolean;
  unterzeile?: Unterzeile;
  groesse?: Groesse;
}) {
  const unten =
    unterzeile === "ortszeit" ? "Ortszeit" : unterzeile === "datum" ? kurzesDatum(jetzt) : null;

  return (
    <div className={`clock ${groesse === "kompakt" ? "klein" : ""}`}>
      <div className="clock-time">{zeitText(jetzt, format, sekunden)}</div>
      {unten && <div className="clock-label">{unten}</div>}
    </div>
  );
}
