import { useEffect, useState } from "react";
import { hh, EINNAHME_KATEGORIEN, type Vorschlaege } from "./api";

/**
 * Auswahllisten fuer Konto und Kategorie.
 *
 * Frueher standen beide als feste Listen im Code — die echten Banken und die
 * gewachsenen Kategorien des Entwicklers („Kautionskasse", „Tabak", „Gaming").
 * Das war fremder Ballast fuer jeden anderen Nutzer und verriet nebenbei ein
 * Stueck Privatleben.
 *
 * Ersatzlos streichen ging nicht: Beides sind Auswahllisten, und ohne Eintraege
 * haette man bestehende Buchungen nicht mehr bearbeiten koennen — der dort
 * hinterlegte Wert waere schlicht nicht mehr waehlbar gewesen.
 *
 * Deshalb: was der Nutzer tatsaechlich benutzt (aus den eigenen Buchungen und
 * Fixkosten, haeufigstes zuerst) plus ein paar neutrale Vorgaben fuer den
 * leeren Start. Ab der zweiten Buchung ist das nuetzlicher als jede
 * mitgelieferte Liste und pflegt sich von selbst.
 */
const STANDARD_KONTEN = ["Girokonto", "Bargeld", "Kreditkarte", "PayPal"];

const STANDARD_KATEGORIEN = [
  "Allgemein", "Freizeit", "Gesundheit", "Haushalt", "Heizung",
  "Internet & Telefon", "Kleidung", "Lebensmittel", "Miete", "Mobilität",
  "Sonstiges", "Steuern", "Strom", "Versicherung",
];

// Modulweit gemerkt, damit nicht jedes Formular einzeln nachfragt: drei
// Auswahlfelder auf einer Seite sollen eine Anfrage ausloesen, nicht drei.
let geladen: Vorschlaege | null = null;
let laufend: Promise<Vorschlaege> | null = null;

function holen(): Promise<Vorschlaege> {
  if (!laufend) {
    laufend = hh.vorschlaege()
      .then((v) => { geladen = v; return v; })
      .catch((e) => {
        // Nicht den Fehlschlag merken — sonst bleibt die Liste bis zum
        // Neuladen der Seite bei den Vorgaben stehen.
        laufend = null;
        throw e;
      });
  }
  return laufend;
}

/**
 * Eigene Werte und Vorgaben zusammen, nach dem Alphabet. Doppelte fliegen
 * raus, auch wenn sie sich nur in der Schreibung unterscheiden — dann gewinnt
 * die eigene Schreibweise.
 */
function mische(eigene: string[] | undefined, standard: string[]): string[] {
  const je = new Map<string, string>();
  for (const w of [...(eigene ?? []), ...standard]) {
    const k = w.trim().toLocaleLowerCase("de");
    if (k && !je.has(k)) je.set(k, w.trim());
  }
  return [...je.values()].sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
}

// Wer nach dem Speichern neu laden laesst, damit ein frisch eingetippter Wert
// beim naechsten Mal in der Liste steht.
const hoerer = new Set<() => void>();

/** Vorschlaege neu holen — nach dem Speichern eines Formulars aufrufen. */
export function auswahlNeuLaden(): void {
  laufend = null;
  holen().then(() => hoerer.forEach((h) => h())).catch(() => { /* Kuer */ });
}

function useAuswahl(feld: "konten" | "kategorien", standard: string[]): string[] {
  const [liste, setListe] = useState<string[]>(() => mische(geladen?.[feld], standard));

  useEffect(() => {
    let aktiv = true;
    const setzen = () => { if (aktiv && geladen) setListe(mische(geladen[feld], standard)); };
    hoerer.add(setzen);
    holen()
      .then(setzen)
      .catch(() => {
        /* Vorschlaege sind Kuer — die Vorgaben stehen ja schon da. */
      });
    return () => { aktiv = false; hoerer.delete(setzen); };
  }, [feld, standard]);

  return liste;
}

export const useKonten = () => useAuswahl("konten", STANDARD_KONTEN);
export const useKategorien = () => useAuswahl("kategorien", STANDARD_KATEGORIEN);
export const useEinnahmeKategorien = () => useAuswahl("kategorien", EINNAHME_KATEGORIEN);
