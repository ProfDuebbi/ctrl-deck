import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Die Daten hinter der Diagrammansicht.
 *
 * Sie kommen aus EINER Antwort (`/api/diagramme`), die der gleichnamige Sammler
 * im Backend aus allen Modulen zusammenlegt — dieselbe Bauart wie Terminfaden,
 * Suche und Profil. Diese Datei rechnet keine Werte aus; sie beschreibt nur,
 * wie aus Zahlen ein Maßstab und aus einem Maßstab eine Beschriftung wird.
 */

export type Akzent = "blue" | "pink" | "violet" | "green" | "amber" | "red";
export type Diagrammform = "verlauf" | "balken" | "spiegel";

export interface Messpunkt { x: string; y: number; }

export interface Reihe {
  id: string;
  name: string;
  farbe?: Akzent | null;
  punkte: Messpunkt[];
}

export interface Diagramm {
  id: string;
  modul: string;
  titel: string;
  hinweis?: string | null;
  form: Diagrammform;
  einheit: string;
  reihen: Reihe[];
  kennzahl?: { wert: string; label: string } | null;
  breite?: "halb" | "voll";
}

export interface Diagrammsatz {
  von: string;
  bis: string;
  monate: number;
  alles: boolean;
  fehler: string[];
  diagramme: Diagramm[];
}

export const ladeDiagramme = (monate: number) =>
  api<Diagrammsatz>(`/diagramme?monate=${monate}`);

/** Die wählbaren Zeiträume. `0` heißt „alles, was da ist". */
export const ZEITRAEUME = [
  { monate: 3, label: "3 Monate" },
  { monate: 6, label: "6 Monate" },
  { monate: 12, label: "12 Monate" },
  { monate: 0, label: "Alles" },
] as const;

// --- Beschriftung ----------------------------------------------------------

const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** „2026-08" → „Aug" bzw. „Aug 26", wenn der Zeitraum mehrere Jahre umspannt. */
export function monatsLabel(x: string, mitJahr = false): string {
  const [j, m] = x.split("-").map(Number);
  if (!Number.isFinite(m)) return x;
  const kurz = MONATE_KURZ[m - 1] ?? x;
  return mitJahr ? `${kurz} ${String(j).slice(2)}` : kurz;
}

/** Spannt die Reihe über mehr als ein Kalenderjahr? Dann braucht sie Jahreszahlen. */
export const mehrereJahre = (punkte: Messpunkt[]) =>
  new Set(punkte.map((p) => p.x.slice(0, 4))).size > 1;

/**
 * Wert mit Einheit, fertig zum Anzeigen.
 *
 * `minuten` wird zu Stunden: eine Achse mit „14400" beantwortet keine Frage,
 * die jemand hat. `kurz` lässt bei Achsenbeschriftungen die Nachkommastellen
 * weg — dort zählt Lesbarkeit, den genauen Wert liefert die Kurzinfo.
 */
export function formatWert(y: number, einheit: string, kurz = false): string {
  const de = (n: number, stellen = 0) =>
    n.toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen });

  if (einheit === "minuten") {
    const h = y / 60;
    if (kurz) return `${de(h, h < 10 && h > 0 ? 1 : 0)} h`;
    const ganze = Math.floor(y / 60);
    const rest = Math.round(y % 60);
    return rest ? `${de(ganze)} h ${String(rest).padStart(2, "0")} min` : `${de(ganze)} h`;
  }
  if (einheit === "euro") return `${de(y, kurz ? 0 : 2)} €`;
  if (einheit === "anzahl") return de(y);
  // Alles Übrige ist eine Zähler-Einheit (kWh, m³, l) und wird angehängt.
  return `${de(y, kurz ? 1 : 2)} ${einheit}`;
}

// --- Maßstab ---------------------------------------------------------------

/**
 * Eine „runde" Obergrenze über dem größten Wert, plus passende Rasterlinien.
 *
 * Ohne Rundung endet die Achse bei 4713 und die Linien liegen bei 1571, 3142 —
 * Zahlen, die niemand im Kopf einordnet. Gesucht ist der kleinste Schritt aus
 * 1/2/5 × Zehnerpotenz, mit dem `ziel` Linien reichen.
 */
