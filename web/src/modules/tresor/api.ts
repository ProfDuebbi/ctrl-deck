import { api } from "../../core/api";
import {
  auswickeln,
  einwickeln,
  entschluesseln,
  entschluesselnBytes,
  KDF_ITERATIONEN,
  neuerDatenschluessel,
  neuesSalz,
  passwortSchluessel,
  verschluesseln,
  verschluesselnBytes,
} from "./crypto";
import type { Kategorie } from "./vorlagen";

const base = "/tresor";

// --- Formen ---------------------------------------------------------------

export interface TresorMeta {
  v: number;
  kdf: string;
  iter: number;
  salt: string;
  wrapped: string;
  created_at: string;
  changed_at: string;
}

export interface AnhangRoh {
  id: number;
  eintrag_id: number;
  dateiname: string; // Chiffrat
  groesse: number;
  created_at: string;
}

export interface EintragRoh {
  id: number;
  kategorie: Kategorie;
  vorlage: string;
  titel: string; // Chiffrat
  wert: string; // Chiffrat
  notiz: string | null; // Chiffrat
  ablauf: string | null;
  vorwarn_tage: number;
  tageBis: number | null;
  created_at: string;
  updated_at: string;
  dateien: AnhangRoh[];
}

export interface Anhang {
  id: number;
  eintrag_id: number;
  /** Entschluesselter Dateiname. */
  name: string;
  /** Entschluesselter MIME-Typ. */
  typ: string;
  groesse: number;
  created_at: string;
}

/** Ein entschluesselter Eintrag — existiert nur im Arbeitsspeicher. */
export interface Eintrag extends Omit<EintragRoh, "titel" | "wert" | "notiz" | "dateien"> {
  titel: string;
  wert: string;
  notiz: string;
  dateien: Anhang[];
  /** Gesetzt, wenn dieser Eintrag sich nicht entschluesseln liess. */
  defekt?: boolean;
}

export interface TresorStatus {
  eingerichtet: boolean;
  anzahl: number;
  dateien: number;
  ablaufend: { id: number; kategorie: Kategorie; ablauf: string; tageBis: number }[];
}

export interface EintragEingabe {
  titel: string;
  wert: string;
  notiz: string;
  kategorie: Kategorie;
  vorlage: string;
  ablauf: string | null;
  vorwarn_tage: number;
}

// --- Rohe Endpunkte -------------------------------------------------------

export const tr = {
  meta: () => api<{ eingerichtet: boolean; meta: TresorMeta | null }>(`${base}/meta`),
  status: () => api<TresorStatus>(`${base}/status`),
  liste: () => api<EintragRoh[]>(`${base}/`),
  remove: (id: number) => api(`${base}/${id}`, { method: "DELETE" }),
  removeDatei: (fid: number) => api(`${base}/dateien/${fid}`, { method: "DELETE" }),
  zuruecksetzen: () => api(`${base}/`, { method: "DELETE" }),
};

// --- Einrichten, entsperren, Passwort wechseln ----------------------------

/**
 * Ersteinrichtung: Datenschluessel wuerfeln, mit dem Passwort einwickeln,
 * das Paeckchen ablegen. Zurueck kommt der offene Schluessel — der Aufrufer
 * zeigt daraus den Wiederherstellungsschluessel an.
 */
export async function tresorEinrichten(passwort: string): Promise<CryptoKey> {
  const salt = neuesSalz();
  const kek = await passwortSchluessel(passwort, salt, KDF_ITERATIONEN);
  const dek = await neuerDatenschluessel();
  const meta = {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: KDF_ITERATIONEN,
    salt,
    wrapped: await einwickeln(dek, kek),
  };
  await api(`${base}/init`, { method: "POST", body: JSON.stringify({ meta }) });
  return dek;
}

/** Wirft, wenn das Passwort nicht passt (die GCM-Pruefsumme schlaegt an). */
export async function tresorOeffnen(passwort: string, meta: TresorMeta): Promise<CryptoKey> {
  const kek = await passwortSchluessel(passwort, meta.salt, meta.iter);
  return auswickeln(meta.wrapped, kek);
}

/** Neues Passwort: derselbe Datenschluessel, nur neu eingewickelt. */
export async function passwortAendern(
  dek: CryptoKey,
  neuesPasswort: string,
  bisher: TresorMeta
): Promise<TresorMeta> {
  const salt = neuesSalz();
  const kek = await passwortSchluessel(neuesPasswort, salt, KDF_ITERATIONEN);
  const meta = {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: KDF_ITERATIONEN,
    salt,
    wrapped: await einwickeln(dek, kek),
  };
  const res = await api<{ meta: TresorMeta }>(`${base}/passwort`, {
    method: "PUT",
    body: JSON.stringify({ meta, bisher: bisher.salt }),
  });
  return res.meta;
}

