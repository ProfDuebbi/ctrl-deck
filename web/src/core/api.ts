/**
 * Wird gerufen, sobald der Server eine Anfrage als „nicht angemeldet"
 * zurueckweist. Die Tuer haengt sich hier ein und zeigt wieder den
 * Anmeldebildschirm — sonst liefe die Oberflaeche mit einer abgelaufenen
 * Sitzung weiter und wuerfe an zufaelligen Stellen Fehler.
 */
let beiAbmeldung: (() => void) | null = null;
export function meldeAbmeldungAn(fn: (() => void) | null): void {
  beiAbmeldung = fn;
}

/** Fehler, den eine abgewiesene Anfrage wirft — von Aufrufern erkennbar. */
export class NichtAngemeldet extends Error {
  constructor() {
    super("nicht angemeldet");
    this.name = "NichtAngemeldet";
  }
}

// Duenne Hilfsschicht fuer Aufrufe ans lokale Backend.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 401) {
    beiAbmeldung?.();
    throw new NichtAngemeldet();
  }
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Me {
  name: string;
  appName: string;
}
