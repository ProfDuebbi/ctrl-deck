import { api } from "../../core/api";

export type FahrzeugArt = "auto" | "motorrad" | "roller" | "fahrrad" | "anderes";
export type FristStatus = "abgelaufen" | "dringend" | "bald" | "offen";

export interface Frist {
  feld: "hu_bis" | "versicherung_bis" | "steuer_bis" | "inspektion_bis";
  label: string;
  datum: string;
  tage: number;
  status: FristStatus;
}

export interface Fahrzeug {
  id: number;
  name: string;
  kennzeichen: string | null;
  art: FahrzeugArt;
  hu_bis: string | null;
  versicherung_bis: string | null;
  steuer_bis: string | null;
  inspektion_bis: string | null;
  notiz: string | null;
  aktiv: number;
  fristen: Frist[];
}

export type EintragArt = "tanken" | "wartung" | "reparatur" | "sonstiges";

export interface Eintrag {
  id: number;
  fahrzeug_id: number;
  datum: string;
  art: EintragArt;
  km: number | null;
  liter: number | null;
  betrag: number | null;
  notiz: string | null;
}

export interface Uebersicht {
  anzahl: number;
  naechste: (Frist & { fahrzeug: string }) | null;
  dringend: number;
  kostenJahr: number;
}

const base = "/fahrzeug";

export const fz = {
  liste: () => api<Fahrzeug[]>(base),
  uebersicht: () => api<Uebersicht>(`${base}/uebersicht`),
  anlegen: (f: Partial<Fahrzeug>) =>
    api<{ id: number }>(base, { method: "POST", body: JSON.stringify(f) }),
  aendern: (id: number, f: Partial<Fahrzeug>) =>
    api(`${base}/${id}`, { method: "PUT", body: JSON.stringify(f) }),
  loeschen: (id: number) => api(`${base}/${id}`, { method: "DELETE" }),
  eintraege: (id: number) => api<Eintrag[]>(`${base}/${id}/eintraege`),
  eintragen: (id: number, e: Partial<Eintrag>) =>
    api<{ id: number }>(`${base}/${id}/eintraege`, { method: "POST", body: JSON.stringify(e) }),
  eintragLoeschen: (id: number) => api(`${base}/eintraege/${id}`, { method: "DELETE" }),
};

export const ARTEN: { wert: FahrzeugArt; label: string }[] = [
  { wert: "auto", label: "Auto" },
  { wert: "motorrad", label: "Motorrad" },
  { wert: "roller", label: "Roller" },
  { wert: "fahrrad", label: "Fahrrad / E-Bike" },
  { wert: "anderes", label: "Anderes" },
];

export const EINTRAG_ARTEN: { wert: EintragArt; label: string }[] = [
  { wert: "tanken", label: "Tanken / Laden" },
  { wert: "wartung", label: "Wartung" },
  { wert: "reparatur", label: "Reparatur" },
  { wert: "sonstiges", label: "Sonstiges" },
];

export const euro = (n: number) =>
  n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** „in 12 Tagen" / „seit 3 Tagen abgelaufen". */
export function fristText(tage: number): string {
  if (tage === 0) return "heute fällig";
  if (tage === 1) return "morgen fällig";
  if (tage === -1) return "seit gestern abgelaufen";
  if (tage < 0) return `seit ${-tage} Tagen abgelaufen`;
  if (tage < 31) return `in ${tage} Tagen`;
  const monate = Math.round(tage / 30.4);
  return `in ${monate} ${monate === 1 ? "Monat" : "Monaten"}`;
}

/**
 * Verbrauch aus zwei aufeinanderfolgenden Tankvorgaengen.
 *
 * Gerechnet wird „Liter dieser Tankung auf die seither gefahrene Strecke" —
 * das ist die uebliche Naeherung und stimmt genau dann, wenn beide Male
 * vollgetankt wurde. Ohne Kilometerstand gibt es kein Ergebnis statt eines
 * falschen.
 */
export function verbrauch(eintraege: Eintrag[]): { liter100: number | null; proKm: number | null } {
  const tankungen = eintraege
    .filter((e) => e.art === "tanken" && e.km != null && e.liter != null)
    .sort((a, b) => a.datum.localeCompare(b.datum) || a.id - b.id);
  if (tankungen.length < 2) return { liter100: null, proKm: null };

  const strecke = (tankungen[tankungen.length - 1].km ?? 0) - (tankungen[0].km ?? 0);
  if (strecke <= 0) return { liter100: null, proKm: null };

  // Die erste Tankung fuellt nur den Ausgangszustand — ihre Liter gehoeren zu
  // einer Strecke, die wir nicht kennen.
  const liter = tankungen.slice(1).reduce((s, e) => s + (e.liter ?? 0), 0);
  const kosten = tankungen.slice(1).reduce((s, e) => s + (e.betrag ?? 0), 0);
  return {
    liter100: (liter / strecke) * 100,
    proKm: kosten > 0 ? kosten / strecke : null,
  };
}
