import { machRouter } from "../route.js";
import { db } from "../db.js";
import {
  fruehestes, jeMonat, tageZaehlen,
  type Diagramm, type ProfilBeitrag, type ProfilZahl,
  type ServerModule, type Termin, type Treffer,
} from "./index.js";

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

async function einrichten(): Promise<void> {
  await db.exec(`
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
}

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

const router = machRouter();

router.get("/", async (_req, res) => {
  const rows = await db.alle<FahrzeugRow>("SELECT * FROM fahrzeuge ORDER BY aktiv DESC, name");
  res.json(rows.map((f) => ({ ...f, fristen: fristenVon(f) })));
});

router.post("/", async (req, res) => {
  const d = saeubern(req.body);
  if ("error" in d) return res.status(400).json(d);
  const info = await db.schreibe(
    `INSERT INTO fahrzeuge (name, kennzeichen, art, hu_bis, versicherung_bis, steuer_bis, inspektion_bis, notiz, aktiv, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.name, d.kennzeichen, d.art, d.hu_bis, d.versicherung_bis, d.steuer_bis, d.inspektion_bis, d.notiz, d.aktiv, now()
  );
  res.json({ id: info.id });
});

router.put("/:id", async (req, res) => {
  const d = saeubern(req.body);
  if ("error" in d) return res.status(400).json(d);
  await db.schreibe(
    `UPDATE fahrzeuge SET name=?, kennzeichen=?, art=?, hu_bis=?, versicherung_bis=?, steuer_bis=?, inspektion_bis=?, notiz=?, aktiv=?
      WHERE id=?`,
    d.name, d.kennzeichen, d.art, d.hu_bis, d.versicherung_bis, d.steuer_bis, d.inspektion_bis, d.notiz, d.aktiv, req.params.id
  );
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  // Die Eintraege haengen per FOREIGN KEY dran und gehen mit (PRAGMA
  // foreign_keys steht im SQLite-Treiber auf ON).
  await db.schreibe("DELETE FROM fahrzeuge WHERE id=?", req.params.id);
  res.json({ ok: true });
});

router.get("/:id/eintraege", async (req, res) => {
  res.json(
    await db.alle(
      "SELECT * FROM fahrzeug_eintraege WHERE fahrzeug_id=? ORDER BY datum DESC, id DESC", req.params.id
    )
  );
});

