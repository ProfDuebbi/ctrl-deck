import { useState } from "react";
import { Icon } from "./Icon";
import { verschiebe } from "./moduleOrder";
import { mitUebergang, uebergangsName } from "./bewegung";
import type { DashboardModule, PlannedModule } from "./modules";

/**
 * Die Kachelwand der Startseite — umsortierbar.
 *
 * Gezogen wird ausschliesslich am Griff: `draggable` wird erst gesetzt, wenn
 * der Griff gedrueckt ist. Waere die ganze Karte dauerhaft ziehbar, wuerde
 * jeder Versuch, eine Zahl aus einer Kachel zu markieren, zum Umsortieren.
 *
 * Der Griff ist zugleich das Tastaturbedienelement: mit den Pfeiltasten
 * wandert die Karte, ohne dass man ziehen koennen muss. Eine Umsortierung, die
 * nur mit der Maus geht, ist keine.
 */
export function ModuleGrid({
  module, geplant, onOeffnen, onReihenfolge,
}: {
  module: DashboardModule[];
  geplant: PlannedModule[];
  onOeffnen: (id: string) => void;
  onReihenfolge: (ids: string[]) => void;
}) {
  const [ziehId, setZiehId] = useState<string | null>(null);
  const [griffAktiv, setGriffAktiv] = useState<string | null>(null);
  // Waehrend des Ziehens zeigt die Wand schon die neue Anordnung; gespeichert
  // wird erst beim Loslassen.
  const [vorschau, setVorschau] = useState<string[] | null>(null);
  const [ansage, setAnsage] = useState("");

  const ids = module.map((m) => m.id);
  const anzeige = vorschau ?? ids;
  const sortiert = anzeige
    .map((id) => module.find((m) => m.id === id))
    .filter((m): m is DashboardModule => !!m);

  function beenden() {
    if (vorschau && vorschau.join() !== ids.join()) {
      const neu = vorschau;
      mitUebergang(() => onReihenfolge(neu));
    }
    setZiehId(null);
    setGriffAktiv(null);
    setVorschau(null);
  }

  /** Tastatur: Karte um eine Position nach vorn oder hinten. */
  function ruecken(id: string, richtung: -1 | 1) {
    const von = ids.indexOf(id);
    const nach = von + richtung;
    if (nach < 0 || nach >= ids.length) return;
    const neu = verschiebe(ids, id, ids[nach]);
    // „Wo ist die Karte hin?" — der Browser zeigt den Weg selbst.
    mitUebergang(() => onReihenfolge(neu));
    const titel = module.find((m) => m.id === id)?.title ?? id;
    setAnsage(`${titel} auf Position ${nach + 1} von ${ids.length}`);
  }

  function griffTaste(e: React.KeyboardEvent, id: string) {
    const vor = e.key === "ArrowLeft" || e.key === "ArrowUp";
    const zurueck = e.key === "ArrowRight" || e.key === "ArrowDown";
    if (!vor && !zurueck) return;
    e.preventDefault();
    ruecken(id, vor ? -1 : 1);
  }

  return (
    <>
      <div className="grid">
        {sortiert.map((m, i) => (
          <article
            className={`card clickable accent-${m.accent} ${ziehId === m.id ? "zieht" : ""}`}
            key={m.id}
            draggable={griffAktiv === m.id}
            onDragStart={(e) => {
              setZiehId(m.id);
              setVorschau(ids);
              e.dataTransfer.effectAllowed = "move";
              // Firefox startet ohne Nutzlast gar keinen Zug.
              e.dataTransfer.setData("text/plain", m.id);
            }}
            onDragOver={(e) => {
              if (!ziehId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setVorschau((v) => verschiebe(v ?? ids, ziehId, m.id));
            }}
            onDrop={(e) => { e.preventDefault(); beenden(); }}
            onDragEnd={beenden}
          >
            <div className="card-top">
              <span
                className="card-ico"
                style={{ viewTransitionName: uebergangsName(m.id) }}
              >
                <Icon name={m.icon} />
              </span>
              <button
                className="card-griff"
                title={`${m.title} verschieben`}
                aria-label={`${m.title} verschieben — Position ${i + 1} von ${sortiert.length}. Mit den Pfeiltasten bewegen.`}
                onPointerDown={() => setGriffAktiv(m.id)}
                onPointerUp={() => setGriffAktiv(null)}
                onKeyDown={(e) => griffTaste(e, m.id)}
              >
                <Icon name="griff" />
              </button>
              <span className="card-go"><Icon name="pfeil-rechts" /></span>
            </div>
            <h3 className="card-title">
              <button className="card-link" onClick={() => onOeffnen(m.id)}>
                {m.title}
                <span className="sr-only"> öffnen</span>
              </button>
            </h3>
            <p className="card-desc">{m.description}</p>
            {m.Tile ? <div className="card-body"><m.Tile /></div> : null}
          </article>
        ))}

        {geplant.map((m) => (
          <article className={`card planned accent-${m.accent}`} key={m.title}>
            <div className="card-top">
              <span className="card-ico"><Icon name={m.icon} /></span>
              <span className="badge">geplant</span>
            </div>
            <h3 className="card-title">{m.title}</h3>
            <p className="card-desc">{m.description}</p>
          </article>
        ))}

        <article className="card add">
          <span className="plus"><Icon name="plus" /></span>
          <p className="card-desc">Hier wachsen deine nächsten Module.</p>
        </article>
      </div>

      {/* Fuer Screenreader: das Ergebnis des Verschiebens ist sonst unsichtbar. */}
      <span className="sr-only" role="status">{ansage}</span>
    </>
  );
}
