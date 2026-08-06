# CTRL·DECK — Hinweise für Claude

Privates, lokal laufendes Control-Dashboard. Vite + React + TypeScript (Port 5180)
und Express + `node:sqlite` (Port 8787). Start: `start.cmd` oder `npm run dev`.

## Gestaltung: das Hausrecht liegt bei theme.css

Diese Oberfläche hat ein **eigenes, bewusst gewähltes Design-System**. Die
verbindlichen Regeln stehen als Kommentarblock oben in
`web/src/core/theme.css` — flache, undurchsichtige Flächen, Haarlinien statt
Schatten, kleine Radien, Farbe nur dort, wo sie etwas bedeutet. Der frühere
„KI-Look" (Glasflächen, Farbnebel, Verlaufstext, große Radien) wurde im Juli
2026 absichtlich entfernt.

**Bewegung nur, wo sie etwas bedeutet** (Regel 5): Eine Animation muss eine
Frage beantworten — „wo ist die Karte hin", „woher komme ich", „ist es jetzt
offen", „wie voll ist das". Kein Anheben beim Überfahren, kein Pulsieren, keine
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

## Module

Ein Feature = ein Backend-Modul (`server/src/modules/<name>.ts`, eintragen in
`serverModules`) + ein Frontend-Modul (`web/src/modules/<name>/`, eintragen in
`dashboardModules` in `web/src/core/modules.tsx`). Der Kern bleibt unangetastet.

## Tresor

Das Modul `tresor` verschlüsselt im Browser (AES-256-GCM, Schlüssel aus dem
Master-Passwort). **In einer benutzten Installation liegen dort die
empfindlichsten Daten des ganzen Programms** — Ausweisnummern, Steuer-ID,
Versicherungsnummern. Niemals auf einer laufenden Instanz testen: Testskripte
brechen ab, wenn `/api/tresor/status` bereits `eingerichtet` meldet. Für Tests
eine isolierte Zweitinstanz mit eigenem Datenordner starten.
