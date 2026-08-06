import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./ui";
import { Icon } from "./Icon";

/**
 * Zuschnitt eines Bildes — mit dem Ausschnitt, den man dabei sieht.
 *
 * Vorher wurde stillschweigend mittig beschnitten. Bei einem Portraet, das
 * nicht in der Bildmitte steht, kam damit das Ohr in den Avatar. Man sah es
 * erst hinterher und konnte nichts dagegen tun.
 *
 * ── Das Rechenmodell (die eine Sache, die hier stimmen muss) ──────────────
 *
 * Alles wird in **Quellpixeln** gerechnet, nicht in Bildschirmpixeln. Der
 * Ausschnitt ist ein Rechteck (`sx, sy, cw, ch`) im Originalbild:
 *
 *   cwMax = groesstes Rechteck im Seitenverhaeltnis, das ins Bild passt
 *   cw    = cwMax / zoom        ch = cw / seitenverhaeltnis
 *   sx    = mitteX - cw / 2     sy = mitteY - ch / 2   (in die Bildgrenzen geklemmt)
 *
 * Die Vorschau zeigt genau dieses Rechteck: das Bild wird um `fenster / cw`
 * skaliert und um `-sx, -sy` verschoben. Am Ende zeichnet `drawImage` mit
 * denselben vier Zahlen. **Vorschau und Ergebnis koennen deshalb nicht
 * auseinanderlaufen** — es ist dieselbe Rechnung, nicht zwei aehnliche.
 */

/** `toDataURL` faellt bei unbekanntem Format still auf PNG zurueck (siehe bilder.ts). */
function alsDatenUrl(flaeche: HTMLCanvasElement, guete: number): string {
  const webp = flaeche.toDataURL("image/webp", guete);
  return webp.startsWith("data:image/webp") ? webp : flaeche.toDataURL("image/jpeg", guete);
}

const klemme = (n: number, von: number, bis: number) => Math.min(bis, Math.max(von, n));

