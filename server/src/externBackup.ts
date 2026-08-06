import fs from "node:fs";
import path from "node:path";
import { BACKUP_DIR, listBackups, getSetting, setSetting, anhangOrdner } from "./db.js";

/**
 * Sicherung auf ein ZWEITES Laufwerk.
 *
 * Warum es das braucht: `data/ctrl-deck.db`, `data/tresor/` und `data/backups/`
 * liegen auf derselben Platte. Ein Plattenausfall nimmt damit die Daten UND
 * saemtliche Sicherungen mit — die vorhandene Sicherungsfunktion schuetzt
 * bisher nur gegen eigene Fehler (versehentlich geloescht, falsch gebucht),
 * nicht gegen Hardware.
 *
 * Was hier NICHT passiert: es wird nichts neu gesichert. Diese Datei spiegelt
 * nur, was `db.ts` bereits erzeugt hat. `db.ts` bleibt die einzige Stelle, die
 * weiss, woraus eine Sicherung besteht (`.db` + `.dateien/`-Ordner).
 */

/** So viele Staende liegen am externen Ort (lokal sind es 14). */
export const EXTERN_KOPIEN = 7;

const KEY_PFAD = "backup_extern_pfad";
const KEY_ZULETZT = "backup_extern_zuletzt";
const KEY_FEHLER = "backup_extern_fehler";

/**
 * Nur Dateien aus unserer eigenen Namenswelt fassen wir am Zielort an.
 *
 * Der Zielordner koennte auch anderes enthalten — jemand traegt aus Versehen
 * seinen Dokumentenordner ein. Aufraeumen darf deshalb ausschliesslich, was
 * nachweislich von uns stammt.
 */
const UNSER_NAME = /^(ctrl-deck|auto|pre-restore)_\d{4}-\d{2}-\d{2}T[\d-]+\.db$/;

export interface ExternStatus {
  /** Zielordner, "" = nicht eingerichtet. */
  pfad: string;
  /** Ist ueberhaupt ein Ziel hinterlegt? */
  aktiv: boolean;
  /** Existiert das Laufwerk gerade? (USB abgezogen -> false) */
  erreichbar: boolean;
  /** Zeitpunkt der letzten erfolgreichen Spiegelung. */
  zuletzt: string | null;
  /** Grund, warum die letzte Spiegelung nicht klappte. */
  fehler: string | null;
  /** Was am Zielort liegt. */
  anzahl: number;
  groesse: number;
  behalten: number;
}

export function externPfad(): string {
  return (getSetting(KEY_PFAD) ?? "").trim();
}

export function setzeExternPfad(roh: string): string {
  const pfad = roh.trim();
  setSetting(KEY_PFAD, pfad);
  setSetting(KEY_FEHLER, ""); // alter Fehler gehoert zum alten Ziel
  return pfad;
}

/**
 * Steckt das Laufwerk? Geprueft wird die Wurzel (`D:\`, `\\server\share\`),
 * nicht der Ordner selbst — den legen wir bei Bedarf an, ein fehlendes
 * Laufwerk kann man dagegen nicht anlegen.
 */
function laufwerkDa(pfad: string): boolean {
  try {
    const root = path.parse(path.resolve(pfad)).root;
    return root ? fs.existsSync(root) : false;
  } catch {
    return false;
  }
}

function ordnerInhalt(dir: string): { anzahl: number; groesse: number } {
  if (!fs.existsSync(dir)) return { anzahl: 0, groesse: 0 };
  let anzahl = 0;
  let groesse = 0;
  for (const eintrag of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, eintrag.name);
    try {
      if (eintrag.isDirectory()) {
        groesse += ordnerInhalt(p).groesse;
      } else {
        groesse += fs.statSync(p).size;
        if (UNSER_NAME.test(eintrag.name)) anzahl++;
      }
    } catch {
      /* weg ist weg */
    }
  }
  return { anzahl, groesse };
}

export function externStatus(): ExternStatus {
  const pfad = externPfad();
  const fehler = (getSetting(KEY_FEHLER) ?? "").trim();
  const erreichbar = pfad ? laufwerkDa(pfad) : false;
  const inhalt = erreichbar ? ordnerInhalt(pfad) : { anzahl: 0, groesse: 0 };
  return {
    pfad,
    aktiv: pfad !== "",
    erreichbar,
    zuletzt: getSetting(KEY_ZULETZT),
    fehler: fehler || null,
    anzahl: inhalt.anzahl,
    groesse: inhalt.groesse,
    behalten: EXTERN_KOPIEN,
  };
}

