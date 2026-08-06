import { useEffect, useState } from "react";
import { hh, type Vorschlaege } from "./api";

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

/** Eigene Werte zuerst, Vorgaben fuellen auf; Doppelte fliegen raus. */
const mische = (eigene: string[] | undefined, standard: string[]) =>
  [...new Set([...(eigene ?? []), ...standard])];

function useAuswahl(feld: "konten" | "kategorien", standard: string[]): string[] {
  const [liste, setListe] = useState<string[]>(() => mische(geladen?.[feld], standard));

  useEffect(() => {
    let aktiv = true;
    holen()
      .then((v) => { if (aktiv) setListe(mische(v[feld], standard)); })
      .catch(() => {
        /* Vorschlaege sind Kuer — die Vorgaben stehen ja schon da. */
      });
    return () => { aktiv = false; };
  }, [feld, standard]);

  return liste;
}

export const useKonten = () => useAuswahl("konten", STANDARD_KONTEN);
export const useKategorien = () => useAuswahl("kategorien", STANDARD_KATEGORIEN);
