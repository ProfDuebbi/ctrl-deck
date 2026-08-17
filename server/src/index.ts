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
  listBackups, deleteBackup, starteDatenbank, BACKUP_DIR,
} from "./db.js";
import { anmeldeRouten, istEingerichtet, richteAuthEin, tuersteher } from "./auth.js";
import { kopfRouten } from "./kopf.js";
import { sicher } from "./route.js";
import { externPfad, externStatus, setzeExternPfad, syncExtern } from "./externBackup.js";
import { serverModules } from "./modules/index.js";

/*
 * Die Reihenfolge beim Start ist jetzt ausdrucksstark und nicht mehr dem Zufall
 * der Import-Reihenfolge ueberlassen: erst die Datenbankverbindung, dann die
 * Tabellen der Anmeldung, dann die der Module — und erst danach lauscht
 * ueberhaupt jemand auf dem Port.
 *
 * Frueher legte jede Moduldatei ihre Tabellen beim Importieren an. Das ging
 * nur, solange die Datenbank synchron war. Eine angeschlossene Datenbank
 * antwortet ueber ein Netzwerk, und auf ein Versprechen kann man im Rumpf einer
 * importierten Datei nicht sauber warten.
 */
const datenbank = await starteDatenbank();
await richteAuthEin();
for (const mod of serverModules) {
  if (mod.einrichten) await mod.einrichten();
}
console.log(`[db] ${datenbank.bezeichnung}`);

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
// Express nimmt von Haus aus nur 100 kB entgegen — ein Profilbild als
// Data-URL sprengt das knapp und haette einen kryptischen 413 geliefert.
// Die scharfe Grenze zieht die Route selbst (AVATAR_MAX), hier steht nur
// genug Luft, damit eine ehrliche Anfrage ueberhaupt ankommt.
app.use(express.json({ limit: "1mb" }));

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

// Aussehen des Kopfbereichs (Bild, Uhr, Wetter). Steht HINTER dem Tuersteher:
// ein Kopfbild kann verraten, wer hier wohnt.
kopfRouten(app);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ctrl-deck", time: new Date().toISOString() });
});

// Begruessung / Nutzer fuer die Startseite ("Willkommen, <Name>").
// Ohne gesetzten Namen bleibt die Begruessung namenlos — die Oberflaeche
// laesst dann das Komma weg.

/**
 * Obergrenze fuers Profilbild, gemessen an der Data-URL.
 *
 * Das Bild liegt bewusst IN DER DATENBANK und nicht als Datei in `data/`:
 * Sicherung, externe Spiegelung und Wiederherstellen fassen die `.db` an —
 * ein eigener Ordner waere beim Wiederherstellen still verlorengegangen
 * (nur `data/tresor/` ist mit der Sicherung gepaart, siehe db.ts).
 *
 * Damit die Datenbank davon nicht aufgeht, verkleinert die Oberflaeche das
 * Bild vorher auf 256×256. 300 kB lassen dafuer reichlich Luft und sind fuer
 * SQLite nichts; wer die Grenze reisst, hat die Verkleinerung umgangen.
 */
const AVATAR_MAX = 300_000;
const AVATAR_ERLAUBT = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

app.get("/api/me", sicher(async (_req, res) => {
  res.json({
    name: (await getSetting("user_name")) ?? "",
    appName: (await getSetting("app_name")) || "CTRL·DECK",
    avatar: (await getSetting("user_avatar")) || null,
  });
}));

/**
 * Teilweise Aenderung: nur was im Rumpf steht, wird angefasst.
 *
 * Deshalb `in`-Pruefungen statt Wahrheitswerten — sonst koennte man das Bild
 * nie wieder loswerden, weil `null` und „nicht mitgeschickt" gleich aussaehen.
 */
