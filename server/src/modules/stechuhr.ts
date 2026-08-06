import { Router } from "express";
import { db, getSetting, setSetting } from "../db.js";
import {
  fruehestes, jeMonat, tageZaehlen,
  type Diagramm, type ProfilBeitrag, type ProfilZahl,
  type ServerModule, type Treffer,
} from "./index.js";

// --- Schema ---------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS time_entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    datum      TEXT NOT NULL,       -- YYYY-MM-DD (lokal)
    start      TEXT,                -- HH:MM oder null
    ende       TEXT,                -- HH:MM oder null
    minuten    INTEGER NOT NULL,    -- Dauer in Minuten
    quelle     TEXT NOT NULL,       -- 'stempel' | 'manuell' | 'uebertrag'
    notiz      TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    farbe      TEXT NOT NULL DEFAULT 'blue',
    archiviert INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

// Nachtraeglich eingefuehrt: Zeiten haengen an einem Projekt. Kein FK, damit ein
// geloeschtes Projekt seine Eintraege nicht mitreisst — die Route setzt auf NULL.
{
  const cols = db.prepare("PRAGMA table_info(time_entries)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "projekt_id")) {
    db.exec("ALTER TABLE time_entries ADD COLUMN projekt_id INTEGER");
  }
}

// --- Zeit-Helfer (lokale Zeit, nicht UTC) --------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const now = () => new Date().toISOString();

/** Montag (00:00) der Woche, in der `d` liegt — als YYYY-MM-DD. */
function mondayOf(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Mo=0 … So=6
  x.setDate(x.getDate() - day);
  return localDate(x);
}

const RUNNING_KEY = "stechuhr_running_since"; // Epoch-ms als String, oder leer
const RUNNING_PROJECT_KEY = "stechuhr_running_project"; // Projekt-ID als String, oder leer

const runningProject = (): number | null => {
  const v = getSetting(RUNNING_PROJECT_KEY);
  return v ? Number(v) : null;
};

// Hier standen zwei einmalige Uebernahmen aus dem Vorgaengersystem des
// Entwicklers: ein Startuebertrag von 40 h 01 min und eine Migration, die alle
// Alteintraege einem konkreten Projekt zuordnete. Beides entfernt — eine
// frische Installation beginnt bei null. Bestehende Eintraege bleiben.

// --- Router ---------------------------------------------------------------

const router = Router();

// --- Projekte -------------------------------------------------------------

