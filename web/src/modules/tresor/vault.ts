import { useSyncExternalStore } from "react";

/**
 * Wo der entsperrte Schluessel wohnt.
 *
 * Bewusst NICHT im React-State: die Tresor-Ansicht wird beim Wechsel auf ein
 * anderes Modul ausgehaengt, und dann waere der Tresor jedes Mal wieder zu.
 * Bewusst auch NICHT im localStorage — dort ueberlebt er den Neustart, und
 * genau das soll er nicht. Ein Neuladen der Seite sperrt.
 */

/** Nach so langer Untaetigkeit sperrt sich der Tresor von selbst. */
const LEERLAUF_MS = 15 * 60 * 1000;

let schluessel: CryptoKey | null = null;
let letzteAktivitaet = 0;
let wecker: number | undefined;

const horcher = new Set<() => void>();
const melden = () => horcher.forEach((h) => h());

function subscribe(h: () => void): () => void {
  horcher.add(h);
  return () => horcher.delete(h);
}

const istOffen = () => schluessel !== null;

/** React-Hook: ist der Tresor gerade entsperrt? */
export function useEntsperrt(): boolean {
  return useSyncExternalStore(subscribe, istOffen, () => false);
}

export const holeSchluessel = (): CryptoKey | null => schluessel;

/** Jede Bedienung schiebt die Leerlaufsperre nach hinten. */
export function angefasst(): void {
  letzteAktivitaet = Date.now();
}

function pruefeLeerlauf() {
  if (schluessel && Date.now() - letzteAktivitaet >= LEERLAUF_MS) sperren();
}

export function entsperren(key: CryptoKey): void {
  schluessel = key;
  angefasst();
  window.clearInterval(wecker);
  wecker = window.setInterval(pruefeLeerlauf, 20_000);
  // Tastatur und Maus in der ganzen App zaehlen als Lebenszeichen — sonst
  // sperrt der Tresor mitten im Tippen, wenn man nur lange liest.
  window.addEventListener("keydown", angefasst, true);
  window.addEventListener("pointerdown", angefasst, true);
  melden();
}

export function sperren(): void {
  if (!schluessel) return;
  schluessel = null;
  window.clearInterval(wecker);
  wecker = undefined;
  window.removeEventListener("keydown", angefasst, true);
  window.removeEventListener("pointerdown", angefasst, true);
  melden();
}
