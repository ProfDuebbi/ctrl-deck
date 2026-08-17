/**
 * Notausgang: Anmeldepasswort neu setzen.
 *
 *   npm run passwort-neu     (im Projektordner)
 *
 * Warum das kein Loch ist: Wer diesen Ordner erreicht, erreicht auch
 * `data/ctrl-deck.db` und koennte sie direkt oeffnen. Das Skript gibt also
 * niemandem etwas, das er nicht ohnehin haette — es erspart nur, mit einem
 * SQLite-Werkzeug hantieren zu muessen. Auf einem Server ist es der Weg
 * ueber das Terminal, und damit die einzige Rettung, die immer funktioniert.
 *
 * Der Tresor bleibt davon voellig unberuehrt: sein Master-Passwort kennt der
 * Server nicht, und dieses Skript kann es weder lesen noch aendern.
 */
import { MIN_LAENGE, istEingerichtet, richteAuthEin, setzePasswort } from "../auth.js";
import { starteDatenbank } from "../db.js";
import { DB_PATH } from "../paths.js";

/** Eingabe ohne Bildschirmecho — ein Passwort gehoert nicht ins Terminalfenster. */
function frageVerdeckt(frage: string): Promise<string> {
  return new Promise((fertig, scheitern) => {
    const ein = process.stdin;
    if (!ein.isTTY) {
      scheitern(new Error("Kein Terminal — bitte direkt in einer Eingabeaufforderung ausführen."));
      return;
    }
    process.stdout.write(frage);
    ein.setRawMode(true);
    ein.resume();
    ein.setEncoding("utf8");

    let gesammelt = "";
    const aufhoeren = () => {
      ein.setRawMode(false);
      ein.pause();
      ein.removeListener("data", beiTaste);
      process.stdout.write("\n");
    };
    const beiTaste = (taste: string) => {
      for (const z of taste) {
        if (z === "\r" || z === "\n") { aufhoeren(); fertig(gesammelt); return; }
        if (z === "\u0003") { aufhoeren(); scheitern(new Error("abgebrochen")); return; } // Strg+C
        if (z === "\u007f" || z === "\b") { gesammelt = gesammelt.slice(0, -1); continue; }
        if (z >= " ") gesammelt += z;
      }
    };
    ein.on("data", beiTaste);
  });
}

async function main() {
  // Das Skript laeuft ausserhalb des Servers und muss die Verbindung deshalb
  // selbst aufbauen — frueher passierte das beim blossen Importieren.
  await starteDatenbank();
  await richteAuthEin();

  console.log("\n  CTRL·DECK — Anmeldepasswort neu setzen");
  console.log(`  Datenbank: ${DB_PATH}`);
  console.log(
    (await istEingerichtet())
      ? "  Es gibt bereits ein Passwort. Es wird ersetzt."
      : "  Bisher ist kein Passwort gesetzt."
  );
  console.log("  Alle angemeldeten Geräte werden abgemeldet.\n");

  const neu = await frageVerdeckt(`  Neues Passwort (mind. ${MIN_LAENGE} Zeichen): `);
  if (neu.length < MIN_LAENGE) {
    console.error(`\n  Zu kurz — mindestens ${MIN_LAENGE} Zeichen. Nichts geändert.\n`);
    process.exit(1);
  }
  const nochmal = await frageVerdeckt("  Zur Sicherheit noch einmal:            ");
  if (neu !== nochmal) {
    console.error("\n  Die beiden Eingaben sind nicht gleich. Nichts geändert.\n");
    process.exit(1);
  }

  await setzePasswort(neu);
  console.log("\n  Erledigt. Beim nächsten Aufruf im Browser gilt das neue Passwort.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n  Abgebrochen: ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
