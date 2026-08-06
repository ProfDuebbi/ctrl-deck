import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db, setSetting } from "./db.js";

/**
 * Anmeldung — ein Konto pro Installation.
 *
 * CTRL·DECK wird selbst installiert, jeder betreibt seine eigene Datenbank.
 * Deshalb gibt es genau EIN Konto und keine Registrierung, keine Rollen, kein
 * E-Mail-Versand. Wer mehr braucht, betreibt eine zweite Installation.
 *
 * Was diese Anmeldung leistet und was nicht:
 * - Sie schuetzt den SERVER. Ohne sie kann jeder, der den Port erreicht, alles
 *   lesen und schreiben — auf einem Server oder im WLAN ist das der Unterschied
 *   zwischen privat und oeffentlich.
 * - Sie schuetzt NICHT die Datei auf der Platte. `data/ctrl-deck.db` ist eine
 *   gewoehnliche SQLite-Datei; wer an den Ordner kommt, liest sie. Der einzige
 *   echte Safe im Projekt ist der Tresor, und der verschluesselt im Browser.
 *
 * Das Anmeldepasswort ist bewusst NICHT das Tresor-Passwort: dieses hier geht
 * zwangslaeufig zum Server, jenes verlaesst den Browser nie.
 */

// --- Tabellen -------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS konto (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    passwort TEXT NOT NULL,
    angelegt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sitzungen (
    id        TEXT PRIMARY KEY,
    angelegt  TEXT NOT NULL,
    laeuft_ab TEXT NOT NULL,
    zuletzt   TEXT NOT NULL
  );