app.put("/api/me", sicher(async (req, res) => {
  const body = req.body ?? {};

  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Bitte einen Namen angeben." });
    if (name.length > 60) return res.status(400).json({ error: "Der Name ist zu lang (höchstens 60 Zeichen)." });
    await setSetting("user_name", name);
  }

  if ("appName" in body) {
    // Leer heisst „zurueck zur Vorgabe", nicht „gar kein Name" — eine App
    // ohne Titel waere in der Seitenleiste eine leere Zeile.
    const appName = String(body.appName ?? "").trim();
    if (appName.length > 30) return res.status(400).json({ error: "Der Titel ist zu lang (höchstens 30 Zeichen)." });
    await setSetting("app_name", appName);
  }

  if ("avatar" in body) {
    const avatar = body.avatar;
    if (avatar === null || avatar === "") {
      await setSetting("user_avatar", "");
    } else if (typeof avatar !== "string" || !AVATAR_ERLAUBT.test(avatar)) {
      return res.status(400).json({ error: "Das ist kein gültiges Bild (PNG, JPEG oder WebP)." });
    } else if (avatar.length > AVATAR_MAX) {
      return res.status(413).json({ error: "Das Bild ist zu groß." });
    } else {
      await setSetting("user_avatar", avatar);
    }
  }

  res.json({
    name: (await getSetting("user_name")) ?? "",
    appName: (await getSetting("app_name")) || "CTRL·DECK",
    avatar: (await getSetting("user_avatar")) || null,
  });
}));

/**
 * Selbst gewaehlte Reihenfolge der Module (Startseite UND Seitenleiste).
 * Eine leere Liste heisst „wie im Code deklariert" — so ist Zuruecksetzen
 * nur ein leeres Array und braucht keinen eigenen Endpunkt.
 */
app.get("/api/module-order", sicher(async (_req, res) => {
  const roh = await getSetting("module_order");
  let order: string[] = [];
  try {
    const geparst = roh ? JSON.parse(roh) : [];
    if (Array.isArray(geparst)) order = geparst.filter((x) => typeof x === "string");
  } catch {
    /* kaputter Eintrag -> Standardreihenfolge */
  }
  res.json({ order });
}));

app.put("/api/module-order", sicher(async (req, res) => {
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
  await setSetting("module_order", JSON.stringify(order));
  res.json({ order });
}));

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
app.get("/api/module-hidden", sicher(async (_req, res) => {
  const roh = await getSetting("module_hidden");
  let hidden: string[] = [];
  try {
    const geparst = roh ? JSON.parse(roh) : [];
    if (Array.isArray(geparst)) hidden = geparst.filter((x) => typeof x === "string");
  } catch {
    /* kaputter Eintrag -> nichts ausgeblendet */
  }
  res.json({ hidden });
}));

app.put("/api/module-hidden", sicher(async (req, res) => {
  const roh = req.body?.hidden;
  if (!Array.isArray(roh)) return res.status(400).json({ error: "hidden muss eine Liste sein" });
  const bekannt = new Set(serverModules.map((m) => m.id));
  const hidden: string[] = [];
  for (const x of roh) {
    const id = String(x);
    if (bekannt.has(id) && !hidden.includes(id)) hidden.push(id);
  }
  await setSetting("module_hidden", JSON.stringify(hidden));
  res.json({ hidden });
}));

// Welche Module sind aktiv? Die Startseite rendert daraus ihre Kacheln.
app.get("/api/modules", (_req, res) => {
  res.json(serverModules.map((m) => ({ id: m.id, title: m.title })));
});

/**
 * Ein Sicherungsname, wie ihn db.ts vergibt — und nichts anderes.
 *
 * Zwei Endungen, weil es zwei Wege gibt: `.db` ist die Dateikopie der lokalen
 * Installation, `.json` der Export einer angeschlossenen Datenbank. Die
 * Pruefung auf den blossen Dateinamen verhindert, dass jemand ueber `..` aus
 * dem Sicherungsordner herausklettert.
 */
const nameOk = (n: string) =>
  !!n && n === path.basename(n) && (n.endsWith(".db") || n.endsWith(".json"));

