import { useEffect, useRef } from "react";

/**
 * Escape schliesst.
 *
 * Der Betrachter benutzt nicht `Modal` aus `core/ui`: Ein PDF braucht die
 * halbe Bildschirmhoehe, und `.modal` ist auf Formulare zugeschnitten. Von
 * dort fehlt dann aber, was jeder Dialog koennen muss — deshalb dieser kleine
 * Ersatz. Bewusst nur die Taste: Der Betrachter hat einen sichtbaren
 * Schliessen-Knopf, und eine Fokusfalle um ein `<iframe>` herum kaeme dem
 * eingebauten PDF-Betrachter des Browsers in die Quere.
 */
export function useDialogTaste(onClose: () => void): void {
  const merker = useRef(onClose);
  merker.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      merker.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
