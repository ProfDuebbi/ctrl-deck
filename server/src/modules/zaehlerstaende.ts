import { Router } from "express";
import { db, getSetting, setSetting } from "../db.js";
import type { ServerModule, Treffer } from "./index.js";

// --- Schema ---------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS meters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    einheit    TEXT NOT NULL,        -- kWh, m³, …
    accent     TEXT NOT NULL DEFAULT 'blue',  -- blue | pink | violet
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meter_readings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id   INTEGER NOT NULL,
    datum      TEXT NOT NULL,        -- YYYY-MM-DD
    stand      REAL NOT NULL,        -- Zählerstand
    notiz      TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_readings_meter ON meter_readings(meter_id, datum);
`);

// Tarif-Felder wurden nachtraeglich ergaenzt — bestehende DBs nachziehen.
{
  const spalten = new Set(
    (db.prepare("PRAGMA table_info(meters)").all() as { name: string }[]).map((c) => c.name)
  );
  for (const [name, def] of [
    ["preis", "REAL"],          // € je Einheit (z. B. 0,32 €/kWh)
    ["grundpreis", "REAL"],     // € pro Monat, optional
    ["abschlag", "REAL"],       // € pro Monat, was du zahlst
  ] as const) {
    if (!spalten.has(name)) db.exec(`ALTER TABLE meters ADD COLUMN ${name} ${def}`);
  }
}

const now = () => new Date().toISOString();

/** Zahl oder null — leere Tariffelder sollen nicht als 0 durchrutschen. */
function zahlOderNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// --- Einmaliges Seeding: übliche Haushaltszähler --------------------------
{
  if (!getSetting("zaehler_seeded")) {
    const ins = db.prepare(
      `INSERT INTO meters (name, einheit, accent, sort, created_at) VALUES (?, ?, ?, ?, ?)`
    );
    ins.run("Strom", "kWh", "blue", 0, now());
    ins.run("Gas", "m³", "pink", 1, now());
    ins.run("Wasser", "m³", "violet", 2, now());
    setSetting("zaehler_seeded", "1");
    console.log("[zaehlerstaende] Standardzähler angelegt: Strom, Gas, Wasser");
  }
}

// --- Router ---------------------------------------------------------------

const router = Router();

// Alle Zähler
router.get("/meters", (_req, res) => {
  const rows = db.prepare("SELECT * FROM meters ORDER BY sort, id").all();
  res.json(rows);
});

router.post("/meters", (req, res) => {
  const b = req.body ?? {};
  if (!b.name?.trim()) return res.status(400).json({ error: "name fehlt" });
  const maxSort = (db.prepare("SELECT COALESCE(MAX(sort),-1) s FROM meters").get() as { s: number }).s;
  const info = db
    .prepare(
      `INSERT INTO meters (name, einheit, accent, sort, preis, grundpreis, abschlag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.name.trim(), (b.einheit || "").trim() || "Einheit", b.accent || "blue", maxSort + 1,
      zahlOderNull(b.preis), zahlOderNull(b.grundpreis), zahlOderNull(b.abschlag), now()
    );
  res.json({ id: info.lastInsertRowid });
});

router.put("/meters/:id", (req, res) => {
  const b = req.body ?? {};
  db.prepare(
    `UPDATE meters SET name=?, einheit=?, accent=?, preis=?, grundpreis=?, abschlag=? WHERE id=?`
  ).run(
    (b.name || "").trim() || "Zähler",
    (b.einheit || "").trim() || "Einheit",
    b.accent || "blue",
    zahlOderNull(b.preis),
    zahlOderNull(b.grundpreis),
    zahlOderNull(b.abschlag),
    req.params.id
  );
  res.json({ ok: true });
});

router.delete("/meters/:id", (req, res) => {
  db.prepare("DELETE FROM meter_readings WHERE meter_id=?").run(req.params.id);
  db.prepare("DELETE FROM meters WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Ablesungen eines Zählers (chronologisch aufsteigend)
router.get("/meters/:id/readings", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM meter_readings WHERE meter_id=? ORDER BY datum ASC, id ASC")
    .all(req.params.id);
  res.json(rows);
});

router.post("/meters/:id/readings", (req, res) => {
  const b = req.body ?? {};
  if (!b.datum) return res.status(400).json({ error: "datum fehlt" });
  const stand = Number(b.stand);
  if (!Number.isFinite(stand)) return res.status(400).json({ error: "ungültiger Zählerstand" });
  const info = db
    .prepare(
      `INSERT INTO meter_readings (meter_id, datum, stand, notiz, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(req.params.id, b.datum, stand, b.notiz || null, now());
  res.json({ id: info.lastInsertRowid });
});

router.put("/readings/:id", (req, res) => {
  const b = req.body ?? {};
  const stand = Number(b.stand);
  if (!Number.isFinite(stand)) return res.status(400).json({ error: "ungültiger Zählerstand" });
  db.prepare(`UPDATE meter_readings SET datum=?, stand=?, notiz=? WHERE id=?`).run(
    b.datum,
    stand,
    b.notiz || null,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete("/readings/:id", (req, res) => {
  db.prepare("DELETE FROM meter_readings WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Kurz-Statistik für die Kachel: je Zähler letzter Stand + letzter Verbrauch/Tag
router.get("/summary", (_req, res) => {
  const meters = db.prepare("SELECT * FROM meters ORDER BY sort, id").all() as Array<{
    id: number;
    name: string;
    einheit: string;
    accent: string;
  }>;
  const out = meters.map((m) => {
    const rows = db
      .prepare("SELECT datum, stand FROM meter_readings WHERE meter_id=? ORDER BY datum ASC, id ASC")
      .all(m.id) as Array<{ datum: string; stand: number }>;
    const last = rows[rows.length - 1] ?? null;
    const prev = rows[rows.length - 2] ?? null;
    let perDay: number | null = null;
    if (last && prev) {
      const days = Math.max(1, Math.round((+new Date(last.datum) - +new Date(prev.datum)) / 864e5));
      perDay = (last.stand - prev.stand) / days;
    }
    return {
      id: m.id,
      name: m.name,
      einheit: m.einheit,
      accent: m.accent,
      count: rows.length,
      lastStand: last?.stand ?? null,
      lastDatum: last?.datum ?? null,
      perDay,
    };
  });
  res.json(out);
});

/** Meldung an die globale Suche: Zaehlernamen. */
function suche(begriff: string, grenze: number): Treffer[] {
  const rows = db
    .prepare("SELECT id, name, einheit FROM meters WHERE name LIKE ? ORDER BY sort LIMIT ?")
    .all(`%${begriff}%`, grenze) as { id: number; name: string; einheit: string }[];
  return rows.map((r) => ({
    id: `zaehlerstaende:zaehler:${r.id}`,
    titel: r.name,
    untertitel: r.einheit,
    modul: "zaehlerstaende",
    art: "Zähler",
  }));
}

export const zaehlerstaendeModule: ServerModule = {
  id: "zaehlerstaende",
  title: "Zählerstände",
  router,
  suche,
};
