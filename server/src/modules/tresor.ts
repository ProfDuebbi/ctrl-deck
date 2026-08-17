import { raw } from "express";
import { machRouter } from "../route.js";
import fs from "node:fs";
import path from "node:path";
import { db, getSetting, setSetting, sicherungMoeglich } from "../db.js";
import { TRESOR_DIR } from "../paths.js";
import {
  fruehestes, tageZaehlen,
  type ProfilBeitrag, type ProfilZahl, type ServerModule, type Termin,
} from "./index.js";

/**
 * TRESOR — Ablage fuer Ausweisnummern, Steuer-ID, Versicherungsnummern usw.
 *
 * Der Server sieht die Geheimnisse NIE. Verschluesselt und entschluesselt wird
 * ausschliesslich im Browser (AES-256-GCM, Schluessel aus dem Master-Passwort).
 * Hier liegen nur Chiffrate. Was der Server im Klartext braucht — und auch nur
 * das —, ist die Kategorie und das Ablaufdatum: daraus entstehen Kachel und
 * Sidebar-Badge, und die verraten fuer sich genommen nichts.
 *
 * Der Schluessel selbst wird nicht aus dem Passwort abgeleitet, sondern nur
 * damit *eingewickelt* (key wrapping). Deshalb kostet ein Passwortwechsel nur
 * ein neues Paeckchen — kein Neuverschluesseln aller Eintraege und Dateien.
 */

// --- Schema ---------------------------------------------------------------

async function einrichten(): Promise<void> {
  await db.exec(`
  CREATE TABLE IF NOT EXISTS tresor_eintraege (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kategorie    TEXT NOT NULL DEFAULT 'sonstiges',  -- Klartext (nur Rubrik)
    vorlage      TEXT NOT NULL DEFAULT 'frei',       -- Klartext (Formatpruefung)
    titel        TEXT NOT NULL,                      -- Chiffrat
    wert         TEXT NOT NULL,                      -- Chiffrat
    notiz        TEXT,                               -- Chiffrat oder NULL
    ablauf       TEXT,                               -- 'JJJJ-MM-TT', Klartext
    vorwarn_tage INTEGER NOT NULL DEFAULT 60,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tresor_dateien (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    eintrag_id INTEGER NOT NULL REFERENCES tresor_eintraege(id) ON DELETE CASCADE,
    dateiname  TEXT NOT NULL,   -- Chiffrat
    groesse    INTEGER NOT NULL,-- Klartextgroesse in Bytes
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tresor_dateien_eintrag ON tresor_dateien (eintrag_id);
  `);

  /*
   * `inhalt` kam nachtraeglich dazu und ist der Anhang selbst — als Chiffrat,
   * versteht sich. Die Spalte bleibt NULL, solange die Anhaenge als Dateien in
   * `data/tresor/` liegen; das ist bei einer lokalen Installation der Normal-
   * und Dauerzustand und aendert sich auch nicht.
   *
   * Gefuellt wird sie nur, wenn eine eigene Datenbank angeschlossen ist. Dann
   * gibt es naemlich kein verlaessliches Dateisystem: Ein Container wirft seine
   * Platte beim Neustart weg, und ein Tresoreintrag zeigte danach auf einen
   * Anhang, den es nicht mehr gibt. Wo die Daten liegen, muessen auch die
   * Anhaenge liegen.
   */
  const spalten = new Set(
    (await db.alle<{ name: string }>("PRAGMA table_info(tresor_dateien)")).map((c) => c.name)
  );
  if (!spalten.has("inhalt")) await db.exec("ALTER TABLE tresor_dateien ADD COLUMN inhalt BLOB");
}

/*
 * Wo ein Anhang liegt, haengt davon ab, wo die Datenbank liegt.
 *
 * LOKAL (Vorgabe): als eigene Datei in `data/tresor/` — verschluesselt, der
 * Dateiname ist nur die laufende Nummer. Ohne Master-Passwort ist das Rauschen.
 * Die Sicherung in db.ts nimmt den Ordner gepaart mit der `.db` mit; daran
 * aendert sich nichts, und bestehende Anhaenge bleiben genau da, wo sie sind.
 *
 * ANGESCHLOSSENE DATENBANK: in der Spalte `tresor_dateien.inhalt`. Sonst waere
 * die halbe Ablage auf einem Rechner, der die Daten gar nicht mehr haelt.
 *
 * Gelesen wird IMMER beides — erst die Spalte, dann die Datei. Dadurch bleibt
 * ein Bestand lesbar, der vor einem Umzug entstanden ist.
 */
