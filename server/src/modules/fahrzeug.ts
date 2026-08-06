import { Router } from "express";
import { db } from "../db.js";
import type { ServerModule, Termin, Treffer } from "./index.js";

/**
 * FAHRZEUG — Fristen, Kosten, Kilometer.
 *
 * Der Kern des Moduls sind vier Termine, die Geld kosten, wenn man sie
 * verpasst: Hauptuntersuchung, Versicherung, Steuer, Inspektion. Alles andere
 * (Tanken, Wartung, Reparaturen) ist Buchfuehrung und darf leer bleiben.
 *
 * Bewusst allgemein gehalten: „Fahrzeug" ist nicht zwingend ein Auto. Wer ein
 * Motorrad, einen Roller oder ein E-Bike eintraegt, braucht dieselben Felder —
 * nur die HU entfaellt, und ein leeres Datum meldet eben keinen Termin.
 */

// --- Schema ---------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS fahrzeuge (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    kennzeichen       TEXT,
    art               TEXT NOT NULL DEFAULT 'auto',   -- auto|motorrad|roller|fahrrad|anderes
    hu_bis            TEXT,                            -- YYYY-MM-DD, Hauptuntersuchung
    versicherung_bis  TEXT,
    steuer_bis        TEXT,
    inspektion_bis    TEXT,
    notiz             TEXT,
    aktiv             INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL
  );

  -- Tanken, Wartung, Reparatur. Die Spalte km ist der ZAEHLERSTAND, nicht die
  -- gefahrene Strecke — Strecken rechnet die Oberflaeche aus der Differenz.
  CREATE TABLE IF NOT EXISTS fahrzeug_eintraege (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fahrzeug_id INTEGER NOT NULL REFERENCES fahrzeuge(id) ON DELETE CASCADE,
    datum       TEXT NOT NULL,
    art         TEXT NOT NULL DEFAULT 'tanken',  -- tanken|wartung|reparatur|sonstiges
    km          INTEGER,
    liter       REAL,
    betrag      REAL,
    notiz       TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fz_eintraege ON fahrzeug_eintraege (fahrzeug_id, datum);
`);

const now = () => new Date().toISOString();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Heute lokal — `toISOString()` waere UTC und liefert nachts den Vortag. */
function heuteLokal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function tageBis(datum: string): number {
  const [j1, m1, t1] = heuteLokal().split("-").map(Number);
  const [j2, m2, t2] = datum.split("-").map(Number);
  return Math.round((Date.UTC(j2, m2 - 1, t2) - Date.UTC(j1, m1 - 1, t1)) / 86_400_000);
}

/**
 * Bewusst `type` und nicht `interface`: node:sqlite liefert
 * `Record<string, SQLOutputValue>`, und darauf laesst sich nur ein Typalias
 * casten — Interfaces bekommen in TypeScript keine implizite Index-Signatur.
 * Dieselbe Bauart benutzen die anderen Module (z. B. `EinnahmeRow`).
 */
type FahrzeugRow = {
  id: number; name: string; kennzeichen: string | null; art: string;
  hu_bis: string | null; versicherung_bis: string | null;
  steuer_bis: string | null; inspektion_bis: string | null;
  notiz: string | null; aktiv: number; created_at: string;
};

/** Die vier Pflichttermine eines Fahrzeugs, in der Reihenfolge ihrer Haerte. */
const FRISTEN = [
  { feld: "hu_bis", label: "Hauptuntersuchung" },
  { feld: "versicherung_bis", label: "Versicherung" },
  { feld: "steuer_bis", label: "Kfz-Steuer" },
  { feld: "inspektion_bis", label: "Inspektion" },
] as const;

/** Fristen eines Fahrzeugs mit Restlaufzeit, faellig zuerst. */
function fristenVon(f: FahrzeugRow) {
  return FRISTEN.map(({ feld, label }) => {
    const datum = f[feld] as string | null;
    if (!datum) return null;
    const tage = tageBis(datum);
    return {
      feld,
      label,
      datum,
      tage,
      status: tage < 0 ? "abgelaufen" : tage <= 30 ? "dringend" : tage <= 90 ? "bald" : "offen",
    };
  })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.tage - b.tage);
}

function saeubern(b: any): Omit<FahrzeugRow, "id" | "created_at"> | { error: string } {
  const name = String(b?.name ?? "").trim();
  if (!name) return { error: "Bitte einen Namen angeben." };
  for (const { feld, label } of FRISTEN) {
    const v = b?.[feld];
    if (v && !ISO.test(String(v))) return { error: `Ungültiges Datum bei ${label}.` };
  }
  return {
    name,
    kennzeichen: String(b?.kennzeichen ?? "").trim() || null,
    art: ["auto", "motorrad", "roller", "fahrrad", "anderes"].includes(b?.art) ? b.art : "auto",
    hu_bis: b?.hu_bis || null,
    versicherung_bis: b?.versicherung_bis || null,
    steuer_bis: b?.steuer_bis || null,
    inspektion_bis: b?.inspektion_bis || null,
    notiz: String(b?.notiz ?? "").trim() || null,
    aktiv: b?.aktiv === 0 || b?.aktiv === false ? 0 : 1,
  };
}

// --- Router ---------------------------------------------------------------

const router = Router();

router.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM fahrzeuge ORDER BY aktiv DESC, name")
    .all() as FahrzeugRow[];
  res.json(rows.map((f) => ({ ...f, fristen: fristenVon(f) })));
});

router.post("/", (req, res) => {
  const d = saeubern(req.body);
  if ("error" in d) return res.status(400).json(d);
  const info = db
    .prepare(
      `INSERT INTO fahrzeuge (name, kennzeichen, art, hu_bis, versicherung_bis, steuer_bis, inspektion_bis, notiz, aktiv, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(d.name, d.kennzeichen, d.art, d.hu_bis, d.versicherung_bis, d.steuer_bis, d.inspektion_bis, d.notiz, d.aktiv, now());
  res.json({ id: info.lastInsertRowid });
});

