/*
 * CTRL·DECK — modulares Control-Dashboard, das lokal laeuft.
 * Copyright (C) 2026 ProfDuebbi
 *
 * Freie Software unter der GNU Affero General Public License, Version 3 oder
 * spaeter. Weitergabe und Aenderung erlaubt; ohne jede Gewaehrleistung.
 * Der volle Lizenztext steht in der Datei LICENSE.
 */

import express from "express";
import cors from "cors";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { TLS_DIR, WEB_DIST } from "./paths.js";
import {
  getSetting, setSetting, createBackup, pruneBackups, restoreDatabase,
  listBackups, deleteBackup, BACKUP_DIR,
} from "./db.js";
import { anmeldeRouten, istEingerichtet, tuersteher } from "./auth.js";
import { externPfad, externStatus, setzeExternPfad, syncExtern } from "./externBackup.js";
import { serverModules } from "./modules/index.js";

const app = express();
const PORT = Number(process.env.PORT ?? 8787);

/**
 * Hinter einem Reverse Proxy (Caddy, nginx, Traefik) kommt jede Anfrage von
 * der Adresse des Proxys, und ob sie urspruenglich per HTTPS kam, steht nur im
 * Kopf `X-Forwarded-Proto`. Express glaubt solche Koepfe nur, wenn man es ihm
 * ausdruecklich sagt.
 *
 * Standardmaessig AUS, und das ist Absicht: Wer diese Koepfe blind glaubt,
 * laesst sich die Herkunftsadresse frei erfinden — und genau daran haengt die
 * Bremse gegen das Durchprobieren von Passwoertern (auth.ts zaehlt pro
 * Adresse). Ein einziger Angreifer koennte sich damit unbegrenzt viele
 * Versuche verschaffen ODER alle anderen aussperren.
 *
 * Wer also einen Proxy davorstellt, setzt TRUST_PROXY — auf die Anzahl der
 * Zwischenstationen (meist `1`) oder auf `loopback`, wenn der Proxy auf
 * demselben Rechner laeuft.
 */
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
  const wert = /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY;
  app.set("trust proxy", wert);
  console.log(`[proxy] X-Forwarded-* wird vertraut (trust proxy = ${wert})`);
}

/**
 * CORS nur fuer die eigene Oberflaeche.
 *
 * Vorher stand hier `cors()` — das setzt `Access-Control-Allow-Origin: *`.
 * Weil es hier keine Anmeldung gibt, konnte damit JEDE beliebige Webseite,
 * die im selben Browser offen ist, `fetch("http://localhost:8787/api/...")`
 * aufrufen UND die Antwort lesen: Haushalt, Schulden, Laermprotokoll,
 * Zaehlerstaende. Der Tresor haette nur Chiffrat herausgegeben, alles andere
 * Klartext.
 *
 * Im Normalbetrieb laeuft ohnehin alles ueber den Vite-Proxy (Port 5180) und
 * braucht gar kein CORS; die Liste deckt nur den Fall ab, dass jemand die
 * Oberflaeche direkt gegen den Server faehrt.
 */
const ERLAUBTE_HERKUNFT = [
  "http://localhost:5180", "http://127.0.0.1:5180",
  "http://localhost:4173", "http://127.0.0.1:4173", // vite preview
  // Laeuft die Oberflaeche unter einer eigenen Adresse (Reverse Proxy,
  // Tailscale-Name), gehoert sie hier dazu — mehrere durch Komma getrennt:
  //   ORIGIN=https://deck.example.org
  ...(process.env.ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];
app.use(cors({ origin: ERLAUBTE_HERKUNFT, credentials: true }));
app.use(express.json());

/**
 * Ab hier ist alles unter /api abgeschlossen.
 *
 * Diese eine Zeile schuetzt saemtliche rund 90 Routen aller Module — genau
 * dafuer haengt jedes Modul unter `/api/<modul>`. Ausnahmen stehen in
 * `auth.ts`, nicht hier, damit es nur EINE Liste gibt: /health, /auth/* und —
 * solange noch kein Konto existiert — die Ortssuche der Ersteinrichtung.
 *
 * Wichtig: erst die Anmelde-Endpunkte registrieren, dann den Tuersteher,
 * dann die Module. Express arbeitet in Reihenfolge ab.
 */
anmeldeRouten(app);
app.use("/api", tuersteher);

// --- Kern-Endpunkte -------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ctrl-deck", time: new Date().toISOString() });
});

