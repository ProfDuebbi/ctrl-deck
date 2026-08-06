import { api } from "../../core/api";

export type FristEinheit = "tage" | "wochen" | "monate";
export type VertragStatus = "dringend" | "bald" | "offen" | "verpasst" | "ausgelaufen";

/** Vom Server errechnet — nie selbst setzen. */
export interface VertragsInfo {
  laufzeitBis: string;
  kuendbarBis: string;
  tage: number;
  status: VertragStatus;
  verlaengert: boolean;
}

export interface Fixkost {
  id: number;
  name: string;
  betrag: number;
  intervall: Intervall;
  faellig: string | null;
  konto: string | null;
  kategorie: string | null;
  aktiv: number;
  notiz: string | null;
  vertrag_ende: string | null;
  frist_wert: number | null;
  frist_einheit: FristEinheit | null;
  verlaengerung: number | null;
  vertrag: VertragsInfo | null;
}

export type Intervall = "monatlich" | "quartal" | "halbjahr" | "jaehrlich";

export interface Summary {
  proMonat: number;
  proJahr: number;
  anzahl: number;
  ohneBetrag: number;
  jeKonto: { name: string; betrag: number }[];
  jeKategorie: { name: string; betrag: number }[];
  einnahmenProMonat: number;
  uebrigProMonat: number;
}

/** Gebuendelte Zahlen fuer die Uebersichtskachel. */
export interface TileData {
  fixProMonat: number;
  einnahmenProMonat: number;
  uebrigProMonat: number;
  monat: { ein: number; aus: number; saldo: number };
  schuldenOffen: number;
  schuldenAnzahl: number;
  naechsteEinnahme: { name: string; datum: string; betrag: number; tage: number } | null;
  naechsteFrist: { name: string; kuendbarBis: string; tage: number; status: VertragStatus } | null;
  ohneBetrag: number;
  anzahl: number;
}

/** Wiederkehrende monatliche Einnahme — bucht sich am Zahltag selbst. */
export interface Einnahme {
  id: number;
  name: string;
  betrag: number;
  tag: number;
  kategorie: string | null;
  konto: string | null;
  notiz: string | null;
  start: string;        // YYYY-MM
  ende: string | null;  // YYYY-MM
  aktiv: number;
  naechster: string | null;
  zuletzt: { periode: string; datum: string } | null;
}

export type EinnahmePayload = Omit<Partial<Einnahme>, "aktiv" | "naechster" | "zuletzt"> & {
  aktiv?: boolean | number;
};

export interface EinnahmeLauf {
  periode: string;
  datum: string;
  buchung_id: number | null;
  betrag: number | null;
}

const base = "/haushalt";

/** Was ans Backend geht. `aktiv` darf boolean sein — der Server normalisiert auf 0/1. */
export type FixkostPayload = Omit<Partial<Fixkost>, "aktiv"> & { aktiv?: boolean | number };

export interface Buchung {
  id: number;
  datum: string;
  art: "eingang" | "ausgang";
  betrag: number;
  kategorie: string | null;
  empfaenger: string | null;
  konto: string | null;
  notiz: string | null;
  /** gesetzt, wenn die Zeile aus einer wiederkehrenden Einnahme entstand */
  einnahme_id?: number | null;
}

export interface JahrRow {
  jahr: number;
  eingang: number;
  ausgang: number;
  differenz: number;
  buchungen: number;
  historisch: boolean;
}

export interface JahrDetail {
  jahr: number;
  monate: { monat: number; eingang: number; ausgang: number }[];
  eingang: number;
  ausgang: number;
  differenz: number;
  uebertrag: { jahr: number; eingang: number; ausgang: number; notiz: string | null } | null;
}

export interface Schuld {
  id: number;
  person: string;
  gesamt: number;
  bezahlt: number;
  offen: number;
  notiz: string | null;
  erledigt: number;
}

export interface Zahlung {
  id: number;
  schuld_id: number;
  datum: string;
  betrag: number;
  notiz: string | null;
}

