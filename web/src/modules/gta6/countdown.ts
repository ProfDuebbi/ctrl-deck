/*
 * Alles Zaehlbare an einer Stelle. Kein Server, keine Tabelle: dieses
 * Modul speichert nichts und fragt nichts ab, es rechnet nur mit der
 * Uhr des Rechners. Deshalb gibt es dazu auch kein Backend-Modul.
 *
 * Das Datum steht absichtlich hier im Quelltext und nicht in den
 * Einstellungen. Ein Erscheinungstermin ist keine Vorliebe, sondern
 * eine Tatsache mit genau einer richtigen Antwort — und ein Feld, in
 * das sich "19. Novembr" tippen laesst, ist ein Feld, aus dem NaN
 * herauskommt. Verschiebt Rockstar, ist es hier eine Zeile.
 */

/** Erscheinungstermin. Monat menschlich gezaehlt: 11 = November. */
export const ZIEL = { jahr: 2026, monat: 11, tag: 19 } as const;

/** Der erste Trailer — der Anfang der Wartezeit fuer den Fortschritt. */
export const ANKUENDIGUNG = { jahr: 2023, monat: 12, tag: 4 } as const;

/*
 * Beide als ORTSZEIT, nicht als UTC.
 *
 * `new Date("2026-11-19")` waere Mitternacht UTC — im Winter also der
 * 19. um 01:00 hier, und der Countdown liefe eine Stunde zu frueh ab.
 * Mit den Einzelwerten entsteht Mitternacht in der Zeitzone dieses
 * Rechners. Dasselbe Problem wie beim Datum in `haushalt.ts`, nur
 * andersherum: dort war `toISOString()` der Fehler, hier waere es das
 * ISO-Format beim Einlesen.
 */
export function zielDatum(): Date {
  return new Date(ZIEL.jahr, ZIEL.monat - 1, ZIEL.tag, 0, 0, 0, 0);
}

export function ankuendigungsDatum(): Date {
  return new Date(ANKUENDIGUNG.jahr, ANKUENDIGUNG.monat - 1, ANKUENDIGUNG.tag, 0, 0, 0, 0);
}

export interface Rest {
  /** true, sobald der Termin erreicht ist — dann stehen alle Zahlen auf 0. */
  vorbei: boolean;
  tage: number;
  stunden: number;
  minuten: number;
  sekunden: number;
}

const SEKUNDE = 1000;
const MINUTE = 60 * SEKUNDE;
const STUNDE = 60 * MINUTE;
const TAG = 24 * STUNDE;

/** Was bis zum Erscheinen uebrig ist. Nie negativ. */
export function rest(jetzt: Date = new Date()): Rest {
  const ms = zielDatum().getTime() - jetzt.getTime();
  if (ms <= 0) return { vorbei: true, tage: 0, stunden: 0, minuten: 0, sekunden: 0 };

  return {
    vorbei: false,
    tage: Math.floor(ms / TAG),
    stunden: Math.floor((ms % TAG) / STUNDE),
    minuten: Math.floor((ms % STUNDE) / MINUTE),
    sekunden: Math.floor((ms % MINUTE) / SEKUNDE),
  };
}

/** Anteil der Wartezeit, der vorbei ist — 0 bis 100, auf eine Stelle. */
export function fortschritt(jetzt: Date = new Date()): number {
  const start = ankuendigungsDatum().getTime();
  const ende = zielDatum().getTime();
  const anteil = ((jetzt.getTime() - start) / (ende - start)) * 100;
  return Math.round(Math.min(100, Math.max(0, anteil)) * 10) / 10;
}

/*
 * Die Marken auf dem Weg. `tage` ist der Abstand zum Erscheinen, ab dem
 * die Marke als erreicht gilt. Absteigend sortiert — die Darstellung
 * verlaesst sich darauf.
 */
export const MARKEN = [
  { tage: 365, label: "Noch ein Jahr" },
  { tage: 182, label: "Noch ein halbes Jahr" },
  { tage: 100, label: "Zum letzten Mal dreistellig" },
  { tage: 50, label: "Noch fünfzig Tage" },
  { tage: 30, label: "Der letzte Monat" },
  { tage: 7, label: "Die letzte Woche" },
  { tage: 1, label: "Morgen ist es so weit" },
  { tage: 0, label: "Erscheinungstag" },
] as const;

export interface Marke {
  tage: number;
  label: string;
  erreicht: boolean;
}

/** Marken mit Zustand — erreicht ist alles, was naeher liegt als „noch uebrig". */
export function marken(verbleibendeTage: number): Marke[] {
  return MARKEN.map((m) => ({ ...m, erreicht: verbleibendeTage <= m.tage }));
}

/**
 * Die naechste Marke, die bevorsteht. `null`, wenn alle vorbei sind.
 *
 * MARKEN ist absteigend sortiert, offen sind also immer die HINTEREN —
 * und die naechste ist die erste davon. `offen[offen.length - 1]` waere
 * die letzte ueberhaupt ("Erscheinungstag"), und genau das stand in der
 * Kachel: "Erscheinungstag in 83 Tagen" statt "noch fuenfzig Tage in 33
 * Tagen". Beim Lesen richtig, im Bild sofort falsch.
 */
export function naechsteMarke(verbleibendeTage: number): Marke | null {
  return marken(verbleibendeTage).find((m) => !m.erreicht) ?? null;
}

export const zwei = (n: number) => String(n).padStart(2, "0");

/** Der Termin, wie er dasteht. Einmal geschrieben, zweimal gebraucht. */
export const TERMIN_TEXT = "19. November 2026";
