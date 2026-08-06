import { api } from "../../core/api";

export interface Geburtstag {
  id: number;
  name: string;
  tag: number;
  monat: number;
  jahr: number | null;
  /** Todesjahr. Gesetzt = Gedenktag, kein Geburtstag zum Gratulieren. */
  verstorben: number | null;
  notiz: string | null;
  tageBis: number;
  alter: number | null;
}

const base = "/geburtstage";

export const gb = {
  list: () => api<Geburtstag[]>(`${base}/`),
  naechste: (tage = 30) =>
    api<{ anzahl: number; naechste: Geburtstag[] }>(`${base}/naechste?tage=${tage}`),
  create: (g: Partial<Geburtstag>) =>
    api<{ id: number }>(`${base}/`, { method: "POST", body: JSON.stringify(g) }),
  update: (id: number, g: Partial<Geburtstag>) =>
    api(`${base}/${id}`, { method: "PUT", body: JSON.stringify(g) }),
  remove: (id: number) => api(`${base}/${id}`, { method: "DELETE" }),
};

export const MONATE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** "in 3 Tagen", "heute", "morgen" — lesbarer als eine nackte Zahl. */
export function wannText(tage: number): string {
  if (tage === 0) return "heute";
  if (tage === 1) return "morgen";
  if (tage <= 30) return `in ${tage} Tagen`;
  const monate = Math.round(tage / 30);
  return monate === 1 ? "in gut einem Monat" : `in ${monate} Monaten`;
}
