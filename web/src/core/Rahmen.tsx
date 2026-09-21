import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Der Rahmen — Marke, Navigation, Werkzeuge, Zustand, Inhalt.
 *
 * Es gibt zwei davon: die gewachsene Seitenleiste (`RahmenKlassisch`, unten
 * in dieser Datei) und die Schiene mit Kopfzeile der Haut „Nexus"
 * (`haut/nexus/RahmenNexus.tsx`). `App` weiss von beiden nichts weiter, als
 * dass sie diesen Vertrag erfuellen.
 *
 * Warum ein Vertrag aus DATEN und nicht aus fertigem JSX: Die beiden Rahmen
 * setzen dieselben Punkte unterschiedlich — der eine als breite Zeile mit
 * Beschriftung, der andere als Symbol in einer Schiene, mit dem Namen erst
 * beim Ausklappen. Wer hier fertige Knoepfe hereinreichte, koennte im
 * zweiten Rahmen nur noch ihr Aussehen uebersteuern, nicht ihren Aufbau.
 */

/** Ein Punkt in der Navigation oder in der Werkzeugleiste. */
export interface RahmenPunkt {
  id: string;
  titel: string;
  icon: IconName;
  /** Nur zum Lesen da: `undefined` heisst „nicht anklickbar" (geplantes Modul). */
  onClick?: () => void;
  aktiv?: boolean;
  /** React-Hook fuer den Live-Zaehler. Wird IMMER aufgerufen, auch bei 0. */
  useZaehler?: () => number;
  /** Fester Zaehler, wenn die Zahl schon feststeht (z.B. neue Fassungen). */
  zaehler?: number;
  /** Erklaert den Punkt beim Ueberfahren — und beschriftet ihn, wenn die
   *  Schiene eingeklappt ist und der Name nicht danebensteht. */
  hinweis?: string;
  /** Tastenkuerzel, das neben dem Namen steht (nur „Suchen"). */
  taste?: string;
  /** Randnotiz statt Zaehler — „bald" bei geplanten Modulen. */
  notiz?: string;
  /** Wofuer der Zaehler zaehlt. Steht im Titel und fuer Screenreader hinter
   *  der Zahl — „3" allein ist ohne dieses Wort keine Auskunft. */
  zaehlerWort?: string;
}

export interface RahmenProps {
  appName: string;
  /** Klick auf die Marke — fuehrt zur Uebersicht. */
  onMarke: () => void;
  module: RahmenPunkt[];
  geplant: RahmenPunkt[];
  /** Die globale Suche. Steht getrennt, weil der Nexus-Rahmen sie in die
   *  Kopfzeile hebt und nicht in die Schiene stellt. */
  suche: RahmenPunkt;
  /** Backups, „Was ist neu", Abmelden. */
  werkzeuge: RahmenPunkt[];
  /** `null` heisst „verbindet noch". */
  online: boolean | null;
  eingeklappt: boolean;
  onEingeklappt: (b: boolean) => void;
  /** Der Profilknopf. Der klassische Rahmen zeigt ihn nicht — dort steht er
   *  im Kopfbereich jeder Seite; der Nexus-Rahmen setzt ihn in die Kopfzeile. */
  profil: ReactNode;
  /** Dialoge, die ueber allem liegen (Suche, Backups, Modulwahl). Sie stehen
   *  NEBEN dem Layout, nicht darin: ein Dialog gehoert keinem Bereich. */
  ueberlagerung?: ReactNode;
  children: ReactNode;
}

/** Rendert den Live-Zaehler eines Punktes (ruft den Hook unbedingt auf). */
export function RahmenZaehler({ punkt, klasse }: { punkt: RahmenPunkt; klasse: string }) {
  // Der Hook MUSS bei jedem Rendern laufen — deshalb eine eigene Komponente
  // je Punkt und kein `punkt.useZaehler?.()` mitten in einer Schleife.
  const gezaehlt = punkt.useZaehler?.() ?? punkt.zaehler ?? 0;
  if (gezaehlt <= 0) return null;
  const wort = punkt.zaehlerWort ?? "fällig";
  return (
    <span className={klasse} title={`${gezaehlt} ${wort}`}>
      {gezaehlt}
      <span className="sr-only"> {wort}</span>
    </span>
  );
}

