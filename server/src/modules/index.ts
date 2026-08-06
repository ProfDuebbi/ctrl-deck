import type { Router } from "express";
import { db } from "../db.js";

/**
 * Ein Termin, wie ihn ein Modul an den gemeinsamen Terminfaden meldet.
 *
 * Absichtlich flach und ohne Bezug zur Herkunftstabelle: Der Faden soll
 * sortieren und anzeigen koennen, ohne irgendetwas ueber Geburtstage,
 * Kuendigungsfristen oder Zahltage zu wissen.
 */
export interface Termin {
  /** Eindeutig ueber alle Module: `<modul>:<art>:<id>`. */
  id: string;
  /** YYYY-MM-DD, immer lokal gerechnet. */
  datum: string;
  /** HH:MM, falls es eine Uhrzeit gibt. */
  zeit?: string | null;
  titel: string;
  notiz?: string | null;
  /** Grobe Sorte — bestimmt Symbol und Sortierung bei Gleichstand. */
  art: "geburtstag" | "aufgabe" | "frist" | "ablauf" | "zahltag";
  /** Modul-Kennung, damit man von dort aus hinspringen kann. */
  modul: string;
  dringend?: boolean;
}

/** Ein Suchtreffer, wie ihn ein Modul an die globale Suche meldet. */
export interface Treffer {
  /** Eindeutig ueber alle Module: `<modul>:<art>:<id>`. */
  id: string;
  titel: string;
  /** Zweite Zeile: wo der Treffer sitzt, oder was drinsteht. */
  untertitel?: string | null;
  /** Modul-Kennung — die Suche springt beim Anklicken dorthin. */
  modul: string;
  /** Grobe Einordnung fuer die Anzeige („Aufgabe", „Buchung", …). */
  art: string;
  /** Datum, falls der Treffer eines hat — sortiert Gleichrangiges. */
  datum?: string | null;
}

/**
 * Eine Kennzahl fuers Profil — eine Zahl, die man sonst nur nach mehreren
 * Klicks in einem Modul zu sehen bekommt.
 *
 * `wert` ist FERTIG FORMATIERT. Das Modul kennt seine Einheit („12,5 h",
 * „432,10 €", „1.204 km"); die Profilseite soll nicht raten muessen, wo ein
 * Komma und wo ein Euro hingehoert.
 */
export interface ProfilZahl {
  /** Eindeutig ueber alle Module: `<modul>:<schluessel>`. */
  id: string;
  wert: string;
  label: string;
  /** Kleine zweite Zeile: der Kontext, ohne den die Zahl ein Raetsel bleibt. */
  hinweis?: string | null;
  /**
   * Faerbung. `neutral` ist der Normalfall — Farbe bedeutet hier etwas
   * (Regel 3 in theme.css) und ist keine Dekoration.
   */
  ton?: "neutral" | "gut" | "achtung" | "schlecht";
}

/** Ein zurueckliegendes Ereignis fuer den Verlauf („Zuletzt passiert"). */
export interface ProfilEreignis {
  /** Eindeutig ueber alle Module: `<modul>:<art>:<id>`. */
  id: string;
  /** YYYY-MM-DD, immer lokal gerechnet. */
  datum: string;
  titel: string;
  /** Zweite Zeile: Betrag, Dauer, Fahrzeug — was den Eintrag erklaert. */
  detail?: string | null;
  /** Wort fuer die Anzeige: „Aufgabe erledigt", „Buchung", „Ablesung". */
  art: string;
  modul: string;
}

/** Was ein Modul zum Profil beitraegt. Alles darin ist freiwillig. */
export interface ProfilBeitrag {
  zahlen?: ProfilZahl[];
  /**
   * Tage, an denen in diesem Modul etwas passiert ist: `{ "2026-08-05": 3 }`.
   * Nur Tage mit Aktivitaet — Nullen blaehen die Antwort auf, ohne etwas zu
   * sagen. Futter fuers Aktivitaetsraster.
   */
  tage?: Record<string, number>;
  ereignisse?: ProfilEreignis[];
  /**
   * Frueheste Spur, die dieses Modul kennt (YYYY-MM-DD). Das Profil bildet
   * daraus „dabei seit" — eine Angabe, die sonst nirgends steht, weil das
   * Programm nie einen Geburtstag von sich selbst notiert hat.
   */
  seit?: string | null;
}

/** Kennfarben, die die Oberflaeche kennt (siehe theme.css, Regel 3). */
export type Akzent = "blue" | "pink" | "violet" | "green" | "amber" | "red";

/** Ein Messpunkt. `x` ist die Beschriftung (Monat, Kategorie, Name). */
export interface Messpunkt {
  x: string;
  y: number;
}

export interface Reihe {
  id: string;
  name: string;
  /**
   * Feste Kennfarbe DIESER Reihe — etwa die Projektfarbe aus der Stechuhr.
   * Ohne Angabe faerbt die Ansicht nach ihrer festen Reihenfolge.
   *
   * Wichtig: Farbe folgt der SACHE, nie ihrem Rang. Wer eine Reihe wegfiltert,
   * darf die uebrigen nicht umfaerben — sonst ist „Umbau ist blau" gelogen.
   */
  farbe?: Akzent | null;
  punkte: Messpunkt[];
}

