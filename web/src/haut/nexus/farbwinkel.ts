/**
 * Farbe der Modulkacheln in der Haut „Nexus".
 *
 * Das Kit faerbt eine Kachel (`.nx-tile`) aus ZWEI Farbwinkeln: `--h` fuer
 * Symbol und Schein, `--h2` fuer das Ende des Verlaufs. Saettigung und
 * Helligkeit stehen fest im CSS, damit die Wand als ein Satz wirkt — hier
 * wird also nur der Ton gewaehlt.
 *
 * Die Winkel stehen je Modul fest und nicht aus einer Rechnung, weil
 * nebeneinander liegende Kacheln sich sonst zufaellig gleichen koennen.
 * Rot (um 0°), Bernstein (um 45°) und Gruen (etwa 90°–170°) sind
 * ausgespart: in beiden Haeuten heissen sie „kaputt", „Achtung" und
 * „erledigt/Plus" (Regel 3). Die Leitzahl einer Kachel steht in deren
 * Farbe — eine gruene Kachel liesse jeden Betrag wie ein Guthaben aussehen.
 *
 * Die Instrumententafel liest `--h`/`--h2` nicht — dort sind es zwei
 * unbenutzte Variablen.
 */
const WINKEL: Record<string, [number, number]> = {
  termine: [265, 225],
  laermprotokoll: [330, 290],
  stechuhr: [195, 225],
  zaehlerstaende: [180, 206],
  aufgaben: [282, 318],
  haushalt: [228, 196],
  geburtstage: [318, 348],
  fahrzeug: [212, 248],
  tresor: [245, 275],
  notizen: [25, 345],
  dokumente: [200, 176],
  gta6: [312, 22],
};

/** Fuer Module, die hier (noch) nicht stehen: ein Ton aus dem Namen,
 *  aus demselben erlaubten Bereich. */
function ausName(id: string): [number, number] {
  let n = 0;
  for (const z of id) n = (n * 31 + z.charCodeAt(0)) >>> 0;
  const h = 178 + (n % 170); // 178°–347°: Cyan ueber Blau bis Rosa
  return [h, (h + 34) % 360];
}

export function farbwinkel(id: string): { "--h": number; "--h2": number } {
  const [h, h2] = WINKEL[id] ?? ausName(id);
  return { "--h": h, "--h2": h2 };
}