const inDatenbank = () => !sicherungMoeglich();
const dateiPfad = (id: number | bigint) => path.join(TRESOR_DIR, `${id}.bin`);
const now = () => new Date().toISOString();

// --- Meta (Salz + eingewickelter Schluessel) ------------------------------

interface TresorMeta {
  v: number;
  kdf: string;
  iter: number;
  salt: string;
  /** Der mit dem Passwort-Schluessel eingewickelte Datenschluessel. */
  wrapped: string;
  created_at: string;
  changed_at: string;
}

async function leseMeta(): Promise<TresorMeta | null> {
  const roh = await getSetting("tresor_meta");
  if (!roh) return null;
  try {
    return JSON.parse(roh) as TresorMeta;
  } catch {
    return null;
  }
}

/** Nimmt nur an, was wirklich nach Meta aussieht — sonst sperrt man sich aus. */
function pruefeMeta(m: unknown): TresorMeta | null {
  const o = m as Partial<TresorMeta> | null;
  if (!o || typeof o !== "object") return null;
  if (typeof o.salt !== "string" || !o.salt) return null;
  if (typeof o.wrapped !== "string" || !o.wrapped) return null;
  const iter = Number(o.iter);
  if (!(iter >= 100000)) return null;
  return {
    v: 1,
    kdf: String(o.kdf ?? "PBKDF2-SHA256"),
    iter,
    salt: o.salt,
    wrapped: o.wrapped,
    created_at: typeof o.created_at === "string" ? o.created_at : now(),
    changed_at: now(),
  };
}

// --- Helfer ---------------------------------------------------------------

interface EintragRow {
  id: number;
  kategorie: string;
  vorlage: string;
  titel: string;
  wert: string;
  notiz: string | null;
  ablauf: string | null;
  vorwarn_tage: number;
  created_at: string;
  updated_at: string;
}

/** Tage bis zum Datum — negativ heisst abgelaufen. */
function tageBis(datum: string): number {
  const heute = new Date();
  const a = Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate());
  const [j, m, t] = datum.split("-").map(Number);
  if (!j || !m || !t) return Number.POSITIVE_INFINITY;
  return Math.round((Date.UTC(j, m - 1, t) - a) / 86400000);
}

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

