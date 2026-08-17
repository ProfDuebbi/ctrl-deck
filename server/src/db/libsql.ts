import { AsyncLocalStorage } from "node:async_hooks";
import type { Ergebnis, Treiber, Wert, Zeile } from "./schnittstelle.js";

/*
 * Der Treiber fuer eine ANGESCHLOSSENE Datenbank (libSQL / Turso / sqld).
 *
 * Er ist die Server-Option und wird nur benutzt, wenn `DB_URL` gesetzt ist.
 * Ohne diese Variable existiert er nicht einmal im Arbeitsspeicher — die
 * Bibliothek wird erst beim Verbinden nachgeladen (siehe `verbindeLibsql`).
 * Eine lokale Installation bleibt dadurch genau so schlank wie vorher: kein
 * zusaetzliches Paket, keine Zugangsdaten, keine Konfiguration.
 *
 * WARUM libSQL und nicht PostgreSQL: libSQL spricht denselben SQL-Dialekt wie
 * SQLite. Alle rund 120 Anweisungen dieses Projekts — `date(x, 'localtime')`,
 * `AUTOINCREMENT`, `ON CONFLICT … DO UPDATE`, `PRAGMA table_info`, `?` als
 * Platzhalter — bleiben Wort fuer Wort stehen. Bei PostgreSQL muesste jede
 * einzelne davon uebersetzt werden, und jede Uebersetzung ist eine Stelle, an
 * der sich ein Rechenfehler einschleichen kann, den niemand bemerkt.
 *
 * Nur die WEB-Variante der Bibliothek wird geladen (`@libsql/client/web`).
 * Sie spricht ueber HTTP und ist reines JavaScript — der Grundsatz „kein
 * nativer Build" gilt also auch hier.
 */

/** Was die Bibliothek liefert — nur der Teil, den dieser Treiber benutzt. */
interface LibsqlErgebnis {
  columns: string[];
  rows: unknown[];
  rowsAffected: number;
  lastInsertRowid?: bigint | number;
}
interface LibsqlAusfuehrer {
  execute(anweisung: { sql: string; args: unknown[] }): Promise<LibsqlErgebnis>;
}
interface LibsqlKlammer extends LibsqlAusfuehrer {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
interface LibsqlClient extends LibsqlAusfuehrer {
  executeMultiple(sql: string): Promise<void>;
  transaction(modus: "write"): Promise<LibsqlKlammer>;
  close(): void;
}

/**
 * Die gerade offene Transaktion. Dieselbe Mechanik wie im SQLite-Treiber:
 * Anweisungen aus der laufenden Klammer heraus muessen an die Klammer gehen,
 * alles andere an die normale Verbindung — sonst landete die halbe Arbeit
 * ausserhalb und `ROLLBACK` liesse sie stehen.
 */
const offeneKlammer = new AsyncLocalStorage<LibsqlKlammer>();

export class LibsqlTreiber implements Treiber {
  readonly art = "libsql" as const;
  readonly bezeichnung: string;
  /** Es gibt keine Datei — daran erkennt die Sicherung, dass sie exportieren muss. */
  readonly datei = null;

  private klient: LibsqlClient;
  /** Nur eine Transaktion gleichzeitig; fremde Anweisungen warten so lange. */
  private laufend: Promise<void> | null = null;

  constructor(klient: LibsqlClient, bezeichnung: string) {
    this.klient = klient;
    this.bezeichnung = bezeichnung;
  }

  /** Klammer, falls wir in einer stecken — sonst die normale Verbindung. */
  private async ziel(): Promise<LibsqlAusfuehrer> {
    const drin = offeneKlammer.getStore();
    if (drin) return drin;
    while (this.laufend) await this.laufend;
    return this.klient;
  }

  /**
   * Zeilen in genau die Form bringen, die `node:sqlite` liefert.
   *
   * Das ist keine Kosmetik: libSQL gibt Zeilen zurueck, die man sowohl ueber
   * den Spaltennamen als auch ueber den Index lesen kann. `res.json()` wuerde
   * daraus etwas anderes machen als bisher, und die Oberflaeche bekaeme
   * ploetzlich Felder mit den Namen "0", "1", "2". Beide Treiber muessen
   * dasselbe liefern, sonst ist die Schnittstelle keine.
   */
  private formen<T>(ergebnis: LibsqlErgebnis): T[] {
    const spalten = ergebnis.columns;
    return ergebnis.rows.map((roh) => {
      const zeile: Record<string, unknown> = {};
      const werte = roh as Record<string | number, unknown>;
      for (let i = 0; i < spalten.length; i++) zeile[spalten[i]] = werte[i];
      return zeile as T;
    });
  }

  async alle<T = Zeile>(sql: string, werte: Wert[] = []): Promise<T[]> {
    const ziel = await this.ziel();
    return this.formen<T>(await ziel.execute({ sql, args: werte }));
  }

  async eine<T = Zeile>(sql: string, werte: Wert[] = []): Promise<T | undefined> {
    return (await this.alle<T>(sql, werte))[0];
  }

