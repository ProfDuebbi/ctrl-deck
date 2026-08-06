import { Avatar } from "./Avatar";

/**
 * Der Zugang zu Profil und Einstellungen: Name, daneben das Profilbild,
 * und um das Bild herum ein Zahnrad.
 *
 * Warum ein Zahnrad UM das Bild statt daneben: zwei getrennte Ziele („Profil"
 * und „Einstellungen") waeren zwei Klicks fuer dieselbe Seite. Der Ring sagt
 * „hier laesst sich etwas einstellen", das Bild sagt „und zwar an dir".
 *
 * Zur Bewegung — Regel 5 in theme.css sagt, Bewegung muss eine Frage
 * beantworten. Hier ist die Frage „kann ich das anklicken?". Deshalb rastet
 * das Rad beim Ueberfahren um GENAU EINEN ZAHN weiter und bleibt dann stehen,
 * statt zu kreiseln: ein Mechanismus, der reagiert, keine Zierschleife. Bei
 * `prefers-reduced-motion` schaltet die globale Regel am Dateiende sie ab.
 */

export function ProfilKnopf({
  name,
  bild,
  aktiv,
  onClick,
}: {
  name: string;
  bild: string | null;
  aktiv: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`profil-knopf ${aktiv ? "aktiv" : ""}`}
      onClick={onClick}
      title="Profil & Einstellungen"
      aria-current={aktiv ? "page" : undefined}
    >
      {/* Kein Name am Knopf: er steht direkt neben „Gute Nacht, <Name>",
          dort ist er schon gesagt. Zweimal derselbe Name nebeneinander liest
          sich wie ein Fehler. */}
      <span className="profil-knopf-ring">
        {/*
          Das Rad ist ein Bild (`web/public/profil_rad.png`), kein SVG: es
          stammt aus `bilder/radp.png` und traegt einen Farbverlauf und
          Leuchtschein, den Konturen nicht nachbilden koennen. Die Schwaerze
          des Originals wurde in einen Alphakanal umgerechnet, damit es ueber
          jedem Hintergrund sitzt statt in einem dunklen Viereck.

          Nur das Rad dreht sich — der Avatar liegt darueber und steht still.
          Ein mitdrehendes Gesicht waere ein Karussell, kein Mechanismus.
        */}
        <img className="zahnrad" src="/profil_rad.png" alt="" aria-hidden="true" />
        <Avatar name={name} bild={bild} groesse={30} />
      </span>
      <span className="sr-only">Profil und Einstellungen öffnen</span>
    </button>
  );
}
