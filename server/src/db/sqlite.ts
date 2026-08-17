import { DatabaseSync, type StatementSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Ergebnis, Treiber, Wert, Zeile } from "./schnittstelle.js";

/**
 * Der Standardtreiber: eine SQLite-Datei im Ordner `data/`.
 *
 * `node:sqlite` ist seit Node 22.5 eingebaut — kein nativer Build, keine
 * Abhaengigkeit, kein `node-gyp`. Genau deshalb faellt eine frische
 * Installation von CTRL·DECK nicht ueber Compiler-Fehler, und genau deshalb
 * bleibt dieser Treiber die Vorgabe.
 *
 * Er ist synchron und wird hier in Versprechen verpackt. Das kostet nichts
 * Messbares und erspart dem restlichen Programm zwei Fassungen von allem.
 */

/**
 * Markiert den Aufrufbaum innerhalb einer Transaktion.
 *
 * Ohne das wuerde sich die Klammer selbst aussperren: `transaktion()` haelt die
 * Sperre, waehrend `arbeit()` laeuft — und jede Anweisung AUS dieser Arbeit
 * heraus wuerde auf eben diese Sperre warten. `AsyncLocalStorage` traegt die
 * Markierung durch alle `await` hindurch mit, sodass die eigene Arbeit
 * durchgelassen und alles Fremde angehalten wird.
 */
const drinnen = new AsyncLocalStorage<true>();

export class SqliteTreiber implements Treiber {
  readonly art = "sqlite" as const;
  readonly datei: string;
  readonly bezeichnung: string;

  private db: DatabaseSync;
  /**
   * Vorbereitete Anweisungen, nach ihrem SQL abgelegt.
   *
   * Frueher hielten die Module ihre `db.prepare()`-Ergebnisse selbst fest und
   * riefen sie in Schleifen wieder auf. Diese Schnittstelle nimmt bei jedem
   * Aufruf das SQL entgegen — ohne diesen Zwischenspeicher wuerde jede Zeile
   * einer Schleife die Anweisung neu uebersetzen.
   */
  private vorbereitet = new Map<string, StatementSync>();
  /** Laeuft gerade eine Transaktion? Dann wartet alles Fremde. */
  private klammer: Promise<void> | null = null;

  constructor(datei: string) {
    this.datei = datei;
    this.bezeichnung = `SQLite-Datei (${datei})`;
    this.db = new DatabaseSync(datei);
    this.einstellen();
  }

  private einstellen(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  private stmt(sql: string): StatementSync {
    let s = this.vorbereitet.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.vorbereitet.set(sql, s);
    }
    return s;
  }

  /** Wartet, bis eine fremde Transaktion durch ist. Die eigene laeuft durch. */
  private async freieBahn(): Promise<void> {
    if (drinnen.getStore()) return;
    while (this.klammer) await this.klammer;
  }

  async alle<T = Zeile>(sql: string, werte: Wert[] = []): Promise<T[]> {
    await this.freieBahn();
    return this.stmt(sql).all(...(werte as never[])) as T[];
  }

  async eine<T = Zeile>(sql: string, werte: Wert[] = []): Promise<T | undefined> {
    await this.freieBahn();
    return this.stmt(sql).get(...(werte as never[])) as T | undefined;
  }

  async schreibe(sql: string, werte: Wert[] = []): Promise<Ergebnis> {
    await this.freieBahn();
    const info = this.stmt(sql).run(...(werte as never[]));
    return { id: Number(info.lastInsertRowid ?? 0), zeilen: Number(info.changes ?? 0) };
  }

  async exec(sql: string): Promise<void> {
    await this.freieBahn();
    // `exec` kann das Schema aendern; eine gespeicherte Anweisung auf eine
    // Tabelle, die es gerade nicht mehr in dieser Form gibt, waere danach
    // Schrott. Nach jeder Schema-Aenderung also von vorn.
    this.vorbereitet.clear();
    this.db.exec(sql);
  }

  async transaktion<T>(arbeit: () => Promise<T>): Promise<T> {
    // Schon in einer Klammer? Dann gehoert die Arbeit mit hinein. Verschachtelte
    // Transaktionen brauechten Sicherungspunkte (SAVEPOINT) — das waere Aufwand
    // fuer einen Fall, den dieses Programm nicht hat.
    if (drinnen.getStore()) return arbeit();

    while (this.klammer) await this.klammer;
    let loesen!: () => void;
    this.klammer = new Promise<void>((r) => { loesen = r; });
    try {
      this.db.exec("BEGIN");
      try {
        const ergebnis = await drinnen.run(true, arbeit);
        this.db.exec("COMMIT");
        return ergebnis;
      } catch (fehler) {
        try { this.db.exec("ROLLBACK"); } catch { /* schon zurueckgerollt */ }
        throw fehler;
      }
    } finally {
      this.klammer = null;
      loesen();
    }
  }

  async schliesse(): Promise<void> {
    this.vorbereitet.clear();
    this.db.close();
  }

  // --- nur fuer den Dateitreiber -----------------------------------------

  /**
   * Schreibt das WAL in die Hauptdatei zurueck.
   *
   * Muss vor jedem Kopieren der Datei laufen, sonst fehlt der Kopie alles, was
   * seit dem letzten Zusammenfuehren nur im `-wal` steht.
   */
  async checkpoint(): Promise<void> {
    await this.freieBahn();
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }

  /**
   * Schliesst die Datei und oeffnet sie danach neu — der Weg, auf dem eine
   * Wiederherstellung die Datei unter der laufenden Verbindung austauscht.
   * Der Aufrufer tauscht sie zwischen `zu()` und `auf()`.
   */
  async zu(): Promise<void> {
    this.vorbereitet.clear();
    this.db.close();
  }

  async auf(): Promise<void> {
    this.db = new DatabaseSync(this.datei);
    this.einstellen();
  }
}
