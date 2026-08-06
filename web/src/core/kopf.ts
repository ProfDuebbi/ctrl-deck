import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * Aussehen des Kopfbereichs auf der Startseite.
 *
 * Die Form spiegelt `server/src/kopf.ts` — beim Aendern beide Seiten anfassen.
 * Der Server saeubert jeden Wert nach, das Frontend darf also grosszuegig
 * sein; umgekehrt gilt das nicht.
 */

export type Position = "oben" | "mitte" | "unten";
export type Groesse = "kompakt" | "gross";
export type Format = "24" | "12";
export type Unterzeile = "ortszeit" | "datum" | "keine";

export interface Kopf {
  bild: string | null;
  staerke: number;
  position: Position;
  abdunkeln: number;
  weichzeichnen: number;
  groesse: Groesse;
  uhrZeigen: boolean;
  uhrSekunden: boolean;
  uhrFormat: Format;
  uhrUnterzeile: Unterzeile;
  wetterZeigen: boolean;
  wetterDetails: boolean;
  wetterOrt: boolean;
}

/** Muss mit VORGABE in server/src/kopf.ts uebereinstimmen — sonst springt
 *  der Kopfbereich beim ersten Laden einmal sichtbar um. */
export const KOPF_VORGABE: Kopf = {
  bild: null,
  staerke: 22,
  position: "mitte",
  abdunkeln: 0,
  weichzeichnen: 0,
  groesse: "gross",
  uhrZeigen: true,
  uhrSekunden: true,
  uhrFormat: "24",
  uhrUnterzeile: "ortszeit",
  wetterZeigen: true,
  wetterDetails: true,
  wetterOrt: true,
};

export const kopfApi = {
  lesen: () => api<Kopf>("/kopf"),
  /** Teilweise Aenderung: nur mitschicken, was sich aendert. Das Bild bleibt
   *  dabei absichtlich draussen — es waere bei jedem Reglerschub dabei. */
  setzen: (teil: Partial<Kopf>) =>
    api<Kopf>("/kopf", { method: "PUT", body: JSON.stringify(teil) }),
};

/**
 * Der Kopfbereich wird an zwei Stellen gebraucht: die Startseite zeigt ihn,
 * das Profil stellt ihn ein. Beide sollen dieselbe Wahrheit sehen, ohne dass
 * die eine die andere kennt — deshalb ein winziger geteilter Speicher statt
 * eines Zustands, der durch die halbe App gereicht wird.
 */
let gemerkt: Kopf | null = null;
const horcher = new Set<(k: Kopf) => void>();

export function kopfSetzen(neu: Kopf): void {
  gemerkt = neu;
  for (const h of horcher) h(neu);
}

export function useKopf(): Kopf {
  const [kopf, setKopf] = useState<Kopf>(gemerkt ?? KOPF_VORGABE);

  useEffect(() => {
    horcher.add(setKopf);
    if (!gemerkt) {
      kopfApi.lesen()
        .then(kopfSetzen)
        .catch(() => { /* Vorgabe steht ja schon da */ });
    }
    return () => { horcher.delete(setKopf); };
  }, []);

  return kopf;
}