// Begruessung / Nutzer fuer die Startseite ("Willkommen, <Name>").
// Ohne gesetzten Namen bleibt die Begruessung namenlos — die Oberflaeche
// laesst dann das Komma weg.
app.get("/api/me", (_req, res) => {
  res.json({
    name: getSetting("user_name") ?? "",
    appName: getSetting("app_name") ?? "CTRL·DECK",
  });
});

app.put("/api/me", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name fehlt" });
  setSetting("user_name", name);
  res.json({ name });
});

/**
 * Selbst gewaehlte Reihenfolge der Module (Startseite UND Seitenleiste).
 * Eine leere Liste heisst „wie im Code deklariert" — so ist Zuruecksetzen
 * nur ein leeres Array und braucht keinen eigenen Endpunkt.
 */
app.get("/api/module-order", (_req, res) => {
  const roh = getSetting("module_order");
  let order: string[] = [];
  try {
    const geparst = roh ? JSON.parse(roh) : [];
    if (Array.isArray(geparst)) order = geparst.filter((x) => typeof x === "string");
  } catch {
    /* kaputter Eintrag -> Standardreihenfolge */
  }
  res.json({ order });
});

app.put("/api/module-order", (req, res) => {
  const roh = req.body?.order;
  if (!Array.isArray(roh)) return res.status(400).json({ error: "order muss eine Liste sein" });
  // Nur bekannte Modul-Kennungen, jede hoechstens einmal. Damit kann eine
  // veraltete Oberflaeche keine Karteileichen einschleusen.
  const bekannt = new Set(serverModules.map((m) => m.id));
  const order: string[] = [];
  for (const x of roh) {
    const id = String(x);
    if (bekannt.has(id) && !order.includes(id)) order.push(id);
  }
  setSetting("module_order", JSON.stringify(order));
  res.json({ order });
});

/**
 * Ausgeblendete Module.
 *
 * Ausblenden ist eine ANZEIGE-Entscheidung, keine Sicherheitsgrenze: Die
 * Routen des Moduls bleiben erreichbar (hinter der Anmeldung), und die Daten
 * bleiben liegen. Wer ein Modul wieder einblendet, findet alles vor — genau
 * darum heisst es „ausblenden" und nicht „loeschen".
 *
 * Gleiche Machart wie `module_order`: eine Liste von Kennungen in den
 * Einstellungen, serverseitig gegen die Registry gefiltert. Damit ist das hier
 * zugleich die Vorstufe eines „Modul-Stores": zuerst waehlt man, was man sieht.
 */
app.get("/api/module-hidden", (_req, res) => {
  const roh = getSetting("module_hidden");
  let hidden: string[] = [];
  try {
    const geparst = roh ? JSON.parse(roh) : [];
    if (Array.isArray(geparst)) hidden = geparst.filter((x) => typeof x === "string");
  } catch {
    /* kaputter Eintrag -> nichts ausgeblendet */
  }
  res.json({ hidden });
});

app.put("/api/module-hidden", (req, res) => {
  const roh = req.body?.hidden;
  if (!Array.isArray(roh)) return res.status(400).json({ error: "hidden muss eine Liste sein" });
  const bekannt = new Set(serverModules.map((m) => m.id));
  const hidden: string[] = [];
  for (const x of roh) {
    const id = String(x);
    if (bekannt.has(id) && !hidden.includes(id)) hidden.push(id);
  }
  setSetting("module_hidden", JSON.stringify(hidden));
  res.json({ hidden });
});

// Welche Module sind aktiv? Die Startseite rendert daraus ihre Kacheln.
app.get("/api/modules", (_req, res) => {
  res.json(serverModules.map((m) => ({ id: m.id, title: m.title })));
});

// Manuelles Voll-Backup: Datenbank samt verschluesselter Tresor-Anhaenge.
app.post("/api/backup", (_req, res) => {
  try {
    const target = createBackup();
    pruneBackups();
    // Jede neue Sicherung geht sofort mit aufs zweite Laufwerk. Fehlt es
    // gerade, wird das still uebersprungen und beim naechsten Mal nachgeholt.
    const extern = syncExtern();
    const info = listBackups().find((b) => b.name === path.basename(target));
    res.json({
      ok: true,
      path: target,
      size: info?.size ?? 0,
      dateien: info?.dateien ?? 0,
      extern: { ok: extern.ok, uebersprungen: extern.uebersprungen, fehler: extern.fehler },
    });
  } catch {
    res.status(500).json({ error: "Backup fehlgeschlagen" });
  }
});

