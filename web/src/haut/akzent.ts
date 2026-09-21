/**
 * Akzent-Engine — aus EINER Farbe wird das ganze Farbset der Haut „Nexus".
 *
 * Uebernommen aus dem Nexus UI Kit v1.0 (`nexus-accent.js`) und nach
 * TypeScript gebracht. Inhaltlich unveraendert; nur das Fensterglobale
 * Drumherum ist weg, weil hier ein Modul reicht. Urheberschaft und
 * Nutzungsbedingungen des Kits stehen in `nexus/LIZENZ-nexus-ui-kit.txt`.
 *
 * Zwei Dinge macht sie von selbst:
 *
 * 1. Sie zieht jede Eingabe in ein brauchbares Fenster. Man darf also
 *    Dunkelbraun waehlen, ohne dass Knoepfe unlesbar werden — Helligkeit und
 *    Saettigung werden so korrigiert, dass heller Text darauf stehen bleibt
 *    und die Farbe ueberhaupt noch nach Akzent aussieht.
 *
 * 2. Sie baut daraus den Verlauf: kuehler Pol → Akzent → warmer Pol. Die
 *    Drehung ist bewusst eng (−32°/+30°), damit der Verlauf in der
 *    Farbfamilie bleibt. Bei weiter Drehung laeuft ein pinker Akzent
 *    sichtbar nach Orange aus.
 */

/** Das Violett des Kits. Ohne eigene Wahl faerbt sich die Haut damit. */
export const AKZENT_VORGABE = "#8b5cf6";

interface Hsl { h: number; s: number; l: number; }

/** Die Namen, die die Engine setzt — zum Setzen wie zum Wegraeumen. */
const MARKEN = [
  "--nx-accent", "--nx-accent-2", "--nx-accent-3",
  "--nx-accent-soft", "--nx-accent-glow",
  "--nx-grad", "--nx-grad-soft",
] as const;

export type AkzentTokens = Record<(typeof MARKEN)[number], string>;

function hexZuHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h6 = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const num = parseInt(h6, 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

const hsl = (c: Hsl) => `hsl(${c.h} ${Math.round(c.s)}% ${Math.round(c.l)}%)`;
const hsla = (c: Hsl, a: number) =>
  `hsl(${c.h} ${Math.round(c.s)}% ${Math.round(c.l)}% / ${a})`;

/** Nicht so dunkel, dass heller Text verschwindet; nicht so blass, dass er
 *  ueberstrahlt; genug Saettigung fuer einen echten Akzent. */
function normalisieren(c: Hsl): Hsl {
  return {
    h: c.h,
    s: Math.min(92, Math.max(c.s < 8 ? 0 : 45, c.s)),
    l: Math.min(72, Math.max(52, c.l)),
  };
}

/** Das vollstaendige Farbset zu einer Farbe — oder `null`, wenn die Eingabe
 *  kein Hexwert ist. */
export function akzentTokens(farbe: string): AkzentTokens | null {
  const roh = hexZuHsl(farbe || AKZENT_VORGABE);
  if (!roh) return null;
  const basis = normalisieren(roh);
  const kuehl = { h: (basis.h + 328) % 360, s: basis.s, l: Math.min(70, basis.l + 5) };
  const warm = { h: (basis.h + 30) % 360, s: basis.s, l: Math.min(70, basis.l + 2) };
  return {
    "--nx-accent": hsl(basis),
    "--nx-accent-2": hsl(warm),
    "--nx-accent-3": hsl(kuehl),
    "--nx-accent-soft": hsla(basis, 0.14),
    "--nx-accent-glow": hsla(basis, 0.45),
    "--nx-grad": `linear-gradient(105deg, ${hsl(kuehl)} 0%, ${hsl(basis)} 50%, ${hsl(warm)} 100%)`,
    "--nx-grad-soft": `linear-gradient(105deg, ${hsla(kuehl, 0.14)}, ${hsla(warm, 0.14)})`,
  };
}

/**
 * Setzt die Farbe am Dokument. `null` raeumt sie weg — dann greift wieder
 * die Vorgabe aus dem Stylesheet, statt dass ein alter Wert kleben bleibt.
 */
export function akzentAnwenden(farbe: string | null): void {
  const ziel = document.documentElement;
  const t = farbe ? akzentTokens(farbe) : null;
  if (!t) {
    for (const k of MARKEN) ziel.style.removeProperty(k);
    return;
  }
  for (const k of MARKEN) ziel.style.setProperty(k, t[k]);
}
