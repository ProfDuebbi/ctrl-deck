import { api } from "../../core/api";
// Dokumente leihen sich die Verschluesselung des Tresors — bewusst dieselbe,
// nicht eine zweite. Dieselbe Ueberlegung wie bei den Notizen: ein zweites
// Master-Passwort waere ein zweiter Zettel, den man verlieren kann. Der
// Schluessel bleibt im Tresor (`vault.ts`); wer ihn sperrt, sperrt auch hier.
import {
  entschluesseln, entschluesselnBytes, verschluesseln, verschluesselnBytes,
} from "../tresor/crypto";

const base = "/dokumente";

// --- Formen ---------------------------------------------------------------

/** Eine Datei, wie sie in der Datenbank steht. `dateiname` kann Chiffrat sein. */
export interface DateiRoh {
  id: number;
  dokument_id: number;
  dateiname: string;
  /** MIME-Typ, IMMER Klartext — daran haengt die Vorschau. */
  typ: string;
  /** Klartextgroesse in Bytes. */
  groesse: number;
  created_at: string;
}

/** Dieselbe Datei mit lesbarem Namen. */
export interface Datei extends Omit<DateiRoh, "dateiname"> {
  name: string;
}

/**
 * Ein Dokument, wie es vom Server kommt. Bei einem verschluesselten Eintrag
 * sind `titel`, `ablageort` und `notiz` Chiffrate.
 */
export interface DokumentRoh {
  id: number;
  titel: string;
  kategorie: string;
  schlagworte: string;
  ablageort: string;
  notiz: string;
  datum: string | null;
  ablauf: string | null;
  vorwarn_tage: number | null;
  verschluesselt: number;
  geloescht_at: string | null;
  created_at: string;
  updated_at: string;
  dateien: DateiRoh[];
}

/** Aufgeschlossen — oder, solange der Tresor zu ist, mit Platzhaltern. */
export interface Dokument extends Omit<DokumentRoh, "dateien"> {
  dateien: Datei[];
  /** Verschluesselt und Tresor zu: Titel und Text sind noch Chiffrat. */
  zu?: boolean;
  /** Verschluesselt, Tresor offen, aber das Chiffrat passt nicht zum Schluessel. */
  defekt?: boolean;
}

/** Was im Formular steht — immer Klartext. */
export interface Entwurf {
  titel: string;
  kategorie: string;
  schlagworte: string;
  ablageort: string;
  notiz: string;
  datum: string;
  ablauf: string;
  vorwarn_tage: number;
  verschluesselt: boolean;
}

export const VORWARN_STANDARD = 30;

export const leererEntwurf = (): Entwurf => ({
  titel: "",
  kategorie: "",
  schlagworte: "",
  ablageort: "",
  notiz: "",
  datum: "",
  ablauf: "",
  vorwarn_tage: VORWARN_STANDARD,
  verschluesselt: false,
});

// --- Rohe Endpunkte -------------------------------------------------------

export const dk = {
  liste: (papierkorb = false) =>
    api<DokumentRoh[]>(`${base}${papierkorb ? "?papierkorb=1" : ""}`),
  eine: (id: number) => api<DokumentRoh>(`${base}/${id}`),
  kategorien: () => api<string[]>(`${base}/kategorien`),
  anlegenRoh: (d: Record<string, unknown>) =>
    api<{ id: number; created_at: string; updated_at: string }>(base, {
      method: "POST",
      body: JSON.stringify(d),
    }),
  aendernRoh: (id: number, d: Record<string, unknown>) =>
    api<{ ok: true; updated_at: string }>(`${base}/${id}`, {
      method: "PUT",
      body: JSON.stringify(d),
    }),
  loeschen: (id: number, endgueltig = false) =>
    api(`${base}/${id}${endgueltig ? "?endgueltig=1" : ""}`, { method: "DELETE" }),
  zurueck: (id: number) => api(`${base}/${id}/zurueck`, { method: "POST" }),
  papierkorbLeeren: () => api<{ geloescht: number }>(`${base}/papierkorb`, { method: "DELETE" }),
  dateiLoeschen: (fid: number) => api(`${base}/dateien/${fid}`, { method: "DELETE" }),
};

// --- Ver- und Entschluesseln ---------------------------------------------

/**
 * Macht aus dem Entwurf das, was auf die Leitung geht.
 *
 * Kategorie, Schlagworte und die beiden Daten bleiben auch bei einem
 * verschluesselten Dokument im Klartext — genau wie das Ablaufdatum im Tresor.
 * Sie sind der Preis dafuer, dass Liste, Fächer-Filter und Terminfaden
 * ueberhaupt etwas anzeigen koennen, solange der Tresor zu ist. Wer das nicht
 * will, laesst sie leer.
 */
