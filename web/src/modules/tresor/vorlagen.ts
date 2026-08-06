/**
 * Vorlagen fuer die Nummern, die man einmal im Jahr braucht und nie zur Hand
 * hat. Jede Vorlage weiss, wie ihre Nummer aussieht, wie sie sich lesbar
 * gruppieren laesst und ob die Pruefziffer stimmt.
 *
 * Die Pruefung sagt Bescheid, sie blockiert nicht. Wer eine Nummer aus einem
 * alten Bescheid abtippt, deren Format keiner Regel folgt, soll sie trotzdem
 * speichern koennen — der Tresor ist eine Ablage, kein Formular vom Amt.
 */

export type Kategorie = "amtlich" | "versicherung" | "bank" | "dokument" | "sonstiges";

export const KATEGORIEN: { id: Kategorie; titel: string }[] = [
  { id: "amtlich", titel: "Amtliche Nummern" },
  { id: "versicherung", titel: "Versicherung" },
  { id: "bank", titel: "Bank & Finanzen" },
  { id: "dokument", titel: "Ausweise & Dokumente" },
  { id: "sonstiges", titel: "Sonstiges" },
];

export interface Pruefergebnis {
  ok: boolean;
  text: string;
}

export interface Vorlage {
  id: string;
  titel: string;
  kategorie: Kategorie;
  /** Vorschlag fuer die Beschriftung des Eintrags. */
  bezeichnung: string;
  platzhalter: string;
  hinweis?: string;
  /** Ablaufdatum im Formular vorschlagen (Ausweise, Paesse). */
  ablauf?: boolean;
  /** Rohform zum Speichern — ohne Leerzeichen, Grossbuchstaben. */
  normalisiere?: (w: string) => string;
  /** Lesbare Gruppierung fuer die Anzeige. */
  formatiere?: (w: string) => string;
  pruefe?: (w: string) => Pruefergebnis | null;
}

// --- Bausteine ------------------------------------------------------------

const nurZiffern = (w: string) => w.replace(/\D/g, "");
const ohneLeer = (w: string) => w.replace(/\s/g, "").toUpperCase();
const gruppiere = (w: string, n: number) => (w.match(new RegExp(`.{1,${n}}`, "g")) ?? []).join(" ");
const quersumme = (n: number) => Math.floor(n / 10) + (n % 10);
/** Buchstabe -> zweistellige Ordnungszahl (A=01 … Z=26). */
const buchstabenwert = (c: string) => String(c.charCodeAt(0) - 64).padStart(2, "0");

/**
 * ISO 7064 MOD 11,10 — die Pruefziffer der steuerlichen Identifikationsnummer.
 */
function mod11_10(ziffern: string): number {
  let p = 10;
  for (const z of ziffern) {
    const m = (Number(z) + p) % 10 || 10;
    p = (2 * m) % 11;
  }
  return (11 - p) % 10;
}

// --- Vorlagen -------------------------------------------------------------

