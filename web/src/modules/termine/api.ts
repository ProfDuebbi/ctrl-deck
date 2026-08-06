import { api } from "../../core/api";

/** Sorte eines Termins — bestimmt Symbol und Farbe. */
export type TerminArt = "geburtstag" | "aufgabe" | "frist" | "ablauf" | "zahltag";

export interface Termin {
  id: string;
  datum: string;
  zeit?: string | null;
  titel: string;
  notiz?: string | null;
  art: TerminArt;
  modul: string;
  dringend?: boolean;
  tageBis: number;
}

export interface Faden {
  von: string;
  bis: string;
  tage: number;
  /** Module, die beim Sammeln gestolpert sind — ihre Zeilen fehlen. */
  fehler: string[];
  termine: Termin[];
}

export interface Uebersicht {
  anzahl: number;
  heute: number;
  ueberfaellig: number;
  dringend: number;
  naechster: Termin | null;
}

export const termine = {
  faden: (tage: number) => api<Faden>(`/termine?tage=${tage}`),
  uebersicht: (tage = 14) => api<Uebersicht>(`/termine/uebersicht?tage=${tage}`),
};

/**
 * Farbe nach Sorte, nicht nach Herkunftsmodul.
 *
 * Regel 3 in theme.css: Farbe bedeutet etwas. Hier heisst sie „wie dringend
 * ist das", nicht „aus welchem Modul kommt das" — sonst waere Violett nur
 * noch ein Hinweis darauf, dass jemand Geburtstag hat, und Bernstein stuende
 * neben einer harmlosen Zeile, weil sie zufaellig aus dem Haushalt kommt.
 */
export const ART_FARBE: Record<TerminArt, string> = {
  ablauf: "amber",
  frist: "amber",
  aufgabe: "blue",
  zahltag: "green",
  geburtstag: "violet",
};

export const ART_TEXT: Record<TerminArt, string> = {
  ablauf: "läuft ab",
  frist: "Frist",
  aufgabe: "Aufgabe",
  zahltag: "Zahltag",
  geburtstag: "Geburtstag",
};

const WOCHENTAG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** „Heute", „Morgen", sonst „Donnerstag, 30. Juli". */
export function tagesTitel(datum: string, tageBis: number): string {
  if (tageBis === 0) return "Heute";
  if (tageBis === 1) return "Morgen";
  const [j, m, t] = datum.split("-").map(Number);
  const d = new Date(j, m - 1, t);
  const lang = d.toLocaleDateString("de-DE", { day: "numeric", month: "long" });
  return `${WOCHENTAG[d.getDay()]}, ${lang}`;
}

/** „in 3 Tagen", „seit 2 Tagen überfällig". */
export function abstand(tageBis: number): string {
  if (tageBis === 0) return "heute";
  if (tageBis === 1) return "morgen";
  if (tageBis === -1) return "seit gestern überfällig";
  if (tageBis < 0) return `seit ${-tageBis} Tagen überfällig`;
  if (tageBis < 7) return `in ${tageBis} Tagen`;
  if (tageBis < 14) return "nächste Woche";
  return `in ${Math.round(tageBis / 7)} Wochen`;
}
