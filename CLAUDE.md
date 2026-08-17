# CTRL·DECK — Hinweise für Claude

Privates, lokal laufendes Control-Dashboard. Vite + React + TypeScript (Port 5180)
und Express + `node:sqlite` (Port 8787). Start: `start.cmd` oder `npm run dev`.

**Zum Testen nie die laufende Installation benutzen** — dort liegen echte Daten.
Stattdessen eine isolierte Zweitinstanz: `server/src` in den Scratchpad kopieren,
`node_modules` als Junction verlinken, `PORT=8799` starten (`ROOT_DIR` leitet
sich aus dem Dateipfad ab, es entsteht also ein eigenes `data/`). **Beim
Aufräumen die Junction mit `(Get-Item …).Delete()` lösen, BEVOR
`Remove-Item -Recurse` läuft**, sonst räumt es das echte `node_modules` mit ab.

## Gestaltung: das Hausrecht liegt bei theme.css

Diese Oberfläche hat ein **eigenes, bewusst gewähltes Design-System**. Die
verbindlichen Regeln stehen als Kommentarblock oben in
`web/src/core/theme.css` — flache, undurchsichtige Flächen, Haarlinien statt
Schatten, kleine Radien, Farbe nur dort, wo sie etwas bedeutet. Der frühere
„KI-Look" (Glasflächen, Farbnebel, Verlaufstext, große Radien) wurde im Juli
2026 absichtlich entfernt.

**Bewegung nur, wo sie etwas bedeutet** (Regel 5): Eine Animation muss eine
Frage beantworten — „wo ist die Karte hin", „woher komme ich", „ist es jetzt
offen", „wie voll ist das", „kann ich das anklicken" (Zahnrad um den Avatar,
rastet um einen Zahn). Kein Anheben beim Überfahren, kein Pulsieren, keine
Einblend-Kaskaden, keine hochzählenden Zahlen. Reines Zustandsfeedback bleibt
ein Farbwechsel in `--t`. `prefers-reduced-motion` schaltet alles ab.

**Diese Regeln haben Vorrang vor jedem installierten Design-Skill.**

Global installiert sind mehrere fremde Design-Skills (`impeccable`,
`design-taste-frontend`, `high-end-visual-design`, `minimalist-ui`,
`industrial-brutalist-ui`, `apple-design` u. a.). Sie sind für Projekte *ohne*
eigenen Look gedacht und bringen jeweils ein eigenes mit — Verläufe, große
Schatten, GSAP-Motion, andere Schriften. In diesem Projekt gilt:

- Als **Prüfer** willkommen: Kritik, Audit, Hinweise auf schwache Hierarchie,
  Kontrastprobleme, Abstände. Da helfen sie.
- Als **Vorlagengeber** nicht: Keine fremden Design-Systeme, Stil-Presets,
  Schrift- oder Farbwechsel übernehmen, ohne dass der Nutzer das ausdrücklich
  will. Im Zweifel nachfragen statt umgestalten.
- `/impeccable init` und ähnliche Befehle, die Dateien ins Projekt schreiben,
  vorher abstimmen.

## Symbole statt Emoji

Alle Symbole kommen aus `web/src/core/Icon.tsx` (24×24, Strichstärke 1.5,
`currentColor`). **Keine neuen Emoji in der Oberfläche** — neues Symbol dort
ergänzen. Ausnahme: Desktop-Benachrichtigungen, die kein SVG rendern können.

## Datum

`new Date().toISOString().slice(0,10)` ist **UTC** und liefert nachts den
Vortag. Immer `heuteLokal()` (in `haushalt/api.ts` und `haushalt.ts`) bzw.
`localDate` (Stechuhr) benutzen. Default-Daten nie als Modul-Konstante, sondern
als Funktion — sonst klebt das Datum am Ladezeitpunkt.

## Datenbank

Seit August 2026 sprechen die Module **nicht mehr direkt mit `node:sqlite`**,
sondern mit der Schnittstelle in `server/src/db/schnittstelle.ts`. Dahinter
stecken zwei Treiber: die lokale Datei (`db/sqlite.ts`, Vorgabe) und eine
angeschlossene Datenbank (`db/libsql.ts`, nur wenn `DB_URL` gesetzt ist).

**Alles ist asynchron.** Es gibt kein `db.prepare()` mehr:

```ts
await db.alle<T>(sql, ...werte)      // alle Zeilen
await db.eine<T>(sql, ...werte)      // erste Zeile oder undefined
await db.schreibe(sql, ...werte)     // { id, zeilen }  (nicht lastInsertRowid/changes)
await db.exec(sql)                   // Schema, mehrere Anweisungen, keine Platzhalter
await db.transaktion(async () => …)  // alles oder nichts
```

Auch `getSetting`/`setSetting` liefern Versprechen.

**Wo gelesen und dann geschrieben wird, gehört eine `transaktion()` drum.**
Solange die Datenbank synchron war, konnte zwischen zwei Anweisungen nichts
dazwischenkommen; jetzt bedient Express in jedem `await` die nächste Anfrage.
Betroffen sind Sperren, Zähler und „gibt es das schon?"-Prüfungen — siehe
`einnahmenAusfuehren()` in `haushalt.ts` als Beispiel.

Das SQL selbst bleibt SQLite-Dialekt und wird von beiden Treibern verstanden
(`date(x,'localtime')`, `AUTOINCREMENT`, `ON CONFLICT`, `PRAGMA table_info`,
`?` als Platzhalter). **Lokal ändert sich durch die Wahlmöglichkeit nichts** —
ohne `DB_URL` läuft alles wie immer über `data/ctrl-deck.db`, die Tresor-Anhänge
bleiben Dateien in `data/tresor/`, und gesichert wird per Dateikopie.

## Module

Ein Feature = ein Backend-Modul (`server/src/modules/<name>.ts`, eintragen in
`serverModules`) + ein Frontend-Modul (`web/src/modules/<name>/`, eintragen in
`dashboardModules` in `web/src/core/modules.tsx`). Der Kern bleibt unangetastet.

Zwei Pflichten im Backend-Modul:

- Router mit **`machRouter()`** aus `server/src/route.ts` bauen, nie mit
  `Router()`. Express 4 kennt keine abgelehnten Versprechen — ohne diese Hülle
  bekommt eine gescheiterte Anfrage nie eine Antwort, der Browser dreht sich.
- Tabellen und Migrationen in **`einrichten()`** anlegen, nicht im Dateirumpf.
  `index.ts` ruft das der Reihe nach auf, bevor der Server lauscht.

## Tresor

Das Modul `tresor` verschlüsselt im Browser (AES-256-GCM, Schlüssel aus dem
Master-Passwort). **In einer benutzten Installation liegen dort die
empfindlichsten Daten des ganzen Programms** — Ausweisnummern, Steuer-ID,
Versicherungsnummern. Niemals auf einer laufenden Instanz testen: Testskripte
brechen ab, wenn `/api/tresor/status` bereits `eingerichtet` meldet. Für Tests
eine isolierte Zweitinstanz mit eigenem Datenordner starten.
