import { machRouter } from "../route.js";
import { db, type Wert } from "../db.js";
import {
  fruehestes, jeMonat, tageZaehlen,
  type Diagramm, type ProfilBeitrag, type ServerModule, type Termin, type Treffer,
} from "./index.js";

// --- Schema ---------------------------------------------------------------

async function einrichten(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      titel         TEXT NOT NULL,
      notiz         TEXT,
      prioritaet    TEXT NOT NULL DEFAULT 'normal',   -- hoch | normal | niedrig
      erledigt      INTEGER NOT NULL DEFAULT 0,
      erledigt_at   TEXT,
      faellig_datum TEXT,                             -- YYYY-MM-DD oder null
      faellig_zeit  TEXT,                             -- HH:MM oder null
      wiederholung  TEXT NOT NULL DEFAULT 'einmalig', -- einmalig | taeglich | woechentlich | monatlich
      created_at    TEXT NOT NULL,
      sort          INTEGER NOT NULL DEFAULT 0
    );
  `);
}

const now = () => new Date().toISOString();
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Nächster Fälligkeitstermin einer wiederkehrenden Aufgabe (ab dem aktuellen Datum). */
function nextDue(datum: string, wdh: string): string {
  const [y, m, d] = datum.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  if (wdh === "taeglich") base.setDate(base.getDate() + 1);
  else if (wdh === "woechentlich") base.setDate(base.getDate() + 7);
  else if (wdh === "monatlich") {
    const day = base.getDate();
    base.setDate(1);
    base.setMonth(base.getMonth() + 1);
    // auf letzten gültigen Tag des Zielmonats begrenzen (z.B. 31. → 28./30.)
    const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    base.setDate(Math.min(day, lastDay));
  }
  return iso(base);
}

// --- Router ---------------------------------------------------------------

const router = machRouter();

// Sortierung: offene zuerst (nach Fälligkeit, dann Priorität), erledigte ans Ende.
const ORDER = `ORDER BY
  erledigt ASC,
  CASE WHEN erledigt=0 AND faellig_datum IS NOT NULL THEN 0 ELSE 1 END,
  faellig_datum ASC, faellig_zeit ASC,
  CASE prioritaet WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
  sort ASC, id DESC`;

router.get("/tasks", async (_req, res) => {
  res.json(await db.alle(`SELECT * FROM tasks ${ORDER}`));
});

// Fällige, noch offene Aufgaben (für Badge + Browser-Benachrichtigung).
// Eine Aufgabe ist fällig, wenn ihr Termin <= jetzt liegt.
router.get("/due", async (_req, res) => {
  const d = iso(new Date());
  const t = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  const rows = await db.alle(
    `SELECT * FROM tasks
     WHERE erledigt=0 AND faellig_datum IS NOT NULL
       AND (faellig_datum < ? OR (faellig_datum = ? AND (faellig_zeit IS NULL OR faellig_zeit <= ?)))
     ${ORDER}`,
    d, d, t
  );
  res.json(rows);
});

router.post("/tasks", async (req, res) => {
  const b = req.body ?? {};
  if (!b.titel?.trim()) return res.status(400).json({ error: "titel fehlt" });
  const info = await db.schreibe(
    `INSERT INTO tasks (titel, notiz, prioritaet, faellig_datum, faellig_zeit, wiederholung, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    b.titel.trim(),
    b.notiz?.trim() || null,
    b.prioritaet || "normal",
    b.faellig_datum || null,
    b.faellig_zeit || null,
    b.wiederholung || "einmalig",
    now()
  );
  res.json({ id: info.id });
});

router.put("/tasks/:id", async (req, res) => {
  const b = req.body ?? {};
  await db.schreibe(
    `UPDATE tasks SET titel=?, notiz=?, prioritaet=?, faellig_datum=?, faellig_zeit=?, wiederholung=? WHERE id=?`,
    (b.titel || "").trim() || "Ohne Titel",
    b.notiz?.trim() || null,
    b.prioritaet || "normal",
    b.faellig_datum || null,
    b.faellig_zeit || null,
    b.wiederholung || "einmalig",
    req.params.id
  );
  res.json({ ok: true });
});