// --- Eintraege ------------------------------------------------------------

async function chiffriere(key: CryptoKey, e: EintragEingabe) {
  return {
    kategorie: e.kategorie,
    vorlage: e.vorlage,
    ablauf: e.ablauf,
    vorwarn_tage: e.vorwarn_tage,
    titel: await verschluesseln(key, e.titel),
    wert: await verschluesseln(key, e.wert),
    notiz: e.notiz ? await verschluesseln(key, e.notiz) : null,
  };
}

export async function eintragAnlegen(key: CryptoKey, e: EintragEingabe): Promise<number> {
  const res = await api<{ id: number }>(`${base}/`, {
    method: "POST",
    body: JSON.stringify(await chiffriere(key, e)),
  });
  return res.id;
}

export async function eintragSpeichern(key: CryptoKey, id: number, e: EintragEingabe): Promise<void> {
  await api(`${base}/${id}`, { method: "PUT", body: JSON.stringify(await chiffriere(key, e)) });
}

/** Dateiname und MIME-Typ liegen als kleines JSON-Paket im Chiffrat. */
async function anhangEntschluesseln(key: CryptoKey, d: AnhangRoh): Promise<Anhang> {
  let name = `Anhang ${d.id}`;
  let typ = "application/octet-stream";
  try {
    const kopf = JSON.parse(await entschluesseln(key, d.dateiname)) as { n?: string; t?: string };
    if (kopf.n) name = kopf.n;
    if (kopf.t) typ = kopf.t;
  } catch {
    name = "unlesbar";
  }
  return { id: d.id, eintrag_id: d.eintrag_id, name, typ, groesse: d.groesse, created_at: d.created_at };
}

/**
 * Alles holen und aufschliessen. Ein einzelner kaputter Eintrag darf nicht die
 * ganze Liste verschlucken — er wird als `defekt` durchgereicht und in der
 * Ansicht markiert.
 */
export async function eintraegeLaden(key: CryptoKey): Promise<Eintrag[]> {
  const roh = await tr.liste();
  return Promise.all(
    roh.map(async (r): Promise<Eintrag> => {
      try {
        return {
          ...r,
          titel: await entschluesseln(key, r.titel),
          wert: await entschluesseln(key, r.wert),
          notiz: r.notiz ? await entschluesseln(key, r.notiz) : "",
          dateien: await Promise.all(r.dateien.map((d) => anhangEntschluesseln(key, d))),
        };
      } catch {
        return { ...r, titel: "— nicht lesbar —", wert: "", notiz: "", dateien: [], defekt: true };
      }
    })
  );
}

/** Nur die Titel — fuer die Kachel, wenn der Tresor offen ist. */
export async function titelLaden(key: CryptoKey, ids: number[]): Promise<Map<number, string>> {
  const roh = await tr.liste();
  const map = new Map<number, string>();
  await Promise.all(
    roh
      .filter((r) => ids.includes(r.id))
      .map(async (r) => {
        try {
          map.set(r.id, await entschluesseln(key, r.titel));
        } catch {
          /* defekt — dann eben ohne Namen */
        }
      })
  );
  return map;
}

// --- Anhaenge -------------------------------------------------------------

export async function anhangHochladen(key: CryptoKey, eintragId: number, datei: File): Promise<void> {
  const paket = await verschluesselnBytes(key, await datei.arrayBuffer());
  // Der Dateiname verraet oft mehr als der Inhalt ("Steuerbescheid_2024.pdf")
  // und faehrt deshalb ebenfalls verschluesselt mit. Das Chiffrat ist Base64
  // und damit unbedenklich fuer einen HTTP-Kopf, egal wie die Datei heisst.
  const kopf = await verschluesseln(
    key,
    JSON.stringify({ n: datei.name, t: datei.type || "application/octet-stream" })
  );
  const res = await fetch(`/api${base}/${eintragId}/dateien`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Datei-Name": kopf,
      "X-Datei-Groesse": String(datei.size),
    },
    body: paket as BodyInit,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Upload fehlgeschlagen");
}

/** Holt den Anhang und gibt ihn entschluesselt als Blob zurueck. */
export async function anhangHolen(key: CryptoKey, anhang: Anhang): Promise<Blob> {
  const res = await fetch(`/api${base}/dateien/${anhang.id}`);
  if (!res.ok) throw new Error("Anhang nicht gefunden");
  const klar = await entschluesselnBytes(key, await res.arrayBuffer());
  return new Blob([klar], { type: anhang.typ });
}

export function groesseText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
