import { machRouter } from "../route.js";
import { db, getSetting, setSetting } from "../db.js";
import {
  fruehestes, tageZaehlen,
  type Akzent, type Diagramm, type Messpunkt, type ProfilBeitrag, type ProfilZahl,
  type ServerModule, type Treffer,
} from "./index.js";

// --- Schema ---------------------------------------------------------------

const now = () => new Date().toISOString();

async function einrichten(): Promise<void> {
  await db.exec(`
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
  const spalten = new Set(
    (await db.alle<{ name: string }>("PRAGMA table_info(meters)")).map((c) => c.name)
  );
  for (const [name, def] of [
    ["preis", "REAL"],          // € je Einheit (z. B. 0,32 €/kWh)
    ["grundpreis", "REAL"],     // € pro Monat, optional
    ["abschlag", "REAL"],       // € pro Monat, was du zahlst
  ] as const) {
    if (!spalten.has(name)) await db.exec(`ALTER TABLE meters ADD COLUMN ${name} ${def}`);
  }

  // Einmaliges Seeding: uebliche Haushaltszaehler.
  if (!(await getSetting("zaehler_seeded"))) {
    const ins = `INSERT INTO meters (name, einheit, accent, sort, created_at) VALUES (?, ?, ?, ?, ?)`;
    await db.schreibe(ins, "Strom", "kWh", "blue", 0, now());
    await db.schreibe(ins, "Gas", "m³", "pink", 1, now());
    await db.schreibe(ins, "Wasser", "m³", "violet", 2, now());
    await setSetting("zaehler_seeded", "1");
    console.log("[zaehlerstaende] Standardzähler angelegt: Strom, Gas, Wasser");
  }
}

/** Zahl oder null — leere Tariffelder sollen nicht als 0 durchrutschen. */
function zahlOderNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// --- Router ---------------------------------------------------------------

const router = machRouter();

// Alle Zähler
router.get("/meters", async (_req, res) => {
  res.json(await db.alle("SELECT * FROM meters ORDER BY sort, id"));
});

router.post("/meters", async (req, res) => {
  const b = req.body ?? {};
  if (!b.name?.trim()) return res.status(400).json({ error: "name fehlt" });
  const info = await db.transaktion(async () => {
    // Groesste Sortiernummer lesen und die naechste vergeben gehoert zusammen —
    // sonst bekommen zwei gleichzeitig angelegte Zaehler dieselbe.
    const maxSort = (await db.eine<{ s: number }>("SELECT COALESCE(MAX(sort),-1) s FROM meters"))!.s;
    return db.schreibe(
      `INSERT INTO meters (name, einheit, accent, sort, preis, grundpreis, abschlag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      b.name.trim(), (b.einheit || "").trim() || "Einheit", b.accent || "blue", maxSort + 1,
      zahlOderNull(b.preis), zahlOderNull(b.grundpreis), zahlOderNull(b.abschlag), now()
    );
  });
  res.json({ id: info.id });
});