async function dateienZu(ids: number[]): Promise<Map<number, unknown[]>> {
  const map = new Map<number, unknown[]>();
  if (ids.length === 0) return map;
  const rows = await db.alle<{ id: number; eintrag_id: number }>(
    `SELECT id, eintrag_id, dateiname, groesse, created_at FROM tresor_dateien
     WHERE eintrag_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
    ...ids
  );
  for (const r of rows) {
    if (!map.has(r.eintrag_id)) map.set(r.eintrag_id, []);
    map.get(r.eintrag_id)!.push(r);
  }
  return map;
}

/** Ein Eintragsfeld aus dem Rumpf holen — Chiffrate sind immer Zeichenketten. */
function feld(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

// --- Router ---------------------------------------------------------------

const router = machRouter();

/** Ist der Tresor eingerichtet? Liefert das Paeckchen zum Entsperren mit. */
router.get("/meta", async (_req, res) => {
  const meta = await leseMeta();
  res.json({ eingerichtet: !!meta, meta });
});

/**
 * Zustand fuer Kachel und Badge — beantwortbar OHNE Passwort, weil nur
 * Anzahlen und Ablaufdaten hineinfliessen.
 */
router.get("/status", async (_req, res) => {
  const meta = await leseMeta();
  const anzahl = (await db.eine<{ n: number }>("SELECT COUNT(*) AS n FROM tresor_eintraege"))!.n;
  const dateien = (await db.eine<{ n: number }>("SELECT COUNT(*) AS n FROM tresor_dateien"))!.n;
  const rows = await db.alle<{ id: number; kategorie: string; ablauf: string; vorwarn_tage: number }>(
    "SELECT id, kategorie, ablauf, vorwarn_tage FROM tresor_eintraege WHERE ablauf IS NOT NULL"
  );

  const ablaufend = rows
    .map((r) => ({ ...r, tageBis: tageBis(r.ablauf) }))
    .filter((r) => r.tageBis <= r.vorwarn_tage)
    .sort((a, b) => a.tageBis - b.tageBis);

  res.json({ eingerichtet: !!meta, anzahl, dateien, ablaufend });
});

/** Ersteinrichtung. Laeuft nur, solange es noch nichts zu verlieren gibt. */
router.post("/init", async (req, res) => {
  const meta = pruefeMeta(req.body?.meta);
  if (!meta) return res.status(400).json({ error: "unvollständige Tresor-Daten" });
  // Pruefen und Setzen gehoeren zusammen: Zwei Einrichtungsversuche kurz
  // hintereinander duerfen nicht beide durchkommen — der zweite ersetzte sonst
  // den Schluessel des ersten, und alles damit Verschluesselte waere verloren.
  const ok = await db.transaktion(async () => {
    if (await leseMeta()) return false;
    meta.created_at = now();
    await setSetting("tresor_meta", JSON.stringify(meta));
    return true;
  });
  if (!ok) return res.status(409).json({ error: "Tresor ist bereits eingerichtet" });
  res.json({ ok: true, meta });
});

/**
 * Passwort wechseln: der Browser wickelt denselben Datenschluessel neu ein und
 * schickt nur das neue Paeckchen. `bisher` ist das alte Salz — damit ein alter,
 * offen gebliebener Tab nicht einen zwischenzeitlichen Wechsel ueberschreibt.
 */
router.put("/passwort", async (req, res) => {
  const meta = pruefeMeta(req.body?.meta);
  if (!meta) return res.status(400).json({ error: "unvollständige Tresor-Daten" });
  // Das Lesen des alten Salzes und das Schreiben des neuen Paeckchens gehoeren
  // in eine Klammer — genau davor soll `bisher` ja schuetzen.
  const stand = await db.transaktion(async () => {
    const alt = await leseMeta();
    if (!alt) return "nicht-eingerichtet" as const;
    if (String(req.body?.bisher ?? "") !== alt.salt) return "veraltet" as const;
    meta.created_at = alt.created_at;
    await setSetting("tresor_meta", JSON.stringify(meta));
    return "ok" as const;
  });
  if (stand === "nicht-eingerichtet")
    return res.status(409).json({ error: "Tresor ist nicht eingerichtet" });
  if (stand === "veraltet")
    return res.status(409).json({ error: "Der Tresor wurde zwischenzeitlich geändert — bitte neu laden." });
  res.json({ ok: true, meta });
});

/** Alle Eintraege — als Chiffrat. Entschluesselt wird im Browser. */
router.get("/", async (_req, res) => {
  const rows = await db.alle<EintragRow>("SELECT * FROM tresor_eintraege ORDER BY kategorie, id");
  const anhaenge = await dateienZu(rows.map((r) => r.id));
  res.json(
    rows.map((r) => ({
      ...r,
      tageBis: r.ablauf ? tageBis(r.ablauf) : null,
      dateien: anhaenge.get(r.id) ?? [],
    }))
  );
});

function rumpf(req: { body?: Record<string, unknown> }) {
  const b = req.body ?? {};
  const titel = feld(b.titel);
  const wert = feld(b.wert);
  const ablauf = feld(b.ablauf);
  if (!titel) return { error: "Titel fehlt" as const };
  if (!wert) return { error: "Wert fehlt" as const };
  if (ablauf && !ISO_DATUM.test(ablauf)) return { error: "ungültiges Ablaufdatum" as const };
  const vorwarn = Number(b.vorwarn_tage);
  return {
    titel,
    wert,
    notiz: feld(b.notiz),
    ablauf,
    kategorie: feld(b.kategorie) ?? "sonstiges",
    vorlage: feld(b.vorlage) ?? "frei",
    vorwarn_tage: vorwarn >= 1 && vorwarn <= 3650 ? Math.round(vorwarn) : 60,
  };
}

router.post("/", async (req, res) => {
  const d = rumpf(req);
  if ("error" in d) return res.status(400).json({ error: d.error });
  const info = await db.schreibe(
    `INSERT INTO tresor_eintraege (kategorie, vorlage, titel, wert, notiz, ablauf, vorwarn_tage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.kategorie, d.vorlage, d.titel, d.wert, d.notiz, d.ablauf, d.vorwarn_tage, now(), now()
  );
  res.json({ id: info.id });
});

