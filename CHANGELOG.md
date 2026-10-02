# Änderungen

Was sich in CTRL·DECK geändert hat, neueste Fassung zuerst.

Diese Datei ist die einzige Quelle: Das Programm liest sie beim Aufruf von
„Was ist neu" ein und zeigt sie an. Der Aufbau ist deshalb verbindlich —
`## Version — TT.MM.JJJJ`, darunter `### Neu` / `### Geändert` / `### Behoben`
und darunter Punkte mit `-`. Wer eine Zeile ergänzt, ändert damit zugleich das,
was in der Oberfläche steht.

## 0.4.0 — 03.10.2026

### Neu
- **Ein zweites Aussehen: „Nexus".** Die Oberfläche kann jetzt zwei Häute
  tragen. Die **Instrumententafel** bleibt die Vorgabe und ändert sich um
  kein Pixel: flache Flächen, Haarlinien, Farbe nur da, wo sie etwas
  bedeutet. Daneben steht **Nexus** — gestapelte Flächen, runde Ecken, eine
  Kopfzeile mit Marke, Suche und Profil, eine Icon-Schiene statt der
  Seitenleiste und Licht im Hintergrund. Umgeschaltet wird unter
  **Einstellungen → Aussehen**; die Wahl gilt für den Browser, in dem du
  gerade sitzt, nicht für das Dashboard. Alle Module ziehen ohne eigenes
  Zutun mit.
- **Nexus baut die Seiten neu auf, statt sie nur umzufärben.** Den Anfang
  machen die Übersicht und die Aufgaben: Der Kopf der Startseite hat keinen Rahmen mehr:
  Das Kopfbild ist der Hintergrund, randlos von der Schiene bis zum Rand, und
  läuft nach unten weich in die Seite aus. Die Begrüßung steht groß darauf,
  die Uhr frei daneben, das Wetter als Glasleiste. Ohne Bild leuchtet dort
  die Akzentfarbe. Die Modulkarten sind Kacheln wie im Nexus-Kit: jedes Modul
  hat einen eigenen Farbton als Schleier, sein Symbol steht groß und blass
  in der Ecke, und die wichtigste Zahl leuchtet in der Kachelfarbe. Die Aufgaben stehen in einer Liste statt
  in einem Kartenstapel, und das Titelfeld steht groß und für sich allein.
  **Inzwischen sind alle Module umgebaut:** Kennzahlen stehen als eigene
  Kacheln, Termine, Verträge, Fahrzeugfristen und die nächsten Geburtstage
  als durchgehende Listen mit rundem Farbbalken, Reiter als eingelassene
  Leiste, Filter als Pillen. Die Stempeluhr ist eine große Bühne, die grün
  leuchtet, solange sie läuft, und der Tresor empfängt mit einem
  leuchtenden Schloss. Bearbeiten und Löschen erscheinen in Tabellen und
  Listen erst, wenn man bei der Zeile ist.
- **Eine Farbe färbt alles.** In der Haut „Nexus" hängt das ganze Bild an
  einer Akzentfarbe: Knöpfe, der aktive Punkt in der Schiene, der Fokusring
  und der Marken-Verlauf. Fünf Vorschläge stehen bereit, jede andere Farbe
  lässt sich frei wählen — Helligkeit und Sättigung werden dabei so
  nachgezogen, dass heller Text auf einem Knopf lesbar bleibt. **Grün,
  Bernstein und Rot ändern sich nicht mit:** sie bedeuten etwas, und was
  „Fehler" heißt, darf keine Geschmacksfrage werden.
- **Inhaltsbreite einstellbar** — Schmal, Mittel, Breit oder Voll, unter
  **Einstellungen → Aussehen** und in beiden Häuten wirksam. Auf einem sehr
  breiten Schirm blieben links und rechts sonst hunderte Pixel leer,
  ausgerechnet auf einer Kachelwand, deren Zweck es ist, viel auf einmal zu
  zeigen. Vorgabe ist „Voll".
- **Die Stechuhr hat eine Projektübersicht.** Bisher ließen sich Projekte nur
  aus einer fertigen Liste auswählen; wer eines anlegen, umbenennen oder
  abschließen wollte, musste erst ein Fenster öffnen. Jetzt stehen sie offen
  auf der Seite: jedes Projekt mit erfasster Zeit, Zeit dieser Woche, Zahl der
  Einträge und letztem Tag. In jeder Zeile lässt sich direkt **einstempeln**
  (läuft schon etwas, heißt der Knopf „Wechseln" und bucht die laufende Zeit
  weg), oben im Feld ein **neues Projekt eröffnen**, und rechts eines
  **beenden**. Beendete Projekte liegen zugeklappt darunter und lassen sich
  jederzeit wieder öffnen.
