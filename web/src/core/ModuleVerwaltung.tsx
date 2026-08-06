import { Modal } from "./ui";
import { Icon } from "./Icon";
import type { DashboardModule } from "./modules";

/**
 * „Welche Module willst du sehen?"
 *
 * Ausblenden ist ausdruecklich kein Loeschen: Die Daten bleiben liegen, die
 * Routen bleiben erreichbar, nur Kachelwand und Seitenleiste lassen das Modul
 * weg. Wer es wieder einblendet, findet alles vor.
 *
 * Nicht jeder braucht ein Laermprotokoll. Genau das ist der Grund, warum es
 * diesen Dialog gibt — und die Vorstufe zu einem Modul-Store, in dem man
 * spaeter auswaehlt, was ueberhaupt mitkommt.
 */
export function ModuleVerwaltung({
  module,
  versteckt,
  umschalten,
  onClose,
}: {
  module: DashboardModule[];
  versteckt: string[];
  umschalten: (id: string) => void;
  onClose: () => void;
}) {
  const sichtbar = module.length - versteckt.length;

  return (
    <Modal title="Module ein- und ausblenden" onClose={onClose}>
      <p className="modal-msg">
        Ausgeblendete Module verschwinden aus Übersicht und Seitenleiste.
        <strong> Es werden keine Daten gelöscht</strong> — beim Einblenden ist alles wieder da.
      </p>

      <ul className="mv-liste">
        {module.map((m) => {
          const aus = versteckt.includes(m.id);
          return (
            <li className={`mv-zeile ${aus ? "aus" : ""}`} key={m.id}>
              <span className={`mv-ico a-${m.accent}`} aria-hidden="true"><Icon name={m.icon} /></span>
              <span className="mv-text">
                <span className="mv-titel">{m.title}</span>
                <span className="mv-beschreibung">{m.description}</span>
              </span>
              <label className="mv-schalter">
                <input
                  type="checkbox"
                  checked={!aus}
                  onChange={() => umschalten(m.id)}
                  aria-label={`${m.title} ${aus ? "einblenden" : "ausblenden"}`}
                />
                <span>{aus ? "aus" : "an"}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="mv-fuss">
        {sichtbar} von {module.length} Modulen sichtbar
        {sichtbar === 0 && " — die Übersicht ist damit leer."}
      </p>
    </Modal>
  );
}
