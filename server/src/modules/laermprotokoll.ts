import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { db, getSetting, setSetting } from "../db.js";
import { ROOT_DIR, EXPORT_DIR } from "../paths.js";
import type { ServerModule, Treffer } from "./index.js";

// --- Schema ---------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS noise_own (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    datum       TEXT NOT NULL,
    start       TEXT,
    ende        TEXT,
    dauer_min   INTEGER,
    aktivitaet  TEXT NOT NULL DEFAULT 'Musik',
    lautstaerke TEXT,
    bemerkung   TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS noise_foreign (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    datum       TEXT NOT NULL,
    uhrzeit     TEXT,
    verursacher TEXT NOT NULL,
    art         TEXT NOT NULL,
    bemerkung   TEXT,
    created_at  TEXT NOT NULL
  );
`);

// --- Helfer ---------------------------------------------------------------

/**
 * Angaben fuer den Kopf des Berichts. Frueher standen hier der Klarname des
 * Mieters und der des Vermieters fest im Code — in einem Beweispapier ist das
 * genau die Stelle, an der ein fremder Nutzer seine eigenen Daten braucht.
 */
export function berichtsKopf(): { mieter: string; vermieter: string } {
  return {
    mieter: getSetting("bericht_mieter") ?? "",
    vermieter: getSetting("bericht_vermieter") ?? "",
  };
}

/**
 * Kopfzeile fuer den TXT-Export. Ohne hinterlegte Namen bleibt die Zeile weg,
 * statt „Mieter:  · Vermieter: " zu drucken — ein halb ausgefuellter Briefkopf
 * ist schlechter als gar keiner.
 */
function kopfZeile(): string {
  const { mieter, vermieter } = berichtsKopf();
  const teile: string[] = [];
  if (mieter) teile.push(`Mieter: ${mieter}`);
  if (vermieter) teile.push(`Vermieter: ${vermieter}`);
  return teile.join(" · ");
}

const now = () => new Date().toISOString();

// Hier stand ein Einleseweg fuer zwei TXT-Dateien aus einem festen Ordner auf
// dem Rechner des Entwicklers (`../Webseiten`). Er hat seinen Zweck erfuellt —
// die Daten sind laengst in der Datenbank — und ist entfernt: ein absoluter
// Pfad in fremde Ordner ist in ausgelieferter Software wertlos, und der Knopf
// „aus Original-TXT" haette bei jedem anderen den Bestand geloescht.

// --- Statistik ------------------------------------------------------------

function ownStats() {
  const rows = db
    .prepare("SELECT dauer_min, aktivitaet FROM noise_own")
    .all() as { dauer_min: number | null; aktivitaet: string }[];
  const sessions = rows.filter((r) => r.dauer_min != null);
  const totalMin = sessions.reduce((s, r) => s + (r.dauer_min ?? 0), 0);
  const longest = sessions.reduce((m, r) => Math.max(m, r.dauer_min ?? 0), 0);
  return {
    entries: rows.length,
    sessions: sessions.length,
    totalMin,
    avgMin: sessions.length ? Math.round(totalMin / sessions.length) : 0,
    longestMin: longest,
  };
}

function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

// --- Export in TXT (gleiches Format wie das Original) ---------------------

function pad(v: string | null, width: number): string {
  return (v ?? "--").padEnd(width);
}

function exportOwnTxt(): string {
  const rows = db
    .prepare("SELECT * FROM noise_own ORDER BY datum, start")
    .all() as any[];
  const s = ownStats();
  // Ohne hinterlegte Namen faellt die Zeile ganz weg, statt eine Leerzeile
  // mitten in den Briefkopf zu setzen.
  const head = [
    "LÄRMPROTOKOLL — TABELLE 1: EIGENES PROTOKOLL",
    ...(kopfZeile() ? [kopfZeile()] : []),
    `Exportiert am: ${new Date().toLocaleDateString("de-DE")} (aus dem CTRL·DECK-Dashboard)`,
    "",
    "Spalten: Datum | Start | Ende | Dauer | Aktivität | Einstellung/Lautstärke | Bemerkung",
    "=".repeat(92),
    "",
  ];
  const body = rows.map((r) =>
    [
      r.datum,
      pad(r.start, 5),
      pad(r.ende, 5),
      pad(r.dauer_min != null ? `${r.dauer_min} min` : null, 6),
      pad(r.aktivitaet, 13),
      pad(r.lautstaerke, 14),
      r.bemerkung ?? "",
    ].join(" | ")
  );
  const foot = [
    "",
    "=".repeat(92),
    `Zusammenfassung: ${s.entries} Einträge (${s.sessions} Sessions + ${s.entries - s.sessions} Ruhephasen).`,
    `Gesamtdauer: ${fmtDur(s.totalMin)} · Ø pro Session: ${s.avgMin} min · längste: ${s.longestMin} min.`,
    "",
  ];
  return [...head, ...body, ...foot].join("\n");
}

function exportForeignTxt(): string {
  const rows = db
    .prepare("SELECT * FROM noise_foreign ORDER BY datum, uhrzeit")
    .all() as any[];
  const head = [
    "LÄRMPROTOKOLL — TABELLE 2: FREMDGERÄUSCHE / LÄRM DURCH DRITTE",
    ...(kopfZeile() ? [kopfZeile()] : []),
    `Exportiert am: ${new Date().toLocaleDateString("de-DE")} (aus dem CTRL·DECK-Dashboard)`,
    "",
    "Spalten: Datum | Uhrzeit | Verursacher | Art des Lärms | Bemerkung",
    "=".repeat(92),
    "",
  ];
  const body = rows.map((r) =>
    [r.datum, pad(r.uhrzeit, 5), pad(r.verursacher, 28), pad(r.art, 33), r.bemerkung ?? ""].join(" | ")
  );
  const foot = ["", "=".repeat(92), `Zusammenfassung: ${rows.length} Vorfälle.`, ""];
  return [...head, ...body, ...foot].join("\n");
}

// --- Router ---------------------------------------------------------------

const router = Router();

// Eigenes Protokoll -------------------------------------------------------
router.get("/own", (_req, res) => {
  res.json(db.prepare("SELECT * FROM noise_own ORDER BY datum DESC, start DESC").all());
});

router.post("/own", (req, res) => {
  const b = req.body ?? {};
  if (!b.datum) return res.status(400).json({ error: "datum fehlt" });
  const info = db
    .prepare(
      `INSERT INTO noise_own (datum, start, ende, dauer_min, aktivitaet, lautstaerke, bemerkung, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.datum,
      b.start || null,
      b.ende || null,
      b.dauer_min ?? null,
      b.aktivitaet || "Musik",
      b.lautstaerke || null,
      b.bemerkung || null,
      now()
    );
  res.json({ id: info.lastInsertRowid });
});

