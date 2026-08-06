import React, { useEffect, useState } from "react";
import { DiagrammKarte } from "./Diagramm";
import { ladeDiagramme, ZEITRAEUME, type Diagrammsatz } from "./diagramme";
import { dashboardModules } from "./modules";
import { Icon, type IconName } from "./Icon";

/**
 * Die Übersicht als Bild statt als Kachelwand.
 *
 * Die Kachelwand beantwortet „wie steht es gerade?" — jede Kachel eine
 * Momentaufnahme. Sie kann nicht beantworten, wie es dorthin gekommen ist.
 * Diese Ansicht zeigt dieselben Module in der anderen Zeitform: Verläufe,
 * Verteilungen, Ein und Aus.
 *
 * EINE Zeitraum-Leiste über allem, nicht ein Filter je Karte. Vier
 * verschiedene Zeiträume nebeneinander wären vier Bilder, die man nicht
 * vergleichen darf, obwohl sie nebeneinander liegen.
 */

const ZEITRAUM_SPEICHER = "cd_diagramme_monate";

function modulInfo(id: string): { icon: IconName; accent: string } {
  const m = dashboardModules.find((x) => x.id === id);
  return { icon: m?.icon ?? "uebersicht", accent: m?.accent ?? "blue" };
}

export function DiagrammAnsicht({
  onModul,
  wechsel,
}: {
  onModul: (id: string) => void;
  /** Der Umschalter zwischen den beiden Ansichten — kommt von aussen, damit
      er in beiden an derselben Stelle steht. */
  wechsel: React.ReactNode;
}) {
  const [monate, setMonate] = useState(() => {
    // `Number(null)` ist 0 — und 0 ist ein gueltiger Wert („Alles"). Ohne die
    // ausdrueckliche Pruefung auf „nichts gespeichert" startet jeder neue
    // Browser mit dem groessten statt dem vorgesehenen Zeitraum.
    const roh = localStorage.getItem(ZEITRAUM_SPEICHER);
    const zahl = roh === null ? NaN : Number(roh);
    return ZEITRAEUME.some((z) => z.monate === zahl) ? zahl : 12;
  });
  const [satz, setSatz] = useState<Diagrammsatz | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState(false);

  useEffect(() => {
    localStorage.setItem(ZEITRAUM_SPEICHER, String(monate));
    let aktuell = true;
    setLaedt(true);
    ladeDiagramme(monate)
      .then((d) => { if (aktuell) { setSatz(d); setFehler(false); } })
      .catch(() => { if (aktuell) setFehler(true); })
      .finally(() => { if (aktuell) setLaedt(false); });
    return () => { aktuell = false; };
  }, [monate]);

  /**
   * Zwei Sorten Bild, zwei Gruppen.
   *
   * Vorher lagen Verläufe und Ranglisten in EINEM Raster. Ein Verlauf ist
   * dreimal so hoch wie eine Rangliste aus drei Zeilen — und ein Raster mit
   * ungleich hohen Kacheln reisst genau dort Löcher, wo die kurze Karte sitzt.
   * Das war kein Abstandsproblem, sondern ein Strukturproblem: die Karten
   * waren nie gleichwertig, sie standen nur im selben Raster.
   *
   * Getrennt haben die Karten einer Gruppe von sich aus ähnliche Höhe, und
   * nebenbei entsteht ein Rhythmus: erst die Entwicklung, dann die Verteilung.
   */
  const gruppen = [
    {
      id: "verlauf",
      titel: "Wie es sich entwickelt",
      unter: "je Monat",
      karten: satz?.diagramme.filter((d) => d.form !== "balken") ?? [],
    },
    {
      id: "verteilung",
      titel: "Wo es herkommt",
      unter: "Größenvergleich im Zeitraum",
      karten: satz?.diagramme.filter((d) => d.form === "balken") ?? [],
    },
  ];

  return (
    <section aria-labelledby="titel-diagramme" className="dg-ansicht">
      <div className="section-head">
        <h2 className="section-title" id="titel-diagramme">Verläufe</h2>
        <span className="section-hinweis">alle Bilder zeigen denselben Zeitraum</span>
        <div className="zeitraum-wahl" role="group" aria-label="Zeitraum">
          {ZEITRAEUME.map((z) => (
            <button
              key={z.monate}
              className={`seg-btn ${monate === z.monate ? "aktiv" : ""}`}
              onClick={() => setMonate(z.monate)}
              aria-pressed={monate === z.monate}
            >
              {z.label}
            </button>
          ))}
        </div>
        {wechsel}
      </div>

      {/* Der Satz stand vorher unter JEDEM Zeitdiagramm — siebenmal dieselbe
          Zeile. Er gilt für alle gleichermaßen und steht deshalb einmal hier:
          ohne ihn liest sich der kurze letzte Balken als Einbruch. */}
      {satz && satz.diagramme.some((d) => d.form !== "balken") && (
        <p className="dg-fussnote dg-fussnote-oben">
          Der laufende Monat ist noch nicht vorbei — der letzte Wert jeder Zeitreihe ist ein Teilmonat.
        </p>
      )}

      {fehler && (
        <p className="dg-leer"><Icon name="warnung" /> Die Auswertung ließ sich nicht laden.</p>
      )}

      {/*
        Beim Wechsel des Zeitraums bleibt das alte Bild stehen und wird nur
        blasser. Ein Skelett an seiner Stelle würde die Seite bei jedem Klick
        zusammenfallen und wieder aufspringen lassen.
      */}
      {satz && (
        <div className={`dg-gruppen ${laedt ? "laedt" : ""}`}>
          {gruppen.map(
            (g) =>
              g.karten.length > 0 && (
                <div className="dg-gruppe" key={g.id}>
                  <h3 className="dg-gruppe-titel">
                    {g.titel}
                    <span className="dg-gruppe-unter">{g.unter}</span>
                  </h3>
                  {/* Zeilen statt Raster: die letzte Zeile teilt sich die Breite
                      unter ihren Karten auf, statt Löcher zu lassen. */}
                  <div className="dg-zeilen">
                    {g.karten.map((d) => (
                      <DiagrammKarte
                        key={d.id}
                        daten={d}
                        lauf={`${d.id}:${monate}`}
                        ikon={modulInfo(d.modul).icon}
                        akzent={modulInfo(d.modul).accent}
                        onModul={onModul}
                      />
                    ))}
                  </div>
                </div>
              )
          )}
        </div>
      )}

      {satz && satz.diagramme.length === 0 && !laedt && (
        <p className="dg-leer">
          <Icon name="uebersicht" />
          In diesem Zeitraum gibt es noch nichts zu zeigen. Trage etwas ein oder wähle einen längeren Zeitraum.
        </p>
      )}

      {satz && satz.fehler.length > 0 && (
        <p className="dg-leer klein">
          <Icon name="warnung" /> Ohne Bild geblieben: {satz.fehler.join(", ")}.
        </p>
      )}
    </section>
  );
}
