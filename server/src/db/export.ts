import fs from "node:fs";
import path from "node:path";
import { db } from "../db.js";
import type { Wert } from "./schnittstelle.js";

/*
 * Sichern und Wiederherstellen OHNE Dateikopie.
 *
 * Die eingebaute Sicherung kopiert `data/ctrl-deck.db`. Das ist schnell,
 * zuverlaessig und bleibt fuer die lokale Installation genau so — angefasst
 * wird hier nichts davon.
 *
 * Bei einer angeschlossenen Datenbank gibt es diese Datei aber nicht: Die
 * Daten liegen auf einem anderen Rechner. Deshalb liest dieser Weg den
 * INHALT — alle Tabellen, Zeile fuer Zeile — und schreibt ihn als JSON.
 *
 * Die Sicherung besteht dabei aus DENSELBEN ZWEI TEILEN wie bisher, nur mit
 * anderer Endung:
 *
 *   ctrl-deck_2026-08-17T12-00-00.json
 *   ctrl-deck_2026-08-17T12-00-00.dateien/
 *
 * Das ist kein Zufall, sondern der Grund fuer diese Wahl: Auflisten, Loeschen,
 * Aufraeumen und das Spiegeln aufs zweite Laufwerk arbeiten unveraendert
 * weiter, weil sie nur den Namensstamm und den Anhang-Ordner kennen.
 *
 * NEBENWIRKUNG, die keine ist, sondern der Zweck: So ein Export ist
 * treiberunabhaengig. Man kann ihn aus der lokalen Datei ziehen und in die
 * eigene Datenbank zurueckspielen — das ist der Umzugsweg.
 */

/** Aufbau der Exportdatei. `v` faengt spaetere Formatwechsel ab. */
interface Export {
  v: 1;
  erstellt: string;
  /** Nur zur Information beim Hineinsehen. */
  herkunft: string;
  /** Tabellenname -> Zeilen. Reihenfolge ist die Einfuege-Reihenfolge. */
  tabellen: { name: string; zeilen: Record<string, unknown>[] }[];
}

/**
 * Ein Wert, wie er in JSON darf.
 *
 * Rohbytes (der Inhalt eines Tresor-Anhangs) kommen hier normalerweise nicht
 * vor — die wandern in den Anhang-Ordner. Sollte doch einmal eine BLOB-Spalte
 * dazukommen, landet sie als Base64 in einem erkennbaren Umschlag, statt still
 * zu einem leeren Objekt zu werden.
 */
function alsJson(wert: unknown): unknown {
  if (wert instanceof Uint8Array) return { $bin: Buffer.from(wert).toString("base64") };
  if (wert instanceof ArrayBuffer) return { $bin: Buffer.from(wert).toString("base64") };
  return wert;
}

function ausJson(wert: unknown): Wert {
  if (wert && typeof wert === "object" && "$bin" in (wert as Record<string, unknown>)) {
    return new Uint8Array(Buffer.from(String((wert as { $bin: string }).$bin), "base64"));
  }
  return wert as Wert;
}

/** Alle eigenen Tabellen. Die internen `sqlite_*` gehen niemanden etwas an. */
async function tabellen(): Promise<string[]> {
  const rows = await db.alle<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  return rows.map((r) => r.name);
}

/**
 * Tabellen so ordnen, dass eine Tabelle immer NACH denen steht, auf die sie
 * zeigt.
 *
 * Ohne das scheitert das Wiedereinspielen an den Fremdschluesseln: Ein Anhang
 * kann nicht vor dem Tresoreintrag angelegt werden, an dem er haengt. Beim
 * Leeren geht es genau andersherum, deshalb wird dieselbe Liste dort rueckwaerts
 * durchlaufen.
 */
async function nachAbhaengigkeit(namen: string[]): Promise<string[]> {
  const zeigtAuf = new Map<string, string[]>();
  for (const name of namen) {
    const fks = await db.alle<{ table: string }>(`PRAGMA foreign_key_list("${name}")`);
    zeigtAuf.set(name, fks.map((f) => f.table).filter((t) => namen.includes(t) && t !== name));
  }
  const fertig: string[] = [];
  const gesehen = new Set<string>();
  const gerade = new Set<string>();
  const besuche = (name: string) => {
    if (gesehen.has(name)) return;
    // Ein Ring waere ein Schema-Fehler; hier einfach nicht endlos kreisen.
    if (gerade.has(name)) return;
    gerade.add(name);
    for (const ziel of zeigtAuf.get(name) ?? []) besuche(ziel);
    gerade.delete(name);
    gesehen.add(name);
    fertig.push(name);
  };
  for (const name of namen) besuche(name);
  return fertig;
}

/**
 * Schreibt den gesamten Bestand nach `zielJson` und die Tresor-Anhaenge in den
 * zugehoerigen Ordner. Gibt den Pfad der JSON-Datei zurueck.
 */
