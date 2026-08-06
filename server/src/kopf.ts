import type { Express } from "express";
import { getSetting, setSetting } from "./db.js";

/**
 * Aussehen des Kopfbereichs auf der Startseite.
 *
 * Zwei Sachen, getrennt gespeichert und mit gutem Grund:
 * - `kopf_bild` — die Data-URL des Kopfbildes. Gross, aendert sich selten.
 * - `kopf_optionen` — alles andere als ein JSON-Objekt. Klein, aendert sich
 *   bei jedem Schieben eines Reglers.
 * Steckte beides in einem Feld, schickte jedes Verstellen der Deckkraft das
 * komplette Bild ueber die Leitung und schriebe es neu in die Datenbank.
 *
 * Das Bild liegt wie das Profilbild IN DER DATENBANK und nicht als Datei in
 * `data/`: nur so nehmen Sicherung, externe Spiegelung und Wiederherstellung
 * es ohne Zusatzarbeit mit (siehe db.ts — gepaart ist allein `data/tresor/`).
 */

const BILD_MAX = 900_000;
const BILD_ERLAUBT = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export type Position = "oben" | "mitte" | "unten";
export type Groesse = "kompakt" | "gross";
export type Format = "24" | "12";
export type Unterzeile = "ortszeit" | "datum" | "keine";

export interface KopfOptionen {
  /** Deckkraft des Bildes in Prozent. Nach oben begrenzt, damit die
   *  Begruessung lesbar bleibt — ein Kopfbild ist Hintergrund, keine Tapete. */
  staerke: number;
  position: Position;
  abdunkeln: number;
  weichzeichnen: number;
  groesse: Groesse;
  uhrZeigen: boolean;
  uhrSekunden: boolean;
  uhrFormat: Format;
  uhrUnterzeile: Unterzeile;
  wetterZeigen: boolean;
  wetterDetails: boolean;
  wetterOrt: boolean;
}

/** Was ohne jede Einstellung gilt — genau das heutige Aussehen. */
const VORGABE: KopfOptionen = {
  staerke: 22,
  position: "mitte",
  abdunkeln: 0,
  weichzeichnen: 0,
  groesse: "gross",
  uhrZeigen: true,
  uhrSekunden: true,
  uhrFormat: "24",
  uhrUnterzeile: "ortszeit",
  wetterZeigen: true,
  wetterDetails: true,
  wetterOrt: true,
};

const zahl = (wert: unknown, von: number, bis: number, ersatz: number): number => {
  const n = Number(wert);
  if (!Number.isFinite(n)) return ersatz;
  return Math.min(bis, Math.max(von, Math.round(n)));
};

const ausWahl = <T extends string>(wert: unknown, erlaubt: readonly T[], ersatz: T): T =>
  erlaubt.includes(wert as T) ? (wert as T) : ersatz;

/**
 * Rohwerte auf gueltige Einstellungen bringen.
 *
 * Wird auf BEIDEN Wegen gebraucht: beim Lesen (in der Datenbank koennte nach
 * einem Rueckspielen einer alten Sicherung ein Feld fehlen) und beim
 * Schreiben. Deshalb eine Funktion und nicht zwei.
 */
function saeubern(roh: unknown, grundlage: KopfOptionen = VORGABE): KopfOptionen {
  const o = (roh ?? {}) as Record<string, unknown>;
  const nimm = <K extends keyof KopfOptionen>(k: K) => (k in o ? o[k] : grundlage[k]);
  return {
    staerke: zahl(nimm("staerke"), 0, 60, grundlage.staerke),
    position: ausWahl(nimm("position"), ["oben", "mitte", "unten"] as const, grundlage.position),
    abdunkeln: zahl(nimm("abdunkeln"), 0, 80, grundlage.abdunkeln),
    weichzeichnen: zahl(nimm("weichzeichnen"), 0, 20, grundlage.weichzeichnen),
    groesse: ausWahl(nimm("groesse"), ["kompakt", "gross"] as const, grundlage.groesse),
    uhrZeigen: Boolean(nimm("uhrZeigen")),
    uhrSekunden: Boolean(nimm("uhrSekunden")),
    uhrFormat: ausWahl(nimm("uhrFormat"), ["24", "12"] as const, grundlage.uhrFormat),
    uhrUnterzeile: ausWahl(nimm("uhrUnterzeile"), ["ortszeit", "datum", "keine"] as const, grundlage.uhrUnterzeile),
    wetterZeigen: Boolean(nimm("wetterZeigen")),
    wetterDetails: Boolean(nimm("wetterDetails")),
    wetterOrt: Boolean(nimm("wetterOrt")),
  };
}

function gespeicherteOptionen(): KopfOptionen {
  const roh = getSetting("kopf_optionen");
  if (!roh) return VORGABE;
  try {
    return saeubern(JSON.parse(roh));
  } catch {
    // Kaputtes JSON ist kein Grund, den Kopfbereich nicht anzuzeigen.
    return VORGABE;
  }
}

export function kopfRouten(app: Express): void {
  app.get("/api/kopf", (_req, res) => {
    res.json({ bild: getSetting("kopf_bild") || null, ...gespeicherteOptionen() });
  });

  /**
   * Teilweise Aenderung, genau wie bei `/api/me`: nur was im Rumpf steht,
   * wird angefasst. `bild: null` loescht — deshalb `in`-Pruefung statt
   * Wahrheitswert, sonst liesse sich das Bild nie wieder loswerden.
   */
  app.put("/api/kopf", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if ("bild" in body) {
      const bild = body.bild;
      if (bild === null || bild === "") {
        setSetting("kopf_bild", "");
      } else if (typeof bild !== "string" || !BILD_ERLAUBT.test(bild)) {
        return res.status(400).json({ error: "Das ist kein gültiges Bild (PNG, JPEG oder WebP)." });
      } else if (bild.length > BILD_MAX) {
        return res.status(413).json({ error: "Das Bild ist zu groß." });
      } else {
        setSetting("kopf_bild", bild);
      }
    }

    // Bestehende Werte als Grundlage: wer nur `staerke` schickt, soll nicht
    // alle anderen Einstellungen auf die Vorgabe zuruecksetzen.
    const neu = saeubern(body, gespeicherteOptionen());
    setSetting("kopf_optionen", JSON.stringify(neu));

    res.json({ bild: getSetting("kopf_bild") || null, ...neu });
  });
}