/** Text fuer die Zustandsanzeige — in beiden Rahmen derselbe Wortlaut. */
export function zustandText(online: boolean | null): string {
  if (online === null) return "verbinde…";
  return online ? "Backend verbunden" : "Backend offline";
}

export function zustandKlasse(online: boolean | null): string {
  if (online === null) return "wait";
  return online ? "ok" : "err";
}

// --- Der klassische Rahmen: Seitenleiste links ---------------------------

/**
 * Das gewachsene Aussehen. Markup und Klassen sind unveraendert aus `App`
 * hierher gezogen — wer die Haut zurueckstellt, bekommt exakt dieselbe
 * Oberflaeche wie vorher, bis auf das letzte Pixel.
 */
export function RahmenKlassisch({
  appName, onMarke, module, geplant, suche, werkzeuge,
  online, eingeklappt, onEingeklappt, ueberlagerung, children,
}: RahmenProps) {
  const werkzeugleiste = [suche, ...werkzeuge];

  return (
    <div className={`app ${eingeklappt ? "collapsed" : ""}`}>
      <a className="skip-link" href="#inhalt">Zum Inhalt springen</a>

      <aside className="sidebar">
        <div className="sidebar-head">
          <button className="brand" onClick={onMarke}>
            <img className="brand-logo" src="/ctrl_logo.png" alt="" />
            <span className="brand-name">{appName}</span>
            <span className="sr-only">— zur Übersicht</span>
          </button>
          <button
            className="sidebar-toggle"
            onClick={() => onEingeklappt(!eingeklappt)}
            title={eingeklappt ? "Menü ausklappen" : "Menü einklappen"}
            aria-label={eingeklappt ? "Menü ausklappen" : "Menü einklappen"}
            aria-expanded={!eingeklappt}
          >
            {eingeklappt ? "»" : "«"}
          </button>
        </div>

        <nav className="nav" aria-label="Module">
          {module.map((m) => (
            <button
              key={m.id}
              className={`nav-item ${m.aktiv ? "active" : ""}`}
              onClick={m.onClick}
              title={m.hinweis ?? m.titel}
              aria-current={m.aktiv ? "page" : undefined}
            >
              <span className="nav-ico"><Icon name={m.icon} /></span>{" "}
              <span className="nav-label">{m.titel}</span>
              <RahmenZaehler punkt={m} klasse="nav-badge" />
            </button>
          ))}
          {geplant.map((m) => (
            <span className="nav-item disabled" key={m.id} title={m.hinweis ?? m.titel}>
              <span className="nav-ico"><Icon name={m.icon} /></span>{" "}
              <span className="nav-label">{m.titel}</span>
              {m.notiz && <span className="soon">{m.notiz}</span>}
            </span>
          ))}
        </nav>

        <div className="sidebar-tools">
          {werkzeugleiste.map((w) => (
            <button
              key={w.id}
              className={`backup-btn ${w.aktiv ? "active" : ""}`}
              onClick={w.onClick}
              title={w.hinweis ?? w.titel}
              aria-current={w.aktiv ? "page" : undefined}
            >
              <span className="nav-ico"><Icon name={w.icon} /></span>{" "}
              <span className="nav-label">{w.titel}</span>
              {w.taste && <kbd className="nav-kbd">{w.taste}</kbd>}
              <RahmenZaehler punkt={w} klasse="nav-badge" />
            </button>
          ))}
          {/* Der farbige Punkt wiederholt nur, was daneben als Wort steht —
              Farbe ist hier nie der einzige Traeger der Information. */}
          <div className="status" role="status">
            <span className={`dot ${zustandKlasse(online)}`} aria-hidden="true" />
            <span className="nav-label">{zustandText(online)}</span>
          </div>
        </div>
      </aside>

      <main className="main" id="inhalt">{children}</main>
      {ueberlagerung}
    </div>
  );
}
