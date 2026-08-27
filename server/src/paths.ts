import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// server/src/paths.ts  ->  Projekt-Wurzel ist zwei Ebenen hoeher
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..", "..");

/**
 * Wo die Daten liegen. Vorgabe ist `data/` neben dem Projekt — genau wie
 * bisher, ein lokaler Start merkt davon nichts.
 *
 * `DATA_DIR` gibt es fuer den Serverbetrieb: In einem Container liegt der
 * dauerhafte Speicher als eingehaengtes Laufwerk irgendwo anders, und ohne
 * diesen Schalter muesste man dafuer das Projektverzeichnis verbiegen.
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, "data");
export const EXPORT_DIR = path.join(DATA_DIR, "exports");
// Verschluesselte Tresor-Anhaenge. Liegen als Dateien neben der DB und muessen
// deshalb bei jeder Sicherung mitgenommen werden (siehe db.ts).
export const TRESOR_DIR = path.join(DATA_DIR, "tresor");
// Verschluesselte Dokumente (Scans, PDFs). Zweiter Bestand derselben Art wie
// die Tresor-Anhaenge — deshalb steht beides unten in ANHANG_BESTAENDE.
export const DOKUMENTE_DIR = path.join(DATA_DIR, "dokumente");
export const DB_PATH = path.join(DATA_DIR, "ctrl-deck.db");
// Optionales Zertifikat fuer HTTPS. Liegt hier `cert.pem` + `key.pem`, liefert
// der Server verschluesselt aus; sonst laeuft er auf http (siehe index.ts).
export const TLS_DIR = path.join(DATA_DIR, "tls");
// Gebaute Oberflaeche (`npm run build`). Existiert sie, liefert der Server sie
// gleich mit aus — dann laeuft alles unter EINER Adresse und man braucht im
// Betrieb weder Vite noch CORS.
export const WEB_DIST = path.join(ROOT_DIR, "web", "dist");

/**
 * Jeder Ordner, in dem verschluesselte Anhaenge als Dateien liegen, mit der
 * Tabelle, die auf sie zeigt.
 *
 * Diese Paarung steht hier EINMAL, weil sie an drei Stellen gebraucht wird:
 * beim Sichern, beim Zurueckspielen und beim Umzug in eine angeschlossene
 * Datenbank (`db/export.ts`, wo der Inhalt dann in einer Spalte landet). Solange
 * es nur den Tresor gab, war die Verdrahtung an jeder dieser Stellen fest
 * eingebaut — beim zweiten Bestand faellt auf, dass das dreimal dasselbe war.
 *
 * `name` ist der Unterordner, unter dem eine Sicherung diesen Bestand ablegt.
 * Er darf sich NICHT mehr aendern: Sicherungen tragen ihn im Dateipfad.
 */
export const ANHANG_BESTAENDE = [
  { name: "tresor", dir: TRESOR_DIR, tabelle: "tresor_dateien" },
  { name: "dokumente", dir: DOKUMENTE_DIR, tabelle: "dokument_dateien" },
] as const;

// Sicherstellen, dass die Datenordner existieren
for (const dir of [DATA_DIR, EXPORT_DIR, TRESOR_DIR, DOKUMENTE_DIR, TLS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
