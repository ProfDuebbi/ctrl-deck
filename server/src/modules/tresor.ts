import { Router, raw } from "express";
import fs from "node:fs";
import path from "node:path";
import { db, getSetting, setSetting } from "../db.js";
import { TRESOR_DIR } from "../paths.js";
import type { ServerModule, Termin } from "./index.js";

/**
 * TRESOR — Ablage fuer Ausweisnummern, Steuer-ID, Versicherungsnummern usw.
 *
 * Der Server sieht die Geheimnisse NIE. Verschluesselt und entschluesselt wird
 * ausschliesslich im Browser (AES-256-GCM, Schluessel aus dem Master-Passwort).
 * Hier liegen nur Chiffrate. Was der Server im Klartext braucht — und auch nur
 * das —, ist die Kategorie und das Ablaufdatum: daraus entstehen Kachel und
 * Sidebar-Badge, und die verraten fuer sich genommen nichts.
 *
 * Der Schluessel selbst wird nicht aus dem Passwort abgeleitet, sondern nur
 * damit *eingewickelt* (key wrapping). Deshalb kostet ein Passwortwechsel nur
 * ein neues Paeckchen — kein Neuverschluesseln aller Eintraege und Dateien.
 */

// --- Schema ---------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS tresor_eintraege (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kategorie    TEXT NOT NULL DEFAULT 'sonstiges',  -- Klartext (nur Rubrik)
    vorlage      TEXT NOT NULL DEFAULT 'frei',       -- Klartext (Formatpruefung)
    titel        TEXT NOT NULL,                      -- Chiffrat
    wert         TEXT NOT NULL,                      -- Chiffrat
    notiz        TEXT,                               -- Chiffrat oder NULL
    ablauf       TEXT,                               -- 'JJJJ-MM-TT', Klartext
    vorwarn_tage INTEGER NOT NULL DEFAULT 60,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tresor_dateien (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    eintrag_id INTEGER NOT NULL REFERENCES tresor_eintraege(id) ON DELETE CASCADE,
    dateiname  TEXT NOT NULL,   -- Chiffrat
    groesse    INTEGER NOT NULL,-- Klartextgroesse in Bytes
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tresor_dateien_eintrag ON tresor_dateien (eintrag_id);
`);

// Anhaenge liegen als eigene Dateien auf der Platte (TRESOR_DIR, angelegt in
// paths.ts) — verschluesselt, der Dateiname ist nur die laufende Nummer. Ohne
// Master-Passwort ist das Rauschen. Die Sicherung in db.ts nimmt den Ordner mit.
const dateiPfad = (id: number | bigint) => path.join(TRESOR_DIR, `${id}.bin`);
const now = () => new Date().toISOString();

// --- Meta (Salz + eingewickelter Schluessel) ------------------------------

interface TresorMeta {
  v: number;
  kdf: string;
  iter: number;
  salt: string;
  /** Der mit dem Passwort-Schluessel eingewickelte Datenschluessel. */
  wrapped: string;
  created_at: string;
  changed_at: string;
}

function leseMeta(): TresorMeta | null {
  const roh = getSetting("tresor_meta");
  if (!roh) return null;
  try {
    return JSON.parse(roh) as TresorMeta;
  } catch {
    return null;
  }
}

/** Nimmt nur an, was wirklich nach Meta aussieht — sonst sperrt man sich aus. */
function pruefeMeta(m: unknown): TresorMeta | null {
  const o = m as Partial<TresorMeta> | null;
  if (!o || typeof o !== "object") return null;
  if (typeof o.salt !== "string" || !o.salt) return null;
  if (typeof o.wrapped !== "string" || !o.wrapped) return null;
  const iter = Number(o.iter);
  if (!(iter >= 100000)) return null;
  return {
    v: 1,
    kdf: String(o.kdf ?? "PBKDF2-SHA256"),
    iter,
    salt: o.salt,
    wrapped: o.wrapped,
    created_at: typeof o.created_at === "string" ? o.created_at : now(),
    changed_at: now(),
  };
}

// --- Helfer ---------------------------------------------------------------

interface EintragRow {
  id: number;
  kategorie: string;
  vorlage: string;
  titel: string;
  wert: string;
  notiz: string | null;
  ablauf: string | null;
  vorwarn_tage: number;
  created_at: string;
  updated_at: string;
}

/** Tage bis zum Datum — negativ heisst abgelaufen. */
function tageBis(datum: string): number {
  const heute = new Date();
  const a = Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate());
  const [j, m, t] = datum.split("-").map(Number);
  if (!j || !m || !t) return Number.POSITIVE_INFINITY;
  return Math.round((Date.UTC(j, m - 1, t) - a) / 86400000);
}

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

function dateienZu(ids: number[]): Map<number, unknown[]> {
  const map = new Map<number, unknown[]>();
  if (ids.length === 0) return map;
  const rows = db
    .prepare(
      `SELECT id, eintrag_id, dateiname, groesse, created_at FROM tresor_dateien
       WHERE eintrag_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`
    )
    .all(...ids) as { id: number; eintrag_id: number }[];
  for (const r of rows) {
    if (!map.has(r.eintrag_id)) map.set(r.eintrag_id, []);
    map.get(r.eintrag_id)!.push(r);
  }
  return map;
}

/** Ein Eintragsfeld aus dem Rumpf holen — Chiffrate sind immer Zeichenketten. */
function feld(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

// --- Router ---------------------------------------------------------------

const router = Router();

/** Ist der Tresor eingerichtet? Liefert das Paeckchen zum Entsperren mit. */
router.get("/meta", (_req, res) => {
  const meta = leseMeta();
  res.json({ eingerichtet: !!meta, meta });
});

/**
 * Zustand fuer Kachel und Badge — beantwortbar OHNE Passwort, weil nur
 * Anzahlen und Ablaufdaten hineinfliessen.
 */
router.get("/status", (_req, res) => {
  const meta = leseMeta();
  const anzahl = (db.prepare("SELECT COUNT(*) AS n FROM tresor_eintraege").get() as { n: number }).n;
  const dateien = (db.prepare("SELECT COUNT(*) AS n FROM tresor_dateien").get() as { n: number }).n;
  const rows = db
    .prepare("SELECT id, kategorie, ablauf, vorwarn_tage FROM tresor_eintraege WHERE ablauf IS NOT NULL")
    .all() as { id: number; kategorie: string; ablauf: string; vorwarn_tage: number }[];

  const ablaufend = rows
    .map((r) => ({ ...r, tageBis: tageBis(r.ablauf) }))
    .filter((r) => r.tageBis <= r.vorwarn_tage)
    .sort((a, b) => a.tageBis - b.tageBis);

  res.json({ eingerichtet: !!meta, anzahl, dateien, ablaufend });
});

/** Ersteinrichtung. Laeuft nur, solange es noch nichts zu verlieren gibt. */
router.post("/init", (req, res) => {
  if (leseMeta()) return res.status(409).json({ error: "Tresor ist bereits eingerichtet" });
  const meta = pruefeMeta(req.body?.meta);
  if (!meta) return res.status(400).json({ error: "unvollständige Tresor-Daten" });
  meta.created_at = now();
  setSetting("tresor_meta", JSON.stringify(meta));
  res.json({ ok: true, meta });
});

/**
 * Passwort wechseln: der Browser wickelt denselben Datenschluessel neu ein und
 * schickt nur das neue Paeckchen. `bisher` ist das alte Salz — damit ein alter,
 * offen gebliebener Tab nicht einen zwischenzeitlichen Wechsel ueberschreibt.
 */
router.put("/passwort", (req, res) => {
  const alt = leseMeta();
  if (!alt) return res.status(409).json({ error: "Tresor ist nicht eingerichtet" });
  if (String(req.body?.bisher ?? "") !== alt.salt)
    return res.status(409).json({ error: "Der Tresor wurde zwischenzeitlich geändert — bitte neu laden." });
  const meta = pruefeMeta(req.body?.meta);
  if (!meta) return res.status(400).json({ error: "unvollständige Tresor-Daten" });
  meta.created_at = alt.created_at;
  setSetting("tresor_meta", JSON.stringify(meta));
  res.json({ ok: true, meta });
});

/** Alle Eintraege — als Chiffrat. Entschluesselt wird im Browser. */
router.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM tresor_eintraege ORDER BY kategorie, id")
    .all() as unknown as EintragRow[];
  const anhaenge = dateienZu(rows.map((r) => r.id));
  res.json(
    rows.map((r) => ({
      ...r,
      tageBis: r.ablauf ? tageBis(r.ablauf) : null,
      dateien: anhaenge.get(r.id) ?? [],
    }))
  );
});

function rumpf(req: { body?: Record<string, unknown> }) {
  const b = req.body ?? {};
  const titel = feld(b.titel);
  const wert = feld(b.wert);
  const ablauf = feld(b.ablauf);
  if (!titel) return { error: "Titel fehlt" as const };
  if (!wert) return { error: "Wert fehlt" as const };
  if (ablauf && !ISO_DATUM.test(ablauf)) return { error: "ungültiges Ablaufdatum" as const };
  const vorwarn = Number(b.vorwarn_tage);
  return {
    titel,
    wert,
    notiz: feld(b.notiz),
    ablauf,
    kategorie: feld(b.kategorie) ?? "sonstiges",
    vorlage: feld(b.vorlage) ?? "frei",
    vorwarn_tage: vorwarn >= 1 && vorwarn <= 3650 ? Math.round(vorwarn) : 60,
  };
}

router.post("/", (req, res) => {
  const d = rumpf(req);
  if ("error" in d) return res.status(400).json({ error: d.error });
  const info = db
    .prepare(
      `INSERT INTO tresor_eintraege (kategorie, vorlage, titel, wert, notiz, ablauf, vorwarn_tage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(d.kategorie, d.vorlage, d.titel, d.wert, d.notiz, d.ablauf, d.vorwarn_tage, now(), now());
  res.json({ id: Number(info.lastInsertRowid) });
});