export async function exportiere(zielJson: string, anhangZiel: string): Promise<string> {
  const namen = await nachAbhaengigkeit(await tabellen());

  const stand: Export = {
    v: 1,
    erstellt: new Date().toISOString(),
    herkunft: db.bezeichnung,
    tabellen: [],
  };

  for (const name of namen) {
    const spalten = (await db.alle<{ name: string }>(`PRAGMA table_info("${name}")`)).map((c) => c.name);
    // Der Anhang-Inhalt bleibt aussen vor: Er geht als Datei in den Ordner
    // daneben. Sonst blaehte eine einzige eingescannte Urkunde die JSON-Datei
    // um ein Drittel ihrer Groesse auf (Base64), und man koennte sie nicht mehr
    // aufmachen, um hineinzusehen.
    const gelesen = spalten.filter((s) => !(name === "tresor_dateien" && s === "inhalt"));
    const roh = await db.alle(`SELECT ${gelesen.map((s) => `"${s}"`).join(", ")} FROM "${name}"`);
    stand.tabellen.push({
      name,
      zeilen: roh.map((zeile) => {
        const raus: Record<string, unknown> = {};
        for (const s of gelesen) raus[s] = alsJson((zeile as Record<string, unknown>)[s]);
        return raus;
      }),
    });
  }

  fs.mkdirSync(path.dirname(zielJson), { recursive: true });
  fs.writeFileSync(zielJson, JSON.stringify(stand), "utf8");

  // Anhaenge daneben — dieselbe Form wie bei der Dateikopie, damit Spiegeln
  // und Aufraeumen nichts Neues lernen muessen.
  const anhaenge = await db.alle<{ id: number; inhalt: Uint8Array | null }>(
    "SELECT id, inhalt FROM tresor_dateien"
  );
  const mitInhalt = anhaenge.filter((a) => a.inhalt);
  if (mitInhalt.length > 0) {
    fs.mkdirSync(anhangZiel, { recursive: true });
    for (const a of mitInhalt) {
      fs.writeFileSync(path.join(anhangZiel, `${a.id}.bin`), Buffer.from(a.inhalt!));
    }
  }

  return zielJson;
}

/**
 * Spielt einen Export zurueck. ERSETZT den gesamten Bestand.
 *
 * Der Aufrufer sichert vorher — hier wird nicht mehr gefragt. Alles laeuft in
 * EINER Klammer: Ein Abbruch mittendrin liesse sonst eine halb geleerte
 * Datenbank zurueck, und das waere schlimmer als jeder Fehler davor.
 */
export async function spieleEin(quelleJson: string, anhangQuelle: string): Promise<void> {
  const roh = JSON.parse(fs.readFileSync(quelleJson, "utf8")) as Export;
  if (roh?.v !== 1 || !Array.isArray(roh.tabellen))
    throw new Error("Das ist keine lesbare CTRL·DECK-Sicherung.");

  // Nur Tabellen anfassen, die es hier auch gibt. Eine Sicherung aus einer
  // aelteren Fassung kennt vielleicht ein Modul nicht mehr — das ist kein
  // Grund, das Zurueckspielen scheitern zu lassen.
  const vorhanden = new Set(await tabellen());
  const zuSchreiben = roh.tabellen.filter((t) => vorhanden.has(t.name));

  await db.transaktion(async () => {
    // Rueckwaerts leeren: erst die Kinder, dann die Eltern.
    for (const t of [...zuSchreiben].reverse()) {
      await db.schreibe(`DELETE FROM "${t.name}"`);
    }
    // Vorwaerts fuellen.
    for (const t of zuSchreiben) {
      for (const zeile of t.zeilen) {
        const spalten = Object.keys(zeile);
        if (spalten.length === 0) continue;
        await db.schreibe(
          `INSERT INTO "${t.name}" (${spalten.map((s) => `"${s}"`).join(", ")})
           VALUES (${spalten.map(() => "?").join(", ")})`,
          ...spalten.map((s) => ausJson(zeile[s]))
        );
      }
    }
  });

  await spieleAnhaengeEin(anhangQuelle);
}

/**
 * Anhaenge aus dem Ordner der Sicherung zurueckholen — dorthin, wo sie in
 * DIESER Installation hingehoeren.
 *
 * Das ist die Stelle, die einen Umzug moeglich macht: Ein Export aus der
 * lokalen Datei landet in einer angeschlossenen Datenbank in der Spalte, und
 * umgekehrt wieder als Datei auf der Platte. Der Export selbst weiss davon
 * nichts und muss es auch nicht.
 */
async function spieleAnhaengeEin(anhangQuelle: string): Promise<void> {
  const { TRESOR_DIR } = await import("../paths.js");
  const { sicherungMoeglich } = await import("../db.js");
  const alsDatei = sicherungMoeglich();

  // Der Anhang-Bestand gehoert zum wiederhergestellten Stand — was hier liegt
  // und dort nicht vorkommt, hat keinen Eintrag mehr, der darauf zeigt.
  if (alsDatei) {
    fs.rmSync(TRESOR_DIR, { recursive: true, force: true });
    fs.mkdirSync(TRESOR_DIR, { recursive: true });
  }
  if (!fs.existsSync(anhangQuelle)) return;

  for (const name of fs.readdirSync(anhangQuelle)) {
    const treffer = /^(\d+)\.bin$/.exec(name);
    if (!treffer) continue;
    const id = Number(treffer[1]);
    const daten = fs.readFileSync(path.join(anhangQuelle, name));
    if (alsDatei) {
      fs.writeFileSync(path.join(TRESOR_DIR, name), daten);
    } else {
      await db.schreibe("UPDATE tresor_dateien SET inhalt = ? WHERE id = ?", new Uint8Array(daten), id);
    }
  }
}