/**
 * Erst neben das Ziel schreiben, dann umbenennen.
 *
 * Bricht die Kopie ab (Stecker raus, Platte voll), bleibt eine `.teil`-Datei
 * liegen — aber niemals eine halbe Datei, die aussieht wie eine vollstaendige
 * Sicherung. Genau darauf verliesse man sich sonst im Ernstfall.
 */
function kopiereDatei(quelle: string, ziel: string): void {
  const temp = `${ziel}.teil`;
  try { fs.rmSync(temp, { force: true }); } catch { /* egal */ }
  fs.copyFileSync(quelle, temp);
  try { fs.rmSync(ziel, { force: true }); } catch { /* egal */ }
  fs.renameSync(temp, ziel);
}

function kopiereOrdner(quelle: string, ziel: string): void {
  const temp = `${ziel}.teil`;
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* egal */ }
  fs.cpSync(quelle, temp, { recursive: true });
  try { fs.rmSync(ziel, { recursive: true, force: true }); } catch { /* egal */ }
  fs.renameSync(temp, ziel);
}

/** Liegengebliebene Bruchstuecke eines abgebrochenen Laufs. */
function raeumeReste(dir: string): void {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".teil")) continue;
    try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); } catch { /* egal */ }
  }
}

export interface ExternErgebnis {
  ok: boolean;
  kopiert: number;
  entfernt: number;
  uebersprungen: boolean;
  fehler: string | null;
  status: ExternStatus;
}

/**
 * Spiegelt die neuesten `EXTERN_KOPIEN` Sicherungen auf das externe Ziel.
 *
 * Wirft nie. Ein nicht angestecktes Laufwerk ist ein normaler Zustand, kein
 * Fehlerfall — der Start der App darf daran nicht haengen. Sichtbar wird es
 * ueber den Status im Sicherungs-Dialog.
 */
export function syncExtern(): ExternErgebnis {
  const antwort = (
    teil: Partial<ExternErgebnis> & { ok: boolean }
  ): ExternErgebnis => ({
    kopiert: 0,
    entfernt: 0,
    uebersprungen: false,
    fehler: null,
    ...teil,
    status: externStatus(),
  });

  const pfad = externPfad();
  if (!pfad) return antwort({ ok: false, uebersprungen: true });

  if (!laufwerkDa(pfad)) {
    setSetting(KEY_FEHLER, "Laufwerk nicht erreichbar");
    return antwort({ ok: false, uebersprungen: true, fehler: "Laufwerk nicht erreichbar" });
  }

  try {
    fs.mkdirSync(pfad, { recursive: true });
    raeumeReste(pfad);

    // Bereits kopierte Sicherungen aendern sich nie mehr. Was gleich heisst und
    // gleich gross ist, wird deshalb uebersprungen — dadurch kostet ein Lauf
    // ohne neue Sicherung nur ein Verzeichnislisting.
    let kopiert = 0;
    const quellen = listBackups().slice(0, EXTERN_KOPIEN);
    for (const b of quellen) {
      const quelle = path.join(BACKUP_DIR, b.name);
      const ziel = path.join(pfad, b.name);
      const dbGroesse = fs.statSync(quelle).size;
      const vorhanden = fs.existsSync(ziel) && fs.statSync(ziel).size === dbGroesse;
      if (!vorhanden) {
        kopiereDatei(quelle, ziel);
        kopiert++;
      }
      // Die Anhaenge gehoeren zum selben Stand und muessen mit.
      const anhQuelle = anhangOrdner(quelle);
      const anhZiel = anhangOrdner(ziel);
      if (fs.existsSync(anhQuelle)) {
        if (!vorhanden || !fs.existsSync(anhZiel)) kopiereOrdner(anhQuelle, anhZiel);
      }
    }

    // Aufraeumen: nur eigene Dateien, nur die aelteren. Sortiert wird nach dem
    // Namen, nicht nach dem Datum der Datei — am Zielort traegt jede Kopie das
    // Datum des Kopierens, der Name dagegen den echten Stand.
    let entfernt = 0;
    const dort = fs
      .readdirSync(pfad)
      .filter((n) => UNSER_NAME.test(n))
      .sort((a, b) => b.localeCompare(a));
    for (const name of dort.slice(EXTERN_KOPIEN)) {
      const p = path.join(pfad, name);
      try { fs.rmSync(p, { force: true }); } catch { /* egal */ }
      try { fs.rmSync(anhangOrdner(p), { recursive: true, force: true }); } catch { /* egal */ }
      entfernt++;
    }

    setSetting(KEY_ZULETZT, new Date().toISOString());
    setSetting(KEY_FEHLER, "");
    return antwort({ ok: true, kopiert, entfernt });
  } catch (e) {
    const text = e instanceof Error ? e.message : "unbekannter Fehler";
    setSetting(KEY_FEHLER, text);
    return antwort({ ok: false, fehler: text });
  }
}