router.put("/:id", async (req, res) => {
  const d = rumpf(req);
  if ("error" in d) return res.status(400).json({ error: d.error });
  const info = await db.schreibe(
    `UPDATE tresor_eintraege SET kategorie=?, vorlage=?, titel=?, wert=?, notiz=?, ablauf=?, vorwarn_tage=?, updated_at=?
     WHERE id=?`,
    d.kategorie, d.vorlage, d.titel, d.wert, d.notiz, d.ablauf, d.vorwarn_tage, now(), req.params.id
  );
  if (info.zeilen === 0) return res.status(404).json({ error: "Eintrag nicht gefunden" });
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  // Die Datenbankzeilen raeumt der Fremdschluessel weg, die Dateien nicht.
  const dateien = await db.transaktion(async () => {
    const liste = await db.alle<{ id: number }>("SELECT id FROM tresor_dateien WHERE eintrag_id=?", id);
    await db.schreibe("DELETE FROM tresor_eintraege WHERE id=?", id);
    return liste;
  });
  for (const d of dateien) {
    try { fs.rmSync(dateiPfad(d.id)); } catch { /* schon weg */ }
  }
  res.json({ ok: true });
});

// --- Anhaenge -------------------------------------------------------------

/**
 * Der Rumpf ist der bereits im Browser verschluesselte Dateiinhalt; der
 * Dateiname kommt als Chiffrat im Kopf mit, weil "Steuerbescheid_2024.pdf"
 * selbst schon eine Auskunft ist.
 */
router.post("/:id/dateien", raw({ type: "application/octet-stream", limit: "64mb" }), async (req, res) => {
  const eintrag = await db.eine<{ id: number }>(
    "SELECT id FROM tresor_eintraege WHERE id=?", req.params.id
  );
  if (!eintrag) return res.status(404).json({ error: "Eintrag nicht gefunden" });

  const name = String(req.header("x-datei-name") ?? "").trim();
  if (!name) return res.status(400).json({ error: "Dateiname fehlt" });
  const daten = req.body as Buffer;
  if (!Buffer.isBuffer(daten) || daten.length === 0)
    return res.status(400).json({ error: "Datei ist leer" });

  const groesse = Number(req.header("x-datei-groesse")) || daten.length;

  if (inDatenbank()) {
    // Zeile und Inhalt in einem Zug — eine Zeile ohne Inhalt waere ein Anhang,
    // den die Oberflaeche anbietet und der beim Anklicken nicht da ist.
    const info = await db.schreibe(
      "INSERT INTO tresor_dateien (eintrag_id, dateiname, groesse, created_at, inhalt) VALUES (?, ?, ?, ?, ?)",
      eintrag.id, name, groesse, now(), new Uint8Array(daten)
    );
    return res.json({ id: info.id });
  }

  const info = await db.schreibe(
    "INSERT INTO tresor_dateien (eintrag_id, dateiname, groesse, created_at) VALUES (?, ?, ?, ?)",
    eintrag.id, name, groesse, now()
  );
  try {
    fs.writeFileSync(dateiPfad(info.id), daten);
  } catch {
    await db.schreibe("DELETE FROM tresor_dateien WHERE id=?", info.id);
    return res.status(500).json({ error: "Datei konnte nicht gespeichert werden" });
  }
  res.json({ id: info.id });
});

router.get("/dateien/:fid", async (req, res) => {
  const row = await db.eine<{ id: number; inhalt: Uint8Array | null }>(
    "SELECT id, inhalt FROM tresor_dateien WHERE id=?", req.params.fid
  );
  if (!row) return res.status(404).json({ error: "Datei nicht gefunden" });
  // Erst die Datenbank, dann die Platte — in dieser Reihenfolge, damit ein
  // Bestand aus beiden Zeiten lesbar bleibt.
  if (row.inhalt) return res.type("application/octet-stream").send(Buffer.from(row.inhalt));
  const p = dateiPfad(row.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "Datei fehlt auf der Platte" });
  res.type("application/octet-stream").send(fs.readFileSync(p));
});

router.delete("/dateien/:fid", async (req, res) => {
  const id = Number(req.params.fid);
  // Die Zeile nimmt einen etwaigen Inhalt mit; eine etwaige Datei muss extra
  // weg. Beides blind versuchen ist richtig — es gibt immer nur eines davon.
  await db.schreibe("DELETE FROM tresor_dateien WHERE id=?", id);
  try { fs.rmSync(dateiPfad(id)); } catch { /* schon weg oder nie dagewesen */ }
  res.json({ ok: true });
});

/**
 * Notausgang: Passwort UND Wiederherstellungsschluessel verloren. Dann sind die
 * Daten ohnehin unlesbar — hier wird der unlesbare Rest entfernt, damit man neu
 * anfangen kann. Die Oberflaeche fragt vorher deutlich nach.
 */
