import { useEffect, useState } from "react";
import { holeSchluessel, useEntsperrt } from "./vault";
import { useTresorStatus } from "./statusStore";
import { entschluesseln } from "./crypto";
import { tr } from "./api";

/**
 * Die Kachel spricht auch im verschlossenen Zustand — aber nur ueber Zahlen
 * und Fristen. Namen zeigt sie erst, wenn der Tresor offen ist.
 */
export function Tile() {
  const status = useTresorStatus();
  const entsperrt = useEntsperrt();
  const [namen, setNamen] = useState<Map<number, string>>(new Map());

  const naechst = status?.ablaufend[0];

  useEffect(() => {
    const key = holeSchluessel();
    if (!entsperrt || !key || !naechst) { setNamen(new Map()); return; }
    let abgebrochen = false;
    tr.liste()
      .then(async (roh) => {
        const m = new Map<number, string>();
        for (const r of roh.filter((x) => status?.ablaufend.some((a) => a.id === x.id))) {
          try { m.set(r.id, await entschluesseln(key, r.titel)); } catch { /* defekt */ }
        }
        if (!abgebrochen) setNamen(m);
      })
      .catch(() => setNamen(new Map()));
    return () => { abgebrochen = true; };
  }, [entsperrt, naechst, status]);

  if (!status) return <div className="tile-mini">lädt…</div>;
  if (!status.eingerichtet) return <div className="tile-mini">noch nicht eingerichtet</div>;

  return (
    <div className="tile-stats">
      <div className="tile-stat">
        <span className="tile-num accent">{status.anzahl}</span>
        <span className="tile-lbl">Einträge</span>
      </div>
      <div className="tile-stat">
        <span className="tile-num">{status.dateien}</span>
        <span className="tile-lbl">Anhänge</span>
      </div>
      <div className="tile-stat">
        <span className={`tile-num ${entsperrt ? "ein" : ""}`} style={{ fontSize: 15 }}>
          {entsperrt ? "offen" : "verschlossen"}
        </span>
        <span className="tile-lbl">Zustand</span>
      </div>
      {naechst && (
        <div className={`tile-note ${naechst.tageBis < 0 ? "tile-warnung" : ""}`}>
          {namen.get(naechst.id) ?? "Ein Dokument"}
          {naechst.tageBis < 0
            ? ` ist seit ${Math.abs(naechst.tageBis)} Tagen abgelaufen`
            : naechst.tageBis === 0
              ? " läuft heute ab"
              : ` läuft in ${naechst.tageBis} Tagen ab`}
        </div>
      )}
    </div>
  );
}
