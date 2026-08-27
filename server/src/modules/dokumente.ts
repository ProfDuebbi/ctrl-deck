import fs from "node:fs";
import path from "node:path";
import { raw } from "express";
import { machRouter } from "../route.js";
import { db, sicherungMoeglich } from "../db.js";
import { DOKUMENTE_DIR } from "../paths.js";
import {
  fruehestes, tageZaehlen,
  type ProfilBeitrag, type ProfilZahl, type ServerModule, type Termin, type Treffer,
} from "./index.js";

/**
 * DOKUMENTENABLAGE — der Aktenschrank.
 *
 * Ein Eintrag ist ein Schriftstueck: Versicherungspolice, Steuerbescheid,
 * Mietvertrag, Garantie. Die Datei dazu ist OPTIONAL. Das ist Absicht und der
 * wichtigste Unterschied zu einer reinen Dateiablage: Vieles liegt weiter auf
 * Papier, und ein Eintrag, der nur sagt „Ordner 3, Register Versicherungen",
 * ist beim Suchen genauso viel wert wie ein Scan. Ein Aktenschrank, in dem die
 * Haelfte fehlt, weil sie nicht eingescannt ist, waere kein Verzeichnis.
 *
 * EIN DOKUMENT KANN VERSCHLUESSELT SEIN — wie bei den Notizen mit demselben
 * Schluessel wie der Tresor, umschaltbar pro Eintrag. Dann sind Titel, Notiz,
 * Ablageort, Dateiname und Dateiinhalt Chiffrate aus dem Browser. Im Klartext
 * bleibt nur, was eine Ansicht bei geschlossenem Tresor braucht: Kategorie,
 * Schlagworte, Daten, Dateityp und -groesse. Verschluesselte Dokumente
 * erscheinen deshalb NICHT in der globalen Suche.
 */

// --- Schema ---------------------------------------------------------------

/** Nach dieser Frist raeumt der Papierkorb sich selbst. */
const PAPIERKORB_TAGE = 30;

/**
 * Kategorien, die von Haus aus zur Wahl stehen. Keine feste Liste: Die
 * Oberflaeche mischt sie mit dem, was schon benutzt wurde, und eigene sind
 * jederzeit eintippbar. Ein Aktenschrank, dessen Faecher jemand anders
 * festgelegt hat, passt nie zum eigenen Papier.
 */
const KATEGORIEN = [
  "Versicherung", "Steuer", "Wohnung", "Fahrzeug",
  "Gesundheit", "Arbeit", "Behörden", "Verträge", "Sonstiges",
];