router.delete("/", async (_req, res) => {
  const dateien = await db.transaktion(async () => {
    const liste = await db.alle<{ id: number }>("SELECT id FROM tresor_dateien");
    // Als eine Anweisung, nicht als `exec`: `exec` leert im Treiber den
    // Anweisungs-Zwischenspeicher, und das ist hier unnoetig.
    await db.schreibe("DELETE FROM tresor_dateien");
    await db.schreibe("DELETE FROM tresor_eintraege");
    await db.schreibe("DELETE FROM settings WHERE key='tresor_meta'");
    return liste;
  });
  for (const d of dateien) {
    try { fs.rmSync(dateiPfad(d.id)); } catch { /* schon weg */ }
  }
  res.json({ ok: true });
});

/**
 * Meldung an den gemeinsamen Terminfaden: ablaufende Dokumente.
 *
 * Genau dafuer sind `kategorie` und `ablauf` im Tresor bewusst NICHT
 * verschluesselt — der Faden kann warnen, ohne dass der Tresor offen ist.
 * Der Titel bleibt dagegen Chiffrat und wird hier nicht angefasst; deshalb
 * steht in der Zeile die Kategorie („Ausweis läuft ab"), nicht der Eintrag.
 */
async function termine(von: string, bis: string): Promise<Termin[]> {
  const rows = await db.alle<{ id: number; kategorie: string; ablauf: string }>(
    "SELECT id, kategorie, ablauf FROM tresor_eintraege WHERE ablauf IS NOT NULL"
  );
  return rows
    .filter((r) => r.ablauf >= von && r.ablauf <= bis)
    .map((r) => ({
      id: `tresor:ablauf:${r.id}`,
      datum: r.ablauf,
      titel: `${r.kategorie || "Dokument"} läuft ab`,
      notiz: "im Tresor hinterlegt",
      art: "ablauf" as const,
      modul: "tresor",
      dringend: true, // ein abgelaufener Ausweis ist nie eine Kleinigkeit
    }));
}

/**
 * Meldung ans Profil — und zwar NUR Anzahlen.
 *
 * Titel, Werte und Notizen liegen hier als Chiffrat; der Server kennt sie
 * nicht und soll sie nie kennen. Ein Verlauf mit Eintragsnamen waere genau
 * der Bruch, gegen den das ganze Modul gebaut ist. Deshalb: kein
 * `ereignisse`, und die Kategorie bleibt draussen, obwohl sie im Klartext
 * gespeichert ist — „3 × Ausweis" auf einer Profilseite ist mehr Auskunft,
 * als ein Tresor geben sollte.
 */
async function profil(von: string, bis: string): Promise<ProfilBeitrag> {
  if (!(await leseMeta())) return {};

  const anzahl = (await db.eine<{ n: number }>("SELECT COUNT(*) AS n FROM tresor_eintraege"))!.n;
  const dateien = (await db.eine<{ n: number; b: number }>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(groesse),0) AS b FROM tresor_dateien"
  ))!;

  const rows = await db.alle<{ ablauf: string; vorwarn_tage: number }>(
    "SELECT ablauf, vorwarn_tage FROM tresor_eintraege WHERE ablauf IS NOT NULL"
  );
  const ablaufend = rows
    .map((r) => ({ ...r, tage: tageBis(r.ablauf) }))
    .filter((r) => r.tage <= r.vorwarn_tage)
    .sort((a, b) => a.tage - b.tage);

  const zahlen: ProfilZahl[] = [
    {
      id: "tresor:eintraege",
      wert: String(anzahl),
      label: "Einträge",
      hinweis: dateien.n > 0 ? `${dateien.n} Anhänge · ${(dateien.b / 1048576).toFixed(1).replace(".", ",")} MB` : "verschlüsselt",
    },
  ];
  if (ablaufend.length > 0) {
    const n = ablaufend[0];
    zahlen.push({
      id: "tresor:ablauf",
      wert: n.tage < 0 ? "abgelaufen" : `${n.tage} ${n.tage === 1 ? "Tag" : "Tage"}`,
      label: ablaufend.length > 1 ? `bis zum nächsten von ${ablaufend.length}` : "bis zum Ablauf",
      ton: n.tage < 0 ? "schlecht" : "achtung",
    });
  }

  return {
    zahlen,
    tage: await tageZaehlen("tresor_eintraege", "date(created_at, 'localtime')", von, bis),
    seit: await fruehestes("tresor_eintraege", "date(created_at, 'localtime')"),
  };
}

export const tresorModule: ServerModule = {
  id: "tresor",
  title: "Tresor",
  router,
  einrichten,
  termine,
  profil,
};
