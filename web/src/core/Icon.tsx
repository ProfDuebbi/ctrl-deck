/**
 * Ein einziger Symbolsatz fuer die ganze App.
 *
 * Warum ueberhaupt: vorher standen ueberall Emoji (🗑 ✎ 🔊 …). Die kommen aus
 * der Schriftart des Betriebssystems, sind mehrfarbig, unterschiedlich gross,
 * unterschiedlich stark gezeichnet und sehen auf Windows, Linux und im PDF
 * jeweils anders aus. In einer Instrumententafel ist das der lauteste Bruch.
 *
 * Regeln fuer neue Symbole:
 * - 24×24-Raster, `viewBox="0 0 24 24"`
 * - nur Kontur, keine Fuellung; Strichstaerke 1.5; runde Enden und Ecken
 * - `currentColor`, damit das Symbol die Farbe seines Textes uebernimmt
 * - Groesse ueber `font-size` des Elternelements (Standard: 1em)
 * - rein dekorativ: das <svg> ist immer aria-hidden. Steht das Symbol allein
 *   in einem Knopf, MUSS der Knopf ein aria-label oder title tragen.
 */

const P = ({ d }: { d: string }) => <path d={d} />;

const SYMBOLE = {
  // --- Module ---------------------------------------------------------
  laerm: (
    <>
      <P d="M11 5 6 9H3v6h3l5 4z" />
      <P d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4" />
      <P d="M18.4 5.9a8.5 8.5 0 0 1 0 12.2" />
    </>
  ),
  stechuhr: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <P d="M12 9.5v4h3" />
      <P d="M9.5 2h5" />
      <P d="M12 2v2.5" />
      <P d="M19.5 6.5 21 5" />
    </>
  ),
  // Skalenstriche waren bei 22px nur noch Rauschen — Bogen und Zeiger reichen.
  zaehler: (
    <>
      <P d="M4 17.5a8 8 0 0 1 16 0" />
      <P d="M12 17.5 16 13" />
      <circle cx="12" cy="17.5" r="1" />
    </>
  ),
  aufgaben: (
    <>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <P d="M8 12.5l2.8 2.8L16 10" />
      <P d="M8.5 2.5v3M15.5 2.5v3" />
    </>
  ),
  // Geldschein mit Mittelkreis wurde bei kleiner Groesse zur Kamera gelesen.
  // Geldboerse mit Verschluss ist eindeutiger.
  haushalt: (
    <>
      <rect x="3" y="5.5" width="18" height="14" rx="2.5" />
      <P d="M3 10h18" />
      <circle cx="16.5" cy="15" r="1.4" />
    </>
  ),
  geburtstage: (
    <>
      <P d="M3.5 21h17" />
      <P d="M5.5 21v-6.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2V21" />
      <P d="M12 12.5V9" />
      <P d="M12 5.2c.9.9.9 1.9 0 2.8-.9-.9-.9-1.9 0-2.8z" />
      <P d="M5.5 16.5c1.6 0 1.6 1.4 3.3 1.4s1.6-1.4 3.2-1.4 1.6 1.4 3.3 1.4 1.6-1.4 3.2-1.4" />
    </>
  ),
  // Panzerschrank: Kasten mit Drehknauf. Ein blosses Schloss waere hier
  // zweideutig — das steht schon fuer den Zustand "verschlossen".
  tresor: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="10.5" cy="12" r="3.5" />
      <P d="M10.5 12h3.5" />
      <P d="M17.5 9.5v5" />
      <P d="M6 19.5V21M18 19.5V21" />
    </>
  ),

  // --- Navigation -----------------------------------------------------
  uebersicht: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  backup: (
    <>
      <P d="M12 3v11" />
      <P d="M8 10.5l4 4 4-4" />
      <P d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),

  // --- Aktionen -------------------------------------------------------
  bearbeiten: (
    <>
      <P d="M4 20h4L18.5 9.5a2.5 2.5 0 0 0-4-4L4 16v4z" />
      <P d="M13.5 6.5l4 4" />
    </>
  ),
  loeschen: (
    <>
      <P d="M4 7h16" />
      <P d="M9.5 4h5" />
      <P d="M6.5 7l.8 12.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7" />
      <P d="M10.5 11v6M13.5 11v6" />
    </>
  ),
  plus: <P d="M12 5v14M5 12h14" />,
  // Zwei Punktreihen — die uebliche Kennzeichnung fuer „hier anfassen".
  // Als Kontur gezeichnet, damit sie zum uebrigen Satz passt.
  griff: (
    <>
      <circle cx="9" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="18" r="1" />
    </>
  ),
  schloss: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
      <P d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
      <P d="M12 14.5v2.5" />
    </>
  ),
  "schloss-offen": (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
      <P d="M8 10.5V7a4 4 0 0 1 7.8-1.2" />
      <P d="M12 14.5v2.5" />
    </>
  ),
  schluessel: (
    <>
      <circle cx="8" cy="15.5" r="4" />
      <P d="M11 12.5 20 3.5" />
      <P d="M17 6.5l2.5 2.5M14.5 9l2 2" />
    </>
  ),
  auge: (
    <>
      <P d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "auge-zu": (
    <>
      <P d="M3.5 8.5c2 2.6 4.8 4.5 8.5 4.5s6.5-1.9 8.5-4.5" />
      <P d="M5 12.5 3 15M19 12.5 21 15M9.5 14.3 8.7 17.4M14.5 14.3l.8 3.1" />
    </>
  ),
  anhang: (
    <P d="M21.4 11.1 12.3 20.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
  ),
  schliessen: <P d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  suchen: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <P d="M15.8 15.8 20.5 20.5" />
    </>
  ),
  export: (
    <>
      <P d="M12 4v11" />
      <P d="M8 11.5l4 4 4-4" />
      <P d="M5 20h14" />
    </>
  ),
  dokument: (
    <>
      <P d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <P d="M13.5 3v5.5H19" />
      <P d="M9 13h6M9 16.5h4" />
    </>
  ),
  neuladen: (
    <>
      <P d="M20 12a8 8 0 1 1-2.4-5.7" />
      <P d="M20.5 4v4.5H16" />
    </>
  ),
  wiederholen: (
    <>
      <P d="M17 2.5 20.5 6 17 9.5" />
      <P d="M20.5 6H8a4 4 0 0 0-4 4v1" />
      <P d="M7 21.5 3.5 18 7 14.5" />
      <P d="M3.5 18H16a4 4 0 0 0 4-4v-1" />
    </>
  ),
  kopieren: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <P d="M5.5 15A2 2 0 0 1 3.5 13V5.5a2 2 0 0 1 2-2H13a2 2 0 0 1 2 2" />
    </>
  ),
  pause: <P d="M9.5 5v14M14.5 5v14" />,
  abspielen: <P d="M7.5 4.8 19 12 7.5 19.2z" />,
  stopp: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  zurueckholen: (
    <>
      <P d="M4 10h11a5 5 0 0 1 0 10H9" />
      <P d="M8 6 4 10l4 4" />
    </>
  ),
  archiv: (
    <>
      <P d="M3.5 8.5h17V19a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <rect x="2.5" y="3.5" width="19" height="5" rx="1.5" />
      <P d="M10 12.5h4" />
    </>
  ),
  /** Fahrzeug — Fristen, Kosten, Kilometer. */
  fahrzeug: (
    <>
      <P d="M4 16.5v-3.2l1.8-4.6A2 2 0 0 1 7.7 7.5h8.6a2 2 0 0 1 1.9 1.2l1.8 4.6v3.2" />
      <P d="M3.5 13.3h17" />
      <circle cx="7.5" cy="16.5" r="1.6" />
      <circle cx="16.5" cy="16.5" r="1.6" />
    </>
  ),
  /** Terminfaden — alles mit Datum aus allen Modulen. */
  termine: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <P d="M3.5 10h17M8 3v4M16 3v4" />
      <P d="M7.5 14h3" />
    </>
  ),
  /** Zweites Laufwerk — Ziel der externen Sicherung. */
  platte: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <P d="M2.5 13.5h19" />
      <circle cx="17.5" cy="16" r="1.1" />
    </>
  ),
  haken: <P d="M5 12.5 9.5 17 19 7" />,
  glocke: (
    <>
      <P d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4.5 2 5.5 2 5.5h-15s2-1 2-5.5z" />
      <P d="M10 18.5a2 2 0 0 0 4 0" />
    </>
  ),
  wecker: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <P d="M12 9.5v4l2.5 1.5" />
      <P d="M5.5 3.5 2.5 6.5M18.5 3.5l3 3" />
    </>
  ),
  warnung: (
    <>
      <P d="M10.7 4.2 2.5 18a1.5 1.5 0 0 0 1.3 2.3h16.4a1.5 1.5 0 0 0 1.3-2.3L13.3 4.2a1.5 1.5 0 0 0-2.6 0z" />
      <P d="M12 9.5v4.5M12 17.5v.01" />
    </>
  ),
  rechner: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <P d="M8 7h8" />
      <P d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" />
    </>
  ),
  ort: (
    <>
      <P d="M12 21s6.5-5.9 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.1 12 21 12 21z" />
      <circle cx="12" cy="10.3" r="2.3" />
    </>
  ),
  feiern: (
    <>
      <P d="M11 3.5 12.6 8l4.5 1.6-4.5 1.6L11 15.7 9.4 11.2 4.9 9.6 9.4 8z" />
      <P d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),

  // --- Richtungen -----------------------------------------------------
  zurueck: <P d="M14.5 5.5 8 12l6.5 6.5" />,
  vor: <P d="M9.5 5.5 16 12l-6.5 6.5" />,
  "pfeil-links": (
    <>
      <P d="M20 12H4" />
      <P d="M10 6 4 12l6 6" />
    </>
  ),
  "pfeil-rechts": (
    <>
      <P d="M4 12h16" />
      <P d="M14 6l6 6-6 6" />
    </>
  ),
  backspace: (
    <>
      <P d="M9 4.5h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9L2.5 12z" />
      <P d="M12.5 9l5 6M17.5 9l-5 6" />
    </>
  ),

  // --- Wetter ---------------------------------------------------------
  sonne: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <P d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </>
  ),
  mond: <P d="M20.5 14.8A8.5 8.5 0 0 1 9.2 3.5a8.5 8.5 0 1 0 11.3 11.3z" />,
  "wolke-sonne": (
    <>
      <circle cx="8" cy="7.5" r="3" />
      <P d="M8 1.8v1.6M2.3 7.5h1.6M3.9 3.4 5 4.5M12.1 3.4 11 4.5" />
      <P d="M8.5 20.5h9a3.75 3.75 0 0 0 .4-7.5 5.5 5.5 0 0 0-10.6-.6 3.3 3.3 0 0 0 1.2 8.1z" />
    </>
  ),
  "wolke-mond": (
    <>
      <P d="M13.5 8.6A5.6 5.6 0 0 1 8.4 2a5.6 5.6 0 1 0 6.6 7.4" />
      <P d="M8.5 20.5h9a3.75 3.75 0 0 0 .4-7.5 5.5 5.5 0 0 0-10.6-.6 3.3 3.3 0 0 0 1.2 8.1z" />
    </>
  ),
  wolke: <P d="M7 19h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11.6 3.5 3.5 0 0 0 7 19z" />,
  nebel: (
    <>
      <P d="M7 14.5h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7.1a3.5 3.5 0 0 0 1 7.4z" />
      <P d="M4 18h11M8 21.5h9" />
    </>
  ),
  regen: (
    <>
      <P d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7.6 3.5 3.5 0 0 0 7 15z" />
      <P d="M9 18.5l-1 3M13 18.5l-1 3M17 18.5l-1 3" />
    </>
  ),
  niesel: (
    <>
      <P d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7.6 3.5 3.5 0 0 0 7 15z" />
      <P d="M9 19v.01M13 19v.01M17 19v.01M11 21.5v.01M15 21.5v.01" />
    </>
  ),
  schnee: (
    <>
      <P d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7.6 3.5 3.5 0 0 0 7 15z" />
      <P d="M9 19h.01M13 19h.01M17 19h.01M11 21.8h.01M15 21.8h.01" />
    </>
  ),
  gewitter: (
    <>
      <P d="M7 14.5h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7.1 3.5 3.5 0 0 0 7 14.5z" />
      <P d="M13 17l-3 4h4l-3 4" />
    </>
  ),
  unbekannt: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <P d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4" />
      <P d="M12 17v.01" />
    </>
  ),
} as const;

export type IconName = keyof typeof SYMBOLE;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`ikon ${className ?? ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SYMBOLE[name]}
    </svg>
  );
}