async function einrichten(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dokumente (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      titel          TEXT NOT NULL DEFAULT '',   -- Klartext, oder Chiffrat
      kategorie      TEXT NOT NULL DEFAULT '',   -- immer Klartext
      schlagworte    TEXT NOT NULL DEFAULT '',   -- immer Klartext, ", "-getrennt
      ablageort      TEXT NOT NULL DEFAULT '',   -- Klartext, oder Chiffrat
      notiz          TEXT NOT NULL DEFAULT '',   -- Klartext, oder Chiffrat
      datum          TEXT,                       -- ausgestellt am, 'JJJJ-MM-TT'
      ablauf         TEXT,                       -- gilt bis, 'JJJJ-MM-TT'
      vorwarn_tage   INTEGER,                    -- wie viele Tage vorher warnen
      verschluesselt INTEGER NOT NULL DEFAULT 0,
      geloescht_at   TEXT,                       -- gesetzt = im Papierkorb
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dokument_dateien (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      dokument_id INTEGER NOT NULL REFERENCES dokumente(id) ON DELETE CASCADE,
      dateiname   TEXT NOT NULL,              -- Klartext, oder Chiffrat
      typ         TEXT NOT NULL DEFAULT '',   -- MIME-Typ, immer Klartext
      groesse     INTEGER NOT NULL,           -- Klartextgroesse in Bytes
      created_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dokumente_papierkorb ON dokumente (geloescht_at);
    CREATE INDEX IF NOT EXISTS idx_dokument_dateien ON dokument_dateien (dokument_id);
  `);

  // Wie im Tresor: die Spalte bleibt NULL, solange die Dateien in
  // `data/dokumente/` liegen. Gefuellt wird sie nur bei einer angeschlossenen
  // Datenbank, wo es kein verlaessliches Dateisystem gibt.
  const spalten = new Set(
    (await db.alle<{ name: string }>("PRAGMA table_info(dokument_dateien)")).map((c) => c.name)
  );
  if (!spalten.has("inhalt")) await db.exec("ALTER TABLE dokument_dateien ADD COLUMN inhalt BLOB");

  // Der Papierkorb raeumt beim Start auf — dieselbe Linie wie bei den Notizen.
  // Die Dateien nimmt der Fremdschluessel NICHT mit, die muessen von Hand weg.
  const grenze = new Date(Date.now() - PAPIERKORB_TAGE * 86400000).toISOString();
  const faellig = await db.alle<{ id: number }>(
    `SELECT f.id FROM dokument_dateien f
       JOIN dokumente d ON d.id = f.dokument_id
      WHERE d.geloescht_at IS NOT NULL AND d.geloescht_at < ?`,
    grenze
  );
  await db.schreibe(
    "DELETE FROM dokumente WHERE geloescht_at IS NOT NULL AND geloescht_at < ?", grenze
  );
  for (const f of faellig) loescheDatei(f.id);
}

const now = () => new Date().toISOString();

// --- Dateien --------------------------------------------------------------

/*
 * Wo eine Datei liegt, haengt davon ab, wo die Datenbank liegt — wortgleich
 * zur Ueberlegung im Tresor: LOKAL als eigene Datei in `data/dokumente/`
 * (verschluesselt, der Name ist nur die laufende Nummer), bei ANGESCHLOSSENER
 * Datenbank in der Spalte `inhalt`, weil ein Container seine Platte beim
 * Neustart vergisst. Gelesen wird immer beides, erst die Spalte, dann die
 * Platte — so bleibt ein Bestand aus der Zeit vor einem Umzug lesbar.
 */
const inDatenbank = () => !sicherungMoeglich();
const dateiPfad = (id: number | bigint) => path.join(DOKUMENTE_DIR, `${id}.bin`);

function loescheDatei(id: number | bigint): void {
  try { fs.rmSync(dateiPfad(id)); } catch { /* schon weg oder nie dagewesen */ }
}

/** 64 MB — dieselbe Grenze wie bei den Tresor-Anhaengen. */
const MAX_DATEI = "64mb";

// --- Helfer ---------------------------------------------------------------

const OHNE_TITEL = "Ohne Titel";

const istDatum = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Vorgabe, wie viele Tage vor Ablauf gewarnt wird. */
const VORWARN_STANDARD = 30;

const MAX_TEXT = 4_000;
const MAX_TITEL = 200;

/**
 * Schlagworte aufraeumen: trimmen, Leere weg, Doppelte weg (ohne Ruecksicht
 * auf Gross- und Kleinschreibung), gedeckelt. Wie bei den Notizen — bewusst
 * dieselbe Form, damit sich beide Module gleich anfuehlen.
 */
function schlagworte(roh: unknown): string {
  const teile = Array.isArray(roh) ? roh.map(String) : String(roh ?? "").split(",");
  const gesehen = new Set<string>();
  const out: string[] = [];
  for (const t of teile) {
    const wort = t.trim().replace(/\s+/g, " ").slice(0, 32);
    if (!wort) continue;
    const k = wort.toLowerCase();
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    out.push(wort);
    if (out.length >= 12) break;
  }
  return out.join(", ");
}

type Zeile = {
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
};

type DateiZeile = {
  id: number;
  dokument_id: number;
  dateiname: string;
  typ: string;
  groesse: number;
  created_at: string;
};

/**
 * Nimmt entgegen, was der Browser schickt, und gibt zurueck, was wirklich
 * geschrieben werden darf — oder eine Meldung.
 *
 * `nurGesetzte` ist der Unterschied zwischen Anlegen und Aendern: Beim Aendern
 * schickt die Ansicht oft nur ein einziges Feld, und ein fehlendes Feld darf
 * dann nicht als "leer" durchgehen.
 */
function felderAus(b: Record<string, unknown>, nurGesetzte: boolean):
  { felder: Record<string, string | number | null> } | { fehler: string } {
  const f: Record<string, string | number | null> = {};
  // Ein Chiffrat ist laenger als sein Klartext — Laengengrenzen gelten nur
  // dort, wo der Server ueberhaupt Klartext sieht.
  const offen = !b.verschluesselt;

  if (!nurGesetzte || b.titel !== undefined) {
    const titel = String(b.titel ?? "").trim();
    if (offen && titel.length > MAX_TITEL)
      return { fehler: `Der Titel ist zu lang (höchstens ${MAX_TITEL} Zeichen).` };
    f.titel = titel;
  }
  if (!nurGesetzte || b.kategorie !== undefined) {
    f.kategorie = String(b.kategorie ?? "").trim().slice(0, 60);
  }
  if (!nurGesetzte || b.schlagworte !== undefined) f.schlagworte = schlagworte(b.schlagworte);
  for (const feld of ["ablageort", "notiz"] as const) {
    if (nurGesetzte && b[feld] === undefined) continue;
    const wert = String(b[feld] ?? "");
    if (offen && wert.length > MAX_TEXT) return { fehler: "Der Text ist zu lang." };
    f[feld] = wert;
  }
  for (const feld of ["datum", "ablauf"] as const) {
    if (nurGesetzte && b[feld] === undefined) continue;
    const d = b[feld] == null ? "" : String(b[feld]);
    if (d && !istDatum(d)) return { fehler: "Das ist kein gültiges Datum." };
    f[feld] = d || null;
  }
  if (!nurGesetzte || b.vorwarn_tage !== undefined) {
    const v = Number(b.vorwarn_tage);
    f.vorwarn_tage = Number.isFinite(v) && v >= 0 ? Math.min(365, Math.round(v)) : VORWARN_STANDARD;
  }
  if (!nurGesetzte || b.verschluesselt !== undefined) f.verschluesselt = b.verschluesselt ? 1 : 0;
  return { felder: f };
}

// --- Router ---------------------------------------------------------------

const router = machRouter();

/**
 * Die Liste, jeweils mit ihren Dateien.
 *
 * Gefiltert und gesucht wird in der Ansicht, nicht hier: Der Titel eines
 * verschluesselten Dokuments ist fuer den Server Rauschen, und ein Suchfeld,
 * das einen Teil des Bestands stillschweigend uebergeht, waere schlimmer als
 * keines. Es sind Aktenstuecke, keine Messreihen — die Liste bleibt klein.
 */
router.get("/", async (req, res) => {
  const imPapierkorb = req.query.papierkorb === "1";
  const rows = await db.alle<Zeile>(
    `SELECT * FROM dokumente
      WHERE geloescht_at IS ${imPapierkorb ? "NOT" : ""} NULL
      ORDER BY ${imPapierkorb ? "geloescht_at DESC" : "updated_at DESC"}`
  );
  const dateien = await db.alle<DateiZeile>(
    `SELECT f.id, f.dokument_id, f.dateiname, f.typ, f.groesse, f.created_at
       FROM dokument_dateien f
       JOIN dokumente d ON d.id = f.dokument_id
      WHERE d.geloescht_at IS ${imPapierkorb ? "NOT" : ""} NULL
      ORDER BY f.id`
  );
  const jeDokument = new Map<number, DateiZeile[]>();
  for (const d of dateien) {
    const liste = jeDokument.get(d.dokument_id);
    if (liste) liste.push(d);
    else jeDokument.set(d.dokument_id, [d]);
  }
  res.json(rows.map((r) => ({ ...r, dateien: jeDokument.get(r.id) ?? [] })));
});

/**
 * Kategorien zur Auswahl: die vorgegebenen und alles, was schon benutzt wurde.
 *
 * Ein eigenes Fach anzulegen soll heissen, es einmal einzutippen — nicht, es
 * vorher irgendwo zu verwalten.
 */
router.get("/kategorien", async (_req, res) => {
  const rows = await db.alle<{ kategorie: string }>(
    "SELECT DISTINCT kategorie FROM dokumente WHERE kategorie <> '' AND geloescht_at IS NULL"
  );
  const alle = new Set([...KATEGORIEN, ...rows.map((r) => r.kategorie)]);
  res.json([...alle].sort((a, b) => a.localeCompare(b, "de")));
});

/** Papierkorb leeren. Steht VOR "/:id", sonst faengt die Zahl-Route das ab. */
router.delete("/papierkorb", async (_req, res) => {
  const dateien = await db.transaktion(async () => {
    const liste = await db.alle<{ id: number }>(
      `SELECT f.id FROM dokument_dateien f
         JOIN dokumente d ON d.id = f.dokument_id
        WHERE d.geloescht_at IS NOT NULL`
    );
    await db.schreibe("DELETE FROM dokumente WHERE geloescht_at IS NOT NULL");
    return liste;
  });
  for (const f of dateien) loescheDatei(f.id);
  res.json({ ok: true, geloescht: dateien.length });
});

router.get("/:id", async (req, res) => {
  const r = await db.eine<Zeile>("SELECT * FROM dokumente WHERE id=?", req.params.id);
  if (!r) return res.status(404).json({ error: "Dokument nicht gefunden" });
  const dateien = await db.alle<DateiZeile>(
    "SELECT id, dokument_id, dateiname, typ, groesse, created_at FROM dokument_dateien WHERE dokument_id=? ORDER BY id",
    r.id
  );
  res.json({ ...r, dateien });
});

router.post("/", async (req, res) => {
  const geprueft = felderAus(req.body ?? {}, false);
  if ("fehler" in geprueft) return res.status(400).json({ error: geprueft.fehler });
  const f = geprueft.felder;
  const t = now();
  const info = await db.schreibe(
    `INSERT INTO dokumente
       (titel, kategorie, schlagworte, ablageort, notiz, datum, ablauf,
        vorwarn_tage, verschluesselt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.titel, f.kategorie, f.schlagworte, f.ablageort, f.notiz, f.datum, f.ablauf,
    f.vorwarn_tage, f.verschluesselt, t, t
  );
  res.json({ id: info.id, created_at: t, updated_at: t });
});

router.put("/:id", async (req, res) => {
  const geprueft = felderAus(req.body ?? {}, true);
  if ("fehler" in geprueft) return res.status(400).json({ error: geprueft.fehler });
  const f = geprueft.felder;
  const namen = Object.keys(f);
  if (namen.length === 0) return res.status(400).json({ error: "Nichts zu ändern" });

  const t = now();
  const satz = [...namen.map((k) => `${k}=?`), "updated_at=?"].join(", ");
  const werte = [...namen.map((k) => f[k]), t, req.params.id];
  const info = await db.schreibe(`UPDATE dokumente SET ${satz} WHERE id=?`, ...werte);
  if (info.zeilen === 0) return res.status(404).json({ error: "Dokument nicht gefunden" });
  res.json({ ok: true, updated_at: t });
});

/**
 * Loeschen heisst: in den Papierkorb. `?endgueltig=1` loescht wirklich.
 *
 * Bei einer Urkunde, die als Scan nur hier liegt, ist der Umweg kein Luxus.
 */
router.delete("/:id", async (req, res) => {
  const endgueltig = req.query.endgueltig === "1";
  if (!endgueltig) {
    const info = await db.schreibe(
      "UPDATE dokumente SET geloescht_at=? WHERE id=? AND geloescht_at IS NULL",
      now(), req.params.id
    );
    if (info.zeilen === 0) return res.status(404).json({ error: "Dokument nicht gefunden" });
    return res.json({ ok: true });
  }

  // Die Datenbankzeilen raeumt der Fremdschluessel weg, die Dateien nicht.
  const ergebnis = await db.transaktion(async () => {
    const dateien = await db.alle<{ id: number }>(
      "SELECT id FROM dokument_dateien WHERE dokument_id=?", req.params.id
    );
    const info = await db.schreibe("DELETE FROM dokumente WHERE id=?", req.params.id);
    return { dateien, zeilen: info.zeilen };
  });
  if (ergebnis.zeilen === 0) return res.status(404).json({ error: "Dokument nicht gefunden" });
  for (const f of ergebnis.dateien) loescheDatei(f.id);
  res.json({ ok: true });
});

router.post("/:id/zurueck", async (req, res) => {
  const info = await db.schreibe(
    "UPDATE dokumente SET geloescht_at=NULL, updated_at=? WHERE id=? AND geloescht_at IS NOT NULL",
    now(), req.params.id
  );
  if (info.zeilen === 0) return res.status(404).json({ error: "Dokument nicht im Papierkorb" });
  res.json({ ok: true });
});

// --- Dateien --------------------------------------------------------------

/**
 * Der Rumpf ist der Dateiinhalt — bei einem verschluesselten Dokument bereits
 * im Browser verschluesselt. Name und Typ kommen im Kopf mit, weil ein Rumpf
 * aus reinem Chiffrat sonst nichts ueber sich verraet.
 *
 * Der MIME-Typ bleibt auch bei einem verschluesselten Dokument im Klartext:
 * Die Liste muss ohne offenen Tresor sagen koennen, ob hier ein PDF oder ein
 * Foto liegt, und mehr sagt er nicht. Genau wie die Groesse beim Tresor.
 */
router.post("/:id/dateien", raw({ type: "application/octet-stream", limit: MAX_DATEI }), async (req, res) => {
  const dokument = await db.eine<{ id: number }>(
    "SELECT id FROM dokumente WHERE id=?", req.params.id
  );
  if (!dokument) return res.status(404).json({ error: "Dokument nicht gefunden" });

  const rohName = String(req.header("x-datei-name") ?? "").trim();
  if (!rohName) return res.status(400).json({ error: "Dateiname fehlt" });
  const daten = req.body as Buffer;
  if (!Buffer.isBuffer(daten) || daten.length === 0)
    return res.status(400).json({ error: "Datei ist leer" });

  /*
   * Der Name kommt IMMER in Base64. Bei einem verschluesselten Dokument, weil
   * "Kuendigung_Mietvertrag.pdf" selbst schon eine Auskunft ist — dann ist es
   * ein Chiffrat und bleibt hier eines. Bei einem offenen Dokument, weil ein
   * HTTP-Kopf nur Latin-1 vertraegt: ein „Prämie.pdf" liesse sich sonst gar
   * nicht senden. Nur im offenen Fall wird ausgepackt.
   */
  const verschluesselt = req.header("x-datei-chiffre") === "1";
  let name = rohName;
  if (!verschluesselt) {
    try {
      name = Buffer.from(rohName, "base64").toString("utf8").trim();
    } catch {
      return res.status(400).json({ error: "Dateiname ist unlesbar" });
    }
    if (!name) return res.status(400).json({ error: "Dateiname fehlt" });
    name = name.slice(0, 255);
  }

  const typ = String(req.header("x-datei-typ") ?? "").trim().slice(0, 120);
  const groesse = Number(req.header("x-datei-groesse")) || daten.length;
  const t = now();

  if (inDatenbank()) {
    // Zeile und Inhalt in einem Zug — eine Zeile ohne Inhalt waere eine Datei,
    // die die Oberflaeche anbietet und die beim Anklicken nicht da ist.
    const info = await db.schreibe(
      "INSERT INTO dokument_dateien (dokument_id, dateiname, typ, groesse, created_at, inhalt) VALUES (?, ?, ?, ?, ?, ?)",
      dokument.id, name, typ, groesse, t, new Uint8Array(daten)
    );
    return res.json({ id: info.id, dateiname: name, typ, groesse, created_at: t });
  }

  const info = await db.schreibe(
    "INSERT INTO dokument_dateien (dokument_id, dateiname, typ, groesse, created_at) VALUES (?, ?, ?, ?, ?)",
    dokument.id, name, typ, groesse, t
  );
  try {
    fs.writeFileSync(dateiPfad(info.id), daten);
  } catch {
    await db.schreibe("DELETE FROM dokument_dateien WHERE id=?", info.id);
    return res.status(500).json({ error: "Datei konnte nicht gespeichert werden" });
  }
  res.json({ id: info.id, dateiname: name, typ, groesse, created_at: t });
});

router.get("/dateien/:fid", async (req, res) => {
  const row = await db.eine<{ id: number; inhalt: Uint8Array | null }>(
    "SELECT id, inhalt FROM dokument_dateien WHERE id=?", req.params.fid
  );
  if (!row) return res.status(404).json({ error: "Datei nicht gefunden" });
  // Erst die Datenbank, dann die Platte — in dieser Reihenfolge, damit ein
  // Bestand aus beiden Zeiten lesbar bleibt.
  if (row.inhalt) return res.type("application/octet-stream").send(Buffer.from(row.inhalt));
  const p = dateiPfad(row.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "Datei fehlt auf der Platte" });
  res.type("application/octet-stream").send(fs.readFileSync(p));
});

