import { api } from "../../core/api";

export interface TimeEntry {
  id: number;
  datum: string;
  start: string | null;
  ende: string | null;
  minuten: number;
  quelle: "stempel" | "manuell" | "uebertrag";
  notiz: string | null;
  projekt_id: number | null;
  projektName: string | null;
  projektFarbe: string | null;
}

export interface Project {
  id: number;
  name: string;
  farbe: string;
  archiviert: number;
  gesamtMin: number;
  wocheMin: number;
  zuletzt: string | null;
  eintraege: number;
}

export interface Status {
  running: boolean;
  since: number | null;
  elapsedMin: number;
  projektId: number | null;
}

export interface Summary {
  weekMin: number;
  todayMin: number;
  running: boolean;
  since: number | null;
  projektName: string | null;
  topProjekt: { name: string; minuten: number } | null;
}

export interface StatRow {
  id: number;
  name: string;
  farbe: string;
  archiviert: number;
  minuten: number;
  eintraege: number;
}

export interface Stats {
  proProjekt: StatRow[];
  ohneProjekt: { minuten: number; eintraege: number };
}

export interface VerlaufRow {
  monat: string;
  minuten: number;
}

/** Farben, die Projekte annehmen koennen — Schluessel landen als CSS-Klasse p-<farbe>. */
export const PROJEKT_FARBEN = ["violet", "blue", "green", "amber", "pink", "cyan"] as const;

const base = "/stechuhr";

export const su = {
  status: () => api<Status>(`${base}/status`),
  punchIn: (projektId?: number | null) =>
    api<{ running: boolean; since: number }>(`${base}/punch/in`, {
      method: "POST",
      body: JSON.stringify({ projektId: projektId ?? null }),
    }),
  punchOut: () => api<{ id: number; minuten: number }>(`${base}/punch/out`, { method: "POST" }),
  punchSwitch: (projektId: number) =>
    api<{ running: boolean; since: number; vorher: { minuten: number } | null }>(
      `${base}/punch/switch`,
      { method: "POST", body: JSON.stringify({ projektId }) }
    ),
  entries: (from: string, to: string, projektId?: number | null) =>
    api<TimeEntry[]>(
      `${base}/entries?from=${from}&to=${to}${projektId ? `&projektId=${projektId}` : ""}`
    ),
  create: (e: Record<string, unknown>) =>
    api<{ id: number }>(`${base}/entries`, { method: "POST", body: JSON.stringify(e) }),
  update: (id: number, e: Record<string, unknown>) =>
    api(`${base}/entries/${id}`, { method: "PUT", body: JSON.stringify(e) }),
  remove: (id: number) => api(`${base}/entries/${id}`, { method: "DELETE" }),
  summary: () => api<Summary>(`${base}/summary`),

  projects: (mitArchiv = false) =>
    api<Project[]>(`${base}/projects${mitArchiv ? "?archiviert=1" : ""}`),
  createProject: (name: string, farbe: string) =>
    api<{ id: number }>(`${base}/projects`, { method: "POST", body: JSON.stringify({ name, farbe }) }),
  updateProject: (id: number, p: { name: string; farbe: string; archiviert: boolean }) =>
    api(`${base}/projects/${id}`, { method: "PUT", body: JSON.stringify(p) }),
  removeProject: (id: number) => api(`${base}/projects/${id}`, { method: "DELETE" }),

  stats: (from: string, to: string) => api<Stats>(`${base}/stats?from=${from}&to=${to}`),
  verlauf: (projektId?: number | null) =>
    api<VerlaufRow[]>(`${base}/verlauf${projektId ? `?projektId=${projektId}` : ""}`),
};

// --- Zeit-Helfer ----------------------------------------------------------

const p = (n: number) => String(n).padStart(2, "0");
export const localDate = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

/** "X h Y min" aus Minuten. */
export function fmtHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/** "H:MM:SS" aus Sekunden (fuer den Live-Timer). */
export function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${p(h)}:${p(m)}:${p(s)}`;
}

export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export type Zeitraum = "woche" | "monat" | "gesamt";

/** Von/bis und Beschriftung fuer den gewaehlten Zeitraum. */
export function spanne(art: Zeitraum, anker: Date): { from: string; to: string; label: string } {
  if (art === "gesamt") return { from: "0000-00-00", to: "9999-99-99", label: "Gesamt" };
  if (art === "monat") {
    const first = new Date(anker.getFullYear(), anker.getMonth(), 1);
    const last = new Date(anker.getFullYear(), anker.getMonth() + 1, 0);
    return {
      from: localDate(first),
      to: localDate(last),
      label: first.toLocaleDateString("de-DE", { month: "long", year: "numeric" }),
    };
  }
  const mo = mondayOf(anker);
  const so = addDays(mo, 6);
  const kurz = (d: Date) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return {
    from: localDate(mo),
    to: localDate(so),
    label: `${kurz(mo)}–${so.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}`,
  };
}

/** "2026-07" -> "Jul 26" fuer die Verlaufsbalken. */
export function monatKurz(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
}

/**
 * Minuten zwischen HH:MM und HH:MM, oder null.
 * Liegt das Ende vor dem Start, wird die Schicht als ueber Mitternacht gewertet
 * (22:00–06:00 = 8 h). Nur exakt gleiche Zeiten ergeben null.
 */
export function minutesBetween(start: string, ende: string): number | null {
  if (!start || !ende) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = ende.split(":").map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return null;
  const diff = eh * 60 + em - (sh * 60 + sm);
  if (diff > 0) return diff;
  return diff < 0 ? diff + 24 * 60 : null;
}
