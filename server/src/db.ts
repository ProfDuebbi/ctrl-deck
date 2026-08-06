import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DB_PATH, DATA_DIR, TRESOR_DIR } from "./paths.js";

export const BACKUP_DIR = path.join(DATA_DIR, "backups");
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function configure(d: DatabaseSync) {
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA foreign_keys = ON;");
}

// node:sqlite ist ab Node 22.5+ eingebaut -> kein nativer Build noetig.
// `let`, damit die Verbindung fuer eine Wiederherstellung neu geoeffnet werden
// kann. ES-Module-Live-Bindings sorgen dafuer, dass importierende Module die
// neue Instanz sehen (sie rufen db.prepare() jeweils zur Laufzeit auf).
export let db = new DatabaseSync(DB_PATH);
configure(db);

// Basis-Schema: eine einfache Key/Value-Tabelle fuer Einstellungen.
// Modul-spezifische Tabellen legt spaeter jedes Modul selbst an.
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Standard-Einstellungen einmalig setzen (ueberschreibt nichts Bestehendes).
// Der Name des Nutzers steht hier bewusst NICHT — den fragt die
// Ersteinrichtung ab (siehe auth.ts). Ein Vorname im ausgelieferten Code
// waere die Sorte Altlast, die man spaeter muehsam wieder herausoperiert.
const seed = db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
);
seed.run("app_name", "CTRL·DECK");

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

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
export const anhangOrdner = (dbPfad: string) => dbPfad.replace(/\.db$/, ".dateien");

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

/** Erzeugt eine Sicherungskopie (DB + Anhaenge) und gibt den DB-Pfad zurueck. */
export function createBackup(prefix = "ctrl-deck"): string {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  const target = path.join(BACKUP_DIR, `${prefix}_${stamp()}.db`);
  fs.copyFileSync(DB_PATH, target);
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
    .filter((f) => f.endsWith(".db"))
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
 * Stellt DB und Anhaenge aus einer Sicherung wieder her. Vorher wird der
 * aktuelle Stand automatisch gesichert. Gibt den Pfad dieser Sicherheitskopie
 * zurueck.
 */
export function restoreDatabase(backupPath: string): string {
  const safety = createBackup("pre-restore");
  db.close();
  for (const suffix of ["-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (fs.existsSync(f)) { try { fs.rmSync(f); } catch { /* egal */ } }
  }
  fs.copyFileSync(backupPath, DB_PATH);

  // Die Anhaenge muessen zum wiederhergestellten Stand passen. Der Ordner wird
  // deshalb ersetzt und nicht ergaenzt: Dateien aus der Zukunft haetten hier
  // keinen Eintrag mehr, der auf sie zeigt. Verloren geht dabei nichts — die
  // Sicherheitskopie von eben enthaelt sie.
  const quelle = anhangOrdner(backupPath);
  fs.rmSync(TRESOR_DIR, { recursive: true, force: true });
  fs.mkdirSync(TRESOR_DIR, { recursive: true });
  if (fs.existsSync(quelle)) fs.cpSync(quelle, TRESOR_DIR, { recursive: true });

  db = new DatabaseSync(DB_PATH);
  configure(db);
  return safety;
}