router.post("/:id/eintraege", async (req, res) => {
  const b = req.body ?? {};
  const datum = String(b.datum ?? "").trim();
  if (!ISO.test(datum)) return res.status(400).json({ error: "Bitte ein Datum angeben." });
  const zahl = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const info = await db.schreibe(
    `INSERT INTO fahrzeug_eintraege (fahrzeug_id, datum, art, km, liter, betrag, notiz, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    req.params.id,
    datum,
    ["tanken", "wartung", "reparatur", "sonstiges"].includes(b.art) ? b.art : "tanken",
    zahl(b.km),
    zahl(b.liter),
    zahl(b.betrag),
    String(b.notiz ?? "").trim() || null,
    now()
  );
  res.json({ id: info.id });
});

router.delete("/eintraege/:id", async (req, res) => {
  await db.schreibe("DELETE FROM fahrzeug_eintraege WHERE id=?", req.params.id);
  res.json({ ok: true });
});

/** Zahlen fuer die Kachel. */
router.get("/uebersicht", async (_req, res) => {
  const rows = await db.alle<FahrzeugRow>("SELECT * FROM fahrzeuge WHERE aktiv=1");
  const alle = rows.flatMap((f) => fristenVon(f).map((fr) => ({ ...fr, fahrzeug: f.name })));
  alle.sort((a, b) => a.tage - b.tage);
  const kosten = (await db.eine<{ summe: number }>(
    `SELECT COALESCE(SUM(betrag), 0) AS summe FROM fahrzeug_eintraege
      WHERE betrag IS NOT NULL AND datum >= date('now', '-12 months')`
  ))!;
  res.json({
    anzahl: rows.length,
    naechste: alle[0] ?? null,
    dringend: alle.filter((f) => f.status === "dringend" || f.status === "abgelaufen").length,
    kostenJahr: kosten.summe,
  });
});

/** Meldung an den gemeinsamen Terminfaden: die vier Fristen. */
async function termine(von: string, bis: string): Promise<Termin[]> {
  const rows = await db.alle<FahrzeugRow>("SELECT * FROM fahrzeuge WHERE aktiv=1");
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
async function suche(begriff: string, grenze: number): Promise<Treffer[]> {
  const m = `%${begriff}%`;
  const rows = await db.alle<FahrzeugRow>(
    "SELECT * FROM fahrzeuge WHERE name LIKE ? OR kennzeichen LIKE ? OR notiz LIKE ? LIMIT ?",
    m, m, m, grenze
  );
  return rows.map((f) => ({
    id: `fahrzeug:fahrzeug:${f.id}`,
    titel: f.name,
    untertitel: f.kennzeichen,
    modul: "fahrzeug",
    art: "Fahrzeug",
  }));
}

/**
 * Meldung ans Profil: Strecke, Verbrauch, Kosten — und die naechste Frist.
 *
 * Kilometer und Verbrauch werden je Fahrzeug gerechnet und dann summiert.
 * Ueber alle Fahrzeuge hinweg zu rechnen waere falsch: zwei Tachos ergeben
 * addiert keine Strecke, und ein Motorrad verzerrt den Schnitt eines Autos.
 */
async function profil(von: string, bis: string): Promise<ProfilBeitrag> {
  const fahrzeuge = await db.alle<{ id: number; name: string }>(
    "SELECT id, name FROM fahrzeuge WHERE aktiv = 1"
  );
  if (fahrzeuge.length === 0) return {};

  let km = 0;
  let liter = 0;
  let literStrecke = 0; // nur Strecke zwischen zwei Tankvorgaengen
  for (const f of fahrzeuge) {
    const rows = await db.alle<{ datum: string; art: string; km: number; liter: number | null }>(
      `SELECT datum, art, km, liter FROM fahrzeug_eintraege
        WHERE fahrzeug_id = ? AND km IS NOT NULL AND datum BETWEEN ? AND ?
        ORDER BY km`,
      f.id, von, bis
    );
    if (rows.length >= 2) km += rows[rows.length - 1].km - rows[0].km;
    // Verbrauch: Sprit ab dem ZWEITEN Tankvorgang, denn erst dann ist bekannt,
    // welche Strecke er getragen hat. Die klassische Voll-zu-Voll-Rechnung.
    const tanken = rows.filter((r) => r.art === "tanken" && r.liter);
    if (tanken.length >= 2) {
      literStrecke += tanken[tanken.length - 1].km - tanken[0].km;
      for (let i = 1; i < tanken.length; i++) liter += tanken[i].liter ?? 0;
    }
  }

  const kosten = (await db.eine<{ summe: number; n: number }>(
    `SELECT COALESCE(SUM(betrag), 0) AS summe, COUNT(*) AS n FROM fahrzeug_eintraege
      WHERE betrag IS NOT NULL AND datum BETWEEN ? AND ?`,
    von, bis
  ))!;

  const alle = (await db.alle<FahrzeugRow>("SELECT * FROM fahrzeuge WHERE aktiv=1"))
    .flatMap((f) => fristenVon(f).map((fr) => ({ ...fr, fahrzeug: f.name })))
    .sort((a, b) => a.tage - b.tage);
  const naechste = alle[0] ?? null;

  const letzte = await db.alle<{
    id: number; datum: string; art: string; km: number | null;
    liter: number | null; betrag: number | null; notiz: string | null; fahrzeug: string;
  }>(
    `SELECT e.id, e.datum, e.art, e.km, e.liter, e.betrag, e.notiz, f.name AS fahrzeug
       FROM fahrzeug_eintraege e JOIN fahrzeuge f ON f.id = e.fahrzeug_id
      ORDER BY e.datum DESC, e.id DESC LIMIT 5`
  );

  const zahl = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
  // Mit Tausenderpunkt — dieselbe Schreibweise wie im Haushalt.
  const euro = (n: number) =>
    `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const zahlen: ProfilZahl[] = [];
  if (km > 0) zahlen.push({ id: "fahrzeug:km", wert: `${zahl(km)} km`, label: "gefahren", hinweis: "im Rückblick" });
  if (liter > 0 && literStrecke > 0) {
    zahlen.push({
      id: "fahrzeug:verbrauch",
      wert: `${((liter / literStrecke) * 100).toFixed(1).replace(".", ",")} l`,
      label: "auf 100 km",
      hinweis: `aus ${zahl(literStrecke)} km`,
    });
  }
  if (kosten.n > 0) {
    zahlen.push({
      id: "fahrzeug:kosten",
      wert: euro(kosten.summe),
      label: "Kosten",
      hinweis: km > 0 ? `${euro((kosten.summe / km) * 100)} je 100 km` : `${kosten.n} Belege`,
    });
  }
  if (naechste) {
    zahlen.push({
      id: "fahrzeug:frist",
      wert: naechste.tage < 0 ? "abgelaufen" : `${naechste.tage} ${naechste.tage === 1 ? "Tag" : "Tage"}`,
      label: naechste.label,
      hinweis: fahrzeuge.length > 1 ? naechste.fahrzeug : null,
      ton: naechste.status === "abgelaufen" ? "schlecht" : naechste.status === "dringend" ? "achtung" : "neutral",
    });
  }

  return {
    zahlen,
    tage: await tageZaehlen("fahrzeug_eintraege", "datum", von, bis),
    ereignisse: letzte.map((e) => ({
      id: `fahrzeug:eintrag:${e.id}`,
      datum: e.datum,
      titel: e.notiz || `${e.art[0].toUpperCase()}${e.art.slice(1)} — ${e.fahrzeug}`,
      detail: [
        e.liter ? `${e.liter.toFixed(2).replace(".", ",")} l` : null,
        e.betrag ? euro(e.betrag) : null,
        e.km ? `${zahl(e.km)} km` : null,
      ].filter(Boolean).join(" · ") || null,
      art: e.art === "tanken" ? "Getankt" : e.art === "wartung" ? "Wartung" : e.art === "reparatur" ? "Reparatur" : "Fahrzeug",
      modul: "fahrzeug",
    })),
    seit: await fruehestes("fahrzeug_eintraege", "datum"),
  };
}

/**
 * Bild aus dem Fahrzeug: was es je Monat gekostet hat.
 *
 * Kosten und nicht Kilometer: Die Strecke steht als Zahl im Profil, aber die
 * Frage, bei der ein Verlauf hilft, ist „wird das teurer?".
 */
async function diagramme(von: string, bis: string): Promise<Diagramm[]> {
  const punkte = await jeMonat(
    "fahrzeug_eintraege", "datum", "COALESCE(SUM(betrag),0)", von, bis, "betrag IS NOT NULL"
  );
  const summe = punkte.reduce((s, p) => s + p.y, 0);
  if (summe === 0) return [];
  return [{
    id: "fahrzeug:kosten",
    titel: "Fahrzeugkosten",
    hinweis: "je Monat, Tanken und Werkstatt",
    form: "verlauf",
    einheit: "euro",
    breite: "halb",
    kennzahl: {
      wert: `${summe.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`,
      label: "im Zeitraum",
    },
    reihen: [{ id: "fahrzeug:kosten", name: "Kosten", farbe: "violet", punkte: punkte.map((p) => ({ ...p, y: Math.round(p.y * 100) / 100 })) }],
  }];
}

export const fahrzeugModule: ServerModule = {
  id: "fahrzeug",
  title: "Fahrzeug",
  router,
  einrichten,
  termine,
  suche,
  profil,
  diagramme,
};