/**
 * Die vier Formen, die dieses Dashboard braucht. Bewusst KEINE Torte:
 * bei nahe beieinanderliegenden Werten ist sie unlesbar, und alles, wofuer
 * man sie nehmen wuerde, kann ein liegender Balken besser.
 *
 *  - `verlauf` : Entwicklung ueber die Zeit (Flaeche bei einer Reihe)
 *  - `balken`  : Groessenvergleich benannter Posten, liegend und sortiert
 *  - `anteil`  : Teil vom Ganzen als EIN liegender Stapel
 *  - `spiegel` : ueber/unter einer Nulllinie (Einnahmen gegen Ausgaben)
 */
export type Diagrammform = "verlauf" | "balken" | "anteil" | "spiegel";

/**
 * Einheit der Y-Werte. Die Ansicht formatiert daraus Achse und Kurzinfo —
 * `minuten` wird zu Stunden, `euro` bekommt Tausenderpunkte.
 */
export type Einheit = "minuten" | "euro" | "anzahl" | "km" | "liter" | string;

export interface Diagramm {
  /** Eindeutig ueber alle Module: `<modul>:<name>`. */
  id: string;
  /** Setzt der Sammler. */
  modul?: string;
  titel: string;
  /** Zweite Zeile: was man hier eigentlich sieht. */
  hinweis?: string | null;
  form: Diagrammform;
  einheit: Einheit;
  reihen: Reihe[];
  /**
   * Die eine Zahl, mit der das Bild ueberschrieben ist. Ein Diagramm ohne
   * Kopfzahl zwingt zum Ablesen der Achse, um „wie viel denn nun?" zu
   * beantworten.
   */
  kennzahl?: { wert: string; label: string } | null;
  /** Platz im Raster. `voll` fuer breite Zeitreihen. */
  breite?: "halb" | "voll";
}

/**
 * Zaehlt je Tag die Zeilen einer Tabelle — der Normalfall fuer `tage`.
 *
 * Steht hier und nicht im Profil-Modul, weil sonst jedes Modul dieselben
 * sechs Zeilen SQL noch einmal schriebe. `ausdruck` ist bewusst roh: manche
 * Tabellen speichern schon ein lokales `datum`, andere ein UTC-`created_at`,
 * das erst durch `date(..., 'localtime')` muss (siehe CLAUDE.md, „Datum").
 */