export const VORLAGEN: Vorlage[] = [
  {
    id: "frei",
    titel: "Freier Eintrag",
    kategorie: "sonstiges",
    bezeichnung: "",
    platzhalter: "Wert",
  },
  {
    id: "steuer_id",
    titel: "Steuerliche Identifikationsnummer",
    kategorie: "amtlich",
    bezeichnung: "Steuer-ID",
    platzhalter: "12 345 678 901",
    hinweis: "11 Ziffern, lebenslang gleich — steht im Schreiben vom Bundeszentralamt für Steuern.",
    normalisiere: nurZiffern,
    formatiere: (w) => w.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4"),
    pruefe: (w) => {
      const z = nurZiffern(w);
      if (z.length !== 11) return { ok: false, text: `${z.length} statt 11 Ziffern.` };
      if (z[0] === "0") return { ok: false, text: "Eine Steuer-ID beginnt nie mit 0." };
      if (mod11_10(z.slice(0, 10)) !== Number(z[10]))
        return { ok: false, text: "Die Prüfziffer passt nicht — bitte noch einmal vergleichen." };
      return { ok: true, text: "Prüfziffer stimmt." };
    },
  },
  {
    id: "steuernummer",
    titel: "Steuernummer (Finanzamt)",
    kategorie: "amtlich",
    bezeichnung: "Steuernummer",
    platzhalter: "123/456/78901",
    hinweis: "Die Nummer des Finanzamts — anders als die Steuer-ID ändert sie sich beim Umzug.",
    normalisiere: (w) => w.replace(/[^\d/]/g, ""),
    pruefe: (w) => {
      const z = nurZiffern(w);
      if (z.length < 10 || z.length > 13)
        return { ok: false, text: `${z.length} Ziffern — üblich sind 10 bis 13 (je nach Bundesland).` };
      return { ok: true, text: "Länge plausibel." };
    },
  },
  {
    id: "sozialversicherung",
    titel: "Sozialversicherungsnummer",
    kategorie: "versicherung",
    bezeichnung: "Sozialversicherungsnummer",
    platzhalter: "65 170839 J 003",
    hinweis:
      "Auch Rentenversicherungsnummer: Bereich (2) + Geburtsdatum TTMMJJ + Anfangsbuchstabe des Geburtsnamens + Seriennummer (2) + Prüfziffer.",
    normalisiere: ohneLeer,
    formatiere: (w) => w.replace(/^(.{2})(.{6})(.{1})(.{2})(.{1})$/, "$1 $2 $3 $4$5"),
    pruefe: (w) => {
      const v = ohneLeer(w);
      if (v.length !== 12) return { ok: false, text: `${v.length} statt 12 Zeichen.` };
      if (!/^\d{8}[A-Z]\d{3}$/.test(v))
        return { ok: false, text: "Erwartet: 8 Ziffern, ein Buchstabe, 3 Ziffern." };
      const tag = Number(v.slice(2, 4));
      const monat = Number(v.slice(4, 6));
      if (monat < 1 || monat > 12 || tag < 1 || tag > 31)
        return { ok: false, text: "Die Stellen 3–8 sind kein gültiges Geburtsdatum (TTMMJJ)." };
      const ziffern = v.slice(0, 8) + buchstabenwert(v[8]) + v.slice(9, 11);
      const gewichte = [2, 1, 2, 5, 7, 1, 2, 1, 2, 1, 2, 1];
      const summe = [...ziffern].reduce((s, z, i) => s + quersumme(Number(z) * gewichte[i]), 0);
      if (summe % 10 !== Number(v[11]))
        return { ok: false, text: "Die Prüfziffer passt nicht — bitte noch einmal vergleichen." };
      return { ok: true, text: "Prüfziffer stimmt." };
    },
  },
  {
    id: "krankenversicherung",
    titel: "Krankenversichertennummer",
    kategorie: "versicherung",
    bezeichnung: "Krankenversichertennummer",
    platzhalter: "A123456780",
    hinweis: "Steht auf der Gesundheitskarte: ein Buchstabe und neun Ziffern.",
    normalisiere: ohneLeer,
    pruefe: (w) => {
      const v = ohneLeer(w);
      if (!/^[A-Z]\d{9}$/.test(v))
        return { ok: false, text: "Erwartet: ein Buchstabe, dann neun Ziffern." };
      const ziffern = buchstabenwert(v[0]) + v.slice(1, 9);
      const summe = [...ziffern].reduce(
        (s, z, i) => s + quersumme(Number(z) * (i % 2 === 0 ? 1 : 2)),
        0
      );
      if (summe % 10 !== Number(v[9]))
        return { ok: false, text: "Die Prüfziffer passt nicht — bitte noch einmal vergleichen." };
      return { ok: true, text: "Prüfziffer stimmt." };
    },
  },
  {
    id: "iban",
    titel: "IBAN",
    kategorie: "bank",
    bezeichnung: "IBAN",
    platzhalter: "DE02 1203 0000 0000 2020 51",
    normalisiere: ohneLeer,
    formatiere: (w) => gruppiere(w, 4),
    pruefe: (w) => {
      const v = ohneLeer(w);
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v))
        return { ok: false, text: "Das sieht nicht nach einer IBAN aus." };
      if (v.startsWith("DE") && v.length !== 22)
        return { ok: false, text: `Eine deutsche IBAN hat 22 Zeichen, diese hat ${v.length}.` };
      const gedreht = v.slice(4) + v.slice(0, 4);
      const zahl = [...gedreht]
        .map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55)))
        .join("");
      // Stueckweise Modulo, weil die Zahl fuer Number viel zu gross ist.
      let rest = 0;
      for (const z of zahl) rest = (rest * 10 + Number(z)) % 97;
      if (rest !== 1) return { ok: false, text: "Die Prüfziffer passt nicht — bitte vergleichen." };
      return { ok: true, text: "Prüfziffer stimmt." };
    },
  },
  {
    id: "personalausweis",
    titel: "Personalausweis",
    kategorie: "dokument",
    bezeichnung: "Personalausweis",
    platzhalter: "T220001293",
    hinweis: "Die Ausweisnummer inklusive der letzten Ziffer (Prüfziffer). Gültigkeit nicht vergessen.",
    ablauf: true,
    normalisiere: ohneLeer,
    pruefe: (w) => ausweisPruefung(w, "Ausweisnummer"),
  },
  {
    id: "reisepass",
    titel: "Reisepass",
    kategorie: "dokument",
    bezeichnung: "Reisepass",
    platzhalter: "C01X00T47",
    hinweis: "Passnummer mit Prüfziffer. Bei Reisen zählt die Gültigkeit oft plus sechs Monate.",
    ablauf: true,
    normalisiere: ohneLeer,
    pruefe: (w) => ausweisPruefung(w, "Passnummer"),
  },
  {
    id: "fuehrerschein",
    titel: "Führerschein",
    kategorie: "dokument",
    bezeichnung: "Führerschein",
    platzhalter: "B072RRE2I55",
    hinweis: "Kartenführerscheine laufen ab — Ablaufdatum lohnt sich hier.",
    ablauf: true,
    normalisiere: ohneLeer,
  },
];

