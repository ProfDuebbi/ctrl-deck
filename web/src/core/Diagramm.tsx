import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import {
  achse, formatWert, glatterPfad, mehrereJahre, monatsLabel, useMasse,
  type Diagramm as Daten, type Messpunkt,
} from "./diagramme";

/**
 * Die Diagramme — von Hand gezeichnetes SVG, keine Bibliothek.
 *
 * Eine Diagramm-Bibliothek bringt immer ihr eigenes Aussehen mit (Schatten,
 * Verläufe, runde Ecken, eigene Schrift) und man verbringt mehr Zeit damit,
 * ihr das abzugewöhnen, als das Zeichnen gekostet hätte. Drei Formen mit
 * gemeinsamem Gerüst sind überschaubar — und sie halten sich an theme.css.
 *
 * Regeln, die hier eingebaut sind und nicht verhandelbar sind:
 *  - NIE zwei Y-Achsen. Zwei Größen unterschiedlicher Einheit sind zwei Bilder.
 *    (Deshalb liefert das Zähler-Modul ein Diagramm JE Zähler.)
 *  - Farbe folgt der Sache, nicht dem Rang. Blau und Violett stehen nie
 *    nebeneinander: bei Rotgrünblindheit sind sie kaum zu unterscheiden
 *    (gemessen ΔE 5,1) — die feste Reihenfolge ist blau, pink, violett.
 *  - Jedes Bild hat eine Tabellenansicht. Wer Farben nicht unterscheiden kann,
 *    liest die Zahlen.
 *  - Rasterlinien sind durchgezogene Haarlinien, nie gestrichelt: eine
 *    gestrichelte Linie liest sich als Schwelle oder Prognose.
 *
 * Zur BEWEGUNG (Regel 5 in theme.css): Balken wachsen einmal auf ihren Wert,
 * Kurven werden einmal von links nach rechts aufgedeckt. Beides beantwortet
 * eine Frage — „wie voll ist das" und „wie ist es verlaufen". Es läuft einmal
 * beim Erscheinen und bei einem Wechsel des Zeitraums, nie im Leerlauf.
 */

const PAD_R = 14;
const PAD_T = 10;
const PAD_B = 24;    // Platz für die Monatsnamen — sonst schneidet die Karte sie ab
const MIN_H = 120;   // darunter wird ein Verlauf zum Strich

const farbeVon = (r: { farbe?: string | null }) => r.farbe ?? "blue";

/**
 * Der linke Rand richtet sich nach der LÄNGSTEN Achsenbeschriftung.
 *
 * Er war fest auf 48 Pixel — bei „20,0 kWh" schnitt das SVG die ersten Ziffern
 * ab, und die Achse las sich als 0, 5, 0, 5, 0. Ein Diagramm, dessen Achse
 * lügt, ist schlimmer als keines. 6,3 Pixel je Zeichen ist die gemessene
 * Laufweite von Jost bei 10,5 Pixel Schriftgröße.
 */
const randLinks = (beschriftungen: string[]) =>
  Math.ceil(Math.max(34, ...beschriftungen.map((t) => t.length * 6.3)) + 12);

/**
 * Wo darf eine x-Beschriftung stehen, ohne über den Rand zu ragen?
 * Am linken Ende wird links ausgerichtet, am rechten rechts, sonst mittig.
 */
function textLage(x: number, breite: number, laenge: number) {
  const halb = (laenge * 6.3) / 2;
  if (x - halb < 2) return { x: 2, anchor: "start" as const };
  if (x + halb > breite - 2) return { x: breite - 2, anchor: "end" as const };
  return { x, anchor: "middle" as const };
}

/**
 * Welche x-Punkte bekommen eine Beschriftung?
 *
 * Jeder `schritt`-te — und der letzte nur dann, wenn er nicht in den
 * vorletzten hineinläuft. Sonst stand dort „Jul 26Aug 26" übereinander.
 */
function beschriftete(anzahl: number, schritt: number): Set<number> {
  const raus = new Set<number>();
  for (let i = 0; i < anzahl; i += schritt) raus.add(i);
  const letzter = anzahl - 1;
  const groesster = Math.max(...raus);
  if (letzter - groesster >= Math.max(1, Math.ceil(schritt * 0.6))) raus.add(letzter);
  return raus;
}

