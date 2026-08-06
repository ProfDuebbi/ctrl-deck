import { Router } from "express";
import { db } from "../db.js";
import {
  fruehestes, jeMonat, tageZaehlen,
  type Diagramm, type ProfilBeitrag, type ProfilZahl,
  type ServerModule, type Termin, type Treffer,
} from "./index.js";

// --- Schema ---------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS fixkosten (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    betrag     REAL NOT NULL DEFAULT 0,   -- in Euro, pro Intervall
    intervall  TEXT NOT NULL DEFAULT 'monatlich', -- monatlich | quartal | halbjahr | jaehrlich
    faellig    TEXT,                      -- Tag im Monat (1-31) oder Monatsname bei jaehrlich
    konto      TEXT,
    kategorie  TEXT,
    aktiv      INTEGER NOT NULL DEFAULT 1,
    notiz      TEXT,
    created_at TEXT NOT NULL
  );

  -- Einzelbuchungen. Der Jahresbericht rechnet sich daraus zusammen.
  CREATE TABLE IF NOT EXISTS buchungen (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    datum      TEXT NOT NULL,             -- YYYY-MM-DD
    art        TEXT NOT NULL,             -- 'eingang' | 'ausgang'
    betrag     REAL NOT NULL,
    kategorie  TEXT,
    empfaenger TEXT,
    konto      TEXT,
    notiz      TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_buchungen_datum ON buchungen (datum);

  -- Jahre aus dem alten Sheet, fuer die es keine Einzelbuchungen mehr gibt.
  CREATE TABLE IF NOT EXISTS jahres_uebertrag (
    jahr    INTEGER PRIMARY KEY,
    eingang REAL NOT NULL DEFAULT 0,
    ausgang REAL NOT NULL DEFAULT 0,
    notiz   TEXT
  );

  -- Wiederkehrende monatliche Einnahmen. Werden automatisch als Buchung
  -- angelegt, sobald der Zahltag des Monats erreicht ist.
  CREATE TABLE IF NOT EXISTS einnahmen (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    betrag     REAL NOT NULL DEFAULT 0,
    tag        INTEGER NOT NULL DEFAULT 1,  -- Tag im Monat, auf Monatsende gekappt
    kategorie  TEXT,
    konto      TEXT,
    notiz      TEXT,
    start      TEXT NOT NULL,               -- YYYY-MM, ab diesem Monat wird gebucht
    ende       TEXT,                        -- YYYY-MM, letzter Monat (optional)
    aktiv      INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  -- Ein Eintrag je bereits gebuchtem Monat. Verhindert Doppelbuchungen und
  -- markiert im Buchungsblatt, welche Zeile automatisch entstanden ist.
  CREATE TABLE IF NOT EXISTS einnahmen_laeufe (
    einnahme_id INTEGER NOT NULL,
    periode     TEXT NOT NULL,              -- YYYY-MM
    buchung_id  INTEGER,
    datum       TEXT NOT NULL,
    PRIMARY KEY (einnahme_id, periode)
  );

  -- AUSSENSTAENDE: was ANDERE dem Nutzer schulden (nicht umgekehrt!).
  -- Stand = gesamt - Summe der Rueckzahlungen. Der Tabellenname blieb
  -- historisch „schulden"; die Beschriftung in der Oberflaeche ist die Wahrheit.
  CREATE TABLE IF NOT EXISTS schulden (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    person     TEXT NOT NULL,
    gesamt     REAL NOT NULL DEFAULT 0,
    notiz      TEXT,
    erledigt   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schulden_zahlungen (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    schuld_id INTEGER NOT NULL,
    datum    TEXT NOT NULL,
    betrag   REAL NOT NULL,
    notiz    TEXT
  );
`);

// Vertragsfelder kamen nachtraeglich dazu — bestehende DBs nachziehen.
{
  const spalten = new Set(
    (db.prepare("PRAGMA table_info(fixkosten)").all() as { name: string }[]).map((c) => c.name)
  );
  for (const [name, def] of [
    ["vertrag_ende", "TEXT"],      // YYYY-MM-DD, Ende der aktuellen Laufzeit
    ["frist_wert", "INTEGER"],     // Kuendigungsfrist, Zahl
    ["frist_einheit", "TEXT"],     // tage | wochen | monate
    ["verlaengerung", "INTEGER"],  // Monate automatischer Verlaengerung, 0 = keine
  ] as const) {
    if (!spalten.has(name)) db.exec(`ALTER TABLE fixkosten ADD COLUMN ${name} ${def}`);
  }
}

const now = () => new Date().toISOString();

/** Heutiges Datum in LOKALER Zeit. toISOString() waere UTC und liefert nachts den Vortag. */
function heuteLokal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Date -> YYYY-MM-DD, lokal. */
function isoLokal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const alsDate = (iso: string) => {
  const [j, m, t] = iso.split("-").map(Number);
  return new Date(j, m - 1, t);
};

/** Monatsanteil einer Position — Vergleichbarkeit ueber alle Intervalle. */
const PRO_MONAT: Record<string, number> = {
  monatlich: 1,
  quartal: 1 / 3,
  halbjahr: 1 / 6,
  jaehrlich: 1 / 12,
};
const monatsAnteil = (betrag: number, intervall: string) =>
  betrag * (PRO_MONAT[intervall] ?? 1);

// --- Wiederkehrende Einnahmen ---------------------------------------------

const p2 = (n: number) => String(n).padStart(2, "0");

/** Aktueller Monat als YYYY-MM in lokaler Zeit. */
const periodeHeute = () => heuteLokal().slice(0, 7);

/** Letzter Tag des Monats — der 31. wird im Februar zum 28./29. */
function letzterTag(jahr: number, monat: number): number {
  return new Date(jahr, monat, 0).getDate();
}

/**
 * Konkretes Buchungsdatum einer Periode. Ein Zahltag jenseits des Monatsendes
 * rutscht auf den letzten Tag — sonst faellt der 31. in halben Jahren aus.
 */
function buchungsDatum(periode: string, tag: number): string {
  const [j, m] = periode.split("-").map(Number);
  const t = Math.min(Math.max(1, tag), letzterTag(j, m));
  return `${periode}-${p2(t)}`;
}

/** Alle Monate von `start` bis einschliesslich `bis`, begrenzt durch `ende`. */
function perioden(start: string, bis: string, ende: string | null): string[] {
  const out: string[] = [];
  let [j, m] = start.split("-").map(Number);
  if (!Number.isFinite(j) || !Number.isFinite(m)) return out;
  // Harte Obergrenze, damit ein kaputtes Startdatum keine Endlosschleife baut.
  for (let i = 0; i < 600; i++) {
    const p = `${j}-${p2(m)}`;
    if (p > bis) break;
    if (ende && p > ende) break;
    out.push(p);
    if (++m > 12) { m = 1; j++; }
  }
  return out;
}

type EinnahmeRow = {
  id: number; name: string; betrag: number; tag: number;
  kategorie: string | null; konto: string | null; notiz: string | null;
  start: string; ende: string | null; aktiv: number;
};

/**
 * Legt fuer jede faellige, noch nicht gebuchte Periode eine Buchung an.
 * Laeuft bei jedem Zugriff auf das Modul — dadurch holt die App auch
 * Monate nach, in denen der Server aus war.
 *
 * `vorziehen` bucht zusaetzlich den laufenden Monat, dessen Zahltag noch
 * bevorsteht ("jetzt buchen"), dann mit dem heutigen Datum.
 */
function einnahmenAusfuehren(opts: { nurId?: number; vorziehen?: boolean } = {}): number {
  const { nurId, vorziehen } = opts;
  const heute = heuteLokal();
  const bis = periodeHeute();
  const rows = (
    nurId != null
      ? db.prepare("SELECT * FROM einnahmen WHERE id = ? AND aktiv = 1").all(nurId)
      : db.prepare("SELECT * FROM einnahmen WHERE aktiv = 1").all()
  ) as EinnahmeRow[];

  const gelaufen = db.prepare("SELECT 1 FROM einnahmen_laeufe WHERE einnahme_id = ? AND periode = ?");
  const buchen = db.prepare(
    `INSERT INTO buchungen (datum, art, betrag, kategorie, empfaenger, konto, notiz, created_at)
     VALUES (?, 'eingang', ?, ?, ?, ?, ?, ?)`
  );
  const merken = db.prepare(
    "INSERT INTO einnahmen_laeufe (einnahme_id, periode, buchung_id, datum) VALUES (?, ?, ?, ?)"
  );

  let n = 0;
  for (const e of rows) {
    if (e.betrag <= 0) continue; // ohne Betrag gibt es nichts zu buchen
    for (const periode of perioden(e.start, bis, e.ende)) {
      const faellig = buchungsDatum(periode, e.tag);
      // Zukunft nicht vorwegnehmen — ausser bei "jetzt buchen".
      if (faellig > heute && !vorziehen) continue;
      if (gelaufen.get(e.id, periode)) continue;
      const datum = faellig > heute ? heute : faellig;
      const info = buchen.run(
        datum, e.betrag, e.kategorie || null, e.name, e.konto || null, e.notiz || null, now()
      );
      merken.run(e.id, periode, info.lastInsertRowid as number, datum);
      n++;
    }
  }
  return n;
}

/** Summe der aktiven wiederkehrenden Einnahmen pro Monat. */
function einnahmenProMonat(): number {
  const r = db
    .prepare("SELECT COALESCE(SUM(betrag), 0) s FROM einnahmen WHERE aktiv = 1")
    .get() as { s: number };
  return r.s;
}

// --- Vertragslaufzeiten & Kuendigungsfristen ------------------------------

export type VertragStatus = "dringend" | "bald" | "offen" | "verpasst" | "ausgelaufen";

export interface VertragsInfo {
  /** Ende der aktuellen Laufzeit — bei Verlaengerung fortgeschrieben. */
  laufzeitBis: string;
  /** Letzter Tag, an dem die Kuendigung raus sein muss. */
  kuendbarBis: string;
  /** Tage von heute bis kuendbarBis. Negativ = Frist ist durch. */
  tage: number;
  status: VertragStatus;
  /** true, wenn die Laufzeit schon mindestens einmal weitergerollt wurde. */
  verlaengert: boolean;
}

/**
 * Sortierrang: was Handeln erfordert, steht oben. Rein nach Restlaufzeit zu
 * sortieren waere falsch — ein laengst ausgelaufener Vertrag haette die
 * kleinste Zahl und wuerde die echten Fristen verdraengen.
 */
const RANG: Record<VertragStatus, number> = {
  dringend: 0, verpasst: 1, bald: 2, offen: 3, ausgelaufen: 4,
};
const nachDringlichkeit = (a: VertragsInfo, b: VertragsInfo) =>
  RANG[a.status] - RANG[b.status] || a.tage - b.tage;

/** Datum minus Kuendigungsfrist. Monate mit Monatsende-Clamping (31.03 − 1 Monat = 28.02). */
function minusFrist(datum: string, wert: number, einheit: string): string {
  const [j, m, t] = datum.split("-").map(Number);
  if (einheit === "monate") {
    const ziel = new Date(j, m - 1 - wert, 1);
    const letzter = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
    return isoLokal(new Date(ziel.getFullYear(), ziel.getMonth(), Math.min(t, letzter)));
  }
  const d = new Date(j, m - 1, t);
  d.setDate(d.getDate() - wert * (einheit === "wochen" ? 7 : 1));
  return isoLokal(d);
}

/** Laufzeitende um `monate` weiterschieben, ebenfalls mit Monatsende-Clamping. */
function plusMonate(datum: string, monate: number): string {
  const [j, m, t] = datum.split("-").map(Number);
  const ziel = new Date(j, m - 1 + monate, 1);
  const letzter = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
  return isoLokal(new Date(ziel.getFullYear(), ziel.getMonth(), Math.min(t, letzter)));
}

type VertragFelder = {
  vertrag_ende: string | null;
  frist_wert: number | null;
  frist_einheit: string | null;
  verlaengerung: number | null;
};

/**
 * Rechnet aus, bis wann gekuendigt werden muss. Verlaengert sich der Vertrag
 * automatisch, wird die Laufzeit so lange weitergerollt, bis der
 * Kuendigungstermin wieder in der Zukunft liegt — der Nutzer traegt das
 * Enddatum also genau einmal ein und nie wieder.
 */
function vertragsInfo(f: VertragFelder): VertragsInfo | null {
  if (!f.vertrag_ende) return null;
  const heute = heuteLokal();
  const wert = f.frist_wert ?? 0;
  const einheit = f.frist_einheit ?? "monate";
  const verlaengerung = f.verlaengerung ?? 0;

  let laufzeitBis = f.vertrag_ende;
  let kuendbarBis = wert > 0 ? minusFrist(laufzeitBis, wert, einheit) : laufzeitBis;
  let verlaengert = false;

  if (verlaengerung > 0) {
    // Obergrenze, damit ein uraltes Datum keine Endlosschleife baut.
    for (let i = 0; i < 200 && kuendbarBis < heute; i++) {
      laufzeitBis = plusMonate(laufzeitBis, verlaengerung);
      kuendbarBis = wert > 0 ? minusFrist(laufzeitBis, wert, einheit) : laufzeitBis;
      verlaengert = true;
    }
  }

  const tage = Math.round(
    (alsDate(kuendbarBis).getTime() - alsDate(heute).getTime()) / 86_400_000
  );

  let status: VertragStatus;
  if (tage < 0) status = laufzeitBis >= heute ? "verpasst" : "ausgelaufen";
  else if (tage <= 30) status = "dringend";
  else if (tage <= 90) status = "bald";
  else status = "offen";

  return { laufzeitBis, kuendbarBis, tage, status, verlaengert };
}

const FRIST_EINHEITEN = new Set(["tage", "wochen", "monate"]);

/** Vertragsfelder aus dem Request lesen. Alles optional — ohne Enddatum kein Vertrag. */
function vertragAusBody(b: Record<string, unknown>) {
  const ende = /^\d{4}-\d{2}-\d{2}$/.test(String(b.vertrag_ende ?? ""))
    ? String(b.vertrag_ende)
    : null;
  if (!ende) return { ende: null, wert: null, einheit: null, verlaengerung: null };
  const wertRoh = Math.round(Number(b.frist_wert));
  const wert = Number.isFinite(wertRoh) && wertRoh > 0 ? Math.min(wertRoh, 999) : null;
  const einheitRoh = String(b.frist_einheit ?? "monate");
  const verlRoh = Math.round(Number(b.verlaengerung));
  return {
    ende,
    wert,
    einheit: FRIST_EINHEITEN.has(einheitRoh) ? einheitRoh : "monate",
    verlaengerung: Number.isFinite(verlRoh) && verlRoh > 0 ? Math.min(verlRoh, 120) : 0,
  };
}

// Hier standen zwei einmalige Uebernahmen aus dem alten Haushaltsbuch des
// Entwicklers: 13 Fixkosten mit echten Betraegen und Konten, die Jahresbilanzen
// 2021-2024 und drei namentlich genannte Schuldner. Alles entfernt — das sind
// Daten, keine Vorgaben, und sie gehoeren niemandem ausser ihm. Bestehende
// Eintraege bleiben unberuehrt, sie liegen laengst in der Datenbank.

// --- Router ---------------------------------------------------------------

const router = Router();

// Vor jeder Anfrage faellige Einnahmen nachbuchen. Kostet nur ein paar
// Selects und macht jede Antwort automatisch aktuell.
router.use((_req, _res, next) => {
  try { einnahmenAusfuehren(); } catch (e) { console.error("[haushalt] Einnahmen-Lauf:", e); }
  next();
});

router.get("/fixkosten", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM fixkosten ORDER BY aktiv DESC, kategorie, name")
    .all() as (Record<string, unknown> & VertragFelder)[];
  res.json(rows.map((r) => ({ ...r, vertrag: vertragsInfo(r) })));
});

/** Nur die Positionen mit Vertragsdaten, dringendste zuerst. */
router.get("/vertraege", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM fixkosten WHERE aktiv = 1 AND vertrag_ende IS NOT NULL")
    .all() as (Record<string, unknown> & VertragFelder)[];
  const out = rows
    .map((r) => ({ ...r, vertrag: vertragsInfo(r)! }))
    .sort((a, b) => nachDringlichkeit(a.vertrag, b.vertrag));
  res.json(out);
});

router.post("/fixkosten", (req, res) => {
  const b = req.body ?? {};
  const name = String(b.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  const betrag = Number(b.betrag);
  if (!Number.isFinite(betrag) || betrag < 0) return res.status(400).json({ error: "ungültiger Betrag" });
  const v = vertragAusBody(b);
  const info = db
    .prepare(
      `INSERT INTO fixkosten (name, betrag, intervall, faellig, konto, kategorie, aktiv, notiz,
                              vertrag_ende, frist_wert, frist_einheit, verlaengerung, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name, betrag, String(b.intervall ?? "monatlich"), b.faellig || null,
      b.konto || null, b.kategorie || null, b.aktiv === false ? 0 : 1, b.notiz || null,
      v.ende, v.wert, v.einheit, v.verlaengerung, now()
    );
  res.json({ id: info.lastInsertRowid });
});

router.put("/fixkosten/:id", (req, res) => {
  const b = req.body ?? {};
  const name = String(b.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Name fehlt" });
  const betrag = Number(b.betrag);
  if (!Number.isFinite(betrag) || betrag < 0) return res.status(400).json({ error: "ungültiger Betrag" });
  const v = vertragAusBody(b);
  db.prepare(
    `UPDATE fixkosten SET name=?, betrag=?, intervall=?, faellig=?, konto=?, kategorie=?, aktiv=?, notiz=?,
                          vertrag_ende=?, frist_wert=?, frist_einheit=?, verlaengerung=?
      WHERE id=?`
  ).run(
    name, betrag, String(b.intervall ?? "monatlich"), b.faellig || null,
    b.konto || null, b.kategorie || null, b.aktiv === false ? 0 : 1, b.notiz || null,
    v.ende, v.wert, v.einheit, v.verlaengerung, req.params.id
  );
  res.json({ ok: true });
});

router.delete("/fixkosten/:id", (req, res) => {
  db.prepare("DELETE FROM fixkosten WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

/** Summen: monatliche Last insgesamt, je Konto und je Kategorie. */
router.get("/summary", (_req, res) => {
  const rows = db
    .prepare("SELECT betrag, intervall, konto, kategorie, aktiv FROM fixkosten WHERE aktiv = 1")
    .all() as { betrag: number; intervall: string; konto: string | null; kategorie: string | null }[];

  let proMonat = 0;
  const jeKonto: Record<string, number> = {};
  const jeKategorie: Record<string, number> = {};
  for (const r of rows) {
    const m = monatsAnteil(r.betrag, r.intervall);
    proMonat += m;
    const k = r.konto || "ohne Konto";
    const c = r.kategorie || "ohne Kategorie";
    jeKonto[k] = (jeKonto[k] ?? 0) + m;
    jeKategorie[c] = (jeKategorie[c] ?? 0) + m;
  }

  const ohneBetrag = db
    .prepare("SELECT COUNT(*) n FROM fixkosten WHERE aktiv = 1 AND betrag = 0")
    .get() as { n: number };

  const sortiert = (o: Record<string, number>) =>
    Object.entries(o).map(([name, betrag]) => ({ name, betrag })).sort((a, b) => b.betrag - a.betrag);

  const einnahmen = einnahmenProMonat();

  res.json({
    proMonat,
    proJahr: proMonat * 12,
    anzahl: rows.length,
    ohneBetrag: ohneBetrag.n,
    jeKonto: sortiert(jeKonto),
    jeKategorie: sortiert(jeKategorie),
    einnahmenProMonat: einnahmen,
    uebrigProMonat: einnahmen - proMonat,
  });
});

// --- Kachel auf der Uebersichtsseite --------------------------------------

/** Tage von heute bis `datum` — negativ waere Vergangenheit, kommt hier nicht vor. */
function tageBis(datum: string): number {
  const [j, m, t] = datum.split("-").map(Number);
  const ziel = new Date(j, m - 1, t);
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  return Math.round((ziel.getTime() - heute.getTime()) / 86_400_000);
}

/**
 * Alles, was die Uebersichtskachel braucht, in einer Antwort — statt vier
 * Einzelabfragen beim Rendern der Startseite.
 */
router.get("/tile", (_req, res) => {
  const fix = db
    .prepare("SELECT betrag, intervall FROM fixkosten WHERE aktiv = 1")
    .all() as { betrag: number; intervall: string }[];
  const fixProMonat = fix.reduce((s, r) => s + monatsAnteil(r.betrag, r.intervall), 0);
  const einnahmen = einnahmenProMonat();

  // Laufender Monat aus echten Buchungen.
  const monat = periodeHeute();
  const saldo = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN art = 'eingang' THEN betrag END), 0) AS ein,
              COALESCE(SUM(CASE WHEN art = 'ausgang' THEN betrag END), 0) AS aus
         FROM buchungen WHERE substr(datum, 1, 7) = ?`
    )
    .get(monat) as { ein: number; aus: number };

  const schulden = db
    .prepare(
      `SELECT COALESCE(SUM(MAX(0, s.gesamt - COALESCE(
                (SELECT SUM(betrag) FROM schulden_zahlungen z WHERE z.schuld_id = s.id), 0))), 0) AS offen,
              COUNT(*) AS anzahl
         FROM schulden s WHERE s.erledigt = 0`
    )
    .get() as { offen: number; anzahl: number };

  // Naechster Zahltag ueber alle aktiven Einnahmen — der frueheste gewinnt.
  const aktive = db.prepare("SELECT * FROM einnahmen WHERE aktiv = 1").all() as EinnahmeRow[];
  let naechste: { name: string; datum: string; betrag: number; tage: number } | null = null;
  for (const e of aktive) {
    const datum = naechsterTermin(e);
    if (!datum) continue;
    if (!naechste || datum < naechste.datum)
      naechste = { name: e.name, datum, betrag: e.betrag, tage: tageBis(datum) };
  }

  const ohneBetrag = db
    .prepare("SELECT COUNT(*) n FROM fixkosten WHERE aktiv = 1 AND betrag = 0")
    .get() as { n: number };

  // Dringendste Kuendigungsfrist — nur was wirklich druckt (<= 90 Tage) oder
  // gerade verpasst wurde.
  const vertraege = db
    .prepare("SELECT name, vertrag_ende, frist_wert, frist_einheit, verlaengerung FROM fixkosten WHERE aktiv = 1 AND vertrag_ende IS NOT NULL")
    .all() as ({ name: string } & VertragFelder)[];
  let frist: { name: string; kuendbarBis: string; tage: number; status: VertragStatus } | null = null;
  let bester: VertragsInfo | null = null;
  for (const v of vertraege) {
    const info = vertragsInfo(v);
    if (!info || info.status === "offen" || info.status === "ausgelaufen") continue;
    if (!bester || nachDringlichkeit(info, bester) < 0) {
      bester = info;
      frist = { name: v.name, kuendbarBis: info.kuendbarBis, tage: info.tage, status: info.status };
    }
  }

  res.json({
    fixProMonat,
    einnahmenProMonat: einnahmen,
    uebrigProMonat: einnahmen - fixProMonat,
    monat: { ...saldo, saldo: saldo.ein - saldo.aus },
    schuldenOffen: schulden.offen,
    schuldenAnzahl: schulden.anzahl,
    naechsteEinnahme: naechste,
    naechsteFrist: frist,
    ohneBetrag: ohneBetrag.n,
    anzahl: fix.length,
  });
});

// --- Wiederkehrende Einnahmen --------------------------------------------

/**
 * Naechster Zahltag: die erste Periode ab heute, die noch nicht gebucht ist.
 * null, wenn die Reihe ausgelaufen ist.
 */
function naechsterTermin(e: EinnahmeRow): string | null {
  const heute = periodeHeute();
  let periode = e.start > heute ? e.start : heute;
  const gelaufen = db.prepare("SELECT 1 FROM einnahmen_laeufe WHERE einnahme_id = ? AND periode = ?");
  for (let i = 0; i < 24; i++) {
    if (e.ende && periode > e.ende) return null;
    if (!gelaufen.get(e.id, periode)) return buchungsDatum(periode, e.tag);
    const [j, m] = periode.split("-").map(Number);
    periode = m === 12 ? `${j + 1}-01` : `${j}-${p2(m + 1)}`;
  }
  return null;
}

router.get("/einnahmen", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM einnahmen ORDER BY aktiv DESC, tag, name")
    .all() as EinnahmeRow[];
  const letzter = db.prepare(
    "SELECT periode, datum FROM einnahmen_laeufe WHERE einnahme_id = ? ORDER BY periode DESC LIMIT 1"
  );
  res.json(
    rows.map((e) => ({
      ...e,
      naechster: e.aktiv ? naechsterTermin(e) : null,
      zuletzt: (letzter.get(e.id) as { periode: string; datum: string } | undefined) ?? null,
    }))
  );
});

/** Gemeinsame Pruefung fuer POST und PUT. */
function einnahmeAusBody(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim();
  if (!name) return { error: "Name fehlt" as const };
  const betrag = Number(b.betrag);
  if (!Number.isFinite(betrag) || betrag < 0) return { error: "ungültiger Betrag" as const };
  const tag = Math.min(31, Math.max(1, Math.round(Number(b.tag)) || 1));
  const start = /^\d{4}-\d{2}$/.test(String(b.start ?? "")) ? String(b.start) : periodeHeute();
  const ende = /^\d{4}-\d{2}$/.test(String(b.ende ?? "")) ? String(b.ende) : null;
  return {
    name, betrag, tag, start, ende,
    kategorie: (b.kategorie as string) || null,
    konto: (b.konto as string) || null,
    notiz: (b.notiz as string) || null,
    aktiv: b.aktiv === false || b.aktiv === 0 ? 0 : 1,
  };
}

router.post("/einnahmen", (req, res) => {
  const v = einnahmeAusBody(req.body ?? {});
  if ("error" in v) return res.status(400).json({ error: v.error });
  const info = db
    .prepare(
      `INSERT INTO einnahmen (name, betrag, tag, kategorie, konto, notiz, start, ende, aktiv, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(v.name, v.betrag, v.tag, v.kategorie, v.konto, v.notiz, v.start, v.ende, v.aktiv, now());
  // Rueckwirkend faellige Monate direkt mitnehmen.
  const gebucht = einnahmenAusfuehren({ nurId: Number(info.lastInsertRowid) });
  res.json({ id: info.lastInsertRowid, gebucht });
});

router.put("/einnahmen/:id", (req, res) => {
  const v = einnahmeAusBody(req.body ?? {});
  if ("error" in v) return res.status(400).json({ error: v.error });
  db.prepare(
    `UPDATE einnahmen SET name=?, betrag=?, tag=?, kategorie=?, konto=?, notiz=?, start=?, ende=?, aktiv=?
      WHERE id=?`
  ).run(v.name, v.betrag, v.tag, v.kategorie, v.konto, v.notiz, v.start, v.ende, v.aktiv, req.params.id);
  const gebucht = einnahmenAusfuehren({ nurId: Number(req.params.id) });
  res.json({ ok: true, gebucht });
});

/**
 * Loeschen entfernt nur die Regel. Bereits gebuchte Einnahmen bleiben stehen —
 * sie sind ja tatsaechlich geflossen und gehoeren in den Jahresbericht.
 */
router.delete("/einnahmen/:id", (req, res) => {
  db.prepare("DELETE FROM einnahmen_laeufe WHERE einnahme_id=?").run(req.params.id);
  db.prepare("DELETE FROM einnahmen WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

/** Zahltag vorziehen: den laufenden Monat sofort buchen. */
router.post("/einnahmen/:id/jetzt", (req, res) => {
  const gebucht = einnahmenAusfuehren({ nurId: Number(req.params.id), vorziehen: true });
  res.json({ gebucht });
});

router.get("/einnahmen/:id/laeufe", (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT l.periode, l.datum, l.buchung_id, b.betrag
           FROM einnahmen_laeufe l LEFT JOIN buchungen b ON b.id = l.buchung_id
          WHERE l.einnahme_id = ? ORDER BY l.periode DESC`
      )
      .all(req.params.id)
  );
});

// --- Buchungen ------------------------------------------------------------

/**
 * Vorschlagslisten fuer das Buchungsformular — abgeleitet aus dem, was der
 * Nutzer selbst schon gebucht hat.
 *
 * Vorher stand hier eine feste Liste mit 29 Empfaengern aus dem alten
 * Haushaltsbuch des Entwicklers — Supermaerkte und Baumaerkte samt Ortsnamen.
 * Das war nicht nur fremder Ballast, sondern verriet nebenbei den Wohnort:
 * persoenliche Daten, die wie Code aussehen.
 *
 * Die abgeleitete Liste ist ab der zweiten Buchung nuetzlicher als jede
 * mitgelieferte und pflegt sich von selbst. Haeufigstes zuerst, damit die
 * Vorschlaege oben stehen, die man wirklich braucht.
 */
router.get("/vorschlaege", (_req, res) => {
  const spalte = (name: "empfaenger" | "kategorie" | "konto") =>
    (
      db
        .prepare(
          `SELECT ${name} AS wert, COUNT(*) AS n FROM buchungen
            WHERE ${name} IS NOT NULL AND TRIM(${name}) <> ''
            GROUP BY ${name} ORDER BY n DESC, wert COLLATE NOCASE LIMIT 60`
        )
        .all() as { wert: string }[]
    ).map((r) => r.wert);

  res.json({
    empfaenger: spalte("empfaenger"),
    kategorien: spalte("kategorie"),
    konten: spalte("konto"),
  });
});

router.get("/buchungen", (req, res) => {
  const from = String(req.query.from ?? "0000-00-00");
  const to = String(req.query.to ?? "9999-99-99");
  const rows = db
    .prepare(
      `SELECT b.*, (SELECT l.einnahme_id FROM einnahmen_laeufe l WHERE l.buchung_id = b.id) AS einnahme_id
         FROM buchungen b WHERE b.datum BETWEEN ? AND ? ORDER BY b.datum DESC, b.id DESC`
    )
    .all(from, to);
  res.json(rows);
});

router.post("/buchungen", (req, res) => {
  const b = req.body ?? {};
  if (!b.datum) return res.status(400).json({ error: "Datum fehlt" });
  const betrag = Number(b.betrag);
  if (!Number.isFinite(betrag) || betrag <= 0) return res.status(400).json({ error: "ungültiger Betrag" });
  const art = b.art === "eingang" ? "eingang" : "ausgang";
  const info = db
    .prepare(
      `INSERT INTO buchungen (datum, art, betrag, kategorie, empfaenger, konto, notiz, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(b.datum, art, betrag, b.kategorie || null, b.empfaenger || null, b.konto || null, b.notiz || null, now());
  res.json({ id: info.lastInsertRowid });
});

router.put("/buchungen/:id", (req, res) => {
  const b = req.body ?? {};
  const betrag = Number(b.betrag);
  if (!b.datum) return res.status(400).json({ error: "Datum fehlt" });
  if (!Number.isFinite(betrag) || betrag <= 0) return res.status(400).json({ error: "ungültiger Betrag" });
  db.prepare(
    `UPDATE buchungen SET datum=?, art=?, betrag=?, kategorie=?, empfaenger=?, konto=?, notiz=? WHERE id=?`
  ).run(
    b.datum, b.art === "eingang" ? "eingang" : "ausgang", betrag,
    b.kategorie || null, b.empfaenger || null, b.konto || null, b.notiz || null, req.params.id
  );
  res.json({ ok: true });
});

router.delete("/buchungen/:id", (req, res) => {
  db.prepare("DELETE FROM buchungen WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// --- Jahresbericht --------------------------------------------------------

/** Monatszeilen eines Jahres plus Jahressumme. */
router.get("/jahr/:jahr", (req, res) => {
  const jahr = Number(req.params.jahr);
  if (!Number.isFinite(jahr)) return res.status(400).json({ error: "ungültiges Jahr" });
  const rows = db
    .prepare(
      `SELECT substr(datum, 6, 2) AS monat,
              COALESCE(SUM(CASE WHEN art = 'eingang' THEN betrag END), 0) AS eingang,
              COALESCE(SUM(CASE WHEN art = 'ausgang' THEN betrag END), 0) AS ausgang
         FROM buchungen WHERE substr(datum, 1, 4) = ?
        GROUP BY monat ORDER BY monat`
    )
    .all(String(jahr)) as { monat: string; eingang: number; ausgang: number }[];

  const monate = Array.from({ length: 12 }, (_, i) => {
    const key = String(i + 1).padStart(2, "0");
    const t = rows.find((r) => r.monat === key);
    return { monat: i + 1, eingang: t?.eingang ?? 0, ausgang: t?.ausgang ?? 0 };
  });
  const eingang = monate.reduce((s, m) => s + m.eingang, 0);
  const ausgang = monate.reduce((s, m) => s + m.ausgang, 0);
  const uebertrag = db.prepare("SELECT * FROM jahres_uebertrag WHERE jahr = ?").get(jahr) as
    | { jahr: number; eingang: number; ausgang: number; notiz: string | null }
    | undefined;

  res.json({ jahr, monate, eingang, ausgang, differenz: eingang - ausgang, uebertrag: uebertrag ?? null });
});

/** Alle Jahre im Überblick — echte Buchungen und Altbestand zusammengeführt. */
router.get("/jahre", (_req, res) => {
  const echte = db
    .prepare(
      `SELECT CAST(substr(datum, 1, 4) AS INTEGER) AS jahr,
              COALESCE(SUM(CASE WHEN art = 'eingang' THEN betrag END), 0) AS eingang,
              COALESCE(SUM(CASE WHEN art = 'ausgang' THEN betrag END), 0) AS ausgang,
              COUNT(*) AS buchungen
         FROM buchungen GROUP BY jahr`
    )
    .all() as { jahr: number; eingang: number; ausgang: number; buchungen: number }[];
  const alte = db.prepare("SELECT * FROM jahres_uebertrag").all() as {
    jahr: number; eingang: number; ausgang: number; notiz: string | null;
  }[];

  const map = new Map<number, { jahr: number; eingang: number; ausgang: number; buchungen: number; historisch: boolean }>();
  for (const a of alte) map.set(a.jahr, { jahr: a.jahr, eingang: a.eingang, ausgang: a.ausgang, buchungen: 0, historisch: true });
  for (const e of echte) {
    const v = map.get(e.jahr);
    if (v) { v.eingang += e.eingang; v.ausgang += e.ausgang; v.buchungen = e.buchungen; }
    else map.set(e.jahr, { ...e, historisch: false });
  }
  const jahre = [...map.values()]
    .map((j) => ({ ...j, differenz: j.eingang - j.ausgang }))
    .sort((a, b) => b.jahr - a.jahr);
  res.json(jahre);
});

router.put("/jahre/:jahr", (req, res) => {
  const jahr = Number(req.params.jahr);
  const b = req.body ?? {};
  db.prepare(
    `INSERT INTO jahres_uebertrag (jahr, eingang, ausgang, notiz) VALUES (?, ?, ?, ?)
     ON CONFLICT(jahr) DO UPDATE SET eingang = excluded.eingang, ausgang = excluded.ausgang, notiz = excluded.notiz`
  ).run(jahr, Number(b.eingang) || 0, Number(b.ausgang) || 0, b.notiz || null);
  res.json({ ok: true });
});

// --- Schulden -------------------------------------------------------------

router.get("/schulden", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*,
              COALESCE((SELECT SUM(betrag) FROM schulden_zahlungen z WHERE z.schuld_id = s.id), 0) AS bezahlt
         FROM schulden s ORDER BY s.erledigt, s.person`
    )
    .all() as { id: number; gesamt: number; bezahlt: number }[];
  res.json(rows.map((r) => ({ ...r, offen: Math.max(0, r.gesamt - r.bezahlt) })));
});

router.post("/schulden", (req, res) => {
  const b = req.body ?? {};
  const person = String(b.person ?? "").trim();
  if (!person) return res.status(400).json({ error: "Name fehlt" });
  const gesamt = Number(b.gesamt);
  if (!Number.isFinite(gesamt) || gesamt < 0) return res.status(400).json({ error: "ungültiger Betrag" });
  const info = db
    .prepare("INSERT INTO schulden (person, gesamt, notiz, created_at) VALUES (?, ?, ?, ?)")
    .run(person, gesamt, b.notiz || null, now());
  res.json({ id: info.lastInsertRowid });
});

router.put("/schulden/:id", (req, res) => {
  const b = req.body ?? {};
  const person = String(b.person ?? "").trim();
  if (!person) return res.status(400).json({ error: "Name fehlt" });
  db.prepare("UPDATE schulden SET person=?, gesamt=?, notiz=?, erledigt=? WHERE id=?").run(
    person, Number(b.gesamt) || 0, b.notiz || null, b.erledigt ? 1 : 0, req.params.id
  );
  res.json({ ok: true });
});

router.delete("/schulden/:id", (req, res) => {
  db.prepare("DELETE FROM schulden_zahlungen WHERE schuld_id=?").run(req.params.id);
  db.prepare("DELETE FROM schulden WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

router.get("/schulden/:id/zahlungen", (req, res) => {
  res.json(
    db.prepare("SELECT * FROM schulden_zahlungen WHERE schuld_id=? ORDER BY datum DESC, id DESC").all(req.params.id)
  );
});

router.post("/schulden/:id/zahlungen", (req, res) => {
  const b = req.body ?? {};
  const betrag = Number(b.betrag);
  if (!Number.isFinite(betrag) || betrag <= 0) return res.status(400).json({ error: "ungültiger Betrag" });
  const info = db
    .prepare("INSERT INTO schulden_zahlungen (schuld_id, datum, betrag, notiz) VALUES (?, ?, ?, ?)")
    .run(req.params.id, b.datum || heuteLokal(), betrag, b.notiz || null);
  res.json({ id: info.lastInsertRowid });
});

router.delete("/zahlungen/:id", (req, res) => {
  db.prepare("DELETE FROM schulden_zahlungen WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

/**
 * Meldung an den gemeinsamen Terminfaden. Der Haushalt liefert zwei Sorten:
 *
 * - **Kuendigungsfristen** aus den Fixkosten. Gerechnet wird mit derselben
 *   `vertragsInfo()` wie im Fixkosten-Tab, damit nirgends eine zweite Wahrheit
 *   entsteht. Verpasste Fristen kommen mit — sie sind erst recht eine Meldung.
 * - **Zahltage** der wiederkehrenden Einnahmen, ueber `buchungsDatum()`, das
 *   den Tag aufs Monatsende kappt (der 31. im Februar wird zum 28./29.).
 */
function termine(von: string, bis: string): Termin[] {
  const ergebnis: Termin[] = [];

  const posten = db.prepare("SELECT * FROM fixkosten WHERE aktiv = 1").all() as (VertragFelder & {
    id: number; name: string;
  })[];
  for (const p of posten) {
    const info = vertragsInfo(p);
    if (!info) continue;
    if (info.status === "ausgelaufen") continue; // nichts mehr zu tun
    if (info.kuendbarBis < von || info.kuendbarBis > bis) continue;
    ergebnis.push({
      id: `haushalt:frist:${p.id}`,
      datum: info.kuendbarBis,
      titel: `${p.name} kündbar bis`,
      notiz: info.status === "verpasst"
        ? `Frist verpasst · Laufzeit bis ${info.laufzeitBis}`
        : `Laufzeit bis ${info.laufzeitBis}${info.verlaengert ? " (verlängert)" : ""}`,
      art: "frist",
      modul: "haushalt",
      dringend: info.status === "dringend" || info.status === "verpasst",
    });
  }

  const einnahmen = db.prepare("SELECT * FROM einnahmen WHERE aktiv = 1").all() as EinnahmeRow[];
  for (const e of einnahmen) {
    // Jeden Monat im Fenster einzeln pruefen — ein Zeitraum kann zwei
    // Monatswechsel enthalten, wenn jemand weit nach vorne schaut.
    for (const periode of perioden(von.slice(0, 7), bis.slice(0, 7), e.ende)) {
      if (periode < e.start) continue;
      const datum = buchungsDatum(periode, e.tag);
      if (datum < von || datum > bis) continue;
      ergebnis.push({
        id: `haushalt:zahltag:${e.id}:${periode}`,
        datum,
        titel: e.name,
        notiz: e.betrag > 0 ? `+ ${e.betrag.toFixed(2).replace(".", ",")} €` : null,
        art: "zahltag",
        modul: "haushalt",
      });
    }
  }

  return ergebnis;
}

/** Meldung an die globale Suche: Fixkosten, Buchungen, Aussenstaende. */
function suche(begriff: string, grenze: number): Treffer[] {
  const m = `%${begriff}%`;
  const je = Math.max(2, Math.floor(grenze / 3));
  const treffer: Treffer[] = [];

  for (const f of db
    .prepare("SELECT id, name, betrag, kategorie FROM fixkosten WHERE name LIKE ? OR kategorie LIKE ? OR notiz LIKE ? LIMIT ?")
    .all(m, m, m, je) as { id: number; name: string; betrag: number; kategorie: string | null }[]) {
    treffer.push({
      id: `haushalt:fixkost:${f.id}`,
      titel: f.name,
      untertitel: `${f.betrag.toFixed(2).replace(".", ",")} € · ${f.kategorie ?? "ohne Kategorie"}`,
      modul: "haushalt",
      art: "Fixkosten",
    });
  }

  for (const b of db
    .prepare(
      `SELECT id, datum, art, betrag, empfaenger, notiz FROM buchungen
        WHERE empfaenger LIKE ? OR notiz LIKE ? OR kategorie LIKE ?
        ORDER BY datum DESC LIMIT ?`
    )
    .all(m, m, m, je) as {
      id: number; datum: string; art: string; betrag: number; empfaenger: string | null; notiz: string | null;
    }[]) {
    treffer.push({
      id: `haushalt:buchung:${b.id}`,
      titel: b.empfaenger || b.notiz || "Buchung",
      untertitel: `${b.art === "eingang" ? "+" : "−"} ${b.betrag.toFixed(2).replace(".", ",")} €`,
      modul: "haushalt",
      art: "Buchung",
      datum: b.datum,
    });
  }

  for (const a of db
    .prepare("SELECT id, person, gesamt FROM schulden WHERE person LIKE ? OR notiz LIKE ? LIMIT ?")
    .all(m, m, je) as { id: number; person: string; gesamt: number }[]) {
    treffer.push({
      id: `haushalt:aussenstand:${a.id}`,
      titel: a.person,
      untertitel: `${a.gesamt.toFixed(2).replace(".", ",")} € geliehen`,
      modul: "haushalt",
      art: "Außenstand",
    });
  }

  return treffer;
}

/**
 * Meldung ans Profil: die vier Zahlen, wegen derer man das Modul aufmacht.
 *
 * „Übrig im Monat" ist die wichtigste davon und steht sonst hinter zwei
 * Klicks (Haushalt → Fixkosten → Fuss der Tabelle). Sie darf als einzige
 * negativ werden — dann ist sie rot, und das ist keine Dekoration.
 */
function profil(von: string, bis: string): ProfilBeitrag {
  /**
   * Mit Tausenderpunkt und echtem Minuszeichen (U+2212, nicht dem
   * Bindestrich). Bei 24 Pixel Schriftgroesse ist „15918,00" eine Ziffernkette
   * und „15.918,00" eine Zahl.
   */
  const euro = (n: number) =>
    `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} €`;

  const fix = db
    .prepare("SELECT betrag, intervall FROM fixkosten WHERE aktiv = 1")
    .all() as { betrag: number; intervall: string }[];
  const fixProMonat = fix.reduce((s, r) => s + monatsAnteil(r.betrag, r.intervall), 0);
  const einnahmen = einnahmenProMonat();
  const uebrig = einnahmen - fixProMonat;

  const jahr = heuteLokal().slice(0, 4);
  const saldo = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN art = 'eingang' THEN betrag END), 0) AS ein,
              COALESCE(SUM(CASE WHEN art = 'ausgang' THEN betrag END), 0) AS aus,
              COUNT(*) AS n
         FROM buchungen WHERE substr(datum, 1, 4) = ?`
    )
    .get(jahr) as { ein: number; aus: number; n: number };

  const offen = db
    .prepare(
      `SELECT COALESCE(SUM(MAX(0, s.gesamt - COALESCE(
                (SELECT SUM(betrag) FROM schulden_zahlungen z WHERE z.schuld_id = s.id), 0))), 0) AS summe,
              COUNT(*) AS n
         FROM schulden s WHERE s.erledigt = 0`
    )
    .get() as { summe: number; n: number };

  const letzte = db
    .prepare(
      `SELECT id, datum, art, betrag, empfaenger, kategorie, notiz FROM buchungen
        ORDER BY datum DESC, id DESC LIMIT 6`
    )
    .all() as {
      id: number; datum: string; art: string; betrag: number;
      empfaenger: string | null; kategorie: string | null; notiz: string | null;
    }[];

  const zahlen: ProfilZahl[] = [
    { id: "haushalt:fix", wert: euro(fixProMonat), label: "fest im Monat", hinweis: `${fix.length} Positionen` },
    {
      id: "haushalt:uebrig",
      wert: euro(uebrig),
      label: "übrig im Monat",
      hinweis: `${euro(einnahmen)} rein`,
      ton: uebrig < 0 ? "schlecht" : "gut",
    },
    {
      id: "haushalt:saldo",
      wert: euro(saldo.ein - saldo.aus),
      label: `Saldo ${jahr}`,
      hinweis: `${saldo.n} Buchungen`,
      ton: saldo.ein - saldo.aus < 0 ? "schlecht" : "gut",
    },
  ];
  if (offen.n > 0) {
    zahlen.push({
      id: "haushalt:aussenstaende",
      wert: euro(offen.summe),
      label: "Außenstände",
      hinweis: `bei ${offen.n} ${offen.n === 1 ? "Person" : "Personen"}`,
      ton: "achtung",
    });
  }

  return {
    zahlen,
    tage: tageZaehlen("buchungen", "datum", von, bis),
    ereignisse: letzte.map((b) => ({
      id: `haushalt:buchung:${b.id}`,
      datum: b.datum,
      titel: b.empfaenger || b.notiz || b.kategorie || "Buchung",
      detail: `${b.art === "eingang" ? "+" : "−"} ${euro(Math.abs(b.betrag))}`,
      art: b.art === "eingang" ? "Eingang" : "Ausgang",
      modul: "haushalt",
    })),
    seit: fruehestes("buchungen", "datum"),
  };
}

/**
 * Bilder aus dem Haushalt.
 *
 * Das erste ist bewusst ein SPIEGEL an einer Nulllinie und kein Liniendiagramm
 * mit zwei Kurven: Einnahmen und Ausgaben sind keine zwei Messreihen, die man
 * vergleicht, sondern zwei Richtungen desselben Kontos. Gruen nach oben, rot
 * nach unten, und der Abstand zur Nulllinie ist die Antwort.
 */
function diagramme(von: string, bis: string): Diagramm[] {
  const euro = (n: number) =>
    `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;

  const out: Diagramm[] = [];

  const ein = jeMonat("buchungen", "datum", "COALESCE(SUM(betrag),0)", von, bis, "art = 'eingang'");
  const aus = jeMonat("buchungen", "datum", "COALESCE(SUM(betrag),0)", von, bis, "art = 'ausgang'");
  const summeEin = ein.reduce((s, p) => s + p.y, 0);
  const summeAus = aus.reduce((s, p) => s + p.y, 0);

  if (summeEin > 0 || summeAus > 0) {
    out.push({
      id: "haushalt:kontobewegung",
      titel: "Ein und aus",
      hinweis: "je Monat",
      form: "spiegel",
      einheit: "euro",
      breite: "voll",
      kennzahl: { wert: euro(summeEin - summeAus), label: "Saldo im Zeitraum" },
      reihen: [
        { id: "haushalt:ein", name: "Eingang", farbe: "green", punkte: ein },
        // Nach unten gespiegelt: der Betrag bleibt positiv, die Form traegt
        // das Vorzeichen. Negative Zahlen in den Daten waeren doppelt gemoppelt.
        { id: "haushalt:aus", name: "Ausgang", farbe: "red", punkte: aus },
      ],
    });
  }

  // Fixkosten sind ein Bestand, kein Verlauf — sie aendern sich selten, aber
  // man will wissen, WOHIN sie gehen. Ein Monatsanteil je Kategorie.
  const kat = db
    .prepare("SELECT betrag, intervall, kategorie FROM fixkosten WHERE aktiv = 1 AND betrag > 0")
    .all() as { betrag: number; intervall: string; kategorie: string | null }[];
  if (kat.length >= 2) {
    const summen = new Map<string, number>();
    for (const r of kat) {
      const k = r.kategorie || "ohne Kategorie";
      summen.set(k, (summen.get(k) ?? 0) + monatsAnteil(r.betrag, r.intervall));
    }
    const punkte = [...summen.entries()]
      .map(([x, y]) => ({ x, y: Math.round(y * 100) / 100 }))
      .sort((a, b) => b.y - a.y);
    out.push({
      id: "haushalt:fixkosten",
      titel: "Fixkosten je Kategorie",
      hinweis: "Monatsanteil, alle Intervalle umgerechnet",
      form: "balken",
      einheit: "euro",
      breite: "halb",
      kennzahl: {
        wert: euro(punkte.reduce((s, p) => s + p.y, 0)),
        label: "fest im Monat",
      },
      reihen: [{ id: "haushalt:fix", name: "Fixkosten", farbe: "pink", punkte }],
    });
  }

  return out;
}

export const haushaltModule: ServerModule = {
  id: "haushalt",
  title: "Haushalt",
  router,
  termine,
  suche,
  profil,
  diagramme,
};
