import { machRouter } from "../route.js";
import { db, getSetting, setSetting, type Wert } from "../db.js";
import {
  fruehestes, jeMonat, tageZaehlen,
  type Diagramm, type ProfilBeitrag, type ProfilZahl,
  type ServerModule, type Treffer,
} from "./index.js";

// --- Schema ---------------------------------------------------------------

async function einrichten(): Promise<void> {
  await db.exec(`
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
  const cols = await db.alle<{ name: string }>("PRAGMA table_info(time_entries)");
  if (!cols.some((c) => c.name === "projekt_id")) {
    await db.exec("ALTER TABLE time_entries ADD COLUMN projekt_id INTEGER");
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

const runningProject = async (): Promise<number | null> => {
  const v = await getSetting(RUNNING_PROJECT_KEY);
  return v ? Number(v) : null;
};

// Hier standen zwei einmalige Uebernahmen aus dem Vorgaengersystem des
// Entwicklers: ein Startuebertrag von 40 h 01 min und eine Migration, die alle
// Alteintraege einem konkreten Projekt zuordnete. Beides entfernt — eine
// frische Installation beginnt bei null. Bestehende Eintraege bleiben.

// --- Router ---------------------------------------------------------------

const router = machRouter();

// --- Projekte -------------------------------------------------------------

/** Projektliste, jeweils mit Gesamtzeit und Zeit der laufenden Woche. */
router.get("/projects", async (req, res) => {
  const mitArchiv = req.query.archiviert === "1";
  const monday = mondayOf(new Date());
  const rows = await db.alle(
    `SELECT p.id, p.name, p.farbe, p.archiviert,
            COALESCE(SUM(t.minuten), 0)                                   AS gesamtMin,
            COALESCE(SUM(CASE WHEN t.datum >= ? THEN t.minuten END), 0)   AS wocheMin,
            MAX(t.datum)                                                  AS zuletzt,
            COUNT(t.id)                                                   AS eintraege
       FROM projects p
       LEFT JOIN time_entries t ON t.projekt_id = p.id
      ${mitArchiv ? "" : "WHERE p.archiviert = 0"}
      GROUP BY p.id
      ORDER BY p.archiviert, gesamtMin DESC, p.name`,
    monday
  );
  res.json(rows);
});

router.post("/projects", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  // Pruefen und Anlegen gehoeren in eine Klammer, sonst laufen zwei gleiche
  // Namen aneinander vorbei — die UNIQUE-Spalte faenge das zwar ab, aber mit
  // einem rohen Datenbankfehler statt der Meldung von unten.
  const ergebnis = await db.transaktion(async () => {
    if (await db.eine("SELECT id FROM projects WHERE name = ?", name)) return null;
    return db.schreibe(
      "INSERT INTO projects (name, farbe, created_at) VALUES (?, ?, ?)",
      name, String(req.body?.farbe ?? "blue"), now()
    );
  });
  if (!ergebnis) return res.status(409).json({ error: "Projekt existiert bereits" });
  res.json({ id: ergebnis.id, name });
});

router.put("/projects/:id", async (req, res) => {
  const b = req.body ?? {};
  const name = String(b.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  const ok = await db.transaktion(async () => {
    if (await db.eine("SELECT id FROM projects WHERE name = ? AND id <> ?", name, req.params.id))
      return false;
    await db.schreibe(
      "UPDATE projects SET name = ?, farbe = ?, archiviert = ? WHERE id = ?",
      name,
      String(b.farbe ?? "blue"),
      b.archiviert ? 1 : 0,
      req.params.id
    );
    return true;
  });
  if (!ok) return res.status(409).json({ error: "Projekt existiert bereits" });
  res.json({ ok: true });
});

// Loeschen loest die Zuordnung, behaelt die Zeiten aber — sie sind zu wertvoll.
router.delete("/projects/:id", async (req, res) => {
  await db.transaktion(async () => {
    await db.schreibe("UPDATE time_entries SET projekt_id = NULL WHERE projekt_id = ?", req.params.id);
    await db.schreibe("DELETE FROM projects WHERE id = ?", req.params.id);
    if ((await runningProject()) === Number(req.params.id))
      await setSetting(RUNNING_PROJECT_KEY, "");
  });
  res.json({ ok: true });
});

// --- Stempeluhr -----------------------------------------------------------

// Laufender Status (fuer Live-Timer)
router.get("/status", async (_req, res) => {
  const since = await getSetting(RUNNING_KEY);
  if (!since) return res.json({ running: false, since: null, elapsedMin: 0, projektId: null });
  const ms = Number(since);
  res.json({
    running: true,
    since: ms,
    elapsedMin: Math.floor((Date.now() - ms) / 60000),
    projektId: await runningProject(),
  });
});

// Einstempeln — optional direkt auf ein Projekt
router.post("/punch/in", async (req, res) => {
  const projektId = Number(req.body?.projektId) || null;
  // „Laeuft schon?" und „dann starte ich jetzt" muessen zusammengehoeren: Sonst
  // koennten zwei schnelle Klicks beide ein leeres Feld sehen, und der zweite
  // ueberschriebe den Startzeitpunkt des ersten — die erste Zeit waere weg.
  const gestartet = await db.transaktion(async () => {
    if (await getSetting(RUNNING_KEY)) return false;
    await setSetting(RUNNING_KEY, String(Date.now()));
    await setSetting(RUNNING_PROJECT_KEY, projektId ? String(projektId) : "");
    return true;
  });
  if (!gestartet) return res.status(409).json({ error: "läuft bereits" });
  res.json({ running: true, since: Date.now(), projektId });
});

/**
 * Beendet den laufenden Lauf und schreibt ihn weg. Gibt null zurueck, wenn
 * nichts lief. Der Aufrufer klammert das — Lesen, Wegschreiben und Leeren des
 * Merkers sind ein Vorgang.
 */
async function stopRunning(): Promise<{ id: number; minuten: number; projektId: number | null } | null> {
  const since = await getSetting(RUNNING_KEY);
  if (!since) return null;
  const startD = new Date(Number(since));
  const endD = new Date();
  const minuten = Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 60000));
  const projektId = await runningProject();
  const info = await db.schreibe(
    `INSERT INTO time_entries (datum, start, ende, minuten, quelle, notiz, projekt_id, created_at)
     VALUES (?, ?, ?, ?, 'stempel', NULL, ?, ?)`,
    localDate(startD), localTime(startD), localTime(endD), minuten, projektId, now()
  );
  await setSetting(RUNNING_KEY, "");
  await setSetting(RUNNING_PROJECT_KEY, "");
  return { id: info.id, minuten, projektId };
}

// Ausstempeln -> erzeugt einen Eintrag
router.post("/punch/out", async (_req, res) => {
  const r = await db.transaktion(stopRunning);
  if (!r) return res.status(409).json({ error: "nicht eingestempelt" });
  res.json(r);
});

// Projektwechsel: laufenden Lauf wegschreiben und sofort neu starten.
router.post("/punch/switch", async (req, res) => {
  const projektId = Number(req.body?.projektId) || null;
  if (!projektId) return res.status(400).json({ error: "projektId fehlt" });
  const vorher = await db.transaktion(async () => {
    const alt = await stopRunning();
    await setSetting(RUNNING_KEY, String(Date.now()));
    await setSetting(RUNNING_PROJECT_KEY, String(projektId));
    return alt;
  });
  res.json({ running: true, since: Date.now(), projektId, vorher });
});

// Eintraege eines Zeitraums (from/to inklusive), optional auf ein Projekt gefiltert
router.get("/entries", async (req, res) => {
  const from = String(req.query.from ?? "0000-00-00");
  const to = String(req.query.to ?? "9999-99-99");
  const projektId = Number(req.query.projektId) || null;
  const rows = await db.alle(
    `SELECT t.*, p.name AS projektName, p.farbe AS projektFarbe
       FROM time_entries t
       LEFT JOIN projects p ON p.id = t.projekt_id
      WHERE t.datum BETWEEN ? AND ?
        ${projektId ? "AND t.projekt_id = ?" : ""}
      ORDER BY t.datum DESC, t.start DESC`,
    ...(projektId ? [from, to, projektId] : [from, to])
  );
  res.json(rows);
});

/** Summen je Projekt fuer einen Zeitraum — die Auswertung „was steckt wo drin?". */
router.get("/stats", async (req, res) => {
  const from = String(req.query.from ?? "0000-00-00");
  const to = String(req.query.to ?? "9999-99-99");
  const proProjekt = await db.alle(
    `SELECT p.id, p.name, p.farbe, p.archiviert,
            COALESCE(SUM(t.minuten), 0) AS minuten,
            COUNT(t.id)                 AS eintraege
       FROM projects p
       LEFT JOIN time_entries t ON t.projekt_id = p.id AND t.datum BETWEEN ? AND ?
      GROUP BY p.id
      HAVING minuten > 0
      ORDER BY minuten DESC`,
    from, to
  );
  const ohneProjekt = await db.eine<{ minuten: number; eintraege: number }>(
    `SELECT COALESCE(SUM(minuten), 0) AS minuten, COUNT(id) AS eintraege
       FROM time_entries WHERE projekt_id IS NULL AND datum BETWEEN ? AND ?`,
    from, to
  );
  res.json({ proProjekt, ohneProjekt });
});

/** Zeitverlauf eines Projekts, auf Monate gebuendelt (fuer die Balken). */
router.get("/verlauf", async (req, res) => {
  const projektId = Number(req.query.projektId) || null;
  const rows = await db.alle(
    `SELECT substr(datum, 1, 7) AS monat, COALESCE(SUM(minuten), 0) AS minuten
       FROM time_entries
      ${projektId ? "WHERE projekt_id = ?" : ""}
      GROUP BY monat ORDER BY monat`,
    ...(projektId ? [projektId] : [])
  );
  res.json(rows);
});

// Manueller Eintrag
router.post("/entries", async (req, res) => {
  const b = req.body ?? {};
  if (!b.datum) return res.status(400).json({ error: "datum fehlt" });
  const minuten = Number(b.minuten);
  if (!Number.isFinite(minuten) || minuten <= 0)
    return res.status(400).json({ error: "ungültige Dauer" });
  const info = await db.schreibe(
    `INSERT INTO time_entries (datum, start, ende, minuten, quelle, notiz, projekt_id, created_at)
     VALUES (?, ?, ?, ?, 'manuell', ?, ?, ?)`,
    b.datum, b.start || null, b.ende || null, Math.round(minuten),
    b.notiz || null, Number(b.projektId) || null, now()
  );
  res.json({ id: info.id });
});

router.put("/entries/:id", async (req, res) => {
  const b = req.body ?? {};
  const minuten = Math.max(1, Math.round(Number(b.minuten) || 0));
  await db.schreibe(
    `UPDATE time_entries SET datum=?, start=?, ende=?, minuten=?, notiz=?, projekt_id=? WHERE id=?`,
    b.datum, b.start || null, b.ende || null, minuten,
    b.notiz || null, Number(b.projektId) || null, req.params.id
  );
  res.json({ ok: true });
});

router.delete("/entries/:id", async (req, res) => {
  await db.schreibe("DELETE FROM time_entries WHERE id=?", req.params.id);
  res.json({ ok: true });
});

// Kurz-Statistik fuer die Kachel
router.get("/summary", async (_req, res) => {
  const monday = mondayOf(new Date());
  const week = (await db.eine<{ m: number }>(
    "SELECT COALESCE(SUM(minuten),0) m FROM time_entries WHERE datum >= ?", monday
  ))!;
  const today = (await db.eine<{ m: number }>(
    "SELECT COALESCE(SUM(minuten),0) m FROM time_entries WHERE datum = ?", localDate(new Date())
  ))!;
  const since = await getSetting(RUNNING_KEY);
  const pid = await runningProject();
  const projekt = pid
    ? await db.eine<{ name: string }>("SELECT name FROM projects WHERE id = ?", pid)
    : undefined;
  // Fuehrendes Projekt insgesamt — die Kachel soll zeigen, wo die Zeit steckt.
  const top = await db.eine<{ name: string; minuten: number }>(
    `SELECT p.name, COALESCE(SUM(t.minuten), 0) AS minuten
       FROM projects p JOIN time_entries t ON t.projekt_id = p.id
      GROUP BY p.id ORDER BY minuten DESC LIMIT 1`
  );
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
async function suche(begriff: string, grenze: number): Promise<Treffer[]> {
  const m = `%${begriff}%`;
  const je = Math.max(2, Math.floor(grenze / 2));
  const treffer: Treffer[] = [];

  for (const p of await db.alle<{ id: number; name: string; archiviert: number | null }>(
    "SELECT id, name, archiviert FROM projects WHERE name LIKE ? LIMIT ?", m, je
  )) {
    treffer.push({
      id: `stechuhr:projekt:${p.id}`,
      titel: p.name,
      untertitel: p.archiviert ? "archiviert" : null,
      modul: "stechuhr",
      art: "Projekt",
    });
  }

  for (const e of await db.alle<{ id: number; datum: string; minuten: number; notiz: string | null }>(
    "SELECT id, datum, minuten, notiz FROM time_entries WHERE notiz LIKE ? ORDER BY datum DESC LIMIT ?", m, je
  )) {
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
async function profil(von: string, bis: string): Promise<ProfilBeitrag> {
  /**
   * Ab hundert Stunden fallen die Minuten weg. „399 h 30 min" passt in keine
   * Kennzahlenspalte, und bei vierhundert Stunden interessiert die halbe
   * Stunde ohnehin niemanden mehr.
   */
  const stunden = (min: number) =>
    min >= 6000 ? `${Math.round(min / 60)} h` : `${Math.floor(min / 60)} h ${pad(min % 60)} min`;
  const summe = async (sql: string, ...args: Wert[]) =>
    (await db.eine<{ m: number }>(sql, ...args))!.m;

  const heute = new Date();
  const woche = await summe("SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE datum >= ?", mondayOf(heute));
  const monat = await summe(
    "SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE substr(datum,1,7) = ?",
    localDate(heute).slice(0, 7)
  );
  const fenster = await summe("SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE datum BETWEEN ? AND ?", von, bis);
  const gestempelt = (await db.eine<{ n: number }>(
    "SELECT COUNT(DISTINCT datum) AS n FROM time_entries WHERE datum BETWEEN ? AND ?", von, bis
  ))!.n;

  const top = await db.eine<{ name: string; minuten: number }>(
    `SELECT p.name, COALESCE(SUM(t.minuten), 0) AS minuten
       FROM projects p JOIN time_entries t ON t.projekt_id = p.id
      WHERE t.datum BETWEEN ? AND ?
      GROUP BY p.id ORDER BY minuten DESC LIMIT 1`,
    von, bis
  );

  const letzte = await db.alle<{ id: number; datum: string; minuten: number; notiz: string | null; projekt: string | null }>(
    `SELECT t.id, t.datum, t.minuten, t.notiz, p.name AS projekt
       FROM time_entries t LEFT JOIN projects p ON p.id = t.projekt_id
      ORDER BY t.datum DESC, t.id DESC LIMIT 6`
  );

  const zahlen: ProfilZahl[] = [
    { id: "stechuhr:woche", wert: stunden(woche), label: "diese Woche" },
    { id: "stechuhr:monat", wert: stunden(monat), label: "dieser Monat" },
    { id: "stechuhr:fenster", wert: stunden(fenster), label: "im Rückblick", hinweis: `an ${gestempelt} Tagen gestempelt` },
  ];
  // Ein „Top-Projekt" ohne zweites Projekt ist keine Rangliste, sondern nur
  // der Name, der ohnehin ueberall steht. Deshalb erst ab zwei.
  const projekte = (await db.eine<{ n: number }>("SELECT COUNT(*) AS n FROM projects"))!.n;
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
    tage: await tageZaehlen("time_entries", "datum", von, bis),
    ereignisse: letzte.map((e) => ({
      id: `stechuhr:eintrag:${e.id}`,
      datum: e.datum,
      titel: e.notiz || e.projekt || "Zeiteintrag",
      detail: `${stunden(e.minuten)}${e.projekt && e.notiz ? ` · ${e.projekt}` : ""}`,
      art: "Zeit erfasst",
      modul: "stechuhr",
    })),
    seit: await fruehestes("time_entries", "datum"),
  };
}

/**
 * Bilder aus der Stechuhr: der Verlauf und die Verteilung.
 *
 * Zwei Fragen, zwei Formen — „wird es mehr oder weniger?" ist eine Zeitreihe,
 * „wo steckt die Zeit?" ein Groessenvergleich. Beides in ein Bild zu packen
 * beantwortet keine von beiden.
 */
async function diagramme(von: string, bis: string): Promise<Diagramm[]> {
  const stunden = (min: number) => Math.round((min / 60) * 10) / 10;
  const summe = (await db.eine<{ m: number }>(
    "SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE datum BETWEEN ? AND ?", von, bis
  ))!.m;
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
      punkte: await jeMonat("time_entries", "datum", "COALESCE(SUM(minuten),0)", von, bis),
    }],
  });

  // Projektfarben kommen aus dem Modul, nicht aus dem Rang der Reihe: wer ein
  // Projekt wegfiltert, soll die uebrigen in ihrer Farbe wiederfinden.
  const proProjekt = await db.alle<{ id: number; name: string; farbe: string; minuten: number }>(
    `SELECT p.id, p.name, p.farbe, COALESCE(SUM(t.minuten), 0) AS minuten
       FROM projects p JOIN time_entries t ON t.projekt_id = p.id
      WHERE t.datum BETWEEN ? AND ?
      GROUP BY p.id HAVING minuten > 0 ORDER BY minuten DESC`,
    von, bis
  );
  const ohne = (await db.eine<{ m: number }>(
    "SELECT COALESCE(SUM(minuten),0) AS m FROM time_entries WHERE projekt_id IS NULL AND datum BETWEEN ? AND ?",
    von, bis
  ))!.m;

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
  einrichten,
  suche,
  profil,
  diagramme,
};
