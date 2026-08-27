import { useEffect, useState } from "react";
import { rest, type Rest } from "./countdown";

/**
 * Der laufende Countdown. Kachel und Vollansicht brauchen ihn beide —
 * einmal geschrieben ist besser als zwei Uhren, die auseinanderlaufen.
 *
 * Der Takt haelt an, sobald der Termin da ist: ein Intervall, das
 * danach noch stuendlich 8.640 mal `vorbei: true` in denselben Zustand
 * schreibt, ist ein Intervall zuviel.
 */
export function useRest(): Rest {
  const [wert, setWert] = useState<Rest>(() => rest());

  useEffect(() => {
    if (wert.vorbei) return;
    const id = window.setInterval(() => setWert(rest()), 1000);
    return () => window.clearInterval(id);
  }, [wert.vorbei]);

  return wert;
}
