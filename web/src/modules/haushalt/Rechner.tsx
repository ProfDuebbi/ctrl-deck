import { useEffect, useMemo, useRef, useState } from "react";
import { rechne, fmtZahl } from "./rechnen";
import { Icon } from "../../core/Icon";

interface Zeile {
  id: number;
  ausdruck: string;
  wert: number;
}

const SPEICHER = "cd_hh_rechner_streifen";

/** Streifen überlebt Schließen und Neuladen — sonst ist er beim Buchen weg. */
function ladeStreifen(): Zeile[] {
  try {
    const roh = localStorage.getItem(SPEICHER);
    if (!roh) return [];
    const d = JSON.parse(roh);
    return Array.isArray(d)
      ? d.filter((z) => typeof z?.ausdruck === "string" && Number.isFinite(z?.wert))
      : [];
  } catch {
    return [];
  }
}

const TASTEN = [
  ["7", "8", "9", "÷"],
  ["4", "5", "6", "×"],
  ["1", "2", "3", "−"],
  ["0", ",", "(", ")"],
];

/**
 * Taschenrechner mit Rechenstreifen. Statt nur einer Zahl auf dem Display
 * bleiben die einzelnen Posten stehen und werden aufsummiert — genau das,
 * was man beim Zusammenrechnen von Ausgaben braucht.
 */
export function Rechner() {
  const [eingabe, setEingabe] = useState("");
  const [streifen, setStreifen] = useState<Zeile[]>(ladeStreifen);
  const [kopiert, setKopiert] = useState(false);
  const feldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(SPEICHER, JSON.stringify(streifen)); } catch { /* egal */ }
  }, [streifen]);

  useEffect(() => { feldRef.current?.focus(); }, []);

  const { wert, fehler } = useMemo(() => rechne(eingabe), [eingabe]);
  const summe = useMemo(() => streifen.reduce((s, z) => s + z.wert, 0), [streifen]);

  function uebernehmen() {
    if (wert == null) return;
    setStreifen([...streifen, { id: Date.now(), ausdruck: eingabe.trim(), wert }]);
    setEingabe("");
    feldRef.current?.focus();
  }

  function tippe(zeichen: string) {
    setEingabe((e) => e + zeichen);
    feldRef.current?.focus();
  }

  async function kopiere(n: number) {
    // Mit Komma, damit es direkt in die Betragsfelder passt.
    try {
      await navigator.clipboard.writeText(n.toFixed(2).replace(".", ","));
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch { /* ohne Zwischenablage-Recht einfach nichts tun */ }
  }

  return (
    <div className="rechner">
      {streifen.length > 0 && (
        <div className="rechner-streifen">
          {streifen.map((z) => (
            <div className="streifen-zeile" key={z.id}>
              <span className="streifen-ausdruck">{z.ausdruck}</span>
              <span className="streifen-wert">{fmtZahl(z.wert)}</span>
              <button
                className="icon-btn" title="Zeile entfernen"
                onClick={() => setStreifen(streifen.filter((x) => x.id !== z.id))}
              >
                ×
              </button>
            </div>
          ))}
          <div className="streifen-summe">
            <span>Summe</span>
            <strong>{fmtZahl(summe)}</strong>
            <button className="icon-btn" title="Summe kopieren" onClick={() => kopiere(summe)}><Icon name="kopieren" /></button>
          </div>
          <button className="btn ghost small" onClick={() => setStreifen([])}>Streifen leeren</button>
        </div>
      )}

      <input
        ref={feldRef}
        className="rechner-feld"
        value={eingabe}
        placeholder="z. B. 12,50 + 3 × 2"
        inputMode="decimal"
        onChange={(e) => setEingabe(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); uebernehmen(); }
          if (e.key === "Escape") setEingabe("");
        }}
      />

      <div className={`rechner-anzeige ${fehler ? "fehler" : ""}`}>
        {fehler ? <><Icon name="warnung" /> {fehler}</> : wert != null ? `= ${fmtZahl(wert)}` : " "}
      </div>

      <div className="rechner-tasten">
        {TASTEN.flat().map((t) => (
          <button key={t} className="taste" onClick={() => tippe(t)}>{t}</button>
        ))}
        <button className="taste weit" onClick={() => setEingabe("")}>C</button>
        <button className="taste" onClick={() => setEingabe((e) => e.slice(0, -1))} aria-label="Zeichen löschen"><Icon name="backspace" /></button>
        <button className="taste gleich" onClick={uebernehmen} disabled={wert == null}>=</button>
      </div>

      <div className="rechner-aktionen">
        <button className="btn ghost small" disabled={wert == null} onClick={() => wert != null && kopiere(wert)}>
          {kopiert ? <><Icon name="haken" /> kopiert</> : <><Icon name="kopieren" /> Ergebnis kopieren</>}
        </button>
        <span className="rechner-tipp">
          Enter legt die Zeile auf den Streifen · kopierte Beträge passen direkt in die Buchungsfelder
        </span>
      </div>
    </div>
  );
}