router.delete("/dateien/:fid", async (req, res) => {
  const info = await db.schreibe("DELETE FROM dokument_dateien WHERE id=?", req.params.fid);
  if (info.zeilen === 0) return res.status(404).json({ error: "Datei nicht gefunden" });
  loescheDatei(Number(req.params.fid));
  res.json({ ok: true });
});

// --- Meldungen an die gemeinsamen Sammler ---------------------------------

/**
 * Terminfaden: was ablaeuft.
 *
 * `ablauf` ist ein echter Verfall — ein Ausweis, der abgelaufen ist, ist
 * ungueltig. Deshalb `ablauf` und nicht `aufgabe`; dringend wird es, sobald
 * die Vorwarnzeit angebrochen ist.
 */
async function termine(von: string, bis: string): Promise<Termin[]> {
  const rows = await db.alle<Zeile>(
    `SELECT * FROM dokumente
      WHERE ablauf IS NOT NULL AND geloescht_at IS NULL AND ablauf BETWEEN ? AND ?`,
    von, bis
  );
  const heute = new Date();
  return rows.map((r) => {
    const tage = Math.round(
      (new Date(`${r.ablauf}T00:00:00`).getTime() - heute.getTime()) / 86400000
    );
    return {
      id: `dokumente:ablauf:${r.id}`,
      datum: r.ablauf!,
      // Der Titel eines verschluesselten Dokuments ist Chiffrat und bleibt es.
      titel: r.verschluesselt ? "Verschlüsseltes Dokument" : r.titel || OHNE_TITEL,
      // Nicht „Wohnung läuft ab" — das Fach laeuft nicht ab, das Dokument tut es.
      notiz: r.verschluesselt || !r.kategorie ? "Dokument" : `Dokument · ${r.kategorie}`,
      art: "ablauf" as const,
      modul: "dokumente",
      dringend: tage <= (r.vorwarn_tage ?? VORWARN_STANDARD),
    };
  });
}

