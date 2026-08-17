import fs from "node:fs";
import path from "node:path";
import { DB_PATH, DATA_DIR, TRESOR_DIR } from "./paths.js";
import type { Ergebnis, Treiber, Wert, Zeile } from "./db/schnittstelle.js";
import { SqliteTreiber } from "./db/sqlite.js";
import { verbindeLibsql } from "./db/libsql.js";

export type { Ergebnis, Wert, Zeile } from "./db/schnittstelle.js";

export const BACKUP_DIR = path.join(DATA_DIR, "backups");
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

/**
 * Der gerade angeschlossene Treiber. Wechselt beim Wiederherstellen die
 * Verbindung, bleibt aber immer derselbe fuer die Dauer eines Laufs.
 */
let treiber: Treiber | null = null;

function verbunden(): Treiber {
  if (!treiber)
    throw new Error(
      "Die Datenbank ist noch nicht verbunden. `starteDatenbank()` gehoert vor alles andere."
    );
  return treiber;
}

/**
 * Verbindet die Datenbank und legt das Grundschema an.
 *
 * Muss VOR den Modulen laufen — die legen in ihrem `einrichten()` ihre eigenen
 * Tabellen an. Frueher passierte beides beim Importieren der Dateien; das ging
 * nur, solange die Datenbank synchron war.
 *
 * **Ohne `DB_URL` passiert genau das, was immer passiert ist**: die Datei
 * `data/ctrl-deck.db` wird geoeffnet. Eine lokale Installation braucht nichts
 * einzustellen und merkt von der Wahlmoeglichkeit nichts.
 *
 * Mit `DB_URL` haengt sich CTRL·DECK an eine mitgebrachte Datenbank. Das ist
 * die Antwort auf den Serverbetrieb: Hosting ohne dauerhaftes Dateisystem
 * (Container, die bei jedem Neustart ihre Platte vergessen), mehrere Prozesse
 * auf demselben Bestand, oder ein `data/` auf einem Netzlaufwerk, wo die
 * Dateisperren von SQLite unzuverlaessig sind.
 */
export async function starteDatenbank(): Promise<Treiber> {
  const url = (process.env.DB_URL ?? "").trim();
  if (url) {
    treiber = await verbindeLibsql(url, process.env.DB_TOKEN);
  } else {
    treiber = new SqliteTreiber(DB_PATH);
  }

  // Basis-Schema: eine einfache Key/Value-Tabelle fuer Einstellungen.
  // Modul-spezifische Tabellen legt jedes Modul selbst an.
  await treiber.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Standard-Einstellungen einmalig setzen (ueberschreibt nichts Bestehendes).
  // Der Name des Nutzers steht hier bewusst NICHT — den fragt die
  // Ersteinrichtung ab (siehe auth.ts). Ein Vorname im ausgelieferten Code
  // waere die Sorte Altlast, die man spaeter muehsam wieder herausoperiert.
  await treiber.schreibe(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
    ["app_name", "CTRL·DECK"]
  );

  return treiber;
}

/**
 * Die Datenbank, wie die Module sie sehen.
 *
 * Bewusst ein festes Objekt statt eines austauschbaren `let`: Frueher stand
 * hier `export let db`, und dass ein Wiederherstellen ueberhaupt funktionierte,
 * haing daran, dass ES-Module ihre Bindungen live weiterreichen und jedes Modul
 * `db.prepare()` erst zur Laufzeit aufruft. Diese Fassade hier bleibt immer
 * dieselbe; getauscht wird nur der Treiber dahinter.
 *
 * Die Werte kommen als einzelne Argumente (`db.eine(sql, id)`), weil das genau
 * so aussieht wie das frühere `db.prepare(sql).get(id)`.
 */
