import { useId } from "react";

/**
 * Freies Feld mit Vorschlagsliste — für Konto und Kategorie.
 *
 * Vorher waren das `<select>`-Felder: Wer bei einer Bank war, die nicht in der
 * Liste stand, oder das Konto wechselte, kam nicht weiter. Jetzt lässt sich
 * alles eintippen; die Liste schlägt nur vor. Tippt man einen vorhandenen Wert
 * in anderer Schreibung („revolut"), wird beim Verlassen die vorhandene
 * genommen — sonst stünde dasselbe Konto bald zweimal in jeder Auswertung.
 */
export function Waehler({ wert, onWahl, liste, platzhalter, title, className, disabled }: {
  wert: string;
  onWahl: (wert: string) => void;
  liste: string[];
  platzhalter: string;
  title?: string;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();

  function angleichen() {
    const t = wert.trim();
    const gleich = liste.find((w) => w.localeCompare(t, "de", { sensitivity: "base" }) === 0);
    if (gleich && gleich !== wert) onWahl(gleich);
    else if (t !== wert) onWahl(t);
  }

  return (
    <>
      <input
        list={id} value={wert} placeholder={platzhalter} title={title ?? platzhalter}
        className={className} disabled={disabled} autoComplete="off"
        onChange={(e) => onWahl(e.target.value)} onBlur={angleichen}
      />
      <datalist id={id}>
        {liste.map((w) => <option key={w} value={w} />)}
      </datalist>
    </>
  );
}
