import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * Das Profilbild — oder, solange keines da ist, die Initialen.
 *
 * Warum ueberhaupt ein Ersatz: ein leerer Kreis sieht aus wie ein Ladefehler.
 * Die Initialen sind ab der ersten Sekunde da (der Name kommt mit `/me`,
 * lange bevor jemand ein Bild hochlaedt) und lassen den Platz fertig
 * aussehen, statt zum Hochladen zu draengen.
 *
 * Die Farbe wird aus dem Namen abgeleitet statt zufaellig gewaehlt: derselbe
 * Mensch bekommt so immer denselben Ton, und zwar auf jedem Geraet, ohne dass
 * dafuer etwas gespeichert werden muss.
 */

/** Aus „Alex" → „A", aus „Anna Meier" → „AM". Mehr als zwei nie. */
export function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return "";
  const ersteZeichen = (s: string) => [...s][0] ?? ""; // [...] wegen Emoji/Umlauten
  if (teile.length === 1) return ersteZeichen(teile[0]).toUpperCase();
  return (ersteZeichen(teile[0]) + ersteZeichen(teile[teile.length - 1])).toUpperCase();
}

/**
 * Die drei Akzentfarben der App, nichts Neues erfunden (Regel 3: Farbe nur,
 * wo sie etwas bedeutet — hier bedeutet sie „du").
 */
const TOENE = ["blue", "violet", "pink"] as const;

function tonFuer(name: string): (typeof TOENE)[number] {
  let summe = 0;
  for (const z of name) summe = (summe + z.codePointAt(0)!) % 9973;
  return TOENE[summe % TOENE.length];
}

export function Avatar({
  name,
  bild,
  groesse = 32,
}: {
  name: string;
  bild: string | null;
  /** Kantenlaenge in px. Die Schrift skaliert mit, damit nichts anstoesst. */
  groesse?: number;
}) {
  const kuerzel = initialen(name);
  const stil = { width: groesse, height: groesse, fontSize: Math.round(groesse * 0.38) };

  /**
   * Laesst sich das Bild nicht laden, faellt der Avatar auf die Initialen
   * zurueck — nicht auf ein Loch.
   *
   * Vorher blendete `onError` das <img> nur aus; uebrig blieb ein leerer
   * Kreis, der wie ein Ladefehler aussah. Genau das ist beim Testen passiert,
   * als etwas in der Datenbank stand, das kein Bild war. Ein Avatar hat immer
   * etwas zu zeigen: den Menschen gibt es ja.
   */
  const [kaputt, setKaputt] = useState(false);
  // Ein neues Bild verdient einen neuen Versuch.
  useEffect(() => { setKaputt(false); }, [bild]);

  if (bild && !kaputt)
    return (
      <img
        className="avatar"
        src={bild}
        alt=""
        style={stil}
        onError={() => setKaputt(true)}
      />
    );

  return (
    <span className={`avatar avatar-text ton-${tonFuer(name)}`} style={stil} aria-hidden="true">
      {kuerzel || <Icon name="person" />}
    </span>
  );
}