/**
 * Ausweis- und Passnummern tragen ihre Pruefziffer am Ende und rechnen mit den
 * Gewichten 7-3-1 (Buchstaben zaehlen als A=10 … Z=35).
 */
function ausweisPruefung(w: string, was: string): Pruefergebnis | null {
  const v = ohneLeer(w);
  if (v.length !== 10)
    return { ok: false, text: `${v.length} statt 10 Zeichen — die ${was} enthält die Prüfziffer am Ende.` };
  const wert = (c: string) => (/\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
  const gewichte = [7, 3, 1];
  const summe = [...v.slice(0, 9)].reduce((s, c, i) => s + wert(c) * gewichte[i % 3], 0);
  if (summe % 10 !== Number(v[9]))
    return { ok: false, text: "Die Prüfziffer passt nicht — bitte noch einmal vergleichen." };
  return { ok: true, text: "Prüfziffer stimmt." };
}

export const vorlage = (id: string): Vorlage => VORLAGEN.find((v) => v.id === id) ?? VORLAGEN[0];

export const kategorieTitel = (id: string): string =>
  KATEGORIEN.find((k) => k.id === id)?.titel ?? "Sonstiges";

/** Wert so anzeigen, wie man ihn vorliest — nicht als Ziffernwurst. */
export function anzeigeWert(wert: string, vorlagenId: string): string {
  const v = vorlage(vorlagenId);
  if (!v.formatiere) return wert;
  try {
    return v.formatiere(v.normalisiere ? v.normalisiere(wert) : wert) || wert;
  } catch {
    return wert;
  }
}
