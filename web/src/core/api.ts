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
  if (!res.ok) throw new Error(await fehlerText(res, `API ${path}: ${res.status}`));
  return res.json() as Promise<T>;
}

/**
 * Der Server erklaert Fehler im Klartext (`{ error: "…" }`) — und zwar in
 * ganzen deutschen Saetzen, die man einem Menschen zeigen kann. Vorher warf
 * `api()` stattdessen „API /me: 400" weg; jedes Formular haette sich seine
 * eigene fetch-Schleife bauen muessen, um an die Begruendung zu kommen.
 */
export async function fehlerText(res: Response, ersatz: string): Promise<string> {
  try {
    const d = await res.json();
    return typeof d?.error === "string" ? d.error : ersatz;
  } catch {
    return ersatz;
  }
}

export interface Me {
  name: string;
  appName: string;
  /** Data-URL des Profilbilds, oder null fuer „zeig die Initialen". */
  avatar: string | null;
}
