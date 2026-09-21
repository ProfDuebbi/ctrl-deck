import type { CSSProperties } from "react";
import { Icon } from "../../core/Icon";
import {
  RahmenZaehler, zustandKlasse, zustandText,
  type RahmenProps, type RahmenPunkt,
} from "../../core/Rahmen";

/**
 * Der Rahmen der Haut „Nexus": Kopfzeile oben, Icon-Schiene links.
 *
 * Er benutzt die echten Klassen des Kits (`.nx-top`, `.nx-rail`,
 * `.nx-content`) — deshalb liegt er hier und nicht in `core/`: er gehoert
 * zur Haut und faellt mit ihr weg.
 *
 * Was anders verteilt ist als im klassischen Rahmen und warum:
 *
 *   - Die MARKE steht oben, nicht ueber der Navigation. Dadurch bleibt die
 *     Schiene reine Navigation und darf schmal werden, ohne ihren Kopf zu
 *     verlieren.
 *   - Die SUCHE ist ein Knopf in der Kopfzeile mit sichtbarem Kuerzel. Sie
 *     gilt fuer die ganze App, nicht fuer ein Modul — in einer Liste von
 *     Modulen stuende sie an der falschen Stelle.
 *   - Der PROFILKNOPF steht oben rechts statt neben jeder Ueberschrift. Im
 *     klassischen Rahmen wiederholt er den Namen aus der Begruessung; hier
 *     ist er der eine feste Platz fuer „wer bin ich".
 *   - Der ZUSTAND („Backend verbunden") ist eine Pille neben dem Profil.
 *     Unten in der Schiene faende ihn niemand, solange sie eingeklappt ist.
 */
export function RahmenNexus({
  appName, onMarke, module, geplant, suche, werkzeuge,
  online, eingeklappt, onEingeklappt, profil, ueberlagerung, children,
}: RahmenProps) {
  return (
    <div className="nx nx-app haut-nexus">
      <a className="skip-link" href="#inhalt">Zum Inhalt springen</a>
      <div className="nx-glow" aria-hidden="true" />

      <header className="nx-top">
        <div className="nx-top-left">
          <button className="nx-brand" onClick={onMarke} type="button">
            <img src="/ctrl_logo.png" alt="" />
            <span className="nx-brand-text"><Markenname name={appName} /></span>
            <span className="sr-only">— zur Übersicht</span>
          </button>
        </div>

        <button className="nx-searchbtn" onClick={suche.onClick} type="button" title={suche.hinweis}>
          <Icon name={suche.icon} />
          {suche.titel}
          {suche.taste && <span className="nx-kbd">{suche.taste}</span>}
        </button>

        <div className="nx-top-right">
          {/* Die Pille traegt Farbe UND Wort — wie der Punkt im klassischen
              Rahmen ist die Farbe nie der einzige Traeger. */}
          <span
            className="nx-status"
            role="status"
            style={{ "--st": zustandFarbe(online) } as CSSProperties}
          >
            {zustandText(online)}
          </span>
          {profil}
        </div>
      </header>

      <div className={`nx-body ${eingeklappt ? "is-narrow" : ""}`}>
        <nav className="nx-rail" aria-label="Module">
          <div className="nx-rail-head">
            <span className="nx-rail-sec">Module</span>
            <button
              className="nx-rail-toggle"
              onClick={() => onEingeklappt(!eingeklappt)}
              title={eingeklappt ? "Menü ausklappen" : "Menü einklappen"}
              aria-label={eingeklappt ? "Menü ausklappen" : "Menü einklappen"}
              aria-expanded={!eingeklappt}
              type="button"
            >
              {eingeklappt ? "»" : "«"}
            </button>
          </div>

          {module.map((m) => (
            <Schienenpunkt key={m.id} punkt={m} eingeklappt={eingeklappt} />
          ))}
          {geplant.map((m) => (
            <span
              key={m.id}
              className="nx-rail-item is-geplant"
              title={m.hinweis ?? m.titel}
            >
              <Icon name={m.icon} />
              <span>{m.titel}</span>
              {m.notiz && <span className="nx-rail-ext">{m.notiz}</span>}
            </span>
          ))}

          <div className="nx-rail-sep" />
          <span className="nx-rail-sec">Werkzeug</span>
          {werkzeuge.map((w) => (
            <Schienenpunkt key={w.id} punkt={w} eingeklappt={eingeklappt} />
          ))}

          <div className="nx-rail-spacer" />
          <p className="nx-rail-foot">{appName} · lokal</p>
        </nav>

        <main className="nx-content" id="inhalt">
          <div className="nx-wrap">{children}</div>
        </main>
      </div>

      {ueberlagerung}
    </div>
  );
}

/** Ein Eintrag der Schiene — Symbol, Name, gegebenenfalls Zaehler. */
function Schienenpunkt({ punkt, eingeklappt }: { punkt: RahmenPunkt; eingeklappt: boolean }) {
  return (
    <button
      className={`nx-rail-item ${punkt.aktiv ? "nx-rail-on" : ""}`}
      onClick={punkt.onClick}
      // Eingeklappt steht kein Name daneben; dann ist der Titel die einzige
      // Auskunft darueber, wofuer das Symbol steht.
      title={eingeklappt ? punkt.titel : punkt.hinweis ?? punkt.titel}
      aria-current={punkt.aktiv ? "page" : undefined}
      type="button"
    >
      <Icon name={punkt.icon} />
      <span>{punkt.titel}</span>
      <RahmenZaehler punkt={punkt} klasse="nx-badge" />
    </button>
  );
}

/**
 * Der Name der App in der Kopfzeile.
 *
 * Das Kit setzt in der Marke EIN Wort in den Verlauf (`.nx-brand-text em`).
 * Bei „CTRL·DECK" bietet sich der Punkt als Trennstelle an — aus
 * „CTRL·DECK" wird CTRL + ·DECK im Verlauf. Wer seiner Installation einen
 * anderen Namen gegeben hat, bekommt ihn schlicht und ganz; ein Name ohne
 * erkennbare Fuge wird nicht auf Verdacht zerschnitten.
 */
function Markenname({ name }: { name: string }) {
  const stelle = name.indexOf("·");
  if (stelle <= 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, stelle)}
      <em>{name.slice(stelle)}</em>
    </>
  );
}

/** Die Bedeutungsfarben des Kits — sie faerben sich NICHT mit dem Akzent um. */
function zustandFarbe(online: boolean | null): string {
  const klasse = zustandKlasse(online);
  if (klasse === "ok") return "var(--green)";
  return klasse === "err" ? "var(--red)" : "var(--amber)";
}