export const db = {
  /** Alle passenden Zeilen. */
  alle<T = Zeile>(sql: string, ...werte: Wert[]): Promise<T[]> {
    return verbunden().alle<T>(sql, werte);
  },
  /** Die erste passende Zeile, oder `undefined`. */
  eine<T = Zeile>(sql: string, ...werte: Wert[]): Promise<T | undefined> {
    return verbunden().eine<T>(sql, werte);
  },
  /** Einfuegen, aendern, loeschen. Liefert `{ id, zeilen }`. */
  schreibe(sql: string, ...werte: Wert[]): Promise<Ergebnis> {
    return verbunden().schreibe(sql, werte);
  },
  /** Mehrere Anweisungen ohne Platzhalter — fuer Schema und Migrationen. */
  exec(sql: string): Promise<void> {
    return verbunden().exec(sql);
  },
  /** Alles oder nichts. */
  transaktion<T>(arbeit: () => Promise<T>): Promise<T> {
    return verbunden().transaktion(arbeit);
  },
  /** Womit wir gerade sprechen — fuer Protokoll und Statusanzeige. */
  get art(): Treiber["art"] {
    return verbunden().art;
  },
  get bezeichnung(): string {
    return verbunden().bezeichnung;
  },
};

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.eine<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    key
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.schreibe(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value
  );
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/**
 * Kann diese Installation durch Kopieren sichern?
 *
 * Nur bei der lokalen Datei. Eine angeschlossene Datenbank liegt nicht auf
 * dieser Platte — dort ist Sichern Sache dessen, der sie betreibt (bei einem
 * Anbieter meist ein Knopf im Kundenbereich, bei einem eigenen Server ein
 * Auftrag auf dem Server selbst).
 */
export function sicherungMoeglich(): boolean {
  return verbunden().datei !== null;
}

/** Der Dateitreiber — oder ein klarer Fehler, wenn extern gespeichert wird. */
function dateiTreiber(): SqliteTreiber {
  const t = verbunden();
  if (!(t instanceof SqliteTreiber))
    throw new Error(
      `Sichern durch Kopieren geht nur bei einer lokalen Datei, nicht bei „${t.bezeichnung}".`
    );
  return t;
}

/**
 * Eine Sicherung besteht aus ZWEI Dingen: der Datenbankdatei und dem Ordner mit
 * den verschluesselten Tresor-Anhaengen. Die Anhaenge liegen bewusst nicht in
 * der DB (Dateien gehoeren nicht in eine SQLite-Spalte), muessen aber zum
 * selben Stand gehoeren — sonst zeigt ein wiederhergestellter Eintrag auf eine
 * Datei, die es nicht mehr gibt. Beide tragen denselben Namensstamm:
 *
 *   ctrl-deck_2026-07-26T18-57-26.db
 *   ctrl-deck_2026-07-26T18-57-26.dateien/
 */
export const anhangOrdner = (pfad: string) => pfad.replace(/\.(db|json)$/, ".dateien");

/**
 * Was als Sicherung zaehlt.
 *
 * `.db` ist die Dateikopie der lokalen Installation, `.json` der Export einer
 * angeschlossenen Datenbank. Beide tragen denselben Namensstamm wie ihr
 * Anhang-Ordner, deshalb kommen Auflisten, Loeschen, Aufraeumen und das
 * Spiegeln aufs zweite Laufwerk mit beiden zurecht, ohne es zu wissen.
 */
export const istSicherung = (name: string) => name.endsWith(".db") || name.endsWith(".json");

/** Groesse und Anzahl der Dateien in einem Ordner (fehlt er: 0). */
function ordnerInhalt(dir: string): { anzahl: number; groesse: number } {
  if (!fs.existsSync(dir)) return { anzahl: 0, groesse: 0 };
  const dateien = fs.readdirSync(dir);
  let groesse = 0;
  for (const f of dateien) {
    try { groesse += fs.statSync(path.join(dir, f)).size; } catch { /* weg ist weg */ }
  }
  return { anzahl: dateien.length, groesse };
}

/**
 * Erzeugt eine Sicherung und gibt ihren Pfad zurueck.
 *
 * Zwei Wege, eine Form: Bei der lokalen Datei wird kopiert (schnell, exakt,
 * seit Juli erprobt — daran aendert sich nichts). Bei einer angeschlossenen
 * Datenbank wird der Inhalt ausgelesen und als JSON geschrieben.
 */
