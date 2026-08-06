import { useEffect, useState } from "react";
import { lp, type Summary } from "./api";

export function Tile() {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    lp.summary().then(setS).catch(() => setS(null));
  }, []);

  if (!s) return <div className="tile-mini">lädt…</div>;

  return (
    <div className="tile-stats">
      <div className="tile-stat">
        <span className="tile-num">{s.own.entries}</span>
        <span className="tile-lbl">eigene Einträge</span>
      </div>
      <div className="tile-stat">
        <span className="tile-num">{s.foreignCount}</span>
        <span className="tile-lbl">Fremdgeräusche</span>
      </div>
      <div className="tile-stat">
        <span className="tile-num accent">{s.ownTotalLabel}</span>
        <span className="tile-lbl">Musik gesamt</span>
      </div>
      {s.lastForeign && (
        <div className="tile-note">
          Letzter Vorfall: {s.lastForeign.datum}
          {s.lastForeign.uhrzeit ? ` · ${s.lastForeign.uhrzeit}` : ""} · {s.lastForeign.verursacher}
        </div>
      )}
    </div>
  );
}