export function achse(max: number, ziel = 4): { max: number; linien: number[] } {
  if (!(max > 0)) return { max: 1, linien: [0, 1] };
  const roh = max / ziel;
  const potenz = Math.pow(10, Math.floor(Math.log10(roh)));
  const schritt = [1, 2, 2.5, 5, 10].map((f) => f * potenz).find((s) => s >= roh) ?? potenz * 10;
  const obergrenze = Math.ceil(max / schritt) * schritt;
  const linien: number[] = [];
  for (let v = 0; v <= obergrenze + schritt / 2; v += schritt) linien.push(Math.round(v * 1e6) / 1e6);
  return { max: obergrenze, linien };
}

// --- Glatte Kurve ----------------------------------------------------------

/**
 * Ein weicher Pfad durch alle Punkte — MONOTON kubisch (Fritsch–Carlson).
 *
 * Das ist nicht dasselbe wie „irgendeine Glättung". Die naheliegende Variante
 * (Catmull-Rom, Kardinal-Spline) schießt zwischen zwei Punkten über: Nach
 * einem Tal folgt ein Buckel, den es in den Daten nie gab, und bei Werten
 * knapp über null taucht die Kurve unter die Nulllinie und behauptet einen
 * negativen Verbrauch. In einem Diagramm, das Aussagen machen soll, ist das
 * keine Kosmetik, sondern eine Falschaussage.
 *
 * Die monotone Variante begrenzt die Steigungen so, dass die Kurve zwischen
 * zwei Punkten NIE über den größeren oder unter den kleineren läuft. Sie ist
 * damit die einzige Glättung, die man einer Messreihe antun darf.
 */
export function glatterPfad(punkte: { x: number; y: number }[]): string {
  const n = punkte.length;
  if (n === 0) return "";
  if (n === 1) return `M${punkte[0].x},${punkte[0].y}`;
  if (n === 2) return `M${punkte[0].x},${punkte[0].y} L${punkte[1].x},${punkte[1].y}`;

  // Sekantensteigungen zwischen benachbarten Punkten.
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = punkte[i + 1].x - punkte[i].x;
    d.push(dx === 0 ? 0 : (punkte[i + 1].y - punkte[i].y) / dx);
  }

  // Vorlaeufige Tangenten: Mittel der beiden Nachbarsekanten.
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push((d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);

  // Und jetzt die Begrenzung, die das Ueberschwingen verhindert.
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      // Zwei gleiche Werte: dazwischen bleibt die Kurve waagerecht.
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  let pfad = `M${punkte[0].x.toFixed(1)},${punkte[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = punkte[i + 1].x - punkte[i].x;
    const c1x = punkte[i].x + dx / 3;
    const c1y = punkte[i].y + (m[i] * dx) / 3;
    const c2x = punkte[i + 1].x - dx / 3;
    const c2y = punkte[i + 1].y - (m[i + 1] * dx) / 3;
    pfad += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${punkte[i + 1].x.toFixed(1)},${punkte[i + 1].y.toFixed(1)}`;
  }
  return pfad;
}

// --- Breite messen ---------------------------------------------------------

/**
 * Breite UND Höhe eines Elements, als Zustand.
 *
 * `ref.current?.clientWidth` reicht nicht: beim ersten Rendern ist sie 0, und
 * ein Ref löst kein Neurendern aus. Genau diese Falle steckte schon im
 * Bildeditor — ein SVG mit Breite 0 zeichnet nichts.
 *
 * Die Höhe kommt dazu, seit die Diagramme ihre Karte ausfüllen statt eine
 * feste Höhe zu haben. Damit das keine Rückkopplung wird (Kasten misst SVG,
 * SVG füllt Kasten, Kasten misst neu …), liegt das SVG im CSS **absolut** im
 * Kasten: es kann seine Größe nicht beeinflussen, nur übernehmen.
 */
export function useMasse<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [masse, setMasse] = useState({ breite: 0, hoehe: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const beobachter = new ResizeObserver(([e]) =>
      setMasse((alt) => {
        const breite = Math.round(e.contentRect.width);
        const hoehe = Math.round(e.contentRect.height);
        // Gleiche Werte nicht neu setzen — sonst rendert jede Messung neu.
        return alt.breite === breite && alt.hoehe === hoehe ? alt : { breite, hoehe };
      })
    );
    beobachter.observe(el);
    setMasse({ breite: el.clientWidth, hoehe: el.clientHeight });
    return () => beobachter.disconnect();
  }, []);
  return { ref, ...masse };
}