// Abhaken: einmalige Aufgabe -> erledigt; wiederkehrende -> nächster Termin.
router.post("/tasks/:id/done", async (req, res) => {
  // Lesen und Schreiben in einer Klammer: Zwei schnelle Klicks auf dieselbe
  // wiederkehrende Aufgabe wuerden sonst denselben Termin lesen und beide
  // einmal weiterspringen — die Aufgabe waere danach eine Runde zu weit.
  const ergebnis = await db.transaktion(async () => {
    const t = await db.eine<{ wiederholung: string; faellig_datum: string | null }>(
      "SELECT * FROM tasks WHERE id=?", req.params.id
    );
    if (!t) return null;
    if (t.wiederholung !== "einmalig" && t.faellig_datum) {
      const next = nextDue(t.faellig_datum, t.wiederholung);
      await db.schreibe(
        "UPDATE tasks SET faellig_datum=?, erledigt=0, erledigt_at=NULL WHERE id=?", next, req.params.id
      );
      return { recurred: true, next };
    }
    await db.schreibe("UPDATE tasks SET erledigt=1, erledigt_at=? WHERE id=?", now(), req.params.id);
    return { recurred: false };
  });
  if (!ergebnis) return res.status(404).json({ error: "nicht gefunden" });
  res.json(ergebnis);
});

router.post("/tasks/:id/reopen", async (req, res) => {
  await db.schreibe("UPDATE tasks SET erledigt=0, erledigt_at=NULL WHERE id=?", req.params.id);
  res.json({ ok: true });
});

router.delete("/tasks/:id", async (req, res) => {
  await db.schreibe("DELETE FROM tasks WHERE id=?", req.params.id);
  res.json({ ok: true });
});

/**
 * Meldung an den gemeinsamen Terminfaden: offene Aufgaben mit Faelligkeit.
 *
 * Ueberfaellige kommen IMMER mit, auch wenn ihr Datum vor dem Zeitfenster
 * liegt — eine Aufgabe von letzter Woche verschwindet nicht dadurch, dass man
 * „die naechsten 14 Tage" ansieht.
 */
async function termine(von: string, bis: string): Promise<Termin[]> {
  const rows = await db.alle<{
    id: number; titel: string; notiz: string | null; prioritaet: string;
    faellig_datum: string; faellig_zeit: string | null; wiederholung: string;
  }>(
    `SELECT * FROM tasks
     WHERE erledigt = 0 AND faellig_datum IS NOT NULL AND faellig_datum <= ?
     ORDER BY faellig_datum, COALESCE(faellig_zeit, '99:99')`,
    bis
  );
  const heute = iso(new Date());
  return rows
    // Alles ab heute plus alles Ueberfaellige; nur was VOR heute liegt und
    // ausserhalb des Fensters beginnt, faellt weg — das gibt es nicht.
    .filter((r) => r.faellig_datum >= von || r.faellig_datum < heute)
    .map((r) => ({
      id: `aufgaben:aufgabe:${r.id}`,
      datum: r.faellig_datum,
      zeit: r.faellig_zeit,
      titel: r.titel,
      notiz: r.notiz,
      art: "aufgabe" as const,
      modul: "aufgaben",
      dringend: r.prioritaet === "hoch" || r.faellig_datum < heute,
    }));
}

/** Meldung an die globale Suche: Titel und Notiz, offene zuerst. */
async function suche(begriff: string, grenze: number): Promise<Treffer[]> {
  const m = `%${begriff}%`;
  const rows = await db.alle<{
    id: number; titel: string; notiz: string | null; erledigt: number; faellig_datum: string | null;
  }>(
    `SELECT id, titel, notiz, erledigt, faellig_datum FROM tasks
      WHERE titel LIKE ? OR notiz LIKE ?
      ORDER BY erledigt, faellig_datum IS NULL, faellig_datum LIMIT ?`,
    m, m, grenze
  );
  return rows.map((r) => ({
    id: `aufgaben:aufgabe:${r.id}`,
    titel: r.titel,
    untertitel: r.notiz,
    modul: "aufgaben",
    art: r.erledigt ? "Aufgabe (erledigt)" : "Aufgabe",
    datum: r.faellig_datum,
  }));
}

