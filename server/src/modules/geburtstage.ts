import { Router } from "express";
import { db } from "../db.js";
import type { ProfilBeitrag, ProfilZahl, ServerModule, Termin, Treffer } from "./index.js";

// --- Schema ---------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS geburtstage (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    tag        INTEGER NOT NULL,   -- 1-31
    monat      INTEGER NOT NULL,   -- 1-12
    jahr       INTEGER,            -- Geburtsjahr, falls bekannt
    verstorben INTEGER,            -- Todesjahr; gesetzt = Gedenktag statt Geburtstag
    notiz      TEXT,
    created_at TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();

// Frueher stand hier eine einmalige Uebernahme von 31 echten Geburtstagen aus
// dem alten Kalender des Entwicklers. Sie ist entfernt: ausgelieferter Code
// enthaelt keine Namen und Geburtsdaten von Menschen. Bestehende Eintraege
// bleiben davon unberuehrt — sie stehen laengst in der Datenbank.

// --- Helfer ---------------------------------------------------------------

/** Tage bis zum naechsten Vorkommen von tag./monat. — heute = 0. */
function tageBis(tag: number, monat: number, heute = new Date()): number {
  const jetzt = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
  let ziel = new Date(jetzt.getFullYear(), monat - 1, tag);
  // Der 29.02. faellt in Nicht-Schaltjahren auf den 01.03. — Date rollt selbst.
  if (ziel < jetzt) ziel = new Date(jetzt.getFullYear() + 1, monat - 1, tag);
  return Math.round((ziel.getTime() - jetzt.getTime()) / 86400000);
}

// --- Router ---------------------------------------------------------------

const router = Router();

router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM geburtstage ORDER BY monat, tag, name").all() as {
    id: number; name: string; tag: number; monat: number; jahr: number | null; verstorben: number | null;
  }[];
  const heute = new Date();
  res.json(
    rows.map((r) => {
      const tage = tageBis(r.tag, r.monat, heute);
      // Alter, das die Person an diesem Termin erreicht (bzw. erreicht haette).
      const jahrDesTermins = heute.getFullYear() + (tage === 0 ? 0 : new Date(heute.getFullYear(), r.monat - 1, r.tag) < heute ? 1 : 0);
      return {
        ...r,
        tageBis: tage,
        alter: r.jahr ? jahrDesTermins - r.jahr : null,
      };
    })
  );
});

/** Die naechsten Termine — fuer Kachel und Erinnerung. */
router.get("/naechste", (req, res) => {
  const tage = Number(req.query.tage) || 30;
  const rows = db.prepare("SELECT * FROM geburtstage").all() as {
    id: number; name: string; tag: number; monat: number; jahr: number | null; verstorben: number | null;
  }[];
  const heute = new Date();
  const naechste = rows
    .map((r) => ({ ...r, tageBis: tageBis(r.tag, r.monat, heute) }))
    .filter((r) => r.tageBis <= tage)
    .sort((a, b) => a.tageBis - b.tageBis);
  res.json({ anzahl: rows.length, naechste });
});