router.put("/:id", (req, res) => {
  const d = saeubern(req.body);
  if ("error" in d) return res.status(400).json(d);
  db.prepare(
    `UPDATE fahrzeuge SET name=?, kennzeichen=?, art=?, hu_bis=?, versicherung_bis=?, steuer_bis=?, inspektion_bis=?, notiz=?, aktiv=?
      WHERE id=?`
  ).run(d.name, d.kennzeichen, d.art, d.hu_bis, d.versicherung_bis, d.steuer_bis, d.inspektion_bis, d.notiz, d.aktiv, req.params.id);
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  // Die Eintraege haengen per FOREIGN KEY dran und gehen mit (PRAGMA
  // foreign_keys steht in db.ts auf ON).
  db.prepare("DELETE FROM fahrzeuge WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

router.get("/:id/eintraege", (req, res) => {
  res.json(
    db
      .prepare("SELECT * FROM fahrzeug_eintraege WHERE fahrzeug_id=? ORDER BY datum DESC, id DESC")
      .all(req.params.id)
  );
});

router.post("/:id/eintraege", (req, res) => {
  const b = req.body ?? {};
  const datum = String(b.datum ?? "").trim();
  if (!ISO.test(datum)) return res.status(400).json({ error: "Bitte ein Datum angeben." });
  const zahl = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const info = db
    .prepare(
      `INSERT INTO fahrzeug_eintraege (fahrzeug_id, datum, art, km, liter, betrag, notiz, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.params.id,
      datum,
      ["tanken", "wartung", "reparatur", "sonstiges"].includes(b.art) ? b.art : "tanken",
      zahl(b.km),
      zahl(b.liter),
      zahl(b.betrag),
      String(b.notiz ?? "").trim() || null,
      now()
    );
  res.json({ id: info.lastInsertRowid });
});

router.delete("/eintraege/:id", (req, res) => {
  db.prepare("DELETE FROM fahrzeug_eintraege WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

/** Zahlen fuer die Kachel. */
router.get("/uebersicht", (_req, res) => {
  const rows = db.prepare("SELECT * FROM fahrzeuge WHERE aktiv=1").all() as FahrzeugRow[];
  const alle = rows.flatMap((f) => fristenVon(f).map((fr) => ({ ...fr, fahrzeug: f.name })));
  alle.sort((a, b) => a.tage - b.tage);
  const kosten = db
    .prepare(
      `SELECT COALESCE(SUM(betrag), 0) AS summe FROM fahrzeug_eintraege
        WHERE betrag IS NOT NULL AND datum >= date('now', '-12 months')`
    )
    .get() as { summe: number };
  res.json({
    anzahl: rows.length,
    naechste: alle[0] ?? null,
    dringend: alle.filter((f) => f.status === "dringend" || f.status === "abgelaufen").length,
    kostenJahr: kosten.summe,
  });
});

/** Meldung an den gemeinsamen Terminfaden: die vier Fristen. */
function termine(von: string, bis: string): Termin[] {
  const rows = db.prepare("SELECT * FROM fahrzeuge WHERE aktiv=1").all() as FahrzeugRow[];
  const out: Termin[] = [];
  for (const f of rows) {
    for (const fr of fristenVon(f)) {
      if (fr.datum < von || fr.datum > bis) continue;
      out.push({
        id: `fahrzeug:${fr.feld}:${f.id}`,
        datum: fr.datum,
        titel: `${fr.label} — ${f.name}`,
        notiz: f.kennzeichen,
        art: "frist",
        modul: "fahrzeug",
        dringend: fr.status === "dringend" || fr.status === "abgelaufen",
      });
    }
  }
  return out;
}

/** Meldung an die globale Suche: Name, Kennzeichen, Notizen. */
function suche(begriff: string, grenze: number): Treffer[] {
  const m = `%${begriff}%`;
  const rows = db
    .prepare("SELECT * FROM fahrzeuge WHERE name LIKE ? OR kennzeichen LIKE ? OR notiz LIKE ? LIMIT ?")
    .all(m, m, m, grenze) as FahrzeugRow[];
  return rows.map((f) => ({
    id: `fahrzeug:fahrzeug:${f.id}`,
    titel: f.name,
    untertitel: f.kennzeichen,
    modul: "fahrzeug",
    art: "Fahrzeug",
  }));
}

export const fahrzeugModule: ServerModule = {
  id: "fahrzeug",
  title: "Fahrzeug",
  router,
  termine,
  suche,
};