- **„Beenden" ist nicht „Löschen".** Ein beendetes Projekt verschwindet nur
  aus der Stempelauswahl. Seine Einträge behalten Name und Farbe, zählen
  weiter in jeder Auswertung und tragen dort das Kennzeichen „beendet".
  Läuft die Uhr noch auf dem Projekt, wird sie vorher ausgestempelt, damit die
  Minuten gebucht werden statt ins Leere zu laufen. Nur das **Löschen** löst
  die Zuordnung — es sagt jetzt vorher, wie viele Stunden das betrifft, und
  verweist auf „Beenden".

### Behoben
- **Zwei Menüpunkte gleichzeitig als aktuelle Seite markiert.** Stand man in
  „Was ist neu", zeigte die Seitenleiste zusätzlich „Übersicht" als aktiv an.
- **„Was ist neu" meldet zuverlässig.** Bis jetzt merkte sich das Programm die
  zuletzt gelesene Fassung an ihrem **Namen** — und eine Fassung heißt erst
  „Unveröffentlicht" und trägt beim Release plötzlich eine Nummer. Wer sie
  vorher gelesen hatte, dessen Merkzeichen zeigte danach ins Leere, und
  ausgerechnet die erste Meldung nach einer Veröffentlichung fiel stillschweigend
  aus. Gemerkt wird jetzt zusätzlich, **wie viele** Fassungen es damals gab; das
  übersteht jedes Umbenennen. Bestehende Installationen tragen das beim ersten
  Aufruf von selbst nach.

## 0.3.1 — 28.08.2026

### Neu
- **Modul GTA VI** — ein Countdown bis zum 19. November 2026, sekundengenau,
  mit Fortschritt seit dem ersten Trailer und Marken auf dem Weg („noch ein
  halbes Jahr", „zum letzten Mal dreistellig", „der letzte Monat"). Ist der
  Tag da, treten die Ziffern ab und es steht nur noch „Es ist so weit."
  Das Modul speichert nichts und fragt nichts ab — es rechnet mit der Uhr
  dieses Rechners. **Es ist zugleich die einzige bewusste Ausnahme vom
  Hausstil:** Sonnenuntergang, Neon und Leuchtschrift, begründet in
  `web/src/modules/gta6/gta6.css`.

## 0.3.0 — 27.08.2026

### Neu
- **Modul Notizen** — freier Text mit einer Werkzeugleiste wie in einem
  Textprogramm, Schlagworten, Wiedervorlage und Papierkorb. Gespeichert wird
  trotzdem schlichtes Markdown. Einzelne Notizen lassen sich mit dem
  Tresor-Schlüssel verschlüsseln.
- **Modul Dokumente** — ein Aktenschrank mit Fächern. Die Datei ist optional:
  Ein Eintrag darf auch nur festhalten, wo das Papier liegt. PDF und Bilder
  lassen sich direkt ansehen, ohne sie vorher auszupacken; Ablaufdaten wandern
  in den Terminfaden, und jedes Dokument kann einzeln verschlüsselt werden.
- **Dateien ablegen** — Dateien lassen sich auf ein Fach ziehen oder über einen
  Knopf auswählen; für jede entsteht ein Eintrag, der gleich im richtigen Fach
  liegt.
- **Außenstände mit Verlauf** — zu einem bestehenden Eintrag lassen sich neue
  Schulden hinzufügen. Geliehenes und Zurückgezahltes stehen in einer
  gemeinsamen Zeitleiste, jede Zeile ist einzeln bearbeitbar, und die Summe
  ergibt sich daraus, statt frei eingetippt zu werden.
- **Was ist neu** — dieser Bereich.

### Geändert
- Sicherungen legen die verschlüsselten Anhänge nach Bestand getrennt ab
  (`tresor/`, `dokumente/`). Ältere Sicherungen bleiben einspielbar.
- Das kleine Schloss zum Aufschließen gehört jetzt zum Tresor, statt beim
  Modul zu liegen, das es zuerst gebraucht hat.

### Behoben
- Zwei Scrollbalken am rechten Rand, sobald die Modulwand über eine
  Bildschirmhöhe hinauswuchs.
- Die Suchfelder in Notizen und Dokumenten sahen anders aus als alle anderen
  Eingabefelder.
- Ein Dokument, das nachträglich auf „verschlüsselt" gestellt wurde, ließ seine
  bereits angehängten Dateien im Klartext liegen.
- Dateinamen mit Umlauten ließen sich nicht hochladen.

## 0.2.0 — 17.08.2026

### Neu
- Eine eigene Datenbank lässt sich anschließen (`DB_URL`). Ohne diese
  Einstellung bleibt alles wie bisher bei der lokalen Datei.

## 0.1.0 — 06.08.2026

### Neu
- Erste Fassung mit Übersicht, Terminfaden, Lärmprotokoll, Stechuhr,
  Zählerständen, Aufgaben, Haushalt, Geburtstagen, Fahrzeug und Tresor.
- Profil als Jahresrückblick und eine zweite Übersicht mit Diagrammen.
- Profil, Einstellungen und ein einstellbarer Kopfbereich.
