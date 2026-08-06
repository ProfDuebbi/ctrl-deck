import { api } from "../../core/api";

export type Accent = "blue" | "pink" | "violet";

export interface Meter {
  id: number;
  name: string;
  einheit: string;
  accent: Accent;
  sort: number;
  /** € je Einheit — ohne Preis bleibt alles reine Verbrauchsanzeige. */
  preis: number | null;
  /** € pro Monat Grundgebühr, optional. */
  grundpreis: number | null;
  /** € pro Monat, was du an den Versorger zahlst. */
  abschlag: number | null;
}

export interface Reading {
  id: number;
  meter_id: number;
  datum: string;
  stand: number;
  notiz: string | null;
}

export interface MeterSummary {
  id: number;
  name: string;
  einheit: string;
  accent: Accent;
  count: number;
  lastStand: number | null;
  lastDatum: string | null;
  perDay: number | null;
}

const base = "/zaehlerstaende";

export const zs = {
  meters: () => api<Meter[]>(`${base}/meters`),
  addMeter: (m: Partial<Meter>) =>
    api<{ id: number }>(`${base}/meters`, { method: "POST", body: JSON.stringify(m) }),
  updateMeter: (id: number, m: Partial<Meter>) =>
    api(`${base}/meters/${id}`, { method: "PUT", body: JSON.stringify(m) }),
  deleteMeter: (id: number) => api(`${base}/meters/${id}`, { method: "DELETE" }),

  readings: (meterId: number) => api<Reading[]>(`${base}/meters/${meterId}/readings`),
  addReading: (meterId: number, r: Partial<Reading>) =>
    api<{ id: number }>(`${base}/meters/${meterId}/readings`, { method: "POST", body: JSON.stringify(r) }),
  updateReading: (id: number, r: Partial<Reading>) =>
    api(`${base}/readings/${id}`, { method: "PUT", body: JSON.stringify(r) }),
  deleteReading: (id: number) => api(`${base}/readings/${id}`, { method: "DELETE" }),

  summary: () => api<MeterSummary[]>(`${base}/summary`),
};

/** Zahl hübsch (max. 3 Nachkommastellen, deutsches Format). */
export function fmtNum(n: number): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 3 });
}

/** Tage zwischen zwei ISO-Daten (min. 1). */
export function daysBetween(a: string, b: string): number {
  return Math.max(1, Math.round((+new Date(b) - +new Date(a)) / 864e5));
}

export const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/** Durchschnittliche Monatslaenge — 30 waere ueber ein Jahr um 5 Tage daneben. */
export const TAGE_PRO_MONAT = 365 / 12;

/** Tage zwischen einem ISO-Datum und heute (lokal, nicht UTC). */
export function tageSeit(datum: string): number {
  const [j, m, t] = datum.split("-").map(Number);
  const d = new Date(j, m - 1, t);
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((heute.getTime() - d.getTime()) / 864e5));
}

export interface Abrechnung {
  tage: number;
  verbrauch: number;
  /** Arbeitspreis + anteiliger Grundpreis. */
  kosten: number;
  /** Abschlag mal Zeitraum — null, wenn kein Abschlag hinterlegt ist. */
  gezahlt: number | null;
  /** gezahlt − kosten. Positiv = Guthaben, negativ = Nachzahlung. */
  differenz: number | null;
}

/**
 * Was der Verbrauch zwischen zwei Ablesungen gekostet hat und wie sich das
 * zum Abschlag verhaelt. Funktioniert bei zwei Ablesungen im Abstand von
 * sechs Wochen genauso wie bei der Jahresablesung — der Zeitraum ist immer
 * der tatsaechliche Abstand, nichts wird auf Monate gerundet.
 */
export function rechneAbrechnung(
  m: Pick<Meter, "preis" | "grundpreis" | "abschlag">,
  verbrauch: number,
  tage: number
): Abrechnung | null {
  if (m.preis == null) return null;
  const monate = tage / TAGE_PRO_MONAT;
  const kosten = verbrauch * m.preis + (m.grundpreis ?? 0) * monate;
  const gezahlt = m.abschlag != null ? m.abschlag * monate : null;
  return {
    tage,
    verbrauch,
    kosten,
    gezahlt,
    differenz: gezahlt != null ? gezahlt - kosten : null,
  };
}
