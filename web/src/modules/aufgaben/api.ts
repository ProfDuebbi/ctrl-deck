import { api } from "../../core/api";

export type Prio = "hoch" | "normal" | "niedrig";
export type Wdh = "einmalig" | "taeglich" | "woechentlich" | "monatlich";

export interface Task {
  id: number;
  titel: string;
  notiz: string | null;
  prioritaet: Prio;
  erledigt: number; // 0|1
  erledigt_at: string | null;
  faellig_datum: string | null;
  faellig_zeit: string | null;
  wiederholung: Wdh;
  created_at: string;
  sort: number;
}

const base = "/aufgaben";

export const ag = {
  list: () => api<Task[]>(`${base}/tasks`),
  due: () => api<Task[]>(`${base}/due`),
  create: (t: Partial<Task>) => api<{ id: number }>(`${base}/tasks`, { method: "POST", body: JSON.stringify(t) }),
  update: (id: number, t: Partial<Task>) => api(`${base}/tasks/${id}`, { method: "PUT", body: JSON.stringify(t) }),
  done: (id: number) => api<{ recurred: boolean; next?: string }>(`${base}/tasks/${id}/done`, { method: "POST" }),
  reopen: (id: number) => api(`${base}/tasks/${id}/reopen`, { method: "POST" }),
  remove: (id: number) => api(`${base}/tasks/${id}`, { method: "DELETE" }),
};

export const WDH_LABEL: Record<Wdh, string> = {
  einmalig: "einmalig",
  taeglich: "täglich",
  woechentlich: "wöchentlich",
  monatlich: "monatlich",
};

export const PRIO_LABEL: Record<Prio, string> = { hoch: "Hoch", normal: "Normal", niedrig: "Niedrig" };

/** Fälligkeits-Zeitpunkt als Date, oder null wenn kein Datum. Ohne Uhrzeit = Tagesbeginn. */
export function dueDate(t: Task): Date | null {
  if (!t.faellig_datum) return null;
  const [y, m, d] = t.faellig_datum.split("-").map(Number);
  if (t.faellig_zeit) {
    const [h, min] = t.faellig_zeit.split(":").map(Number);
    return new Date(y, m - 1, d, h, min);
  }
  return new Date(y, m - 1, d, 0, 0);
}

/** Menschliche Fälligkeits-Angabe: "heute 18:00", "morgen", "in 3 Tagen", "überfällig · gestern". */
export function dueLabel(t: Task): { text: string; state: "overdue" | "today" | "soon" | "later" } | null {
  const dt = dueDate(t);
  if (!dt || !t.faellig_datum) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(t.faellig_datum + "T00:00:00");
  const diffDays = Math.round((day.getTime() - today.getTime()) / 864e5);
  const zeit = t.faellig_zeit ? ` ${t.faellig_zeit}` : "";

  let label: string;
  if (diffDays === 0) label = `heute${zeit}`;
  else if (diffDays === 1) label = `morgen${zeit}`;
  else if (diffDays === -1) label = `gestern${zeit}`;
  else if (diffDays < 0) label = `vor ${-diffDays} Tagen`;
  else label = `in ${diffDays} Tagen${zeit}`;

  const overdue = dt.getTime() < Date.now();
  let state: "overdue" | "today" | "soon" | "later";
  if (overdue) state = "overdue";
  else if (diffDays === 0) state = "today";
  else if (diffDays <= 2) state = "soon";
  else state = "later";
  return { text: overdue && diffDays >= 0 ? `${label} · überfällig` : label, state };
}