/** Kurzinfo am Mauszeiger. Sie ergänzt die Werte, sie ersetzt sie nie. */
function Kurzinfo({ x, y, zeilen, titel }: { x: number; y: number; titel: string; zeilen: { name: string; wert: string; farbe: string }[] }) {
  return (
    <div className="dg-info" style={{ left: x, top: y }} role="status">
      <div className="dg-info-kopf">{titel}</div>
      {zeilen.map((z) => (
        <div className="dg-info-zeile" key={z.name}>
          <i className={`dg-punkt ton-${z.farbe}`} aria-hidden="true" />
          <span className="dg-info-name">{z.name}</span>
          <span className="dg-info-wert">{z.wert}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Wie viele x-Beschriftungen passen nebeneinander, ohne sich zu überlappen?
 * Lieber jede zweite als übereinandergedruckte.
 */
function schrittweite(anzahl: number, breite: number, proLabel = 44): number {
  const passt = Math.max(1, Math.floor(breite / proLabel));
  return Math.ceil(anzahl / passt);
}

// --- Zeitreihe -------------------------------------------------------------

function Verlauf({ daten, lauf }: { daten: Daten; lauf: string }) {
  const { ref, breite, hoehe } = useMasse<HTMLDivElement>();
  const [zeiger, setZeiger] = useState<number | null>(null);
  const reihe = daten.reihen[0];
  const punkte = reihe.punkte;

  // Das Bild füllt seine Karte, statt eine feste Höhe zu haben — dadurch enden
  // alle Karten einer Reihe unten auf derselben Linie.
  const plotH = Math.max(MIN_H, hoehe - PAD_B);
  const innenH = plotH - PAD_T;
  const skala = useMemo(() => achse(Math.max(...punkte.map((p) => p.y), 0)), [punkte]);
  const jahre = mehrereJahre(punkte);
  const achsenText = skala.linien.map((v) => formatWert(v, daten.einheit, true));
  const PAD_L = randLinks(achsenText);
  const innenB = Math.max(10, breite - PAD_L - PAD_R);

  const xVon = (i: number) => PAD_L + (punkte.length === 1 ? innenB / 2 : (i / (punkte.length - 1)) * innenB);
  const yVon = (v: number) => PAD_T + innenH - (v / skala.max) * innenH;
  const boden = PAD_T + innenH;

  const linie = glatterPfad(punkte.map((p, i) => ({ x: xVon(i), y: yVon(p.y) })));
  const flaeche = `${linie} L${xVon(punkte.length - 1).toFixed(1)},${boden} L${xVon(0).toFixed(1)},${boden} Z`;
  const marken = beschriftete(punkte.length, schrittweite(punkte.length, innenB));

  return (
    <div className="dg-flaeche" ref={ref}>
      {breite > 0 && hoehe > 0 && (
        <svg
          className="dg-svg"
          viewBox={`0 0 ${breite} ${plotH + PAD_B}`}
          role="img"
          aria-label={`${daten.titel} — ${punkte.length} Monate`}
          tabIndex={0}
          onMouseLeave={() => setZeiger(null)}
          onBlur={() => setZeiger(null)}
          onMouseMove={(e) => {
            const kasten = e.currentTarget.getBoundingClientRect();
            const rel = (e.clientX - kasten.left - PAD_L) / innenB;
            setZeiger(Math.min(punkte.length - 1, Math.max(0, Math.round(rel * (punkte.length - 1)))));
          }}
          onKeyDown={(e) => {
            // Tastaturbedienung zeigt dasselbe wie die Maus — sonst wäre der
            // Wert nur mit einem Zeigegerät erreichbar.
            if (e.key === "ArrowRight") { e.preventDefault(); setZeiger((z) => Math.min(punkte.length - 1, (z ?? -1) + 1)); }
            if (e.key === "ArrowLeft") { e.preventDefault(); setZeiger((z) => Math.max(0, (z ?? punkte.length) - 1)); }
            if (e.key === "Escape") setZeiger(null);
          }}
        >
          {/* Raster und Achsenbeschriftung: durchgezogene Haarlinien, eine
              Nuance über der Fläche. Sie sollen tragen, nicht auffallen. */}
          {skala.linien.map((v, i) => (
            <g key={v}>
              <line className="dg-raster" x1={PAD_L} x2={breite - PAD_R} y1={yVon(v)} y2={yVon(v)} />
              <text className="dg-achse" x={PAD_L - 8} y={yVon(v) + 3.5} textAnchor="end">
                {achsenText[i]}
              </text>
            </g>
          ))}

          <g className="dg-aufdecken" key={lauf}>
            <path className={`dg-fuellung ton-${farbeVon(reihe)}`} d={flaeche} />
            <path className={`dg-linie ton-${farbeVon(reihe)}`} d={linie} />
          </g>

          {punkte.map((p, i) => {
            if (!marken.has(i)) return null;
            const text = monatsLabel(p.x, jahre);
            const lage = textLage(xVon(i), breite, text.length);
            return (
              <text className="dg-achse" key={p.x} x={lage.x} y={plotH + 16} textAnchor={lage.anchor}>
                {text}
              </text>
            );
          })}

          {zeiger !== null && (
            <g className="dg-zeiger">
              <line x1={xVon(zeiger)} x2={xVon(zeiger)} y1={PAD_T} y2={boden} />
              <circle className={`dg-marke ton-${farbeVon(reihe)}`} cx={xVon(zeiger)} cy={yVon(punkte[zeiger].y)} r={5} />
            </g>
          )}
        </svg>
      )}

      {zeiger !== null && (
        <Kurzinfo
          x={Math.min(Math.max(xVon(zeiger), 70), Math.max(70, breite - 70))}
          y={Math.max(4, yVon(punkte[zeiger].y) - 12)}
          titel={monatsLabel(punkte[zeiger].x, true)}
          zeilen={[{ name: reihe.name, wert: formatWert(punkte[zeiger].y, daten.einheit), farbe: farbeVon(reihe) }]}
        />
      )}
    </div>
  );
}

// --- Größenvergleich -------------------------------------------------------

/**
 * Liegende Balken, nach Größe sortiert.
 *
 * Liegend und nicht stehend, weil die Posten Namen tragen („ohne Kategorie",
 * „Wohnung oben") — stehende Balken zwängen die in schräg gestellte
 * Beschriftungen, und schräge Schrift liest niemand gern.
 *
 * Jeder Balken trägt Namen UND Wert direkt daneben. Damit ist die Farbe nie
 * der einzige Träger einer Information, und die Kurzinfo ist eine Zugabe.
 */
function Balken({ daten, lauf }: { daten: Daten; lauf: string }) {
  const reihe = daten.reihen[0];
  const max = Math.max(...reihe.punkte.map((p) => p.y), 0) || 1;
  const summe = reihe.punkte.reduce((s, p) => s + p.y, 0);

  return (
    <ul className="dg-balken" key={lauf}>
      {reihe.punkte.map((p) => (
        <li className="dg-balken-zeile" key={p.x}>
          <span className="dg-balken-name" title={p.x}>{p.x}</span>
          <span className="dg-balken-spur">
            <span
              className={`dg-balken-fuell ton-${farbeVon(reihe)}`}
              style={{ width: `${(p.y / max) * 100}%` }}
            />
          </span>
          <span className="dg-balken-wert">
            {formatWert(p.y, daten.einheit, true)}
            {summe > 0 && <span className="dg-balken-anteil">{Math.round((p.y / summe) * 100)} %</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// --- Ein und aus -----------------------------------------------------------

/**
 * Zwei Richtungen an einer Nulllinie.
 *
 * Bewusst kein Liniendiagramm mit zwei Kurven: Einnahmen und Ausgaben sind
 * nicht zwei Messreihen, die man vergleicht, sondern zwei Richtungen desselben
 * Kontos. Der Abstand zur Nulllinie IST die Aussage, und beide Reihen liegen
 * auf DERSELBEN Achse — zwei Y-Achsen würden einen Zusammenhang erfinden.
 */
function Spiegel({ daten, lauf }: { daten: Daten; lauf: string }) {
  const { ref, breite, hoehe } = useMasse<HTMLDivElement>();
  const [zeiger, setZeiger] = useState<number | null>(null);
  const [oben, unten] = daten.reihen;
  const punkte = oben.punkte;

  const plotH = Math.max(MIN_H, hoehe - PAD_B);
  const halb = (plotH - PAD_T) / 2;
  const mitte = PAD_T + halb;
  const skala = useMemo(
    () => achse(Math.max(...oben.punkte.map((p) => p.y), ...unten.punkte.map((p) => p.y), 0), 2),
    [oben, unten]
  );
  const jahre = mehrereJahre(punkte);
  const PAD_L = randLinks(skala.linien.map((v) => formatWert(v, daten.einheit, true)));
  const innenB = Math.max(10, breite - PAD_L - PAD_R);

  const spalte = innenB / Math.max(1, punkte.length);
  const balkenB = Math.max(3, Math.min(26, spalte - 6));
  const xVon = (i: number) => PAD_L + spalte * i + spalte / 2;
  const hoeheVon = (v: number) => (v / skala.max) * halb;
  const marken = beschriftete(punkte.length, schrittweite(punkte.length, innenB));

  const werte = (i: number) => [
    { name: oben.name, wert: formatWert(oben.punkte[i]?.y ?? 0, daten.einheit), farbe: farbeVon(oben) },
    { name: unten.name, wert: formatWert(unten.punkte[i]?.y ?? 0, daten.einheit), farbe: farbeVon(unten) },
  ];

  return (
    <div className="dg-flaeche" ref={ref}>
      {breite > 0 && hoehe > 0 && (
        <svg
          className="dg-svg"
          viewBox={`0 0 ${breite} ${plotH + PAD_B}`}
          role="img"
          aria-label={`${daten.titel} — ${oben.name} und ${unten.name} je Monat`}
          tabIndex={0}
          onMouseLeave={() => setZeiger(null)}
          onBlur={() => setZeiger(null)}
          onMouseMove={(e) => {
            const kasten = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((e.clientX - kasten.left - PAD_L) / spalte);
            setZeiger(i >= 0 && i < punkte.length ? i : null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); setZeiger((z) => Math.min(punkte.length - 1, (z ?? -1) + 1)); }
            if (e.key === "ArrowLeft") { e.preventDefault(); setZeiger((z) => Math.max(0, (z ?? punkte.length) - 1)); }
            if (e.key === "Escape") setZeiger(null);
          }}
        >
          {skala.linien.map((v) =>
            v === 0 ? null : (
              <g key={v}>
                <line className="dg-raster" x1={PAD_L} x2={breite - PAD_R} y1={mitte - hoeheVon(v)} y2={mitte - hoeheVon(v)} />
                <line className="dg-raster" x1={PAD_L} x2={breite - PAD_R} y1={mitte + hoeheVon(v)} y2={mitte + hoeheVon(v)} />
                {/* Auch UNTER der Nulllinie beschriften: die Achse ist
                    gespiegelt, und ohne Zahlen unten müsste man die Höhe
                    raten statt sie abzulesen. */}
                <text className="dg-achse" x={PAD_L - 8} y={mitte - hoeheVon(v) + 3.5} textAnchor="end">
                  {formatWert(v, daten.einheit, true)}
                </text>
                <text className="dg-achse" x={PAD_L - 8} y={mitte + hoeheVon(v) + 3.5} textAnchor="end">
                  {formatWert(v, daten.einheit, true)}
                </text>
              </g>
            )
          )}

          <g className="dg-wachsen" key={lauf} style={{ transformOrigin: `0 ${mitte}px` }}>
            {punkte.map((p, i) => {
              const runter = unten.punkte[i]?.y ?? 0;
              return (
                <g key={p.x} className={zeiger === i ? "dg-hell" : undefined}>
                  <rect
                    className={`dg-saeule ton-${farbeVon(oben)}`}
                    x={xVon(i) - balkenB / 2} y={mitte - hoeheVon(p.y)}
                    width={balkenB} height={Math.max(0, hoeheVon(p.y))} rx={2}
                  />
                  <rect
                    className={`dg-saeule ton-${farbeVon(unten)}`}
                    x={xVon(i) - balkenB / 2} y={mitte + 2}
                    width={balkenB} height={Math.max(0, hoeheVon(runter))} rx={2}
                  />
                </g>
              );
            })}
          </g>

          {/* Die Nulllinie steht ÜBER den Säulen: sie ist der Bezugspunkt, an
              dem man abliest, und darf nicht von einem Balken verdeckt werden. */}
          <line className="dg-null" x1={PAD_L} x2={breite - PAD_R} y1={mitte} y2={mitte} />

          {punkte.map((p, i) => {
            if (!marken.has(i)) return null;
            const text = monatsLabel(p.x, jahre);
            const lage = textLage(xVon(i), breite, text.length);
            return (
              <text className="dg-achse" key={p.x} x={lage.x} y={plotH + 16} textAnchor={lage.anchor}>
                {text}
              </text>
            );
          })}
        </svg>
      )}

      {zeiger !== null && (
        <Kurzinfo
          x={Math.min(Math.max(xVon(zeiger), 80), Math.max(80, breite - 80))}
          y={4}
          titel={monatsLabel(punkte[zeiger].x, true)}
          zeilen={werte(zeiger)}
        />
      )}
    </div>
  );
}

// --- Tabellenansicht -------------------------------------------------------

/** Dasselbe Bild als Zahlen. Jedes Diagramm hat sie — ohne Ausnahme. */
function Tabelle({ daten }: { daten: Daten }) {
  const zeitreihe = daten.form !== "balken";
  const x = daten.reihen[0].punkte.map((p) => p.x);
  return (
    <div className="dg-tabelle-rollen">
      <table className="dg-tabelle">
        <thead>
          <tr>
            <th scope="col">{zeitreihe ? "Monat" : "Posten"}</th>
            {daten.reihen.map((r) => <th scope="col" key={r.id}>{r.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {x.map((label, i) => (
            <tr key={label}>
              <th scope="row">{zeitreihe ? monatsLabel(label, true) : label}</th>
              {daten.reihen.map((r) => (
                <td key={r.id}>{formatWert(r.punkte[i]?.y ?? 0, daten.einheit)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Veränderung -----------------------------------------------------------

/**
 * Letzter VOLLER Monat gegen den davor.
 *
 * Der laufende Monat bleibt außen vor: am 6. August gegen den ganzen Juli zu
 * rechnen ergäbe immer einen Absturz. Verglichen wird also Juli gegen Juni.
 *
 * Die Angabe ist FARBLICH NEUTRAL, und das ist eine Entscheidung: „mehr" ist
 * je nach Modul gut (erledigte Aufgaben), schlecht (fremde Vorfälle) oder
 * weder noch (erfasste Zeit). Ein grüner Pfeil an einer steigenden Lärmkurve
 * wäre schlicht gelogen. Der Pfeil sagt die Richtung, die Bewertung bleibt
 * beim Leser — Regel 3 sagt, Farbe bedeutet etwas, also färben wir nichts,
 * was wir nicht wissen.
 */
function veraenderung(daten: Daten, laufenderMonat: string) {
  if (daten.form === "balken") return null;

  // Beim Spiegel zählt der Saldo, nicht eine der beiden Richtungen.
  const werte: Messpunkt[] =
    daten.form === "spiegel" && daten.reihen.length > 1
      ? daten.reihen[0].punkte.map((p, i) => ({ x: p.x, y: p.y - (daten.reihen[1].punkte[i]?.y ?? 0) }))
      : daten.reihen[0].punkte;

  const voll = werte[werte.length - 1]?.x === laufenderMonat ? werte.slice(0, -1) : werte;
  if (voll.length < 2) return null;
  const jetzt = voll[voll.length - 1];
  const davor = voll[voll.length - 2];
  // Prozent von null ist keine Zahl, sondern eine Division durch null.
  if (davor.y === 0) return null;
  const prozent = Math.round(((jetzt.y - davor.y) / Math.abs(davor.y)) * 100);
  if (prozent === 0) return null;
  return { prozent, jetzt, davor };
}

// --- Die Karte -------------------------------------------------------------

export function DiagrammKarte({
  daten,
  lauf,
  ikon,
  akzent,
  onModul,
}: {
  daten: Daten;
  /** Ändert sich mit dem Zeitraum — startet die Bewegung neu. */
  lauf: string;
  ikon: React.ComponentProps<typeof Icon>["name"];
  /** Kennfarbe des Moduls — sie sagt, WOHER die Karte kommt. */
  akzent: string;
  onModul: (id: string) => void;
}) {
  const [alsTabelle, setAlsTabelle] = useState(false);
  const punkte: Messpunkt[] = daten.reihen[0]?.punkte ?? [];
  if (punkte.length === 0) return null;

  const heute = new Date();
  const laufenderMonat = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}`;
  const delta = veraenderung(daten, laufenderMonat);

  /*
    Die Kennfarbe des MODULS steht an der Kante und am Symbol, die Farben der
    DATEN stehen im Bild. Zwei verschiedene Aufgaben: „das ist Haushalt" und
    „das ist ein Eingang". Ohne die erste sehen zehn Karten gleich aus, und man
    liest jede Überschrift, um zu wissen, wo man gerade ist.
  */
  return (
    <section className={`dg-karte accent-${akzent} ${daten.breite === "voll" ? "voll" : ""}`}>
      <header className="dg-kopf">
        <button className="dg-titel" onClick={() => onModul(daten.modul)} title={`In ${daten.titel} öffnen`}>
          <span className="dg-titel-ico"><Icon name={ikon} /></span>
          <span>
            {daten.titel}
            {daten.hinweis && <span className="dg-hinweis">{daten.hinweis}</span>}
          </span>
        </button>
        <button
          className="dg-umschalter"
          onClick={() => setAlsTabelle((t) => !t)}
          aria-pressed={alsTabelle}
          title={alsTabelle ? "Als Diagramm zeigen" : "Als Tabelle zeigen"}
        >
          <Icon name={alsTabelle ? "uebersicht" : "dokument"} />
          <span className="sr-only">{alsTabelle ? "Als Diagramm zeigen" : "Als Tabelle zeigen"}</span>
        </button>
      </header>

      {daten.kennzahl && (
        <p className="dg-kennzahl">
          {/* Proportionale Ziffern: `tabular-nums` lässt eine große
              alleinstehende Zahl auseinanderfallen. Ausgerichtet wird nur in
              Tabellen und an Achsen. */}
          <span className="dg-kennzahl-wert">{daten.kennzahl.wert}</span>
          <span className="dg-kennzahl-label">{daten.kennzahl.label}</span>
          {delta && (
            <span
              className="dg-delta"
              title={`${monatsLabel(delta.davor.x, true)}: ${formatWert(delta.davor.y, daten.einheit)} → ${monatsLabel(delta.jetzt.x, true)}: ${formatWert(delta.jetzt.y, daten.einheit)}`}
            >
              <Icon name={delta.prozent > 0 ? "trend-hoch" : "trend-runter"} />
              {delta.prozent > 0 ? "+" : "−"}{Math.abs(delta.prozent)} %
              <span className="dg-delta-wann">
                {monatsLabel(delta.jetzt.x)} gegen {monatsLabel(delta.davor.x)}
              </span>
            </span>
          )}
        </p>
      )}

      {alsTabelle ? (
        <Tabelle daten={daten} />
      ) : daten.form === "balken" ? (
        <Balken daten={daten} lauf={lauf} />
      ) : daten.form === "spiegel" ? (
        <Spiegel daten={daten} lauf={lauf} />
      ) : (
        <Verlauf daten={daten} lauf={lauf} />
      )}

      {/* Ab zwei Reihen gehört eine Legende dazu — bei einer sagt die
          Überschrift schon, was man sieht, und ein Kästchen daneben wäre nur
          Wiederholung. */}
      {daten.reihen.length > 1 && (
        <ul className="dg-legende">
          {daten.reihen.map((r) => (
            <li key={r.id}>
              <i className={`dg-punkt ton-${farbeVon(r)}`} aria-hidden="true" /> {r.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
