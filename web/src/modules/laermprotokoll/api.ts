import type { Beteiligte } from "./report";
import { api } from "../../core/api";

export interface OwnEntry {
  id: number;
  datum: string;
  start: string | null;
  ende: string | null;
  dauer_min: number | null;
  aktivitaet: string;
  lautstaerke: string | null;
  bemerkung: string | null;
}

export interface ForeignEntry {
  id: number;
  datum: string;
  uhrzeit: string | null;
  verursacher: string;
  art: string;
  bemerkung: string | null;
}

export interface Summary {
  own: { entries: number; sessions: number; totalMin: number; avgMin: number; longestMin: number };
  ownTotalLabel: string;
  foreignCount: number;
  lastForeign: { datum: string; uhrzeit: string | null; verursacher: string } | null;
}

const base = "/laermprotokoll";

export type { Beteiligte } from "./report";

export const lp = {
  listOwn: () => api<OwnEntry[]>(`${base}/own`),
  createOwn: (e: Partial<OwnEntry>) =>
    api<{ id: number }>(`${base}/own`, { method: "POST", body: JSON.stringify(e) }),
  updateOwn: (id: number, e: Partial<OwnEntry>) =>
    api(`${base}/own/${id}`, { method: "PUT", body: JSON.stringify(e) }),
  deleteOwn: (id: number) => api(`${base}/own/${id}`, { method: "DELETE" }),

  listForeign: () => api<ForeignEntry[]>(`${base}/foreign`),
  createForeign: (e: Partial<ForeignEntry>) =>
    api<{ id: number }>(`${base}/foreign`, { method: "POST", body: JSON.stringify(e) }),
  updateForeign: (id: number, e: Partial<ForeignEntry>) =>
    api(`${base}/foreign/${id}`, { method: "PUT", body: JSON.stringify(e) }),
  deleteForeign: (id: number) => api(`${base}/foreign/${id}`, { method: "DELETE" }),

  summary: () => api<Summary>(`${base}/summary`),
  /** Mieter/Vermieter fuer den Kopf des Beweispapiers. */
  bericht: () => api<Beteiligte>(`${base}/bericht`),
  setzeBericht: (b: Beteiligte) =>
    api<Beteiligte>(`${base}/bericht`, { method: "PUT", body: JSON.stringify(b) }),
  export: () =>
    api<{ ownPath: string; forPath: string; ownTxt: string; forTxt: string }>(`${base}/export`, {
      method: "POST",
    }),
};

/** Minuten zwischen HH:MM und HH:MM (oder null). */
export function minutesBetween(start: string | null, ende: string | null): number | null {
  if (!start || !ende) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = ende.split(":").map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return null;
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff >= 0 ? diff : null;
}