router.put("/own/:id", (req, res) => {
  const b = req.body ?? {};
  db.prepare(
    `UPDATE noise_own SET datum=?, start=?, ende=?, dauer_min=?, aktivitaet=?, lautstaerke=?, bemerkung=? WHERE id=?`
  ).run(
    b.datum,
    b.start || null,
    b.ende || null,
    b.dauer_min ?? null,
    b.aktivitaet || "Musik",
    b.lautstaerke || null,
    b.bemerkung || null,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete("/own/:id", (req, res) => {
  db.prepare("DELETE FROM noise_own WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Fremdgeräusche ----------------------------------------------------------
router.get("/foreign", (_req, res) => {
  res.json(db.prepare("SELECT * FROM noise_foreign ORDER BY datum DESC, uhrzeit DESC").all());
});

router.post("/foreign", (req, res) => {
  const b = req.body ?? {};
  if (!b.datum) return res.status(400).json({ error: "datum fehlt" });
  const info = db
    .prepare(
      `INSERT INTO noise_foreign (datum, uhrzeit, verursacher, art, bemerkung, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(b.datum, b.uhrzeit || null, b.verursacher || "?", b.art || "?", b.bemerkung || null, now());
  res.json({ id: info.lastInsertRowid });
});

router.put("/foreign/:id", (req, res) => {
  const b = req.body ?? {};
  db.prepare(
    `UPDATE noise_foreign SET datum=?, uhrzeit=?, verursacher=?, art=?, bemerkung=? WHERE id=?`
  ).run(b.datum, b.uhrzeit || null, b.verursacher || "?", b.art || "?", b.bemerkung || null, req.params.id);
  res.json({ ok: true });
});

router.delete("/foreign/:id", (req, res) => {
  db.prepare("DELETE FROM noise_foreign WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Statistik fuer die Kachel ----------------------------------------------
router.get("/summary", (_req, res) => {
  const own = ownStats();
  const foreignRows = db
    .prepare("SELECT datum, uhrzeit, verursacher FROM noise_foreign ORDER BY datum DESC, uhrzeit DESC LIMIT 1")
    .all() as { datum: string; uhrzeit: string | null; verursacher: string }[];
  const foreignCount = (db.prepare("SELECT COUNT(*) c FROM noise_foreign").get() as { c: number }).c;
  res.json({
    own,
    ownTotalLabel: fmtDur(own.totalMin),
    foreignCount,
    lastForeign: foreignRows[0] ?? null,
  });
});

// Export --------------------------------------------------------------------
/** Angaben fuer den Kopf des Beweispapiers (Mieter, Vermieter). */
router.get("/bericht", (_req, res) => {
  res.json(berichtsKopf());
});

router.put("/bericht", (req, res) => {
  const mieter = String(req.body?.mieter ?? "").trim().slice(0, 200);
  const vermieter = String(req.body?.vermieter ?? "").trim().slice(0, 200);
  setSetting("bericht_mieter", mieter);
  setSetting("bericht_vermieter", vermieter);
  res.json({ mieter, vermieter });
});

router.post("/export", (_req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const ownPath = path.join(EXPORT_DIR, `Laermprotokoll_Eigenes_${stamp}.txt`);
  const forPath = path.join(EXPORT_DIR, `Laermprotokoll_Fremdgeraeusche_${stamp}.txt`);
  const ownTxt = exportOwnTxt();
  const forTxt = exportForeignTxt();
  fs.writeFileSync(ownPath, ownTxt, "utf8");
  fs.writeFileSync(forPath, forTxt, "utf8");
  res.json({ ownPath, forPath, ownTxt, forTxt });
});

/** Meldung an die globale Suche: Bemerkungen, Verursacher, Aktivitaeten. */
function suche(begriff: string, grenze: number): Treffer[] {
  const m = `%${begriff}%`;
  const je = Math.max(2, Math.floor(grenze / 2));
  const treffer: Treffer[] = [];

  for (const r of db
    .prepare(
      `SELECT id, datum, start, aktivitaet, bemerkung FROM noise_own
        WHERE bemerkung LIKE ? OR aktivitaet LIKE ? OR lautstaerke LIKE ?
        ORDER BY datum DESC LIMIT ?`
    )
    .all(m, m, m, je) as {
      id: number; datum: string; start: string | null; aktivitaet: string; bemerkung: string | null;
    }[]) {
    treffer.push({
      id: `laermprotokoll:eigen:${r.id}`,
      titel: r.bemerkung || r.aktivitaet,
      untertitel: `${r.aktivitaet}${r.start ? " · " + r.start : ""}`,
      modul: "laermprotokoll",
      art: "Eigenes Protokoll",
      datum: r.datum,
    });
  }

  for (const r of db
    .prepare(
      `SELECT id, datum, uhrzeit, verursacher, art, bemerkung FROM noise_foreign
        WHERE bemerkung LIKE ? OR verursacher LIKE ? OR art LIKE ?
        ORDER BY datum DESC LIMIT ?`
    )
    .all(m, m, m, je) as {
      id: number; datum: string; uhrzeit: string | null; verursacher: string; art: string; bemerkung: string | null;
    }[]) {
    treffer.push({
      id: `laermprotokoll:fremd:${r.id}`,
      titel: r.bemerkung || r.art,
      untertitel: `${r.verursacher}${r.uhrzeit ? " · " + r.uhrzeit : ""}`,
      modul: "laermprotokoll",
      art: "Fremdgeräusch",
      datum: r.datum,
    });
  }

  return treffer;
}

export const laermprotokollModule: ServerModule = {
  id: "laermprotokoll",
  title: "Lärmprotokoll",
  router,
  suche,
};
