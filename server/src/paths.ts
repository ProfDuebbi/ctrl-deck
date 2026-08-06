import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// server/src/paths.ts  ->  Projekt-Wurzel ist zwei Ebenen hoeher
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const EXPORT_DIR = path.join(DATA_DIR, "exports");
// Verschluesselte Tresor-Anhaenge. Liegen als Dateien neben der DB und muessen
// deshalb bei jeder Sicherung mitgenommen werden (siehe db.ts).
export const TRESOR_DIR = path.join(DATA_DIR, "tresor");
export const DB_PATH = path.join(DATA_DIR, "ctrl-deck.db");
// Optionales Zertifikat fuer HTTPS. Liegt hier `cert.pem` + `key.pem`, liefert
// der Server verschluesselt aus; sonst laeuft er auf http (siehe index.ts).
export const TLS_DIR = path.join(DATA_DIR, "tls");
// Gebaute Oberflaeche (`npm run build`). Existiert sie, liefert der Server sie
// gleich mit aus — dann laeuft alles unter EINER Adresse und man braucht im
// Betrieb weder Vite noch CORS.
export const WEB_DIST = path.join(ROOT_DIR, "web", "dist");

// Sicherstellen, dass die Datenordner existieren
for (const dir of [DATA_DIR, EXPORT_DIR, TRESOR_DIR, TLS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