router.put("/meters/:id", async (req, res) => {
  const b = req.body ?? {};
  await db.schreibe(
    `UPDATE meters SET name=?, einheit=?, accent=?, preis=?, grundpreis=?, abschlag=? WHERE id=?`,
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

router.delete("/meters/:id", async (req, res) => {
  // Zaehler und seine Ablesungen sind eine Einheit: bliebe der Zaehler bei
  // einem Fehler nach dem ersten Loeschen stehen, haette er keine Werte mehr.
  await db.transaktion(async () => {
    await db.schreibe("DELETE FROM meter_readings WHERE meter_id=?", req.params.id);
    await db.schreibe("DELETE FROM meters WHERE id=?", req.params.id);
  });
  res.json({ ok: true });
});

// Ablesungen eines Zählers (chronologisch aufsteigend)
router.get("/meters/:id/readings", async (req, res) => {
  res.json(
    await db.alle("SELECT * FROM meter_readings WHERE meter_id=? ORDER BY datum ASC, id ASC", req.params.id)
  );
});

router.post("/meters/:id/readings", async (req, res) => {
  const b = req.body ?? {};
  if (!b.datum) return res.status(400).json({ error: "datum fehlt" });
  const stand = Number(b.stand);
  if (!Number.isFinite(stand)) return res.status(400).json({ error: "ungültiger Zählerstand" });
  const info = await db.schreibe(
    `INSERT INTO meter_readings (meter_id, datum, stand, notiz, created_at) VALUES (?, ?, ?, ?, ?)`,
    req.params.id, b.datum, stand, b.notiz || null, now()
  );
  res.json({ id: info.id });
});

router.put("/readings/:id", async (req, res) => {
  const b = req.body ?? {};
  const stand = Number(b.stand);
  if (!Number.isFinite(stand)) return res.status(400).json({ error: "ungültiger Zählerstand" });
  await db.schreibe(
    `UPDATE meter_readings SET datum=?, stand=?, notiz=? WHERE id=?`,
    b.datum,
    stand,
    b.notiz || null,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete("/readings/:id", async (req, res) => {
  await db.schreibe("DELETE FROM meter_readings WHERE id=?", req.params.id);
  res.json({ ok: true });
});

// Kurz-Statistik für die Kachel: je Zähler letzter Stand + letzter Verbrauch/Tag
router.get("/summary", async (_req, res) => {
  const meters = await db.alle<{ id: number; name: string; einheit: string; accent: string }>(
    "SELECT * FROM meters ORDER BY sort, id"
  );
  const out = [];
  for (const m of meters) {
    const rows = await db.alle<{ datum: string; stand: number }>(
      "SELECT datum, stand FROM meter_readings WHERE meter_id=? ORDER BY datum ASC, id ASC", m.id
    );
    const last = rows[rows.length - 1] ?? null;
    const prev = rows[rows.length - 2] ?? null;
    let perDay: number | null = null;
    if (last && prev) {
      const days = Math.max(1, Math.round((+new Date(last.datum) - +new Date(prev.datum)) / 864e5));
      perDay = (last.stand - prev.stand) / days;
    }
    out.push({
      id: m.id,
      name: m.name,
      einheit: m.einheit,
      accent: m.accent,
      count: rows.length,
      lastStand: last?.stand ?? null,
      lastDatum: last?.datum ?? null,
      perDay,
    });
  }
  res.json(out);
});

/** Meldung an die globale Suche: Zaehlernamen. */
async function suche(begriff: string, grenze: number): Promise<Treffer[]> {
  const rows = await db.alle<{ id: number; name: string; einheit: string }>(
    "SELECT id, name, einheit FROM meters WHERE name LIKE ? ORDER BY sort LIMIT ?",
    `%${begriff}%`, grenze
  );
  return rows.map((r) => ({
    id: `zaehlerstaende:zaehler:${r.id}`,
    titel: r.name,
    untertitel: r.einheit,
    modul: "zaehlerstaende",
    art: "Zähler",
  }));
}

/**
 * Meldung ans Profil: je Zaehler der laufende Verbrauch.
 *
 * Eine Zahl je Zaehler, nicht eine Summe: kWh und m³ zusammenzuzaehlen waere
 * eine Zahl ohne Einheit und ohne Sinn. Wo ein Preis hinterlegt ist, steht
 * unter dem Verbrauch, was er im Monat kostet — die eigentliche Frage.
 */
async function profil(von: string, bis: string): Promise<ProfilBeitrag> {
  const meters = await db.alle<{
    id: number; name: string; einheit: string;
    preis: number | null; grundpreis: number | null; abschlag: number | null;
  }>("SELECT * FROM meters ORDER BY sort, id");
  if (meters.length === 0) return {};

  const zahlen: ProfilZahl[] = [];
  for (const m of meters) {
    const rows = await db.alle<{ datum: string; stand: number }>(
      "SELECT datum, stand FROM meter_readings WHERE meter_id=? ORDER BY datum ASC, id ASC", m.id
    );
    if (rows.length < 2) continue;
    const letzte = rows[rows.length - 1];
    const vorige = rows[rows.length - 2];
    const tage = Math.max(1, Math.round((+new Date(letzte.datum) - +new Date(vorige.datum)) / 864e5));
    const proTag = (letzte.stand - vorige.stand) / tage;

    const kosten = m.preis ? proTag * 30.4 * m.preis + (m.grundpreis ?? 0) : null;
    zahlen.push({
      id: `zaehlerstaende:${m.id}`,
      // Echtes Minuszeichen statt Bindestrich: ein negativer Verbrauch kommt
      // vor (ausgetauschter Zaehler) und soll dann auch wie eine Zahl aussehen.
      wert: `${proTag.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace("-", "−")} ${m.einheit}`,
      label: `${m.name} je Tag`,
      hinweis: kosten
        ? `≈ ${kosten.toFixed(0)} € im Monat${m.abschlag ? ` · ${m.abschlag.toFixed(0)} € Abschlag` : ""}`
        : `${rows.length} Ablesungen`,
      // Wer mehr verbraucht als der Abschlag deckt, zahlt am Jahresende nach.
      // Das ist der Moment, in dem die Zahl gelb werden darf.
      ton: kosten && m.abschlag && kosten > m.abschlag ? "achtung" : "neutral",
    });
  }
  if (zahlen.length === 0) return {};

  const letzte = await db.alle<{ id: number; datum: string; stand: number; name: string; einheit: string }>(
    `SELECT r.id, r.datum, r.stand, m.name, m.einheit FROM meter_readings r
       JOIN meters m ON m.id = r.meter_id
      ORDER BY r.datum DESC, r.id DESC LIMIT 4`
  );

  return {
    zahlen,
    tage: await tageZaehlen("meter_readings", "datum", von, bis),
    ereignisse: letzte.map((r) => ({
      id: `zaehlerstaende:ablesung:${r.id}`,
      datum: r.datum,
      titel: r.name,
      detail: `${r.stand.toLocaleString("de-DE")} ${r.einheit}`,
      art: "Ablesung",
      modul: "zaehlerstaende",
    })),
    seit: await fruehestes("meter_readings", "datum"),
  };
}

/**
 * Ein Diagramm JE ZAEHLER — nicht eins fuer alle.
 *
 * kWh und m³ in ein Bild zu legen hiesse zwei Y-Achsen, und zwei Y-Achsen
 * erfinden einen Zusammenhang, den es nicht gibt. Getrennte Bilder nebeneinander
 * sind die ehrliche Form dafuer.
 *
 * Gezeigt wird der Verbrauch JE TAG zwischen zwei Ablesungen, nicht der Stand:
 * Der Stand steigt immer und sagt nichts; die Steigung ist die Aussage. Und es
 * ist die einzige Form, die auch dann stimmt, wenn zwischen zwei Ablesungen ein
 * Jahr liegt — bei Strom und Gas ist das hier der Normalfall, die liest der
 * Hausmeister ab.
 */
async function diagramme(von: string, bis: string): Promise<Diagramm[]> {
  const meters = await db.alle<{ id: number; name: string; einheit: string; accent: string }>(
    "SELECT id, name, einheit, accent FROM meters ORDER BY sort, id"
  );

  const out: Diagramm[] = [];
  for (const m of meters) {
    const rows = await db.alle<{ datum: string; stand: number }>(
      "SELECT datum, stand FROM meter_readings WHERE meter_id = ? ORDER BY datum ASC, id ASC", m.id
    );

    const punkte: Messpunkt[] = [];
    for (let i = 1; i < rows.length; i++) {
      // Der Punkt gehoert an das ENDE des Zeitraums: der Verbrauch ist erst
      // mit der zweiten Ablesung bekannt.
      if (rows[i].datum < von || rows[i].datum > bis) continue;
      const tage = Math.max(1, Math.round((+new Date(rows[i].datum) - +new Date(rows[i - 1].datum)) / 864e5));
      punkte.push({
        x: rows[i].datum.slice(0, 7),
        y: Math.round(((rows[i].stand - rows[i - 1].stand) / tage) * 100) / 100,
      });
    }
    // Unter drei Punkten ist das keine Entwicklung, sondern eine Zahl — die
    // steht schon auf der Kachel und im Profil.
    if (punkte.length < 3) continue;

    const letzter = punkte[punkte.length - 1];
    out.push({
      id: `zaehlerstaende:${m.id}`,
      titel: m.name,
      hinweis: `Verbrauch je Tag in ${m.einheit}`,
      form: "verlauf",
      einheit: m.einheit,
      breite: "halb",
      kennzahl: {
        wert: `${letzter.y.toLocaleString("de-DE", { maximumFractionDigits: 2 })} ${m.einheit}`,
        label: "zuletzt je Tag",
      },
      reihen: [{
        id: `zaehlerstaende:${m.id}`,
        name: m.name,
        farbe: (["blue", "pink", "violet"].includes(m.accent) ? m.accent : "violet") as Akzent,
        punkte,
      }],
    });
  }
  return out;
}

export const zaehlerstaendeModule: ServerModule = {
  id: "zaehlerstaende",
  title: "Zählerstände",
  router,
  einrichten,
  suche,
  profil,
  diagramme,
};