// Manuelles Voll-Backup: Datenbank samt verschluesselter Tresor-Anhaenge.
app.post("/api/backup", sicher(async (_req, res) => {
  try {
    const target = await createBackup();
    pruneBackups();
    // Jede neue Sicherung geht sofort mit aufs zweite Laufwerk. Fehlt es
    // gerade, wird das still uebersprungen und beim naechsten Mal nachgeholt.
    const extern = await syncExtern();
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
}));

// Liste aller vorhandenen Backups (neueste zuerst).
app.get("/api/backups", (_req, res) => {
  res.json(listBackups());
});

// Backup wiederherstellen (aktueller Stand wird vorher automatisch gesichert).
app.post("/api/backups/restore", sicher(async (req, res) => {
  const name = String(req.body?.name ?? "");
  if (!nameOk(name)) return res.status(400).json({ error: "ungültiger Name" });
  const src = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(src)) return res.status(404).json({ error: "Backup nicht gefunden" });
  try {
    // Das Ziellaufwerk ist eine Eigenschaft DIESES Rechners, kein Inhalt der
    // Datenbank. Eine Sicherung von vor der Einrichtung kennt den Pfad noch
    // nicht — ohne diese Zeilen waere die externe Sicherung nach einer
    // Wiederherstellung stillschweigend abgeschaltet.
    const zielVorher = await externPfad();
    const safety = await restoreDatabase(src);
    if (zielVorher && (await externPfad()) !== zielVorher) await setzeExternPfad(zielVorher);
    // Die Sicherheitskopie ist der wertvollste Stand ueberhaupt — sie ist das
    // Einzige, was den vorherigen Zustand noch enthaelt. Sofort mitspiegeln.
    await syncExtern();
    console.log(`[backup] „${name}" wiederhergestellt (Sicherheitskopie: ${path.basename(safety)})`);
    res.json({ ok: true, restored: name, safetyBackup: path.basename(safety) });
  } catch {
    res.status(500).json({ error: "Wiederherstellung fehlgeschlagen" });
  }
}));

// Ein Backup loeschen (samt seinem Anhang-Ordner).
app.delete("/api/backups/:name", (req, res) => {
  if (!nameOk(req.params.name)) return res.status(400).json({ error: "ungültiger Name" });
  deleteBackup(req.params.name);
  res.json({ ok: true });
});

// Sicherung auf ein zweites Laufwerk: Zustand, Ziel setzen, jetzt spiegeln.
app.get("/api/extern", sicher(async (_req, res) => {
  res.json(await externStatus());
}));

app.put("/api/extern", sicher(async (req, res) => {
  const pfad = String(req.body?.pfad ?? "");
  if (pfad.length > 500) return res.status(400).json({ error: "Pfad zu lang" });
  await setzeExternPfad(pfad);
  // Direkt einmal spiegeln, damit man sofort sieht, ob das Ziel taugt.
  res.json(await syncExtern());
}));

app.post("/api/extern/sync", sicher(async (_req, res) => {
  res.json(await syncExtern());
}));

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
 * Endstation fuer alles, was in einer Route schiefgeht.
 *
 * Seit die Datenbank asynchron ist, faengt `sicher()` (siehe route.ts) auch
 * abgelehnte Versprechen ein und schickt sie per `next(fehler)` hierher. Ohne
 * diesen Block antwortete Express mit seiner HTML-Fehlerseite — an eine
 * Oberflaeche, die JSON erwartet und daran erstickt.
 *
 * Nach draussen geht bewusst nur ein Satz: eine Fehlermeldung aus der Datenbank
 * kann Tabellennamen und Werte enthalten. Das Ganze steht im Protokoll.
 */
app.use("/api", (fehler: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api]", fehler);
  if (res.headersSent) return;
  res.status(500).json({ error: "Da ist etwas schiefgegangen." });
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
// Bei einer angeschlossenen Datenbank wird dabei exportiert statt kopiert.
try {
  const today = new Date().toISOString().slice(0, 10);
  if ((await getSetting("last_auto_backup")) !== today) {
    await createBackup("auto");
    await setSetting("last_auto_backup", today);
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

server.listen(PORT, HOST, async () => {
  const schema = zertifikat ? "https" : "http";
  console.log(`\n  CTRL·DECK Server laeuft auf ${schema}://${HOST}:${PORT}\n`);
  if (HOST !== "127.0.0.1") {
    console.warn("  [!] Server ist im Netzwerk erreichbar.");
    if (!zertifikat && !TRUST_PROXY)
      console.warn("      Die Verbindung ist unverschluesselt (http) — im eigenen WLAN vertretbar, im Internet nicht.");
    if (!(await istEingerichtet()))
      console.warn("      [!!] Es ist noch KEIN Passwort gesetzt. Bitte sofort im Browser einrichten.\n");
    else console.warn("");
  }

  // Externe Spiegelung erst NACH dem Lauschen: haengt das Ziellaufwerk (USB,
  // Netzlaufwerk im Ruhezustand), wartet niemand auf die Oberflaeche.
  setTimeout(async () => {
    const e = await syncExtern();
    if (e.uebersprungen && !e.fehler) return; // kein Ziel eingerichtet
    if (e.ok) console.log(`[extern] gespiegelt nach ${e.status.pfad} (${e.kopiert} neu, ${e.entfernt} entfernt)`);
    else console.warn(`[extern] uebersprungen: ${e.fehler}`);
  }, 0);
});