  async schreibe(sql: string, werte: Wert[] = []): Promise<Ergebnis> {
    const ziel = await this.ziel();
    const r = await ziel.execute({ sql, args: werte });
    return { id: Number(r.lastInsertRowid ?? 0), zeilen: Number(r.rowsAffected ?? 0) };
  }

  async exec(sql: string): Promise<void> {
    const drin = offeneKlammer.getStore();
    if (drin) {
      // In einer Klammer gibt es kein `executeMultiple` — die Anweisungen also
      // einzeln. Reicht fuer die Migrationen, die genau so gebaut sind.
      for (const teil of zerlege(sql)) await drin.execute({ sql: teil, args: [] });
      return;
    }
    while (this.laufend) await this.laufend;
    await this.klient.executeMultiple(sql);
  }

  async transaktion<T>(arbeit: () => Promise<T>): Promise<T> {
    // Schon in einer Klammer? Dann gehoert die Arbeit mit hinein.
    if (offeneKlammer.getStore()) return arbeit();

    while (this.laufend) await this.laufend;
    let loesen!: () => void;
    this.laufend = new Promise<void>((r) => { loesen = r; });
    try {
      const klammer = await this.klient.transaction("write");
      try {
        const ergebnis = await offeneKlammer.run(klammer, arbeit);
        await klammer.commit();
        return ergebnis;
      } catch (fehler) {
        try { await klammer.rollback(); } catch { /* schon zurueckgerollt */ }
        throw fehler;
      }
    } finally {
      this.laufend = null;
      loesen();
    }
  }

  async schliesse(): Promise<void> {
    this.klient.close();
  }
}

/**
 * Ein Schema-Block in einzelne Anweisungen zerlegen.
 *
 * Bewusst simpel: Es geht ausschliesslich um die `CREATE TABLE`- und
 * `ALTER TABLE`-Bloecke dieses Projekts. Sie enthalten keine Semikolons in
 * Zeichenketten, wohl aber `--`-Kommentare, die wegmuessen — ein Semikolon
 * hinter einem Kommentarzeichen gibt es nicht, aber ein Kommentar am Zeilenende
 * wuerde sonst die naechste Anweisung mitverschlucken.
 */
function zerlege(sql: string): string[] {
  return sql
    .split("\n")
    .map((zeile) => zeile.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Adresse ohne Zugangsdaten — fuer Protokoll und Statusanzeige. */
function ohneGeheimnis(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    u.search = "";
    return u.toString();
  } catch {
    return "(unlesbare Adresse)";
  }
}

/**
 * Verbindet die angeschlossene Datenbank.
 *
 * Die Bibliothek wird ERST HIER geladen. Wer CTRL·DECK lokal betreibt, kommt
 * nie an dieser Stelle vorbei und braucht das Paket deshalb gar nicht
 * installiert zu haben — genau darum steht es nicht in den `dependencies`.
 */
export async function verbindeLibsql(url: string, token: string | undefined): Promise<LibsqlTreiber> {
  /*
   * Der Name steht bewusst in einer Variablen und nicht direkt im `import`.
   *
   * Damit sieht TypeScript kein festes Modul und verlangt es auch nicht — der
   * Compiler laeuft also durch, OHNE dass `@libsql/client` installiert ist.
   * Genau das ist der Zweck: Das Paket steht nicht in den `dependencies`, weil
   * es niemand braucht, der CTRL·DECK lokal betreibt. Wer eine eigene
   * Datenbank anschliesst, installiert es einmal — und bekommt sonst die
   * Meldung unten statt eines Absturzes.
   *
   * `/web` ist die Variante ohne nativen Anteil: reines JavaScript ueber HTTP.
   */
  const paket = "@libsql/client/web";
  let createClient: (o: { url: string; authToken?: string; intMode?: string }) => LibsqlClient;
  try {
    ({ createClient } = await import(paket));
  } catch {
    throw new Error(
      "Fuer eine angeschlossene Datenbank fehlt das Paket `@libsql/client`.\n" +
        "        Einmalig installieren:  npm --prefix server install @libsql/client\n" +
        "        Oder DB_URL entfernen, dann laeuft CTRL·DECK wieder auf der lokalen Datei."
    );
  }

  const klient = createClient({
    url,
    authToken: token || undefined,
    /*
     * Ganze Zahlen als `number`, nicht als `bigint`.
     *
     * `node:sqlite` liefert Zahlen, und das ganze Projekt rechnet damit —
     * `bigint` wuerde bei der ersten Multiplikation mit einem Kommawert werfen
     * und liesse sich nicht als JSON verschicken. Wer mehr als 2^53 Zeilen in
     * einem privaten Dashboard hat, hat andere Sorgen.
     */
    intMode: "number",
  });

  // Sofort etwas fragen: Eine falsche Adresse oder ein abgelaufenes Token soll
  // beim Start auffallen und nicht erst beim ersten Klick im Browser.
  await klient.execute({ sql: "SELECT 1", args: [] });

  return new LibsqlTreiber(klient, `angeschlossene Datenbank (${ohneGeheimnis(url)})`);
}
