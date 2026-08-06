import { useSyncExternalStore } from "react";
import { ag } from "./api";

/**
 * Winziger geteilter Store für die Zahl fälliger Aufgaben.
 * Der globale ReminderWatcher speist ihn (aus /due); die Sidebar liest ihn.
 * So bleibt der Kern generisch und muss das Aufgaben-Modul nicht kennen.
 */
let count = 0;
const listeners = new Set<() => void>();

export function setDueCount(n: number): void {
  if (n !== count) {
    count = n;
    listeners.forEach((l) => l());
  }
}
export function getDueCount(): number {
  return count;
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React-Hook: liefert die aktuelle Anzahl fälliger Aufgaben (live). */
export function useDueCount(): number {
  return useSyncExternalStore(subscribe, getDueCount, getDueCount);
}

/** Frisch vom Backend holen (nach Änderungen in der Aufgaben-View). */
export async function refreshDueCount(): Promise<void> {
  try {
    const due = await ag.due();
    setDueCount(due.length);
  } catch {
    /* Backend evtl. offline — ignorieren */
  }
}