export async function createBackup(prefix = "ctrl-deck"): Promise<string> {
  if (!sicherungMoeglich()) {
    const ziel = path.join(BACKUP_DIR, `${prefix}_${stamp()}.json`);
    const { exportiere } = await import("./db/export.js");
    return exportiere(ziel, anhangOrdner(ziel));
  }
  const t = dateiTreiber();
  await t.checkpoint();
  const target = path.join(BACKUP_DIR, `${prefix}_${stamp()}.db`);
  fs.copyFileSync(t.datei, target);
  if (ordnerInhalt(TRESOR_DIR).anzahl > 0)
    fs.cpSync(TRESOR_DIR, anhangOrdner(target), { recursive: true });
  return target;
}

/** Loescht eine Sicherung samt ihrem Anhang-Ordner. */
export function deleteBackup(name: string): void {
  const p = path.join(BACKUP_DIR, name);
  try { fs.rmSync(p); } catch { /* egal */ }
  try { fs.rmSync(anhangOrdner(p), { recursive: true, force: true }); } catch { /* egal */ }
}

export interface BackupInfo {
  name: string;
  /** DB + Anhaenge zusammen — das ist es, was die Sicherung belegt. */
  size: number;
  at: string;
  auto: boolean;
  safety: boolean;
  /** Anzahl mitgesicherter Tresor-Anhaenge. */
  dateien: number;
}

/** Alle Sicherungen, neueste zuerst. */
export function listBackups(): BackupInfo[] {
  return fs
    .readdirSync(BACKUP_DIR)
    .filter(istSicherung)
    .map((name) => {
      const p = path.join(BACKUP_DIR, name);
      const st = fs.statSync(p);
      const anhaenge = ordnerInhalt(anhangOrdner(p));
      return {
        name,
        size: st.size + anhaenge.groesse,
        at: st.mtime.toISOString(),
        auto: name.startsWith("auto_"),
        safety: name.startsWith("pre-restore_"),
        dateien: anhaenge.anzahl,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Alte Backups aufraeumen — nur die neuesten `keep` behalten. */
export function pruneBackups(keep = 14): void {
  for (const b of listBackups().slice(keep)) deleteBackup(b.name);
}

/**
 * Stellt Daten und Anhaenge aus einer Sicherung wieder her. Vorher wird der
 * aktuelle Stand automatisch gesichert. Gibt den Pfad dieser Sicherheitskopie
 * zurueck.
 *
 * Eine `.json`-Sicherung laesst sich in BEIDE Richtungen einspielen — in die
 * lokale Datei ebenso wie in eine angeschlossene Datenbank. Das ist der Weg,
 * auf dem ein Bestand umzieht.
 */
export async function restoreDatabase(backupPath: string): Promise<string> {
  if (backupPath.endsWith(".json")) {
    const safety = await createBackup("pre-restore");
    const { spieleEin } = await import("./db/export.js");
    await spieleEin(backupPath, anhangOrdner(backupPath));
    return safety;
  }

  const t = dateiTreiber();
  const safety = await createBackup("pre-restore");
  await t.zu();
  for (const suffix of ["-wal", "-shm"]) {
    const f = t.datei + suffix;
    if (fs.existsSync(f)) { try { fs.rmSync(f); } catch { /* egal */ } }
  }
  fs.copyFileSync(backupPath, t.datei);

  // Die Anhaenge muessen zum wiederhergestellten Stand passen. Der Ordner wird
  // deshalb ersetzt und nicht ergaenzt: Dateien aus der Zukunft haetten hier
  // keinen Eintrag mehr, der auf sie zeigt. Verloren geht dabei nichts — die
  // Sicherheitskopie von eben enthaelt sie.
  const quelle = anhangOrdner(backupPath);
  fs.rmSync(TRESOR_DIR, { recursive: true, force: true });
  fs.mkdirSync(TRESOR_DIR, { recursive: true });
  if (fs.existsSync(quelle)) fs.cpSync(quelle, TRESOR_DIR, { recursive: true });

  await t.auf();
  return safety;
}