export function BildEditor({
  datei,
  seitenverhaeltnis,
  zielBreite,
  rund = false,
  titel,
  hinweis,
  guete = 0.85,
  onFertig,
  onAbbrechen,
}: {
  datei: File;
  /** Breite geteilt durch Hoehe des Ergebnisses. 1 = quadratisch. */
  seitenverhaeltnis: number;
  zielBreite: number;
  /** Zeigt die runde Maske des Avatars — der Ausschnitt bleibt quadratisch. */
  rund?: boolean;
  titel: string;
  hinweis?: string;
  guete?: number;
  onFertig: (datenUrl: string) => void;
  onAbbrechen: () => void;
}) {
  const [bild, setBild] = useState<HTMLImageElement | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [mitte, setMitte] = useState({ x: 0, y: 0 });
  const fenster = useRef<HTMLDivElement>(null);
  const zieht = useRef<{ x: number; y: number; mx: number; my: number } | null>(null);
  /**
   * Die Fensterbreite MUSS im Zustand liegen, nicht nur im Ref: beim ersten
   * Rendern ist noch nichts vermessen (`clientWidth` = 0), und ein Ref loest
   * kein Neurendern aus — das Bild bliebe unsichtbar, bis zufaellig etwas
   * anderes die Komponente neu zeichnet. Der Beobachter faengt zugleich das
   * Groesserziehen des Fensters ab.
   */
  const [fensterBreite, setFensterBreite] = useState(0);

  useEffect(() => {
    const el = fenster.current;
    if (!el) return;
    setFensterBreite(el.clientWidth);
    const beobachter = new ResizeObserver(([e]) => setFensterBreite(e.contentRect.width));
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, []);

  /**
   * Die Objekt-URL bleibt bis zum Schliessen bestehen.
   *
   * **Nicht im `onload` freigeben.** Das geladene `Image` behaelt zwar seine
   * Bilddaten (Zeichnen aufs Canvas ginge weiter), aber das `<img>` in der
   * Vorschau ist ein ZWEITES Element mit demselben `src` — und eine
   * freigegebene Objekt-URL laesst sich nicht noch einmal laden. Ergebnis war
   * ein Editor mit leerem Fenster: der Zuschnitt rechnete richtig, man sah
   * nur nichts davon.
   */
  useEffect(() => {
    const url = URL.createObjectURL(datei);
    const b = new Image();
    b.onload = () => {
      setBild(b);
      setMitte({ x: b.width / 2, y: b.height / 2 });
      setZoom(1);
    };
    b.onerror = () => setFehler("Diese Datei ist kein Bild, das der Browser lesen kann.");
    b.src = url;
    return () => URL.revokeObjectURL(url);
  }, [datei]);

  /** Das Ausschnitt-Rechteck in Quellpixeln — die eine Wahrheit. */
  const ausschnitt = useCallback(() => {
    if (!bild) return null;
    const cwMax = Math.min(bild.width, bild.height * seitenverhaeltnis);
    const cw = cwMax / zoom;
    const ch = cw / seitenverhaeltnis;
    // Klemmen, damit der Ausschnitt nie ueber den Bildrand hinausragt —
    // sonst entstuenden am Ergebnis leere Streifen.
    const x = klemme(mitte.x, cw / 2, bild.width - cw / 2);
    const y = klemme(mitte.y, ch / 2, bild.height - ch / 2);
    return { sx: x - cw / 2, sy: y - ch / 2, cw, ch };
  }, [bild, zoom, mitte, seitenverhaeltnis]);

  const a = ausschnitt();

  function beginnen(e: React.PointerEvent) {
    if (!a) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    zieht.current = { x: e.clientX, y: e.clientY, mx: mitte.x, my: mitte.y };
  }

  function ziehen(e: React.PointerEvent) {
    if (!zieht.current || !a || !fensterBreite) return;
    // Bildschirmweg -> Quellpixel: ein Fenster ist `cw` Quellpixel breit.
    const proPixel = a.cw / fensterBreite;
    setMitte({
      x: zieht.current.mx - (e.clientX - zieht.current.x) * proPixel,
      y: zieht.current.my - (e.clientY - zieht.current.y) * proPixel,
    });
  }

  const beenden = () => { zieht.current = null; };

  useEffect(() => {
    const el = fenster.current;
    if (!el) return;
    // Nicht per onWheel im JSX: React haengt Rad-Ereignisse passiv ein,
    // `preventDefault` waere wirkungslos und die Seite scrollte mit.
    const rad = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => klemme(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 1, 5));
    };
    el.addEventListener("wheel", rad, { passive: false });
    return () => el.removeEventListener("wheel", rad);
  }, [bild]);

  function uebernehmen() {
    if (!bild || !a) return;
    const flaeche = document.createElement("canvas");
    flaeche.width = zielBreite;
    flaeche.height = Math.round(zielBreite / seitenverhaeltnis);
    const stift = flaeche.getContext("2d");
    if (!stift) return setFehler("Der Browser kann das Bild nicht zeichnen.");
    stift.drawImage(bild, a.sx, a.sy, a.cw, a.ch, 0, 0, flaeche.width, flaeche.height);
    onFertig(alsDatenUrl(flaeche, guete));
  }

  // Umrechnung fuers Anzeigen: das Fenster ist `cw` Quellpixel breit.
  const skala = a && fensterBreite ? fensterBreite / a.cw : 0;

  return (
    <Modal title={titel} onClose={onAbbrechen}>
      <div className="bed">
        {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}

        <div
          className={`bed-fenster ${rund ? "rund" : ""}`}
          ref={fenster}
          style={{ aspectRatio: String(seitenverhaeltnis) }}
          onPointerDown={beginnen}
          onPointerMove={ziehen}
          onPointerUp={beenden}
          onPointerCancel={beenden}
        >
          {bild && a && (
            <img
              className="bed-bild"
              src={bild.src}
              alt=""
              draggable={false}
              style={{
                width: bild.width * skala,
                height: bild.height * skala,
                transform: `translate(${-a.sx * skala}px, ${-a.sy * skala}px)`,
              }}
            />
          )}
          {/* Die Maske zeigt, was uebrig bleibt — beim Avatar rund, sonst als
              Rahmen. Sie faengt keine Maus, sonst liesse sich nicht ziehen. */}
          <span className="bed-maske" aria-hidden="true" />
        </div>

        <label className="kopf-regler">
          <span className="kopf-regler-kopf">
            Ausschnittgröße
            <b>{zoom.toFixed(1)}×</b>
          </span>
          <input
            type="range" min={100} max={500} value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
          />
        </label>

        <p className="profil-hinweis">
          Ziehen verschiebt den Ausschnitt, Mausrad oder Regler ändern die Größe.
          {hinweis ? ` ${hinweis}` : ""}
        </p>

        <div className="bed-knoepfe">
          <button className="btn" onClick={uebernehmen} disabled={!bild}>Übernehmen</button>
          <button className="btn ghost" onClick={onAbbrechen}>Abbrechen</button>
          {bild && (
            <span className="bed-mass">
              {Math.round(a?.cw ?? 0)}×{Math.round(a?.ch ?? 0)} aus {bild.width}×{bild.height}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