`);

// --- Passwoerter ----------------------------------------------------------

/**
 * scrypt aus `node:crypto` — eingebaut, kein nativer Build.
 *
 * Dieselbe Ueberlegung wie bei `node:sqlite` statt better-sqlite3: eine
 * Abhaengigkeit weniger, die beim Installieren auf einem fremden Rechner
 * kaputtgehen kann. scrypt ist absichtlich langsam und speicherhungrig, damit
 * massenhaftes Durchprobieren teuer wird.
 */
const SCRYPT = { N: 16384, r: 8, p: 1 };

export const MIN_LAENGE = 8;

export function hashePasswort(klartext: string): string {
  const salz = crypto.randomBytes(16);
  const hash = crypto.scryptSync(klartext, salz, 64, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salz.toString("base64"), hash.toString("base64")].join("$");
}

function passwortStimmt(klartext: string, gespeichert: string): boolean {
  const [algo, n, r, p, salzB64, hashB64] = gespeichert.split("$");
  if (algo !== "scrypt") return false;
  try {
    const salz = Buffer.from(salzB64, "base64");
    const erwartet = Buffer.from(hashB64, "base64");
    const berechnet = crypto.scryptSync(klartext, salz, erwartet.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    // Zeitkonstanter Vergleich: ein normales === verraet ueber die Laufzeit,
    // wie viele Bytes gestimmt haben.
    return crypto.timingSafeEqual(berechnet, erwartet);
  } catch {
    return false;
  }
}

// --- Konto ----------------------------------------------------------------

export function istEingerichtet(): boolean {
  return !!db.prepare("SELECT 1 FROM konto WHERE id = 1").get();
}

/** Legt das Konto an oder ersetzt das Passwort; wirft alle Sitzungen weg. */
export function setzePasswort(klartext: string): void {
  if (klartext.length < MIN_LAENGE) throw new Error(`Passwort braucht mindestens ${MIN_LAENGE} Zeichen`);
  db.prepare(
    `INSERT INTO konto (id, passwort, angelegt) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET passwort = excluded.passwort`
  ).run(hashePasswort(klartext), new Date().toISOString());
  // Ein Passwortwechsel muss alte Sitzungen ungueltig machen — sonst bleibt
  // ein Geraet angemeldet, das man gerade aussperren wollte.
  db.prepare("DELETE FROM sitzungen").run();
}

function passwortPasst(klartext: string): boolean {
  const row = db.prepare("SELECT passwort FROM konto WHERE id = 1").get() as { passwort: string } | undefined;
  return !!row && passwortStimmt(klartext, row.passwort);
}

// --- Sitzungen ------------------------------------------------------------

const COOKIE = "cd_sitzung";
const DAUER_TAGE = 30;
const DAUER_MS = DAUER_TAGE * 24 * 60 * 60 * 1000;

/**
 * In der Datenbank steht nur der SHA-256 des Cookie-Werts. Wer die Datei in
 * die Finger bekommt, kann daraus keine gueltige Sitzung bauen — und der
 * Vergleich braucht kein langsames Hashing, weil der Wert schon zufaellig ist.
 */
const fingerabdruck = (roh: string) => crypto.createHash("sha256").update(roh).digest("hex");

function leseCookie(req: Request, name: string): string | null {
  const roh = req.headers.cookie;
  if (!roh) return null;
  for (const teil of roh.split(";")) {
    const i = teil.indexOf("=");
    if (i < 0) continue;
    if (teil.slice(0, i).trim() === name) {
      try { return decodeURIComponent(teil.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/**
 * Laeuft die Verbindung ueber HTTPS? Dann bekommt das Cookie `secure` und
 * wird nie mehr im Klartext verschickt.
 *
 * Bewusst `req.secure` statt `X-Forwarded-Proto` selbst zu lesen: Express
 * beruecksichtigt darin die `trust proxy`-Einstellung (siehe index.ts). Wer
 * den Kopf ungeprueft glaubt, laesst ihn sich von jedem Aufrufer diktieren.
 */
function ueberHttps(req: Request): boolean {
  return req.secure;
}

function starteSitzung(req: Request, res: Response): void {
  const roh = crypto.randomBytes(32).toString("base64url");
  const jetzt = new Date();
  db.prepare("INSERT INTO sitzungen (id, angelegt, laeuft_ab, zuletzt) VALUES (?, ?, ?, ?)").run(
    fingerabdruck(roh),
    jetzt.toISOString(),
    new Date(jetzt.getTime() + DAUER_MS).toISOString(),
    jetzt.toISOString()
  );
  res.cookie(COOKIE, roh, {
    httpOnly: true,       // fuer JavaScript unsichtbar
    sameSite: "lax",      // fremde Seiten koennen damit nichts ausloesen (CSRF)
    secure: ueberHttps(req),
    path: "/",
    maxAge: DAUER_MS,
  });
  aufraeumen();
}

function beendeSitzung(req: Request, res: Response): void {
  const roh = leseCookie(req, COOKIE);
  if (roh) db.prepare("DELETE FROM sitzungen WHERE id = ?").run(fingerabdruck(roh));
  res.clearCookie(COOKIE, { path: "/" });
}

/** Abgelaufene Sitzungen wegwerfen — sonst waechst die Tabelle ewig. */
function aufraeumen(): void {
  db.prepare("DELETE FROM sitzungen WHERE laeuft_ab < ?").run(new Date().toISOString());
}

export function istAngemeldet(req: Request): boolean {
  const roh = leseCookie(req, COOKIE);
  if (!roh) return false;
  const row = db.prepare("SELECT laeuft_ab FROM sitzungen WHERE id = ?").get(fingerabdruck(roh)) as
    | { laeuft_ab: string }
    | undefined;
  if (!row) return false;
  if (row.laeuft_ab < new Date().toISOString()) return false;
  return true;
}

// --- Bremse gegen Durchprobieren -----------------------------------------

/**
 * Absichtlich nur im Arbeitsspeicher: ein Neustart hebt die Sperre auf. Das
 * ist der richtige Handel fuer eine Installation, die einer Person gehoert —
 * wer sich selbst aussperrt, startet neu, waehrend automatisches Raten immer
 * noch an der Wand steht (scrypt kostet pro Versuch spuerbar Zeit).
 */
const MAX_VERSUCHE = 10;
const SPERRE_MS = 15 * 60 * 1000;
const versuche = new Map<string, { anzahl: number; bis: number }>();

function herkunft(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unbekannt";
}

export function gesperrtBis(req: Request): number | null {
  const e = versuche.get(herkunft(req));
  if (!e) return null;
  if (Date.now() > e.bis) { versuche.delete(herkunft(req)); return null; }
  return e.anzahl >= MAX_VERSUCHE ? e.bis : null;
}

function merkeFehlversuch(req: Request): void {
  const k = herkunft(req);
  const e = versuche.get(k);
  if (!e || Date.now() > e.bis) versuche.set(k, { anzahl: 1, bis: Date.now() + SPERRE_MS });
  else e.anzahl++;
}

// --- Tuersteher -----------------------------------------------------------

/**
 * Ohne Anmeldung erreichbar. Bewusst kurz gehalten:
 * - `/health` sagt nur, dass der Server lebt.
 * - `/auth/*` waere sonst nicht benutzbar.
 * - `/wetter/orte` NUR solange kein Konto existiert — die Ersteinrichtung
 *   braucht die Ortssuche, danach ist sie zu.
 */
