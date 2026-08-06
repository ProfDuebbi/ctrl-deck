import type { Router } from "express";

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
}

import { termineModule } from "./termine.js";
import { sucheModule } from "./suche.js";
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