/**
 * Meldung ans Profil: was offen ist, und was man weggearbeitet hat.
 *
 * `erledigt_at` steht als UTC-Zeitstempel in der Tabelle (`toISOString()`).
 * Fuer Tagesgrenzen muss es deshalb durch `date(..., 'localtime')` — sonst
 * rutscht alles, was nach 22 Uhr erledigt wurde, im Raster einen Tag zurueck.
 */
async function profil(von: string, bis: string): Promise<ProfilBeitrag> {
  const zahl = async (sql: string, ...args: Wert[]) =>
    (await db.eine<{ n: number }>(sql, ...args))!.n;

  const heute = iso(new Date());
  const offen = await zahl("SELECT COUNT(*) AS n FROM tasks WHERE erledigt = 0");
  const ueberfaellig = await zahl(
    "SELECT COUNT(*) AS n FROM tasks WHERE erledigt = 0 AND faellig_datum IS NOT NULL AND faellig_datum < ?",
    heute
  );
  const erledigt = await zahl(
    "SELECT COUNT(*) AS n FROM tasks WHERE erledigt = 1 AND date(erledigt_at, 'localtime') BETWEEN ? AND ?",
    von,
    bis
  );

  const letzte = await db.alle<{ id: number; titel: string; prioritaet: string; tag: string }>(
    `SELECT id, titel, prioritaet, date(erledigt_at, 'localtime') AS tag FROM tasks
      WHERE erledigt = 1 AND erledigt_at IS NOT NULL
      ORDER BY erledigt_at DESC LIMIT 6`
  );

  return {
    zahlen: [
      { id: "aufgaben:offen", wert: String(offen), label: "offen", hinweis: offen === 0 ? "alles abgearbeitet" : null, ton: offen === 0 ? "gut" : "neutral" },
      { id: "aufgaben:ueberfaellig", wert: String(ueberfaellig), label: "überfällig", ton: ueberfaellig > 0 ? "achtung" : "gut" },
      { id: "aufgaben:erledigt", wert: String(erledigt), label: "erledigt", hinweis: "im Rückblick" },
    ],
    tage: await tageZaehlen("tasks", "date(erledigt_at, 'localtime')", von, bis, "erledigt = 1"),
    ereignisse: letzte.map((r) => ({
      id: `aufgaben:erledigt:${r.id}`,
      datum: r.tag,
      titel: r.titel,
      detail: r.prioritaet === "hoch" ? "hohe Priorität" : null,
      art: "Aufgabe erledigt",
      modul: "aufgaben",
    })),
    seit: await fruehestes("tasks", "date(created_at, 'localtime')"),
  };
}

/**
 * Bild aus den Aufgaben: was weggearbeitet wurde, Monat fuer Monat.
 *
 * Bewusst die ERLEDIGTEN und nicht die offenen: „offen" ist ein Bestand und
 * gehoert auf eine Kachel, „erledigt" ist eine Bewegung und gehoert in eine
 * Zeitreihe. `erledigt_at` steht als UTC in der Tabelle, deshalb `localtime`.
 */
async function diagramme(von: string, bis: string): Promise<Diagramm[]> {
  const punkte = await jeMonat(
    "tasks", "date(erledigt_at, 'localtime')", "COUNT(*)", von, bis, "erledigt = 1"
  );
  const summe = punkte.reduce((s, p) => s + p.y, 0);
  if (summe === 0) return [];
  return [{
    id: "aufgaben:erledigt",
    titel: "Erledigte Aufgaben",
    hinweis: "je Monat",
    form: "verlauf",
    einheit: "anzahl",
    breite: "halb",
    kennzahl: { wert: String(summe), label: "im Zeitraum" },
    reihen: [{ id: "aufgaben:erledigt", name: "Erledigt", farbe: "pink", punkte }],
  }];
}

export const aufgabenModule: ServerModule = {
  id: "aufgaben",
  title: "Aufgaben",
  router,
  einrichten,
  termine,
  suche,
  profil,
  diagramme,
};
