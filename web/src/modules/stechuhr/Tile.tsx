import { useEffect, useState } from "react";
import { su, fmtHM, type Summary } from "./api";

export function Tile() {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    su.summary().then(setS).catch(() => setS(null));
  }, []);

  if (!s) return <div className="tile-mini">lädt…</div>;

  return (
    <div className="tile-stats">
      <div className="tile-stat">
        <span className="tile-num accent">{fmtHM(s.weekMin)}</span>
        <span className="tile-lbl">diese Woche</span>
      </div>
      <div className="tile-stat">
        <span className="tile-num">{fmtHM(s.todayMin)}</span>
        <span className="tile-lbl">heute</span>
      </div>
      {s.running ? (
        <div className="tile-note">
          <span className="live-dot" /> läuft{s.projektName ? `: ${s.projektName}` : " – eingestempelt"}
        </div>
      ) : (
        s.topProjekt && (
          <div className="tile-note">
            {s.topProjekt.name}: {fmtHM(s.topProjekt.minuten)} gesamt
          </div>
        )
      )}
    </div>
  );
}