/** Projektliste, jeweils mit Gesamtzeit und Zeit der laufenden Woche. */
router.get("/projects", (req, res) => {
  const mitArchiv = req.query.archiviert === "1";
  const monday = mondayOf(new Date());
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.farbe, p.archiviert,
              COALESCE(SUM(t.minuten), 0)                                   AS gesamtMin,
              COALESCE(SUM(CASE WHEN t.datum >= ? THEN t.minuten END), 0)   AS wocheMin,
              MAX(t.datum)                                                  AS zuletzt,
              COUNT(t.id)                                                   AS eintraege
         FROM projects p
         LEFT JOIN time_entries t ON t.projekt_id = p.id
        ${mitArchiv ? "" : "WHERE p.archiviert = 0"}
        GROUP BY p.id
        ORDER BY p.archiviert, gesamtMin DESC, p.name`
    )
    .all(monday);
  res.json(rows);
});

router.post("/projects", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  const vorhanden = db.prepare("SELECT id FROM projects WHERE name = ?").get(name);
  if (vorhanden) return res.status(409).json({ error: "Projekt existiert bereits" });
  const info = db
    .prepare("INSERT INTO projects (name, farbe, created_at) VALUES (?, ?, ?)")
    .run(name, String(req.body?.farbe ?? "blue"), now());
  res.json({ id: info.lastInsertRowid, name });
});

router.put("/projects/:id", (req, res) => {
  const b = req.body ?? {};
  const name = String(b.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  const kollision = db
    .prepare("SELECT id FROM projects WHERE name = ? AND id <> ?")
    .get(name, req.params.id);
  if (kollision) return res.status(409).json({ error: "Projekt existiert bereits" });
  db.prepare("UPDATE projects SET name = ?, farbe = ?, archiviert = ? WHERE id = ?").run(
    name,
    String(b.farbe ?? "blue"),
    b.archiviert ? 1 : 0,
    req.params.id
  );
  res.json({ ok: true });
});

// Loeschen loest die Zuordnung, behaelt die Zeiten aber — sie sind zu wertvoll.
router.delete("/projects/:id", (req, res) => {
  db.prepare("UPDATE time_entries SET projekt_id = NULL WHERE projekt_id = ?").run(req.params.id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  if (runningProject() === Number(req.params.id)) setSetting(RUNNING_PROJECT_KEY, "");
  res.json({ ok: true });
});

// --- Stempeluhr -----------------------------------------------------------

// Laufender Status (fuer Live-Timer)
router.get("/status", (_req, res) => {
  const since = getSetting(RUNNING_KEY);
  if (!since) return res.json({ running: false, since: null, elapsedMin: 0, projektId: null });
  const ms = Number(since);
  res.json({
    running: true,
    since: ms,
    elapsedMin: Math.floor((Date.now() - ms) / 60000),
    projektId: runningProject(),
  });
});

// Einstempeln — optional direkt auf ein Projekt
router.post("/punch/in", (req, res) => {
  if (getSetting(RUNNING_KEY)) return res.status(409).json({ error: "läuft bereits" });
  const projektId = Number(req.body?.projektId) || null;
  setSetting(RUNNING_KEY, String(Date.now()));
  setSetting(RUNNING_PROJECT_KEY, projektId ? String(projektId) : "");
  res.json({ running: true, since: Date.now(), projektId });
});

/** Beendet den laufenden Lauf und schreibt ihn weg. Gibt null zurueck, wenn nichts lief. */
function stopRunning(): { id: number | bigint; minuten: number; projektId: number | null } | null {
  const since = getSetting(RUNNING_KEY);
  if (!since) return null;
  const startD = new Date(Number(since));
  const endD = new Date();
  const minuten = Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 60000));
  const projektId = runningProject();
  const info = db
    .prepare(
      `INSERT INTO time_entries (datum, start, ende, minuten, quelle, notiz, projekt_id, created_at)
       VALUES (?, ?, ?, ?, 'stempel', NULL, ?, ?)`
    )
    .run(localDate(startD), localTime(startD), localTime(endD), minuten, projektId, now());
  setSetting(RUNNING_KEY, "");
  setSetting(RUNNING_PROJECT_KEY, "");
  return { id: info.lastInsertRowid, minuten, projektId };
}

// Ausstempeln -> erzeugt einen Eintrag
router.post("/punch/out", (_req, res) => {
  const r = stopRunning();
  if (!r) return res.status(409).json({ error: "nicht eingestempelt" });
  res.json(r);
});

// Projektwechsel: laufenden Lauf wegschreiben und sofort neu starten.
router.post("/punch/switch", (req, res) => {
  const projektId = Number(req.body?.projektId) || null;
  if (!projektId) return res.status(400).json({ error: "projektId fehlt" });
  const vorher = stopRunning();
  setSetting(RUNNING_KEY, String(Date.now()));
  setSetting(RUNNING_PROJECT_KEY, String(projektId));
  res.json({ running: true, since: Date.now(), projektId, vorher });
});

// Eintraege eines Zeitraums (from/to inklusive), optional auf ein Projekt gefiltert
router.get("/entries", (req, res) => {
  const from = String(req.query.from ?? "0000-00-00");
  const to = String(req.query.to ?? "9999-99-99");
  const projektId = Number(req.query.projektId) || null;
  const rows = db
    .prepare(
      `SELECT t.*, p.name AS projektName, p.farbe AS projektFarbe
         FROM time_entries t
         LEFT JOIN projects p ON p.id = t.projekt_id
        WHERE t.datum BETWEEN ? AND ?
          ${projektId ? "AND t.projekt_id = ?" : ""}
        ORDER BY t.datum DESC, t.start DESC`
    )
    .all(...(projektId ? [from, to, projektId] : [from, to]));
  res.json(rows);
});

/** Summen je Projekt fuer einen Zeitraum — die Auswertung „was steckt wo drin?". */
router.get("/stats", (req, res) => {
  const from = String(req.query.from ?? "0000-00-00");
  const to = String(req.query.to ?? "9999-99-99");
  const proProjekt = db
    .prepare(
      `SELECT p.id, p.name, p.farbe, p.archiviert,
              COALESCE(SUM(t.minuten), 0) AS minuten,
              COUNT(t.id)                 AS eintraege
         FROM projects p
         LEFT JOIN time_entries t ON t.projekt_id = p.id AND t.datum BETWEEN ? AND ?
        GROUP BY p.id
        HAVING minuten > 0
        ORDER BY minuten DESC`
    )
    .all(from, to);
  const ohneProjekt = db
    .prepare(
      `SELECT COALESCE(SUM(minuten), 0) AS minuten, COUNT(id) AS eintraege
         FROM time_entries WHERE projekt_id IS NULL AND datum BETWEEN ? AND ?`
    )
    .get(from, to) as { minuten: number; eintraege: number };
  res.json({ proProjekt, ohneProjekt });
});

/** Zeitverlauf eines Projekts, auf Monate gebuendelt (fuer die Balken). */
router.get("/verlauf", (req, res) => {
  const projektId = Number(req.query.projektId) || null;
  const rows = db
    .prepare(
      `SELECT substr(datum, 1, 7) AS monat, COALESCE(SUM(minuten), 0) AS minuten
         FROM time_entries
        ${projektId ? "WHERE projekt_id = ?" : ""}
        GROUP BY monat ORDER BY monat`
    )
    .all(...(projektId ? [projektId] : []));
  res.json(rows);
});

// Manueller Eintrag
router.post("/entries", (req, res) => {
  const b = req.body ?? {};
  if (!b.datum) return res.status(400).json({ error: "datum fehlt" });
  const minuten = Number(b.minuten);
  if (!Number.isFinite(minuten) || minuten <= 0)
    return res.status(400).json({ error: "ungültige Dauer" });
  const info = db
    .prepare(
      `INSERT INTO time_entries (datum, start, ende, minuten, quelle, notiz, projekt_id, created_at)
       VALUES (?, ?, ?, ?, 'manuell', ?, ?, ?)`
    )
    .run(
      b.datum, b.start || null, b.ende || null, Math.round(minuten),
      b.notiz || null, Number(b.projektId) || null, now()
    );
  res.json({ id: info.lastInsertRowid });
});

router.put("/entries/:id", (req, res) => {
  const b = req.body ?? {};
  const minuten = Math.max(1, Math.round(Number(b.minuten) || 0));
  db.prepare(
    `UPDATE time_entries SET datum=?, start=?, ende=?, minuten=?, notiz=?, projekt_id=? WHERE id=?`
  ).run(
    b.datum, b.start || null, b.ende || null, minuten,
    b.notiz || null, Number(b.projektId) || null, req.params.id
  );
  res.json({ ok: true });
});

router.delete("/entries/:id", (req, res) => {
  db.prepare("DELETE FROM time_entries WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Kurz-Statistik fuer die Kachel
router.get("/summary", (_req, res) => {
  const monday = mondayOf(new Date());
  const week = db
    .prepare("SELECT COALESCE(SUM(minuten),0) m FROM time_entries WHERE datum >= ?")
    .get(monday) as { m: number };
  const today = db
    .prepare("SELECT COALESCE(SUM(minuten),0) m FROM time_entries WHERE datum = ?")
    .get(localDate(new Date())) as { m: number };
  const since = getSetting(RUNNING_KEY);
  const pid = runningProject();
  const projekt = pid
    ? (db.prepare("SELECT name FROM projects WHERE id = ?").get(pid) as { name: string } | undefined)
    : undefined;
  // Fuehrendes Projekt insgesamt — die Kachel soll zeigen, wo die Zeit steckt.
  const top = db
    .prepare(
      `SELECT p.name, COALESCE(SUM(t.minuten), 0) AS minuten
         FROM projects p JOIN time_entries t ON t.projekt_id = p.id
        GROUP BY p.id ORDER BY minuten DESC LIMIT 1`
    )
    .get() as { name: string; minuten: number } | undefined;
  res.json({
    weekMin: week.m,
    todayMin: today.m,
    running: !!since,
    since: since ? Number(since) : null,
    projektName: projekt?.name ?? null,
    topProjekt: top ?? null,
  });
});

/** Meldung an die globale Suche: Projekte und Notizen an Zeiteintraegen. */
function suche(begriff: string, grenze: number): Treffer[] {
  const m = `%${begriff}%`;
  const je = Math.max(2, Math.floor(grenze / 2));
  const treffer: Treffer[] = [];

  for (const p of db
    .prepare("SELECT id, name, archiviert FROM projects WHERE name LIKE ? LIMIT ?")
    .all(m, je) as { id: number; name: string; archiviert: number | null }[]) {
    treffer.push({
      id: `stechuhr:projekt:${p.id}`,
      titel: p.name,
      untertitel: p.archiviert ? "archiviert" : null,
      modul: "stechuhr",
      art: "Projekt",
    });
  }

  for (const e of db
    .prepare("SELECT id, datum, minuten, notiz FROM time_entries WHERE notiz LIKE ? ORDER BY datum DESC LIMIT ?")
    .all(m, je) as { id: number; datum: string; minuten: number; notiz: string | null }[]) {
    treffer.push({
      id: `stechuhr:eintrag:${e.id}`,
      titel: e.notiz ?? "Zeiteintrag",
      untertitel: `${Math.floor(e.minuten / 60)} h ${e.minuten % 60} min`,
      modul: "stechuhr",
      art: "Zeiteintrag",
      datum: e.datum,
    });
  }

  return treffer;
}

/**
 * Meldung ans Profil: wo die Zeit hingegangen ist.
 *
 * Stunden statt Minuten, weil „74 h 20" eine Aussage ist und „4460" eine
 * Zumutung. Die laufende Stempelung bleibt aussen vor — sie steht schon auf
 * der Kachel und wuerde die Zahl bei jedem Neuladen anders aussehen lassen.
 */
function profil(von: string, bis: string): ProfilBeitrag {
  /**
   * Ab hundert Stunden fallen die Minuten weg. „399 h 30 min" passt in keine
   * Kennzahlenspalte, und bei vierhundert Stunden interessiert die halbe
   * Stunde ohnehin niemanden mehr.
   */
  const stunden = (min: number) =>
    min >= 6000 ? `${Math.round(min / 60)} h` : `${Math.floor(min / 60)} h ${pad(min % 60)} min`;
  const summe = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(...(args as [])) as { m: number }).m;

  const heute = new Date();
  const woche = summe("SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE datum >= ?", mondayOf(heute));
  const monat = summe(
    "SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE substr(datum,1,7) = ?",
    localDate(heute).slice(0, 7)
  );
  const fenster = summe("SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE datum BETWEEN ? AND ?", von, bis);
  const gestempelt = (
    db.prepare("SELECT COUNT(DISTINCT datum) AS n FROM time_entries WHERE datum BETWEEN ? AND ?").get(von, bis) as { n: number }
  ).n;

  const top = db
    .prepare(
      `SELECT p.name, COALESCE(SUM(t.minuten), 0) AS minuten
         FROM projects p JOIN time_entries t ON t.projekt_id = p.id
        WHERE t.datum BETWEEN ? AND ?
        GROUP BY p.id ORDER BY minuten DESC LIMIT 1`
    )
    .get(von, bis) as { name: string; minuten: number } | undefined;

  const letzte = db
    .prepare(
      `SELECT t.id, t.datum, t.minuten, t.notiz, p.name AS projekt
         FROM time_entries t LEFT JOIN projects p ON p.id = t.projekt_id
        ORDER BY t.datum DESC, t.id DESC LIMIT 6`
    )
    .all() as { id: number; datum: string; minuten: number; notiz: string | null; projekt: string | null }[];

  const zahlen: ProfilZahl[] = [
    { id: "stechuhr:woche", wert: stunden(woche), label: "diese Woche" },
    { id: "stechuhr:monat", wert: stunden(monat), label: "dieser Monat" },
    { id: "stechuhr:fenster", wert: stunden(fenster), label: "im Rückblick", hinweis: `an ${gestempelt} Tagen gestempelt` },
  ];
  // Ein „Top-Projekt" ohne zweites Projekt ist keine Rangliste, sondern nur
  // der Name, der ohnehin ueberall steht. Deshalb erst ab zwei.
  const projekte = (db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n;
  if (top && projekte > 1) {
    zahlen.push({
      id: "stechuhr:top",
      wert: top.name,
      label: "meiste Zeit",
      hinweis: `${stunden(top.minuten)} · ${Math.round((top.minuten / Math.max(1, fenster)) * 100)} % davon`,
    });
  }

  return {
    zahlen,
    tage: tageZaehlen("time_entries", "datum", von, bis),
    ereignisse: letzte.map((e) => ({
      id: `stechuhr:eintrag:${e.id}`,
      datum: e.datum,
      titel: e.notiz || e.projekt || "Zeiteintrag",
      detail: `${stunden(e.minuten)}${e.projekt && e.notiz ? ` · ${e.projekt}` : ""}`,
      art: "Zeit erfasst",
      modul: "stechuhr",
    })),
    seit: fruehestes("time_entries", "datum"),
  };
}

/**
 * Bilder aus der Stechuhr: der Verlauf und die Verteilung.
 *
 * Zwei Fragen, zwei Formen — „wird es mehr oder weniger?" ist eine Zeitreihe,
 * „wo steckt die Zeit?" ein Groessenvergleich. Beides in ein Bild zu packen
 * beantwortet keine von beiden.
 */
function diagramme(von: string, bis: string): Diagramm[] {
  const stunden = (min: number) => Math.round((min / 60) * 10) / 10;
  const summe = (db
    .prepare("SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE datum BETWEEN ? AND ?")
    .get(von, bis) as { m: number }).m;
  if (summe === 0) return [];

  const out: Diagramm[] = [];

  out.push({
    id: "stechuhr:verlauf",
    titel: "Erfasste Zeit",
    hinweis: "je Monat",
    form: "verlauf",
    einheit: "minuten",
    breite: "voll",
    kennzahl: { wert: `${stunden(summe).toLocaleString("de-DE")} h`, label: "im Zeitraum" },
    reihen: [{
      id: "stechuhr:zeit",
      name: "Erfasste Zeit",
      farbe: "blue",
      punkte: jeMonat("time_entries", "datum", "COALESCE(SUM(minuten),0)", von, bis),
    }],
  });

  // Projektfarben kommen aus dem Modul, nicht aus dem Rang der Reihe: wer ein
  // Projekt wegfiltert, soll die uebrigen in ihrer Farbe wiederfinden.
  const proProjekt = db
    .prepare(
      `SELECT p.id, p.name, p.farbe, COALESCE(SUM(t.minuten), 0) AS minuten
         FROM projects p JOIN time_entries t ON t.projekt_id = p.id
        WHERE t.datum BETWEEN ? AND ?
        GROUP BY p.id HAVING minuten > 0 ORDER BY minuten DESC`
    )
    .all(von, bis) as { id: number; name: string; farbe: string; minuten: number }[];
  const ohne = (db
    .prepare("SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE projekt_id IS NULL AND datum BETWEEN ? AND ?")
    .get(von, bis) as { m: number }).m;

  // Erst ab zwei Posten ist das ein Vergleich; bei einem waere es ein
  // Balkendiagramm mit einem Balken, und das ist eine Zahl.
  if (proProjekt.length + (ohne > 0 ? 1 : 0) >= 2) {
    const punkte = proProjekt.map((p) => ({ x: p.name, y: p.minuten }));
    if (ohne > 0) punkte.push({ x: "ohne Projekt", y: ohne });
    out.push({
      id: "stechuhr:projekte",
      titel: "Zeit je Projekt",
      hinweis: `${proProjekt.length} ${proProjekt.length === 1 ? "Projekt" : "Projekte"}`,
      form: "balken",
      einheit: "minuten",
      breite: "halb",
      reihen: [{
        id: "stechuhr:projekte",
        name: "Zeit je Projekt",
        farbe: "blue",
        punkte,
      }],
    });
  }

  return out;
}

export const stechuhrModule: ServerModule = {
  id: "stechuhr",
  title: "Stechuhr",
  router,
  suche,
  profil,
  diagramme,
};