router.post("/", (req, res) => {
  const b = req.body ?? {};
  const name = String(b.name ?? "").trim();
  const tag = Number(b.tag);
  const monat = Number(b.monat);
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  if (!(tag >= 1 && tag <= 31)) return res.status(400).json({ error: "ungültiger Tag" });
  if (!(monat >= 1 && monat <= 12)) return res.status(400).json({ error: "ungültiger Monat" });
  const info = db
    .prepare("INSERT INTO geburtstage (name, tag, monat, jahr, verstorben, notiz, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(name, tag, monat, Number(b.jahr) || null, Number(b.verstorben) || null, b.notiz || null, now());
  res.json({ id: info.lastInsertRowid });
});

router.put("/:id", (req, res) => {
  const b = req.body ?? {};
  const name = String(b.name ?? "").trim();
  const tag = Number(b.tag);
  const monat = Number(b.monat);
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  if (!(tag >= 1 && tag <= 31)) return res.status(400).json({ error: "ungültiger Tag" });
  if (!(monat >= 1 && monat <= 12)) return res.status(400).json({ error: "ungültiger Monat" });
  db.prepare("UPDATE geburtstage SET name=?, tag=?, monat=?, jahr=?, verstorben=?, notiz=? WHERE id=?").run(
    name, tag, monat, Number(b.jahr) || null, Number(b.verstorben) || null, b.notiz || null, req.params.id
  );
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM geburtstage WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

/**
 * Meldung an den gemeinsamen Terminfaden.
 *
 * Gerechnet wird ueber das naechste Vorkommen, nicht ueber das Geburtsjahr —
 * ein Geburtstag ist ein jaehrlich wiederkehrender Termin. Gedenktage
 * (verstorben) kommen mit, aber ohne Altersangabe und mit †.
 */
function termine(von: string, bis: string): Termin[] {
  const rows = db.prepare("SELECT * FROM geburtstage").all() as {
    id: number; name: string; tag: number; monat: number; jahr: number | null; verstorben: number | null;
  }[];
  const heute = new Date();
  const ergebnis: Termin[] = [];
  for (const r of rows) {
    const tage = tageBis(r.tag, r.monat, heute);
    const datum = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + tage);
    const iso = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, "0")}-${String(datum.getDate()).padStart(2, "0")}`;
    if (iso < von || iso > bis) continue;
    const alter = r.jahr ? datum.getFullYear() - r.jahr : null;
    ergebnis.push({
      id: `geburtstage:geburtstag:${r.id}`,
      datum: iso,
      titel: r.verstorben ? `${r.name} †` : r.name,
      notiz: r.verstorben
        ? `Gedenktag${r.jahr ? ` · ${r.jahr}–${r.verstorben}` : ""}`
        : alter !== null ? `wird ${alter}` : null,
      art: "geburtstag",
      modul: "geburtstage",
    });
  }
  return ergebnis;
}

/** Meldung an die globale Suche: Namen. */
function suche(begriff: string, grenze: number): Treffer[] {
  const rows = db
    .prepare("SELECT id, name, tag, monat, verstorben FROM geburtstage WHERE name LIKE ? ORDER BY name LIMIT ?")
    .all(`%${begriff}%`, grenze) as { id: number; name: string; tag: number; monat: number; verstorben: number | null }[];
  return rows.map((r) => ({
    id: `geburtstage:person:${r.id}`,
    titel: r.verstorben ? `${r.name} †` : r.name,
    untertitel: `${r.tag}.${r.monat}.`,
    modul: "geburtstage",
    art: r.verstorben ? "Gedenktag" : "Geburtstag",
  }));
}

/**
 * Meldung ans Profil: wie viele Menschen im Kalender stehen, und wer als
 * naechstes dran ist.
 *
 * KEIN Beitrag zum Aktivitaetsraster und kein Verlauf: Ein Geburtstag ist
 * kein Tag, an dem ICH etwas getan habe. Das Raster soll die eigene Spur
 * zeigen, nicht den Kalender fremder Leute.
 */
function profil(_von: string, _bis: string): ProfilBeitrag {
  const rows = db.prepare("SELECT name, tag, monat, verstorben FROM geburtstage").all() as {
    name: string; tag: number; monat: number; verstorben: number | null;
  }[];
  if (rows.length === 0) return {};

  const heute = new Date();
  const naechster = rows
    .map((r) => ({ ...r, tage: tageBis(r.tag, r.monat, heute) }))
    .sort((a, b) => a.tage - b.tage)[0];
  const gedenktage = rows.filter((r) => r.verstorben).length;

  const zahlen: ProfilZahl[] = [
    {
      id: "geburtstage:anzahl",
      wert: String(rows.length),
      label: "im Kalender",
      hinweis: gedenktage > 0 ? `davon ${gedenktage} Gedenktage` : null,
    },
    {
      id: "geburtstage:naechster",
      wert: naechster.tage === 0 ? "heute" : `${naechster.tage} ${naechster.tage === 1 ? "Tag" : "Tage"}`,
      label: naechster.verstorben ? "bis zum Gedenktag" : "bis zum nächsten",
      hinweis: naechster.name,
      ton: naechster.tage <= 7 ? "achtung" : "neutral",
    },
  ];
  return { zahlen };
}

export const geburtstageModule: ServerModule = {
  id: "geburtstage",
  title: "Geburtstage",
  router,
  termine,
  suche,
  profil,
};