router.put("/:id", (req, res) => {
  const d = rumpf(req);
  if ("error" in d) return res.status(400).json({ error: d.error });
  const info = db
    .prepare(
      `UPDATE tresor_eintraege SET kategorie=?, vorlage=?, titel=?, wert=?, notiz=?, ablauf=?, vorwarn_tage=?, updated_at=?
       WHERE id=?`
    )
    .run(d.kategorie, d.vorlage, d.titel, d.wert, d.notiz, d.ablauf, d.vorwarn_tage, now(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Eintrag nicht gefunden" });
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  // Die Datenbankzeilen raeumt der Fremdschluessel weg, die Dateien nicht.
  const dateien = db.prepare("SELECT id FROM tresor_dateien WHERE eintrag_id=?").all(id) as { id: number }[];
  db.prepare("DELETE FROM tresor_eintraege WHERE id=?").run(id);
  for (const d of dateien) {
    try { fs.rmSync(dateiPfad(d.id)); } catch { /* schon weg */ }
  }
  res.json({ ok: true });
});

// --- Anhaenge -------------------------------------------------------------

/**
 * Der Rumpf ist der bereits im Browser verschluesselte Dateiinhalt; der
 * Dateiname kommt als Chiffrat im Kopf mit, weil "Steuerbescheid_2024.pdf"
 * selbst schon eine Auskunft ist.
 */
router.post("/:id/dateien", raw({ type: "application/octet-stream", limit: "64mb" }), (req, res) => {
  const eintrag = db.prepare("SELECT id FROM tresor_eintraege WHERE id=?").get(req.params.id) as
    | { id: number }
    | undefined;
  if (!eintrag) return res.status(404).json({ error: "Eintrag nicht gefunden" });

  const name = String(req.header("x-datei-name") ?? "").trim();
  if (!name) return res.status(400).json({ error: "Dateiname fehlt" });
  const daten = req.body as Buffer;
  if (!Buffer.isBuffer(daten) || daten.length === 0)
    return res.status(400).json({ error: "Datei ist leer" });

  const info = db
    .prepare("INSERT INTO tresor_dateien (eintrag_id, dateiname, groesse, created_at) VALUES (?, ?, ?, ?)")
    .run(eintrag.id, name, Number(req.header("x-datei-groesse")) || daten.length, now());
  const id = Number(info.lastInsertRowid);
  try {
    fs.writeFileSync(dateiPfad(id), daten);
  } catch {
    db.prepare("DELETE FROM tresor_dateien WHERE id=?").run(id);
    return res.status(500).json({ error: "Datei konnte nicht gespeichert werden" });
  }
  res.json({ id });
});

router.get("/dateien/:fid", (req, res) => {
  const row = db.prepare("SELECT id FROM tresor_dateien WHERE id=?").get(req.params.fid) as
    | { id: number }
    | undefined;
  if (!row) return res.status(404).json({ error: "Datei nicht gefunden" });
  const p = dateiPfad(row.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "Datei fehlt auf der Platte" });
  res.type("application/octet-stream").send(fs.readFileSync(p));
});

router.delete("/dateien/:fid", (req, res) => {
  const id = Number(req.params.fid);
  db.prepare("DELETE FROM tresor_dateien WHERE id=?").run(id);
  try { fs.rmSync(dateiPfad(id)); } catch { /* schon weg */ }
  res.json({ ok: true });
});

/**
 * Notausgang: Passwort UND Wiederherstellungsschluessel verloren. Dann sind die
 * Daten ohnehin unlesbar — hier wird der unlesbare Rest entfernt, damit man neu
 * anfangen kann. Die Oberflaeche fragt vorher deutlich nach.
 */
router.delete("/", (_req, res) => {
  const dateien = db.prepare("SELECT id FROM tresor_dateien").all() as { id: number }[];
  db.exec("DELETE FROM tresor_dateien; DELETE FROM tresor_eintraege;");
  for (const d of dateien) {
    try { fs.rmSync(dateiPfad(d.id)); } catch { /* schon weg */ }
  }
  db.prepare("DELETE FROM settings WHERE key='tresor_meta'").run();
  res.json({ ok: true });
});

/**
 * Meldung an den gemeinsamen Terminfaden: ablaufende Dokumente.
 *
 * Genau dafuer sind `kategorie` und `ablauf` im Tresor bewusst NICHT
 * verschluesselt — der Faden kann warnen, ohne dass der Tresor offen ist.
 * Der Titel bleibt dagegen Chiffrat und wird hier nicht angefasst; deshalb
 * steht in der Zeile die Kategorie („Ausweis läuft ab"), nicht der Eintrag.
 */
function termine(von: string, bis: string): Termin[] {
  const rows = db
    .prepare("SELECT id, kategorie, ablauf FROM tresor_eintraege WHERE ablauf IS NOT NULL")
    .all() as { id: number; kategorie: string; ablauf: string }[];
  return rows
    .filter((r) => r.ablauf >= von && r.ablauf <= bis)
    .map((r) => ({
      id: `tresor:ablauf:${r.id}`,
      datum: r.ablauf,
      titel: `${r.kategorie || "Dokument"} läuft ab`,
      notiz: "im Tresor hinterlegt",
      art: "ablauf" as const,
      modul: "tresor",
      dringend: true, // ein abgelaufener Ausweis ist nie eine Kleinigkeit
    }));
}

export const tresorModule: ServerModule = {
  id: "tresor",
  title: "Tresor",
  router,
  termine,
};
