import { useSyncExternalStore } from "react";
import { tr, type TresorStatus } from "./api";

/**
 * Der Zustand des Tresors fuer Kachel und Sidebar-Badge.
 *
 * Er kommt bewusst aus einer Quelle, die auch OHNE Master-Passwort antwortet:
 * Anzahlen und Ablaufdaten. So kann die Sidebar warnen, dass der Ausweis
 * ablaeuft, ohne dass der Tresor dafuer offen stehen muss.
 */

let status: TresorStatus | null = null;
let laeuft = false;
const horcher = new Set<() => void>();

const melden = () => horcher.forEach((h) => h());

export async function aktualisiereStatus(): Promise<void> {
  if (laeuft) return;
  laeuft = true;
  try {
    status = await tr.status();
    melden();
  } catch {
    /* Backend evtl. offline — alter Stand bleibt stehen */
  } finally {
    laeuft = false;
  }
}

function subscribe(h: () => void): () => void {
  horcher.add(h);
  // Der erste Interessent stoesst das Laden an; danach halten Aenderungen
  // in der Tresor-Ansicht den Wert frisch.
  if (!status) void aktualisiereStatus();
  return () => horcher.delete(h);
}

const lies = () => status;

export function useTresorStatus(): TresorStatus | null {
  return useSyncExternalStore(subscribe, lies, lies);
}

/** Wie viele Dokumente laufen demnaechst ab? Speist das Sidebar-Badge. */
export function useAblaufBadge(): number {
  return useSyncExternalStore(
    subscribe,
    () => status?.ablaufend.length ?? 0,
    () => 0
  );
}