// Liste aller vorhandenen Backups (neueste zuerst).
app.get("/api/backups", (_req, res) => {
  res.json(listBackups());
});

// Backup wiederherstellen (aktueller Stand wird vorher automatisch gesichert).
app.post("/api/backups/restore", (req, res) => {
  const name = String(req.body?.name ?? "");
  // Pfad-Traversal verhindern: nur reine Dateinamen aus dem Backup-Ordner.
  if (!name || name !== path.basename(name) || !name.endsWith(".db"))
    return res.status(400).json({ error: "ungültiger Name" });
  const src = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(src)) return res.status(404).json({ error: "Backup nicht gefunden" });
  try {
    // Das Ziellaufwerk ist eine Eigenschaft DIESES Rechners, kein Inhalt der
    // Datenbank. Eine Sicherung von vor der Einrichtung kennt den Pfad noch
    // nicht — ohne diese Zeilen waere die externe Sicherung nach einer
    // Wiederherstellung stillschweigend abgeschaltet.
    const zielVorher = externPfad();
    const safety = restoreDatabase(src);
    if (zielVorher && externPfad() !== zielVorher) setzeExternPfad(zielVorher);
    // Die Sicherheitskopie ist der wertvollste Stand ueberhaupt — sie ist das
    // Einzige, was den vorherigen Zustand noch enthaelt. Sofort mitspiegeln.
    syncExtern();
    console.log(`[backup] „${name}" wiederhergestellt (Sicherheitskopie: ${path.basename(safety)})`);
    res.json({ ok: true, restored: name, safetyBackup: path.basename(safety) });
  } catch {
    res.status(500).json({ error: "Wiederherstellung fehlgeschlagen" });
  }
});

// Ein Backup loeschen (samt seinem Anhang-Ordner).
app.delete("/api/backups/:name", (req, res) => {
  const name = req.params.name;
  if (name !== path.basename(name) || !name.endsWith(".db"))
    return res.status(400).json({ error: "ungültiger Name" });
  deleteBackup(name);
  res.json({ ok: true });
});

// Sicherung auf ein zweites Laufwerk: Zustand, Ziel setzen, jetzt spiegeln.
app.get("/api/extern", (_req, res) => {
  res.json(externStatus());
});

app.put("/api/extern", (req, res) => {
  const pfad = String(req.body?.pfad ?? "");
  if (pfad.length > 500) return res.status(400).json({ error: "Pfad zu lang" });
  setzeExternPfad(pfad);
  // Direkt einmal spiegeln, damit man sofort sieht, ob das Ziel taugt.
  res.json(syncExtern());
});

app.post("/api/extern/sync", (_req, res) => {
  res.json(syncExtern());
});

// --- Feature-Module einhaengen -------------------------------------------

for (const mod of serverModules) {
  app.use(`/api/${mod.id}`, mod.router);
  console.log(`[module] /api/${mod.id}  (${mod.title})`);
}

// Unbekannte Adresse unter /api: JSON, nicht Express' HTML-Fehlerseite. Sonst
// bekaeme ein Aufrufer, der sauber JSON erwartet, ploetzlich Markup.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "unbekannter Endpunkt" });
});

/**
 * Gebaute Oberflaeche mitliefern, falls vorhanden (`npm run build`).
 *
 * Im Alltag laeuft die Oberflaeche auf Port 5180 bei Vite, und dieser Block
 * schlaeft. Auf einem Server dagegen ist er der Unterschied zwischen „geht"
 * und „geht nicht": alles kommt dann von EINER Adresse — kein CORS, keine
 * Sonderregeln fuers Cookie, ein Reverse Proxy davor genuegt.
 *
 * Bewusst NICHT hinter der Anmeldung: Wer noch nicht angemeldet ist, muss die
 * Seite ja gerade laden koennen, um den Anmeldebildschirm zu sehen. Geheim ist
 * daran nichts — die Daten liegen alle hinter /api.
 */
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  // Einseiten-Anwendung: jede unbekannte Adresse liefert die index.html, damit
  // ein Neuladen nicht ins Leere laeuft. /api ist ausgenommen — dort soll ein
  // Tippfehler ein ehrliches 404 geben und nicht stillschweigend HTML.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
  console.log(`[web] Oberflaeche wird mitgeliefert (${WEB_DIST})`);
}