export async function zumSenden(e: Entwurf, key: CryptoKey | null): Promise<Record<string, unknown>> {
  const gemeinsam = {
    kategorie: e.kategorie,
    schlagworte: e.schlagworte,
    datum: e.datum || null,
    ablauf: e.ablauf || null,
    vorwarn_tage: e.vorwarn_tage,
    verschluesselt: e.verschluesselt ? 1 : 0,
  };
  if (!e.verschluesselt) {
    return { ...gemeinsam, titel: e.titel, ablageort: e.ablageort, notiz: e.notiz };
  }
  if (!key) throw new Error("Der Tresor ist verschlossen — das Dokument wurde nicht gespeichert.");
  return {
    ...gemeinsam,
    titel: await verschluesseln(key, e.titel),
    ablageort: await verschluesseln(key, e.ablageort),
    notiz: await verschluesseln(key, e.notiz),
  };
}

/** Der Dateiname faehrt bei verschluesselten Dokumenten selbst als Chiffrat. */
async function dateiKlartext(d: DateiRoh, key: CryptoKey | null, chiffriert: boolean): Promise<Datei> {
  const { dateiname, ...rest } = d;
  if (!chiffriert) return { ...rest, name: dateiname };
  if (!key) return { ...rest, name: "Verschlüsselte Datei" };
  try {
    return { ...rest, name: await entschluesseln(key, dateiname) };
  } catch {
    return { ...rest, name: "unlesbar" };
  }
}

/**
 * Ein Dokument zum Anzeigen. Ist es verschluesselt und der Tresor zu, bleiben
 * Titel und Texte weg — es wird als `zu` markiert, damit die Ansicht das kleine
 * Schloss zeigen kann statt Zeichensalat.
 */
export async function zumAnzeigen(r: DokumentRoh, key: CryptoKey | null): Promise<Dokument> {
  if (!r.verschluesselt) {
    return { ...r, dateien: await Promise.all(r.dateien.map((d) => dateiKlartext(d, null, false))) };
  }
  if (!key) {
    return {
      ...r,
      titel: "", ablageort: "", notiz: "",
      dateien: await Promise.all(r.dateien.map((d) => dateiKlartext(d, null, true))),
      zu: true,
    };
  }
  try {
    return {
      ...r,
      titel: await entschluesseln(key, r.titel),
      ablageort: r.ablageort ? await entschluesseln(key, r.ablageort) : "",
      notiz: r.notiz ? await entschluesseln(key, r.notiz) : "",
      dateien: await Promise.all(r.dateien.map((d) => dateiKlartext(d, key, true))),
    };
  } catch {
    // Ein einzelnes kaputtes Chiffrat darf nicht die ganze Liste verschlucken.
    return { ...r, titel: "", ablageort: "", notiz: "", dateien: [], defekt: true };
  }
}

/** Ein geladenes Dokument als Entwurf fuers Formular. */
export function zumBearbeiten(d: Dokument): Entwurf {
  return {
    titel: d.titel,
    kategorie: d.kategorie,
    schlagworte: d.schlagworte,
    ablageort: d.ablageort,
    notiz: d.notiz,
    datum: d.datum ?? "",
    ablauf: d.ablauf ?? "",
    vorwarn_tage: d.vorwarn_tage ?? VORWARN_STANDARD,
    verschluesselt: !!d.verschluesselt,
  };
}

// --- Dateien --------------------------------------------------------------

/** 64 MB — dieselbe Grenze wie im Server (`MAX_DATEI`). */
export const MAX_DATEI_BYTES = 64 * 1024 * 1024;

/** UTF-8 nach Base64 — ein HTTP-Kopf vertraegt kein „Prämie.pdf". */
function nachB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let roh = "";
  for (const b of bytes) roh += String.fromCharCode(b);
  return btoa(roh);
}

export async function dateiHochladen(
  dokumentId: number, datei: File, chiffriert: boolean, key: CryptoKey | null
): Promise<DateiRoh> {
  if (datei.size > MAX_DATEI_BYTES) throw new Error("Die Datei ist größer als 64 MB.");
  if (chiffriert && !key) throw new Error("Der Tresor ist verschlossen.");

  const roh = await datei.arrayBuffer();
  const koerper = chiffriert ? await verschluesselnBytes(key!, roh) : new Uint8Array(roh);
  // Der Name faehrt verschluesselt mit, wenn das Dokument es ist — ein
  // „Kuendigung_Mietvertrag.pdf" ist selbst schon eine Auskunft. Sonst als
  // Base64, weil ein HTTP-Kopf nur Latin-1 kann.
  const name = chiffriert ? await verschluesseln(key!, datei.name) : nachB64(datei.name);

  const res = await fetch(`/api${base}/${dokumentId}/dateien`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Datei-Name": name,
      "X-Datei-Typ": datei.type || "application/octet-stream",
      "X-Datei-Groesse": String(datei.size),
      ...(chiffriert ? { "X-Datei-Chiffre": "1" } : {}),
    },
    body: koerper as BodyInit,
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => null))?.error ?? "Hochladen fehlgeschlagen");
  }
  return res.json();
}

/**
 * Eine Datei ablegen, ohne vorher einen Eintrag anzulegen — der entsteht mit.
 *
 * Der Titel ist der Dateiname ohne Endung: „Police 2026.pdf" wird zu
 * „Police 2026". Die Endung steht ohnehin gleich daneben am Dateisymbol, und
 * ein Titel, der sie mitschleppt, liest sich wie ein Verzeichniseintrag statt
 * wie ein Schriftstueck.
 */