export const hh = {
  vorschlaege: () => api<Vorschlaege>(`${base}/vorschlaege`),
  list: () => api<Fixkost[]>(`${base}/fixkosten`),
  create: (f: FixkostPayload) =>
    api<{ id: number }>(`${base}/fixkosten`, { method: "POST", body: JSON.stringify(f) }),
  update: (id: number, f: FixkostPayload) =>
    api(`${base}/fixkosten/${id}`, { method: "PUT", body: JSON.stringify(f) }),
  remove: (id: number) => api(`${base}/fixkosten/${id}`, { method: "DELETE" }),
  summary: () => api<Summary>(`${base}/summary`),
  tile: () => api<TileData>(`${base}/tile`),
  vertraege: () => api<Fixkost[]>(`${base}/vertraege`),

  buchungen: (from: string, to: string) =>
    api<Buchung[]>(`${base}/buchungen?from=${from}&to=${to}`),
  createBuchung: (b: Partial<Buchung>) =>
    api<{ id: number }>(`${base}/buchungen`, { method: "POST", body: JSON.stringify(b) }),
  updateBuchung: (id: number, b: Partial<Buchung>) =>
    api(`${base}/buchungen/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  removeBuchung: (id: number) => api(`${base}/buchungen/${id}`, { method: "DELETE" }),

  einnahmen: () => api<Einnahme[]>(`${base}/einnahmen`),
  createEinnahme: (e: EinnahmePayload) =>
    api<{ id: number; gebucht: number }>(`${base}/einnahmen`, { method: "POST", body: JSON.stringify(e) }),
  updateEinnahme: (id: number, e: EinnahmePayload) =>
    api<{ gebucht: number }>(`${base}/einnahmen/${id}`, { method: "PUT", body: JSON.stringify(e) }),
  removeEinnahme: (id: number) => api(`${base}/einnahmen/${id}`, { method: "DELETE" }),
  einnahmeJetzt: (id: number) =>
    api<{ gebucht: number }>(`${base}/einnahmen/${id}/jetzt`, { method: "POST" }),
  einnahmeLaeufe: (id: number) => api<EinnahmeLauf[]>(`${base}/einnahmen/${id}/laeufe`),

  jahre: () => api<JahrRow[]>(`${base}/jahre`),
  jahr: (jahr: number) => api<JahrDetail>(`${base}/jahr/${jahr}`),
  setJahr: (jahr: number, v: { eingang: number; ausgang: number; notiz?: string | null }) =>
    api(`${base}/jahre/${jahr}`, { method: "PUT", body: JSON.stringify(v) }),

  schulden: () => api<Schuld[]>(`${base}/schulden`),
  createSchuld: (s: { person: string; gesamt: number; notiz?: string | null }) =>
    api<{ id: number }>(`${base}/schulden`, { method: "POST", body: JSON.stringify(s) }),
  updateSchuld: (id: number, s: Partial<Schuld> & { erledigt?: boolean | number }) =>
    api(`${base}/schulden/${id}`, { method: "PUT", body: JSON.stringify(s) }),
  removeSchuld: (id: number) => api(`${base}/schulden/${id}`, { method: "DELETE" }),
  zahlungen: (id: number) => api<Zahlung[]>(`${base}/schulden/${id}/zahlungen`),
  addZahlung: (id: number, z: { datum: string; betrag: number; notiz?: string | null }) =>
    api<{ id: number }>(`${base}/schulden/${id}/zahlungen`, { method: "POST", body: JSON.stringify(z) }),
  removeZahlung: (id: number) => api(`${base}/zahlungen/${id}`, { method: "DELETE" }),
};

export const MONATE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/**
 * Vorschlaege fuers Buchungsformular. Kommen aus den eigenen Buchungen
 * (`GET /haushalt/vorschlaege`), nicht mehr aus einer fest verdrahteten Liste.
 */
export interface Vorschlaege {
  empfaenger: string[];
  kategorien: string[];
  konten: string[];
}

/**
 * "1.234,56" -> 1234.56, "12,50" -> 12.5, "12.50" -> 12.5. NaN bei Unsinn.
 * Punkte gelten nur dann als Tausendertrenner, wenn auch ein Komma da ist —
 * sonst waere die englische Schreibweise 12.50 stillschweigend 1250.
 */
export function parseBetrag(s: string): number {
  const t = s.trim().replace(/\s|€/g, "");
  if (!t) return NaN;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
}

export const FRIST_EINHEITEN: { wert: FristEinheit; label: string }[] = [
  { wert: "monate", label: "Monate" },
  { wert: "wochen", label: "Wochen" },
  { wert: "tage", label: "Tage" },
];

/**
 * Sortierrang: was Handeln erfordert, steht oben. Rein nach Restlaufzeit zu
 * sortieren wäre falsch — ein vor Monaten ausgelaufener Vertrag hätte die
 * kleinste Zahl und würde die echten Fristen verdrängen.
 */
const RANG: Record<VertragStatus, number> = {
  dringend: 0,
  verpasst: 1,
  bald: 2,
  offen: 3,
  ausgelaufen: 4,
};

/** Vergleichsfunktion für Vertragslisten: Dringlichkeit, dann Restzeit. */
export const nachDringlichkeit = (a: VertragsInfo, b: VertragsInfo) =>
  RANG[a.status] - RANG[b.status] || a.tage - b.tage;

/** Kurztext für einen Vertragsstatus — einmal definiert, überall gleich. */
export function vertragsText(v: VertragsInfo): string {
  const bis = datumLabel(v.kuendbarBis);
  switch (v.status) {
    case "verpasst":
      return `Kündigungsfrist verstrichen (war ${bis}) — läuft bis ${datumLabel(v.laufzeitBis)}`;
    case "ausgelaufen":
      return `Vertrag ausgelaufen am ${datumLabel(v.laufzeitBis)}`;
    case "dringend":
      return `Kündigen bis ${bis} — nur noch ${v.tage} Tage`;
    case "bald":
      return `Kündigen bis ${bis} (in ${v.tage} Tagen)`;
    default:
      return `Kündbar bis ${bis}`;
  }
}

export const INTERVALLE: { wert: Intervall; label: string; kurz: string }[] = [
  { wert: "monatlich", label: "monatlich", kurz: "mtl." },
  { wert: "quartal", label: "vierteljährlich", kurz: "1/4 J." },
  { wert: "halbjahr", label: "halbjährlich", kurz: "1/2 J." },
  { wert: "jaehrlich", label: "jährlich", kurz: "jährl." },
];

// KATEGORIEN und KONTEN standen hier als feste Listen — die gewachsenen
// Kategorien und echten Banken des Entwicklers. Jetzt in auswahl.ts,
// abgeleitet aus den eigenen Buchungen plus neutralen Vorgaben.

/** Kategorien, die bei Einnahmen Sinn ergeben — die Ausgabenliste passt hier nicht. */
export const EINNAHME_KATEGORIEN = [
  "Gehalt", "Lohnersatz", "Kindergeld", "Rente", "Nebenjob", "Erstattung",
  "Geschenk", "Verkauf", "Zinsen", "Sonstiges",
];

/** Vorschlaege fuer den Namen einer Einnahme. */
export const EINNAHME_NAMEN = [
  "Gehalt", "Bürgergeld", "Kindergeld", "Rente", "Wohngeld", "Unterhalt",
  "Steuererstattung", "Nebenjob", "Taschengeld",
];

/** Aktueller Monat als YYYY-MM in lokaler Zeit. */
export const periodeHeute = () => heuteLokal().slice(0, 7);

/** "2026-07" -> "Juli 2026". Leere/kaputte Werte bleiben unveraendert. */
export function periodeLabel(p: string | null): string {
  if (!p) return "—";
  const [j, m] = p.split("-").map(Number);
  return MONATE[m - 1] ? `${MONATE[m - 1]} ${j}` : p;
}

/** "2026-07-15" -> "15.07.2026". */
export function datumLabel(d: string | null): string {
  if (!d) return "—";
  const [j, m, t] = d.split("-");
  return t ? `${t}.${m}.${j}` : d;
}

const PRO_MONAT: Record<Intervall, number> = {
  monatlich: 1,
  quartal: 1 / 3,
  halbjahr: 1 / 6,
  jaehrlich: 1 / 12,
};

/** Was eine Position pro Monat ausmacht — macht Intervalle vergleichbar. */
export const monatsAnteil = (f: Pick<Fixkost, "betrag" | "intervall">) =>
  f.betrag * (PRO_MONAT[f.intervall] ?? 1);

export const euro = (n: number) =>
  n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/**
 * Heutiges Datum als YYYY-MM-DD in *lokaler* Zeit.
 * NICHT toISOString() nehmen: das rechnet nach UTC um und liefert nachts
 * zwischen 00:00 und 02:00 (MESZ) noch den Vortag.
 */
export function heuteLokal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
