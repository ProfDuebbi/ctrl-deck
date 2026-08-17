/*
 * Die eine Stelle, an der steht, was CTRL·DECK von einer Datenbank verlangt.
 *
 * Warum es das ueberhaupt gibt: Bis August 2026 sprach jedes Modul direkt mit
 * `node:sqlite` — 116 Aufrufe von `db.prepare()` quer durch elf Dateien, mit
 * einer synchronen API, die es so nur bei einer Datei im selben Prozess gibt.
 * Wer CTRL·DECK auf einem Server betreibt, soll seine eigene Datenbank
 * anschliessen koennen; jede Datenbank, die ueber ein Netzwerk antwortet, ist
 * aber zwangslaeufig asynchron.
 *
 * Deshalb ist hier ALLES `Promise`-basiert, auch beim lokalen Dateitreiber, der
 * die Antwort in Wahrheit sofort haette. Ein Treiber, der synchron sein darf,
 * und einer, der es nicht kann, ergaeben sonst zwei verschiedene Fassungen
 * jedes Aufrufers.
 *
 * Absichtlich klein gehalten: vier Wege, Daten zu bewegen, plus Klammer und
 * Aufraeumen. Kein Abfrage-Baukasten, keine Modelle, kein Schema-Werkzeug — das
 * SQL steht weiter im Modul, wo man es lesen kann.
 */

/** Was als Platzhalterwert in eine Anweisung darf. */
export type Wert = string | number | bigint | boolean | null | Uint8Array;

/** Eine Ergebniszeile. Die Module casten selbst auf ihre eigene Form. */
export type Zeile = Record<string, any>;

/** Was eine schreibende Anweisung hinterlassen hat. */
export interface Ergebnis {
  /**
   * Schluessel der zuletzt eingefuegten Zeile — 0, wenn nichts eingefuegt
   * wurde. Immer `number`: SQLite liefert je nach Groesse `number` oder
   * `bigint`, und diese Unterscheidung hat in den Modulen nichts zu suchen
   * (frueher stand deshalb an manchen Stellen `Number(...)` und an anderen
   * nicht — dieselbe Zahl kam einmal als `1` und einmal als `1n` an).
   */
  id: number;
  /** Wie viele Zeilen die Anweisung geaendert hat. */
  zeilen: number;
}

/**
 * Ein konkreter Treiber. Davon gibt es zwei: die lokale Datei (`sqlite.ts`,
 * Vorgabe) und eine angeschlossene Datenbank (`libsql.ts`).
 *
 * Beide sprechen denselben SQL-Dialekt. Das ist keine Bequemlichkeit, sondern
 * der Grund fuer die Wahl: `date(x, 'localtime')`, `AUTOINCREMENT`,
 * `ON CONFLICT … DO UPDATE`, `PRAGMA table_info` und `?` als Platzhalter
 * stehen ueber hundert Mal in diesem Projekt und bleiben Wort fuer Wort
 * stehen. Ein Treiber fuer PostgreSQL oder MySQL wuerde hier zwar
 * hineinpassen, muesste aber jede dieser Anweisungen uebersetzen.
 */
export interface Treiber {
  readonly art: "sqlite" | "libsql";
  /**
   * Was in Protokoll und Statusanzeige steht. NIEMALS mit Zugangsdaten — ein
   * Token in der Serverausgabe landet im Terminal, im Journal und im ersten
   * Fehlerbericht, den jemand weitergibt.
   */
  readonly bezeichnung: string;
  /**
   * Pfad der Datenbankdatei, falls es eine gibt. Bei einer angeschlossenen
   * Datenbank `null` — daran erkennt die Sicherung, dass sie nichts kopieren
   * kann und exportieren muss.
   */
  readonly datei: string | null;

  alle<T = Zeile>(sql: string, werte: Wert[]): Promise<T[]>;
  eine<T = Zeile>(sql: string, werte: Wert[]): Promise<T | undefined>;
  schreibe(sql: string, werte: Wert[]): Promise<Ergebnis>;
  /**
   * Mehrere Anweisungen am Stueck, ohne Platzhalter. Das ist der Weg fuers
   * Schema (`CREATE TABLE IF NOT EXISTS …`), nicht fuer Daten: Werte gehoeren
   * in Platzhalter, sonst baut man sich eine Einschleusungsluecke.
   */
  exec(sql: string): Promise<void>;
  /**
   * Fuehrt `arbeit` als eine Einheit aus: entweder alles oder nichts.
   *
   * Braucht es erst, seit die Datenbank asynchron ist. Vorher lief zwischen
   * zwei Anweisungen desselben Vorgangs garantiert nichts anderes — jetzt
   * kann Express in jedem `await` die naechste Anfrage bedienen.
   */
  transaktion<T>(arbeit: () => Promise<T>): Promise<T>;
  schliesse(): Promise<void>;
}