/**
 * Globale Suche: Titel, Kategorie, Schlagworte, Ablageort, Notiz.
 *
 * Verschluesselte Dokumente bleiben draussen — nicht aus Bequemlichkeit,
 * sondern weil der Server ihren Text nicht kennt und nie kennen soll.
 */
async function suche(begriff: string, grenze: number): Promise<Treffer[]> {
  const m = `%${begriff}%`;
  const rows = await db.alle<Zeile>(
    `SELECT * FROM dokumente
      WHERE verschluesselt = 0 AND geloescht_at IS NULL
        AND (titel LIKE ? OR kategorie LIKE ? OR schlagworte LIKE ?
             OR ablageort LIKE ? OR notiz LIKE ?)
      ORDER BY updated_at DESC LIMIT ?`,
    m, m, m, m, m, grenze
  );
  return rows.map((r) => ({
    id: `dokumente:dokument:${r.id}`,
    titel: r.titel || OHNE_TITEL,
    // Wo es liegt, ist die Auskunft, um die es bei einem Aktenstueck geht.
    untertitel: r.ablageort || r.kategorie || r.schlagworte || null,
    modul: "dokumente",
    art: "Dokument",
    datum: r.datum ?? r.updated_at.slice(0, 10),
  }));
}

/**
 * Profil: wie viel abgelegt ist und wann.
 *
 * Titel kommen NICHT mit, auch die unverschluesselten nicht — dieselbe Linie
 * wie bei den Notizen. Eine Jahresuebersicht ist kein Blick in die Schublade.
 */
