import crypto from "node:crypto";

/*
 * Kontoauszuege als CSV lesen.
 *
 * Jede Bank exportiert anders: Commerzbank, Sparkasse, ING, DKB und PayPal
 * benennen ihre Spalten verschieden, manche stellen Kopfzeilen mit Kontodaten
 * davor, manche trennen mit Semikolon, PayPal mit Komma. Statt fuer jede Bank
 * ein eigenes Format zu pflegen, sucht der Leser die Kopfzeile selbst und
 * ordnet die Spalten ueber ihre Namen zu. Was er nicht erkennt, meldet er im
 * Klartext — er raet nicht.
 */

export interface AuszugZeile {
  /** Stabiler Fingerabdruck — dieselbe Zeile ergibt beim zweiten Import denselben Wert. */
  ref: string;
  datum: string;            // YYYY-MM-DD
  art: "eingang" | "ausgang";
  betrag: number;           // immer positiv, die Richtung steht in `art`
  empfaenger: string | null;
  notiz: string | null;
}

export interface Auszug {
  trennzeichen: string;
  /** Welche Kopfspalte wofuer genommen wurde — fuer die Anzeige. */
  spalten: { datum: string; betrag: string; empfaenger: string | null; zweck: string | null };
  zeilen: AuszugZeile[];
  /** Zeilen unterhalb der Kopfzeile ohne gueltiges Datum oder ohne Betrag. */
  uebersprungen: number;
}

/** Kleinbuchstaben, Umlaute ausgeschrieben, nur Buchstaben — fuer Spaltennamen. */
function falte(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z]/g, "");
}

/** CSV mit Anfuehrungszeichen, verdoppelten "" und Zeilenumbruechen in Feldern. */
function zerlege(text: string, trenner: string): string[][] {
  const out: string[][] = [];
  let zeile: string[] = [];
  let feld = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { feld += '"'; i++; }
        else inQuote = false;
      } else feld += c;
    } else if (c === '"') inQuote = true;
    else if (c === trenner) { zeile.push(feld); feld = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      zeile.push(feld);
      out.push(zeile);
      zeile = [];
      feld = "";
    } else feld += c;
  }
  if (feld || zeile.length) { zeile.push(feld); out.push(zeile); }
  return out.map((z) => z.map((f) => f.trim()));
}

/** Das Trennzeichen, das in den ersten Zeilen am haeufigsten vorkommt. */
function trennzeichen(text: string): string {
  const probe = text.split(/\r?\n/).slice(0, 40).join("\n");
  let bestes = ";";
  let max = -1;
  for (const t of [";", "\t", ","]) {
    // Inhalt in Anfuehrungszeichen nicht mitzaehlen — "1,50" ist kein Trenner.
    const n = probe.replace(/"[^"]*"/g, "").split(t).length;
    if (n > max) { max = n; bestes = t; }
  }
  return bestes;
}

// Spaltennamen in Vorrang-Reihenfolge, gefaltet. Der erste Treffer gewinnt —
// deshalb steht "buchungstag" vor "valuta"/"wertstellung", die nie gemeint sind.
const DATUM = ["buchungstag", "buchungsdatum", "datum", "date", "bookingdate"];
const BETRAG = ["betrag", "betrageur", "betragineur", "umsatz", "umsatzineur", "amount", "brutto"];
const SOLL = ["soll", "sollineur", "lastschrift", "ausgang", "belastung"];
const HABEN = ["haben", "habenineur", "gutschrift", "eingang"];
const EMPFAENGER = [
  "beguenstigterzahlungspflichtiger", "zahlungsempfaengerin", "zahlungspflichtiger",
  "auftraggeberempfaenger", "auftraggeberbeguenstigter", "empfaenger", "beguenstigter",
  "zahlungsempfaenger", "auftraggeber", "name", "payee", "gegenkontoname",
];
const ZWECK = ["verwendungszweck", "buchungstext", "beschreibung", "description", "betreff", "text", "vorgang"];

function finde(kopf: string[], namen: string[], schonVergeben: Set<number>): number {
  const gefaltet = kopf.map(falte);
  for (const n of namen) {
    const i = gefaltet.findIndex((k, idx) => k === n && !schonVergeben.has(idx));
    if (i >= 0) return i;
  }
  // Zweiter Durchgang: "Betrag (EUR)" o. ae. — Name steckt am Anfang.
  for (const n of namen) {
    const i = gefaltet.findIndex((k, idx) => k.startsWith(n) && !schonVergeben.has(idx));
    if (i >= 0) return i;
  }
  return -1;
}

/** "01.10.2026", "01.10.26", "2026-10-01", "01/10/2026" -> "2026-10-01". */
function datum(s: string): string | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return gueltig(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(s);
  if (!m) return null;
  const jahr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return gueltig(jahr, +m[2], +m[1]);
}