// Automatisches Tages-Backup: hoechstens einmal pro Kalendertag beim Start.
try {
  const today = new Date().toISOString().slice(0, 10);
  if (getSetting("last_auto_backup") !== today) {
    createBackup("auto");
    setSetting("last_auto_backup", today);
    pruneBackups();
    console.log(`[backup] automatisches Tages-Backup erstellt (${today})`);
  }
} catch {
  console.warn("[backup] automatisches Backup fehlgeschlagen");
}

/**
 * NUR auf dem eigenen Rechner lauschen — es sei denn, jemand will es anders.
 *
 * `app.listen(PORT)` allein bindet an 0.0.0.0 und ::  — der Server waere damit
 * fuer jeden im selben WLAN erreichbar. Seit es eine Anmeldung gibt, ist eine
 * Freigabe vertretbar; die Voreinstellung bleibt trotzdem der eigene Rechner,
 * weil das die richtige Vorgabe fuer ein privates Dashboard ist.
 */
const HOST = process.env.HOST ?? "127.0.0.1";

/**
 * Zertifikat einlesen, falls eines da ist.
 *
 * Zwei Wege fuehren hierher: `data/tls/cert.pem` + `key.pem` einfach
 * hinlegen, oder TLS_CERT/TLS_KEY auf beliebige Dateien zeigen lassen (so
 * bindet man z. B. ein Tailscale- oder Let's-Encrypt-Zertifikat ein).
 *
 * Fehlt beides, laeuft der Server auf http — richtig fuer den lokalen
 * Betrieb, wo die Daten den Rechner nie verlassen.
 */
function leseZertifikat(): { cert: Buffer; key: Buffer } | null {
  const certPfad = process.env.TLS_CERT ?? path.join(TLS_DIR, "cert.pem");
  const keyPfad = process.env.TLS_KEY ?? path.join(TLS_DIR, "key.pem");
  const ausdruecklich = !!(process.env.TLS_CERT || process.env.TLS_KEY);
  const daCert = fs.existsSync(certPfad);
  const daKey = fs.existsSync(keyPfad);

  if (daCert && daKey) {
    return { cert: fs.readFileSync(certPfad), key: fs.readFileSync(keyPfad) };
  }
  // Halb vorhanden oder ausdruecklich verlangt und nicht da: lauter Abbruch.
  // Ein stiller Rueckfall auf http waere hier die gefaehrlichste Variante —
  // man glaubt, verschluesselt zu senden, und tut es nicht.
  if (ausdruecklich || daCert || daKey) {
    console.error("\n  [!!] HTTPS wurde verlangt, aber das Zertifikat ist unvollstaendig:");
    console.error(`       Zertifikat: ${certPfad} ${daCert ? "(da)" : "FEHLT"}`);
    console.error(`       Schluessel: ${keyPfad} ${daKey ? "(da)" : "FEHLT"}`);
    console.error("       Abbruch — es wird bewusst NICHT auf http zurueckgefallen.\n");
    process.exit(1);
  }
  return null;
}

const zertifikat = leseZertifikat();
const server = zertifikat
  ? https.createServer({ cert: zertifikat.cert, key: zertifikat.key }, app)
  : http.createServer(app);

server.listen(PORT, HOST, () => {
  const schema = zertifikat ? "https" : "http";
  console.log(`\n  CTRL·DECK Server laeuft auf ${schema}://${HOST}:${PORT}\n`);
  if (HOST !== "127.0.0.1") {
    console.warn("  [!] Server ist im Netzwerk erreichbar.");
    if (!zertifikat && !TRUST_PROXY)
      console.warn("      Die Verbindung ist unverschluesselt (http) — im eigenen WLAN vertretbar, im Internet nicht.");
    if (!istEingerichtet())
      console.warn("      [!!] Es ist noch KEIN Passwort gesetzt. Bitte sofort im Browser einrichten.\n");
    else console.warn("");
  }

  // Externe Spiegelung erst NACH dem Lauschen: haengt das Ziellaufwerk (USB,
  // Netzlaufwerk im Ruhezustand), wartet niemand auf die Oberflaeche.
  setTimeout(() => {
    const e = syncExtern();
    if (e.uebersprungen && !e.fehler) return; // kein Ziel eingerichtet
    if (e.ok) console.log(`[extern] gespiegelt nach ${e.status.pfad} (${e.kopiert} neu, ${e.entfernt} entfernt)`);
    else console.warn(`[extern] uebersprungen: ${e.fehler}`);
  }, 0);
});