async function profil(von: string, bis: string): Promise<ProfilBeitrag> {
  const z = await db.eine<{ n: number; verschluesselt: number; mitDatei: number }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(verschluesselt), 0) AS verschluesselt,
            COALESCE(SUM(EXISTS (SELECT 1 FROM dokument_dateien f WHERE f.dokument_id = d.id)), 0) AS mitDatei
       FROM dokumente d WHERE geloescht_at IS NULL`
  );
  if (!z || z.n === 0) return {};

  const zahlen: ProfilZahl[] = [
    {
      id: "dokumente:anzahl",
      wert: String(z.n),
      label: z.n === 1 ? "Dokument" : "Dokumente",
      hinweis:
        z.mitDatei < z.n
          ? `${z.mitDatei} als Datei, ${z.n - z.mitDatei} nur als Verweis`
          : z.verschluesselt > 0 ? `davon ${z.verschluesselt} verschlüsselt` : null,
    },
  ];

  return {
    zahlen,
    tage: await tageZaehlen(
      "dokumente", "date(created_at, 'localtime')", von, bis, "geloescht_at IS NULL"
    ),
    seit: await fruehestes("dokumente", "date(created_at, 'localtime')"),
  };
}

export const dokumenteModule: ServerModule = {
  id: "dokumente",
  title: "Dokumente",
  router,
  einrichten,
  termine,
  suche,
  profil,
};