function gueltig(j: number, m: number, t: number): string | null {
  const d = new Date(j, m - 1, t);
  if (d.getFullYear() !== j || d.getMonth() !== m - 1 || d.getDate() !== t) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j}-${p(m)}-${p(t)}`;
}

/**
 * "-1.234,56", "1234,56-", "1,234.56", "+12,50 EUR" -> Zahl mit Vorzeichen.
 * Das zuletzt stehende Satzzeichen ist das Dezimaltrennzeichen; steht nur ein
 * Punkt mit genau drei Ziffern dahinter, ist er ein Tausenderpunkt.
 */
export function betrag(s: string): number {
  let t = s.replace(/\s|€|eur/gi, "");
  if (!t) return NaN;
  let vorzeichen = 1;
  if (/-$/.test(t)) { vorzeichen = -1; t = t.slice(0, -1); }
  if (/^-/.test(t)) { vorzeichen = -vorzeichen; t = t.slice(1); }
  t = t.replace(/^\+/, "");
  const komma = t.lastIndexOf(",");
  const punkt = t.lastIndexOf(".");
  if (komma > punkt) t = t.replace(/\./g, "").replace(",", ".");
  else if (punkt > komma && komma >= 0) t = t.replace(/,/g, "");
  else if (punkt >= 0 && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return vorzeichen * Number(t);
}

// Woran ein Buchungstext hinter dem Namen weitergeht — dort wird abgeschnitten,
// wenn die Bank keine eigene Empfaengerspalte liefert (Commerzbank).
const NACH_DEM_NAMEN =
  /\s(End-to-End|Mandatsref|Mandat|Glaeubiger|Gläubiger|Kundenreferenz|Kartenzahlung|Dat\.u\.Zeit|IBAN|BIC|Kd-?Nr|Kundennr|Rechnung|Ref\.|SEPA|\d{6,})/i;

function nameAusText(text: string): string | null {
  const vorn = text.split(NACH_DEM_NAMEN)[0].trim();
  if (!vorn) return null;
  if (vorn.length <= 40) return vorn;
  const kurz = vorn.slice(0, 40);
  return kurz.slice(0, kurz.lastIndexOf(" ") > 15 ? kurz.lastIndexOf(" ") : 40).trim();
}

/** Liest einen Auszug. Wirft mit einer lesbaren Meldung, wenn er nichts erkennt. */
export function leseAuszug(text: string): Auszug {
  const sauber = text.replace(/^﻿/, "");
  const trenner = trennzeichen(sauber);
  const zeilen = zerlege(sauber, trenner);

  // Kopfzeile: die erste, die eine Datums- und eine Betragsspalte hat. Davor
  // stehen bei manchen Banken Kontonummer, Zeitraum und Saldo.
  let kopfIdx = -1;
  for (let i = 0; i < Math.min(zeilen.length, 40); i++) {
    const leer = new Set<number>();
    const hatBetrag =
      finde(zeilen[i], BETRAG, leer) >= 0 ||
      (finde(zeilen[i], SOLL, leer) >= 0 && finde(zeilen[i], HABEN, leer) >= 0);
    if (finde(zeilen[i], DATUM, leer) >= 0 && hatBetrag) { kopfIdx = i; break; }
  }
  if (kopfIdx < 0)
    throw new Error("Keine Kopfzeile mit Datum und Betrag gefunden. Ist das ein Umsatz-Export als CSV?");

  const kopf = zeilen[kopfIdx];
  const vergeben = new Set<number>();
  const nimm = (namen: string[]) => {
    const i = finde(kopf, namen, vergeben);
    if (i >= 0) vergeben.add(i);
    return i;
  };
  const iDatum = nimm(DATUM);
  const iBetrag = nimm(BETRAG);
  const iSoll = iBetrag < 0 ? nimm(SOLL) : -1;
  const iHaben = iBetrag < 0 ? nimm(HABEN) : -1;
  const iEmpf = nimm(EMPFAENGER);
  const iZweck = nimm(ZWECK);

  const out: AuszugZeile[] = [];
  const gesehen = new Map<string, number>();
  let uebersprungen = 0;

  for (const z of zeilen.slice(kopfIdx + 1)) {
    if (z.every((f) => !f)) continue;
    const d = datum(z[iDatum] ?? "");
    let wert: number;
    if (iBetrag >= 0) wert = betrag(z[iBetrag] ?? "");
    else {
      // Getrennte Spalten: Soll ist ausgehend, egal ob die Bank es mit Minus schreibt.
      const soll = Math.abs(betrag(z[iSoll] ?? "") || 0);
      const haben = Math.abs(betrag(z[iHaben] ?? "") || 0);
      wert = haben - soll;
    }
    if (!d || !Number.isFinite(wert) || wert === 0) { uebersprungen++; continue; }

    const zweck = iZweck >= 0 ? (z[iZweck] || "").replace(/\s+/g, " ") : "";
    const empf = (iEmpf >= 0 && z[iEmpf]) ? z[iEmpf].replace(/\s+/g, " ") : nameAusText(zweck);
    const cent = Math.round(Math.abs(wert) * 100);

    // Zwei gleiche Kaffees am selben Tag sind zwei Buchungen. Deshalb zaehlt
    // das wievielte Vorkommen mit — so bleiben beide unterscheidbar und beim
    // erneuten Import trotzdem wiedererkennbar.
    const schluessel = [d, Math.sign(wert), cent, (empf ?? "").toLowerCase(), zweck.toLowerCase()].join("|");
    const n = (gesehen.get(schluessel) ?? 0) + 1;
    gesehen.set(schluessel, n);
    const ref = crypto.createHash("sha1").update(`${schluessel}|${n}`).digest("hex").slice(0, 24);

    out.push({
      ref,
      datum: d,
      art: wert > 0 ? "eingang" : "ausgang",
      betrag: cent / 100,
      empfaenger: empf ? empf.slice(0, 80) : null,
      notiz: zweck ? zweck.slice(0, 300) : null,
    });
  }

  if (out.length === 0)
    throw new Error("Die Kopfzeile wurde erkannt, aber darunter stehen keine lesbaren Umsätze.");

  return {
    trennzeichen: trenner === "\t" ? "Tab" : trenner,
    spalten: {
      datum: kopf[iDatum],
      betrag: iBetrag >= 0 ? kopf[iBetrag] : `${kopf[iSoll] ?? "?"} / ${kopf[iHaben] ?? "?"}`,
      empfaenger: iEmpf >= 0 ? kopf[iEmpf] : null,
      zweck: iZweck >= 0 ? kopf[iZweck] : null,
    },
    zeilen: out,
    uebersprungen,
  };
}
