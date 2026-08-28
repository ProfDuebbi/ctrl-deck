# Änderungen

Was sich in CTRL·DECK geändert hat, neueste Fassung zuerst.

Diese Datei ist die einzige Quelle: Das Programm liest sie beim Aufruf von
„Was ist neu" ein und zeigt sie an. Der Aufbau ist deshalb verbindlich —
`## Version — TT.MM.JJJJ`, darunter `### Neu` / `### Geändert` / `### Behoben`
und darunter Punkte mit `-`. Wer eine Zeile ergänzt, ändert damit zugleich das,
was in der Oberfläche steht.

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
