/**
 * Kopieren mit Verfallsdatum.
 *
 * Ein Tresor, der den Wert entschluesselt und ihn dann unbegrenzt in der
 * Zwischenablage liegen laesst, hat den Schutz an der letzten Stelle wieder
 * aufgegeben. Passwortwerkzeuge raeumen nach etwa einer Minute auf; hier
 * ebenso.
 *
 * Geleert wird ohne Rueckfrage — die Zwischenablage zu LESEN, um zu pruefen,
 * ob noch der eigene Wert drinsteht, verlangt eine Browser-Erlaubnis und einen
 * Dialog. Ein stiller Dialog ist schlimmer als ein geleertes Feld.
 */

const FRIST_MS = 45_000;

let uhr: number | undefined;
let wartetAufFokus = false;

async function leeren(): Promise<void> {
  try {
    await navigator.clipboard.writeText("");
    abbrechen();
  } catch {
    // Schreiben geht nur, solange das Fenster den Fokus hat. Wer gerade in
    // einem anderen Programm einfuegt, bekommt die Zwischenablage geleert,
    // sobald er zurueckkommt.
    if (!wartetAufFokus) {
      wartetAufFokus = true;
      window.addEventListener("focus", () => { wartetAufFokus = false; void leeren(); }, { once: true });
    }
  }
}

/** Kopiert und plant das Leeren. Ein zweiter Aufruf setzt die Frist neu. */
export async function kopiereFluechtig(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  window.clearTimeout(uhr);
  uhr = window.setTimeout(() => void leeren(), FRIST_MS);
}

/** Sofort leeren — beim Sperren hat der Wert dort nichts mehr verloren. */
export function zwischenablageLeeren(): void {
  window.clearTimeout(uhr);
  uhr = undefined;
  void leeren();
}

function abbrechen() {
  window.clearTimeout(uhr);
  uhr = undefined;
}

export const FRIST_SEKUNDEN = FRIST_MS / 1000;