export function tageZaehlen(
  tabelle: string,
  ausdruck: string,
  von: string,
  bis: string,
  wo = ""
): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT ${ausdruck} AS tag, COUNT(*) AS n FROM ${tabelle}
        WHERE ${ausdruck} BETWEEN ? AND ? ${wo ? `AND ${wo}` : ""}
        GROUP BY tag`
    )
    .all(von, bis) as { tag: string | null; n: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) if (r.tag) out[r.tag] = r.n;
  return out;
}

/**
 * Alle Monate von `von` bis `bis` als YYYY-MM — LUECKENLOS.
 *
 * Das Lueckenlose ist der ganze Zweck: Ein Monat ohne Eintrag muss als Null
 * im Bild stehen, nicht fehlen. Eine Zeitachse, die leere Monate ueberspringt,
 * behauptet einen gleichmaessigen Verlauf, den es nicht gab.
 */
export function monatsReihe(von: string, bis: string): string[] {
  let [j, m] = von.slice(0, 7).split("-").map(Number);
  const ende = bis.slice(0, 7);
  const out: string[] = [];
  // Harte Obergrenze, damit ein krummes Startdatum keine Endlosschleife baut.
  for (let i = 0; i < 1500; i++) {
    const p = `${j}-${String(m).padStart(2, "0")}`;
    if (p > ende) break;
    out.push(p);
    if (++m > 12) { m = 1; j++; }
  }
  return out;
}

/**
 * Summiert `wert` je Monat und fuellt fehlende Monate mit 0.
 *
 * `wert` ist roh (`SUM(minuten)`, `COUNT(*)`, `SUM(betrag)`), weil jedes Modul
 * etwas anderes zaehlt. `datum` muss ein lokales YYYY-MM-DD liefern — bei
 * UTC-Zeitstempeln also `date(spalte, 'localtime')` uebergeben.
 */
export function jeMonat(
  tabelle: string,
  datum: string,
  wert: string,
  von: string,
  bis: string,
  wo = ""
): Messpunkt[] {
  const rows = db
    .prepare(
      `SELECT substr(${datum}, 1, 7) AS monat, ${wert} AS y FROM ${tabelle}
        WHERE ${datum} BETWEEN ? AND ? ${wo ? `AND ${wo}` : ""}
        GROUP BY monat`
    )
    .all(von, bis) as { monat: string; y: number | null }[];
  const gefunden = new Map(rows.map((r) => [r.monat, r.y ?? 0]));
  // Bei „alles" faengt das Fenster im Jahr 1 an — dann beginnt die Achse beim
  // ersten echten Wert statt bei zweitausend leeren Monaten.
  const start = von < "1900-01-01" ? (rows.map((r) => r.monat).sort()[0] ?? bis.slice(0, 7)) : von;
  return monatsReihe(start, bis).map((monat) => ({ x: monat, y: gefunden.get(monat) ?? 0 }));
}

/** Kleinstes Datum aus einer Spalte, oder null bei leerer Tabelle. */
export function fruehestes(tabelle: string, ausdruck: string): string | null {
  const r = db.prepare(`SELECT MIN(${ausdruck}) AS d FROM ${tabelle}`).get() as { d: string | null };
  return r?.d ?? null;
}

/**
 * Ein Backend-Modul kapselt seine eigenen API-Routen (und legt bei Bedarf
 * eigene DB-Tabellen an). Neue Features registrieren sich einfach hier.
 */
export interface ServerModule {
  id: string; // z.B. "laermprotokoll"
  title: string; // Anzeigename
  router: Router; // wird unter /api/<id> eingehaengt
  /**
   * Optional: Was steht in diesem Modul zwischen `von` und `bis` an?
   *
   * So bleibt der Terminfaden dumm und die Module bleiben Herr ihrer Daten —
   * er fragt die Registry, statt in fremde Tabellen zu greifen. Ein Modul
   * ohne Datumsbezug (Stechuhr, Wetter) laesst das einfach weg.
   *
   * Zaehlerstaende melden bewusst NICHTS: Strom und Gas liest hier einmal im
   * Jahr der Hausmeister ab — „bitte ablesen"-Termine waeren sinnlos.
   */
  termine?: (von: string, bis: string) => Termin[];
  /**
   * Optional: Was in diesem Modul passt zu `begriff`?
   *
   * Gleiche Machart wie `termine` — die Suche bleibt dumm, die Module bleiben
   * Herr ihrer Daten. `grenze` ist die Obergrenze je Modul, damit ein
   * datenreiches Modul die Trefferliste nicht allein fuellt.
   *
   * Der TRESOR meldet bewusst NICHTS: Titel, Werte und Notizen liegen dort
   * ausschliesslich als Chiffrat. Eine Volltextsuche darueber koennte es nur
   * geben, wenn der Server die Klartexte kennt — und genau das soll er nie.
   */
  suche?: (begriff: string, grenze: number) => Treffer[];
  /**
   * Optional: Was hat dieses Modul zwischen `von` und `bis` zu erzaehlen?
   *
   * Dritter Sammler nach `termine` und `suche`, gleiche Machart: Das Profil
   * bleibt dumm, die Module bleiben Herr ihrer Daten und ihrer Einheiten.
   *
   * Der TRESOR meldet nur ANZAHLEN — Titel und Werte liegen dort als Chiffrat,
   * und die Profilseite ist kein Ort, an dem Klartext auftauchen darf.
   */
  profil?: (von: string, bis: string) => ProfilBeitrag;
  /**
   * Optional: Was laesst sich in diesem Modul als Bild zeigen?
   *
   * Vierter Sammler nach `termine`, `suche` und `profil`. Ein Modul liefert
   * fertige Reihen mit seiner eigenen Einheit — die Diagrammansicht zeichnet
   * nur, sie rechnet nichts um.
   *
   * Ein Modul darf MEHRERE Diagramme liefern. Das ist bei den Zaehlerstaenden
   * nicht Bequemlichkeit, sondern Pflicht: kWh und m³ in ein Bild zu legen
   * hiesse zwei Y-Achsen, und die erfinden einen Zusammenhang, den es nicht
   * gibt. Ein Zaehler, ein Diagramm.
   */
  diagramme?: (von: string, bis: string) => Diagramm[];
}

import { termineModule } from "./termine.js";
import { sucheModule } from "./suche.js";
import { profilModule } from "./profil.js";
import { diagrammeModule } from "./diagramme.js";
import { laermprotokollModule } from "./laermprotokoll.js";
import { stechuhrModule } from "./stechuhr.js";
import { wetterModule } from "./wetter.js";
import { zaehlerstaendeModule } from "./zaehlerstaende.js";
import { aufgabenModule } from "./aufgaben.js";
import { haushaltModule } from "./haushalt.js";
import { geburtstageModule } from "./geburtstage.js";
import { fahrzeugModule } from "./fahrzeug.js";
import { tresorModule } from "./tresor.js";

export const serverModules: ServerModule[] = [
  // Steht vorn, weil er die Frage beantwortet, mit der man das Dashboard
  // aufmacht. Sammelt aus allen anderen — deshalb ist die Reihenfolge hier
  // egal: gesammelt wird erst beim Aufruf, da sind alle registriert.
  termineModule,
  sucheModule,
  // Sammeln wie der Terminfaden aus allen anderen — Reihenfolge egal.
  profilModule,
  diagrammeModule,
  laermprotokollModule,
  stechuhrModule,
  wetterModule,
  zaehlerstaendeModule,
  aufgabenModule,
  haushaltModule,
  geburtstageModule,
  fahrzeugModule,
  tresorModule,
];
