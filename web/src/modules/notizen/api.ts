import { api } from "../../core/api";
// Notizen leihen sich die Verschluesselung des Tresors — bewusst dieselbe,
// nicht eine zweite. Ein zweites Master-Passwort waere ein zweiter Zettel,
// den man verlieren kann, und dieselbe Krypto in zwei Ausfuehrungen ist eine
// Fehlerquelle mehr. Der Schluessel selbst liegt im Tresor (`vault.ts`) und
// bleibt dort: Wer den Tresor sperrt, sperrt auch die Notizen.
import { entschluesseln, verschluesseln } from "../tresor/crypto";

const base = "/notizen";

// --- Formen ---------------------------------------------------------------

/** Eine Notiz, wie sie in der Datenbank steht. Bei verschluesselten Notizen
 *  sind `titel` und `inhalt` Chiffrate. */
export interface NotizRoh {
  id: number;
  titel: string;
  inhalt: string;
  schlagworte: string;
  angeheftet: number;
  verschluesselt: number;
  wiedervorlage: string | null;
  geloescht_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Listenform: statt des Inhalts nur ein Auszug (leer bei Chiffrat). */
export interface NotizZeile extends Omit<NotizRoh, "inhalt"> {
  auszug: string;
}

/** Was der Editor gerade im Feld stehen hat — immer Klartext. */
export interface Entwurf {
  titel: string;
  inhalt: string;
  schlagworte: string;
  wiedervorlage: string;
  verschluesselt: boolean;
}

export const leererEntwurf = (): Entwurf => ({
  titel: "",
  inhalt: "",
  schlagworte: "",
  wiedervorlage: "",
  verschluesselt: false,
});

// --- Rohe Endpunkte -------------------------------------------------------

export const nz = {
  liste: (papierkorb = false) =>
    api<NotizZeile[]>(`${base}${papierkorb ? "?papierkorb=1" : ""}`),
  eine: (id: number) => api<NotizRoh>(`${base}/${id}`),
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
};

// --- Ver- und Entschluesseln ---------------------------------------------

/**
 * Macht aus dem Entwurf das, was auf die Leitung geht.
 *
 * Schlagworte und Wiedervorlage bleiben auch bei einer verschluesselten
 * Notiz im Klartext — genau wie das Ablaufdatum im Tresor. Sie sind der
 * Preis dafuer, dass Liste, Filter und Terminfaden ueberhaupt etwas anzeigen
 * koennen, solange der Tresor zu ist. Wer das nicht will, laesst sie leer.
 */
export async function zumSenden(e: Entwurf, key: CryptoKey | null): Promise<Record<string, unknown>> {
  const gemeinsam = {
    schlagworte: e.schlagworte,
    wiedervorlage: e.wiedervorlage || null,
    verschluesselt: e.verschluesselt ? 1 : 0,
  };
  if (!e.verschluesselt) return { ...gemeinsam, titel: e.titel, inhalt: e.inhalt };
  if (!key) throw new Error("Der Tresor ist verschlossen — die Notiz wurde nicht gespeichert.");
  return {
    ...gemeinsam,
    titel: await verschluesseln(key, e.titel),
    inhalt: await verschluesseln(key, e.inhalt),
  };
}

/** Eine geladene Notiz als Entwurf — entschluesselt, falls noetig. */
export async function zumBearbeiten(r: NotizRoh, key: CryptoKey | null): Promise<Entwurf> {
  if (!r.verschluesselt) {
    return {
      titel: r.titel,
      inhalt: r.inhalt,
      schlagworte: r.schlagworte,
      wiedervorlage: r.wiedervorlage ?? "",
      verschluesselt: false,
    };
  }
  if (!key) throw new Error("verschlossen");
  return {
    titel: await entschluesseln(key, r.titel),
    inhalt: await entschluesseln(key, r.inhalt),
    schlagworte: r.schlagworte,
    wiedervorlage: r.wiedervorlage ?? "",
    verschluesselt: true,
  };
}

/** Nur den Titel aufschliessen — fuer die Liste. */
export async function titelKlartext(r: NotizZeile, key: CryptoKey): Promise<string> {
  return entschluesseln(key, r.titel);
}

// --- Kleinkram fuer die Anzeige ------------------------------------------

export const OHNE_TITEL = "Ohne Titel";

/**
 * Auszug fuer die Liste — dieselbe grobe Machart wie im Backend.
 *
 * Steht hier noch einmal, weil die Liste nach dem Tippen sofort stimmen soll,
 * ohne dafuer die ganze Liste neu zu holen.
 */
export function kurzfassung(md: string): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}[#>]+\s*/gm, "")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

export function schlagwortListe(s: string): string[] {
  return s.split(",").map((w) => w.trim()).filter(Boolean);
}

/**
 * „vor 3 Minuten", „gestern", „14.08.2026" — je nachdem, wie lange es her
 * ist. Ein voller Zeitstempel an jeder Zeile waere praeziser und nutzloser:
 * bei Notizen zaehlt „frisch oder alt", nicht die Sekunde.
 */
export function wannText(iso: string): string {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${std} h`;
  const heute = new Date();
  const tage = Math.round(
    (new Date(heute.getFullYear(), heute.getMonth(), heute.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000
  );
  if (tage === 1) return "gestern";
  if (tage < 7) return `vor ${tage} Tagen`;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function datumDe(iso: string): string {
  const [j, m, t] = iso.split("-");
  return `${t}.${m}.${j}`;
}

/** Lokales Heute als YYYY-MM-DD. `toISOString()` waere UTC (siehe CLAUDE.md). */
export function heuteLokal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