function offenOhneAnmeldung(pfad: string): boolean {
  if (pfad === "/health") return true;
  if (pfad.startsWith("/auth/")) return true;
  if (pfad === "/wetter/orte" && !istEingerichtet()) return true;
  return false;
}

export function tuersteher(req: Request, res: Response, next: NextFunction): void {
  if (offenOhneAnmeldung(req.path)) return next();
  // Solange kein Konto existiert, ist alles zu ausser der Ersteinrichtung.
  // Sonst stuende eine frische Installation bis zum ersten Passwort offen.
  if (!istEingerichtet()) {
    res.status(401).json({ error: "nicht eingerichtet", einrichten: true });
    return;
  }
  if (!istAngemeldet(req)) {
    res.status(401).json({ error: "nicht angemeldet" });
    return;
  }
  next();
}

// --- Endpunkte ------------------------------------------------------------

export function anmeldeRouten(app: import("express").Express): void {
  app.get("/api/auth/status", (req, res) => {
    res.json({ eingerichtet: istEingerichtet(), angemeldet: istAngemeldet(req) });
  });

  /**
   * Erster Start: Passwort festlegen, dazu Name und Wetter-Standort. Danach
   * nie wieder erreichbar.
   *
   * Alles drei in EINEM Aufruf, weil es sonst ein Konto ohne Namen geben
   * koennte, wenn der zweite Aufruf scheitert — und dafuer gibt es keine
   * Oberflaeche zum Nachbessern. Die `wetter_*`-Schluessel gehoeren dem
   * Wetter-Modul (server/src/modules/wetter.ts), werden hier aber mitgesetzt,
   * damit die Ersteinrichtung eine einzige Entscheidung bleibt.
   */
  app.post("/api/auth/einrichten", (req, res) => {
    if (istEingerichtet()) return res.status(409).json({ error: "bereits eingerichtet" });

    const passwort = String(req.body?.passwort ?? "");
    if (passwort.length < MIN_LAENGE)
      return res.status(400).json({ error: `Das Passwort braucht mindestens ${MIN_LAENGE} Zeichen.` });

    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Bitte einen Namen angeben." });

    const ort = req.body?.ort;
    const lat = Number(ort?.lat);
    const lon = Number(ort?.lon);
    const label = String(ort?.label ?? "").trim();
    const ortOk = label !== "" && Number.isFinite(lat) && Number.isFinite(lon);

    setzePasswort(passwort);
    setSetting("user_name", name);
    // Der Standort ist freiwillig — ohne ihn bleibt die Wetteranzeige leer,
    // alles andere funktioniert.
    if (ortOk) {
      setSetting("wetter_label", label);
      setSetting("wetter_lat", String(lat));
      setSetting("wetter_lon", String(lon));
    }
    starteSitzung(req, res);
    res.json({ ok: true, name, ort: ortOk ? label : null });
  });

  app.post("/api/auth/anmelden", (req, res) => {
    if (!istEingerichtet()) return res.status(409).json({ error: "noch nicht eingerichtet" });

    const bis = gesperrtBis(req);
    if (bis) {
      const minuten = Math.ceil((bis - Date.now()) / 60000);
      return res.status(429).json({ error: `Zu viele Versuche. Bitte ${minuten} Minuten warten.` });
    }

    const passwort = String(req.body?.passwort ?? "");
    if (!passwortPasst(passwort)) {
      merkeFehlversuch(req);
      return res.status(401).json({ error: "Passwort stimmt nicht." });
    }
    versuche.delete(herkunft(req));
    starteSitzung(req, res);
    res.json({ ok: true });
  });

  app.post("/api/auth/abmelden", (req, res) => {
    beendeSitzung(req, res);
    res.json({ ok: true });
  });
}
