import { useEffect, useState } from "react";
import { akzentAnwenden, AKZENT_VORGABE } from "./akzent";

/**
 * Welche Haut die Oberflaeche traegt.
 *
 * CTRL·DECK hat ein eigenes, bewusst gewaehltes Aussehen — die
 * „Instrumententafel" aus `core/theme.css`, flach, kantig, farbsparsam. Das
 * bleibt die Vorgabe und wird von der zweiten Haut nicht angefasst.
 *
 * Daneben steht „Nexus": gestapelte Flaechen, EINE frei waehlbare
 * Akzentfarbe, ein Marken-Verlauf, runde Ecken. Sie ist reine Zutat —
 * `haut/nexus/bruecke.css` biegt die Werte um und tauscht den Rahmen aus,
 * ohne eine Zeile in `theme.css` zu aendern. Wer zurueckschaltet, bekommt
 * exakt die alte Oberflaeche.
 *
 * Die Wahl liegt im localStorage und NICHT auf dem Server — wie schon die
 * Ansicht der Uebersicht. Sie gehoert zum Fenster, in dem man sitzt, nicht
 * zum Dashboard: am Arbeitsplatz die ruhige Tafel, am Fernseher die bunte.
 * Ausserdem laege sie sonst hinter einer Anfrage, und die Seite muesste beim
 * Laden erst in der einen und dann in der anderen Haut erscheinen.
 */
export type Haut = "klassisch" | "nexus";

/**
 * Wie breit der Inhalt hoechstens laufen darf.
 *
 * Gilt fuer BEIDE Haeute, obwohl nur eine davon das Problem hatte: Das Kit
 * deckelt bei 1440px und zentriert, die Instrumententafel deckelte nie. Auf
 * einem 3440px-Schirm bleiben im ersten Fall tausend Pixel links und rechts
 * leer — auf einer Kachelwand, deren ganzer Zweck es ist, viel auf einmal zu
 * zeigen. Zwei getrennte Regelungen dafuer waeren eine zu viel.
 *
 * Die Vorgabe bleibt die volle Breite. Sie ist das, was diese Oberflaeche
 * seit jeher tut, und lange Textzeilen fangen sich ohnehin an anderer
 * Stelle: `.subtitle`, `.lead` und Konsorten tragen ihr eigenes `max-width`
 * in Zeichen. Gedeckelt wird also nur, wer es ausdruecklich enger mag.
 */
export type Breite = "schmal" | "mittel" | "breit" | "voll";

const SCHLUESSEL = "cd_haut";
const SCHLUESSEL_AKZENT = "cd_akzent";
const SCHLUESSEL_BREITE = "cd_breite";

export const HAUT_VORGABE: Haut = "klassisch";
export const BREITE_VORGABE: Breite = "voll";

/** Was als `max-width` am Inhalt landet. `none` heisst: gar keine Grenze. */
const BREITEN_WERTE: Record<Breite, string> = {
  schmal: "1280px",
  mittel: "1600px",
  breit: "2000px",
  voll: "none",
};

export const BREITEN: { wert: Breite; label: string }[] = [
  { wert: "schmal", label: "Schmal" },
  { wert: "mittel", label: "Mittel" },
  { wert: "breit", label: "Breit" },
  { wert: "voll", label: "Voll" },
];

/** Was in den Einstellungen zur Wahl steht. */
export const HAEUTE: { wert: Haut; label: string; erklaerung: string }[] = [
  {
    wert: "klassisch",
    label: "Instrumententafel",
    erklaerung: "Das Original: flache Flächen, Haarlinien, Farbe nur da, wo sie etwas bedeutet.",
  },
  {
    wert: "nexus",
    label: "Nexus",
    erklaerung: "Gestapelte Flächen, eine Akzentfarbe, Marken-Verlauf und eine Icon-Schiene statt der Seitenleiste.",
  },
];

function lesen(): Haut {
  try {
    return localStorage.getItem(SCHLUESSEL) === "nexus" ? "nexus" : HAUT_VORGABE;
  } catch {
    return HAUT_VORGABE;
  }
}

function akzentLesen(): string {
  try {
    const gespeichert = localStorage.getItem(SCHLUESSEL_AKZENT);
    return /^#[0-9a-f]{6}$/i.test(gespeichert ?? "") ? gespeichert! : AKZENT_VORGABE;
  } catch {
    return AKZENT_VORGABE;
  }
}

function breiteLesen(): Breite {
  try {
    const gespeichert = localStorage.getItem(SCHLUESSEL_BREITE);
    return gespeichert && gespeichert in BREITEN_WERTE
      ? (gespeichert as Breite)
      : BREITE_VORGABE;
  } catch {
    return BREITE_VORGABE;
  }
}

/**
 * Traegt die Wahl ans Dokument.
 *
 * `data-haut` steht am <html> und nicht an einem Kasten weiter innen: an der
 * Wurzel erwischt es auch das, was ausserhalb der App-Schale liegt — den
 * Seitengrund, die Bildlaufleisten und die Anmeldetuer, die vor der Schale
 * kommt.
 */
function anwenden(haut: Haut, akzent: string, breite: Breite): void {
  const wurzel = document.documentElement;
  if (haut === "nexus") {
    wurzel.dataset.haut = "nexus";
    akzentAnwenden(akzent);
  } else {
    delete wurzel.dataset.haut;
    // Wegraeumen, nicht ueberschreiben: sonst faerbt eine abgeschaltete Haut
    // die Tafel von innen weiter.
    akzentAnwenden(null);
  }
  // Ausserhalb der Verzweigung: die Breite gilt in beiden Haeuten.
  wurzel.style.setProperty("--inhalt-breite", BREITEN_WERTE[breite]);
}

// Einmal beim Laden des Moduls, noch bevor React etwas zeichnet. Sonst
// erschiene die Seite fuer einen Wimpernschlag in der falschen Haut.
let gemerkt: Haut = lesen();
let gemerkterAkzent: string = akzentLesen();
let gemerkteBreite: Breite = breiteLesen();
anwenden(gemerkt, gemerkterAkzent, gemerkteBreite);

const horcher = new Set<() => void>();
const melden = () => { for (const h of horcher) h(); };

export function hautSetzen(neu: Haut): void {
  gemerkt = neu;
  try { localStorage.setItem(SCHLUESSEL, neu); } catch { /* privates Fenster */ }
  anwenden(gemerkt, gemerkterAkzent, gemerkteBreite);
  melden();
}

export function akzentSetzen(farbe: string): void {
  gemerkterAkzent = farbe;
  try { localStorage.setItem(SCHLUESSEL_AKZENT, farbe); } catch { /* privates Fenster */ }
  anwenden(gemerkt, gemerkterAkzent, gemerkteBreite);
  melden();
}

export function breiteSetzen(neu: Breite): void {
  gemerkteBreite = neu;
  try { localStorage.setItem(SCHLUESSEL_BREITE, neu); } catch { /* privates Fenster */ }
  anwenden(gemerkt, gemerkterAkzent, gemerkteBreite);
  melden();
}

/** Aktuelle Wahl. Aendert sie sich, zeichnet jeder Nutzer dieses Hooks neu —
 *  die Einstellungen stellen um, die Schale wechselt sofort den Rahmen. */
export function useHaut(): { haut: Haut; akzent: string; breite: Breite } {
  const [, neuzeichnen] = useState(0);

  useEffect(() => {
    const h = () => neuzeichnen((n) => n + 1);
    horcher.add(h);
    return () => { horcher.delete(h); };
  }, []);

  return { haut: gemerkt, akzent: gemerkterAkzent, breite: gemerkteBreite };
}
