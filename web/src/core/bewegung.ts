/**
 * Bewegung, die etwas erklaert (Regel 5 in theme.css).
 *
 * Die View-Transitions-API laesst den Browser selbst herausfinden, was sich
 * von wo nach wo bewegt hat: Man sagt ihm, WAS sich aendert, nicht WIE es
 * aussehen soll. Dadurch gibt es hier keine Rechnerei mit Koordinaten und
 * keine Animation, die bei zwoelf Karten anders laeuft als bei drei.
 *
 * Kennt der Browser sie nicht, passiert die Aenderung sofort — dann fehlt die
 * Erklaerung, aber nie die Funktion.
 */

type MitUebergang = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

/** Will der Mensch ueberhaupt Bewegung sehen? */
function bewegungErwuenscht(): boolean {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fuehrt `aendern` so aus, dass der Browser den Weg dorthin zeigen kann.
 *
 * WICHTIG: `aendern` muss den Zustand SYNCHRON setzen. React 18 rendert
 * Zustandsaenderungen aus einem Callback heraus gebuendelt — das passt, weil
 * die API genau auf diesen Moment wartet.
 */
export function mitUebergang(aendern: () => void): void {
  const doc = document as MitUebergang;
  if (!doc.startViewTransition || !bewegungErwuenscht()) {
    aendern();
    return;
  }
  doc.startViewTransition(aendern);
}

/**
 * Name, unter dem der Browser ein Element ueber einen Zustandswechsel hinweg
 * wiedererkennt. Muss zu JEDEM Zeitpunkt eindeutig sein — deshalb je Modul
 * genau ein Symbol mit diesem Namen.
 */
export const uebergangsName = (id: string) => `cd-ico-${id}`;