export async function dokumentAusDatei(
  datei: File, kategorie: string, chiffriert: boolean, key: CryptoKey | null
): Promise<number> {
  if (datei.size > MAX_DATEI_BYTES) throw new Error(`„${datei.name}" ist größer als 64 MB.`);
  const titel = datei.name.replace(/\.[^.]+$/, "").trim() || datei.name;
  const entwurf: Entwurf = { ...leererEntwurf(), titel, kategorie, verschluesselt: chiffriert };
  const { id } = await dk.anlegenRoh(await zumSenden(entwurf, key));
  try {
    await dateiHochladen(id, datei, chiffriert, key);
  } catch (err) {
    // Ein Eintrag ohne die Datei, wegen der es ihn gibt, ist Muell — weg damit.
    await dk.loeschen(id, true).catch(() => {});
    throw err;
  }
  return id;
}

/**
 * Alle Dateien eines Dokuments von Klartext auf Chiffrat umstellen (oder
 * zurueck).
 *
 * Ohne das waere der Schalter „Verschlüsseln" eine Luege: Titel und Notiz
 * wuerden zu Chiffrat, die Dateien blieben im Klartext liegen — und beim
 * naechsten Oeffnen versuchte die Ansicht, sie zu entschluesseln, und
 * scheiterte. Der Server kann das nicht tun; er kennt den Schluessel nicht.
 *
 * Erst hochladen, dann die alte Fassung loeschen. Andersherum waere die Datei
 * bei einem Fehler mittendrin verloren.
 */
export async function dateienUmschluesseln(
  dokumentId: number, dateien: Datei[], vorher: boolean, nachher: boolean, key: CryptoKey | null
): Promise<void> {
  if (vorher === nachher || dateien.length === 0) return;
  for (const alt of dateien) {
    const blob = await dateiHolen(alt, vorher, key);
    const neu = new File([blob], alt.name, { type: alt.typ || "application/octet-stream" });
    await dateiHochladen(dokumentId, neu, nachher, key);
    await dk.dateiLoeschen(alt.id);
  }
}

/** Holt eine Datei und gibt sie lesbar als Blob zurueck. */
export async function dateiHolen(
  datei: Datei, chiffriert: boolean, key: CryptoKey | null
): Promise<Blob> {
  const res = await fetch(`/api${base}/dateien/${datei.id}`);
  if (!res.ok) throw new Error("Die Datei ist nicht mehr da.");
  const roh = await res.arrayBuffer();
  const typ = datei.typ || "application/octet-stream";
  if (!chiffriert) return new Blob([roh], { type: typ });
  if (!key) throw new Error("Der Tresor ist verschlossen.");
  return new Blob([await entschluesselnBytes(key, roh)], { type: typ });
}

// --- Kleinkram fuer die Anzeige ------------------------------------------

export const OHNE_TITEL = "Ohne Titel";

/**
 * Kann der Browser das selbst zeigen?
 *
 * Bewusst knapp gehalten: PDF und Bilder deckt jeder Browser von sich aus ab.
 * Alles andere waere ein eingebauter Betrachter fuer Formate, die auf dem
 * Rechner ohnehin ein besseres Programm haben.
 */
export function istVorschaubar(typ: string): boolean {
  return typ === "application/pdf" || typ.startsWith("image/");
}

export function groesseText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function schlagwortListe(s: string): string[] {
  return s.split(",").map((w) => w.trim()).filter(Boolean);
}

export function datumDe(iso: string | null): string {
  if (!iso) return "—";
  const [j, m, t] = iso.split("-");
  return t ? `${t}.${m}.${j}` : iso;
}

/** Lokales Heute als YYYY-MM-DD. `toISOString()` waere UTC (siehe CLAUDE.md). */
export function heuteLokal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Wie viele Tage noch bis zum Datum? Negativ heisst: schon vorbei. */
export function tageBis(iso: string): number {
  const [j, m, t] = iso.split("-").map(Number);
  const ziel = new Date(j, m - 1, t);
  const heute = new Date();
  const heuteRein = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
  return Math.round((ziel.getTime() - heuteRein.getTime()) / 86400000);
}

export type AblaufStatus = "abgelaufen" | "bald" | "offen";

export function ablaufStatus(d: Pick<Dokument, "ablauf" | "vorwarn_tage">): AblaufStatus | null {
  if (!d.ablauf) return null;
  const tage = tageBis(d.ablauf);
  if (tage < 0) return "abgelaufen";
  return tage <= (d.vorwarn_tage ?? VORWARN_STANDARD) ? "bald" : "offen";
}

export function ablaufText(d: Pick<Dokument, "ablauf" | "vorwarn_tage">): string {
  if (!d.ablauf) return "";
  const tage = tageBis(d.ablauf);
  if (tage < 0) return `abgelaufen am ${datumDe(d.ablauf)}`;
  if (tage === 0) return "läuft heute ab";
  if (tage === 1) return "läuft morgen ab";
  if (tage < 60) return `läuft in ${tage} Tagen ab`;
  return `gültig bis ${datumDe(d.ablauf)}`;
}
