import { useEffect, useState } from "react";
import { gb, MONATE, wannText, type Geburtstag } from "./api";

export function Tile() {
  const [data, setData] = useState<{ anzahl: number; naechste: Geburtstag[] } | null>(null);
  useEffect(() => {
    gb.naechste(60).then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <div className="tile-mini">lädt…</div>;

  const next = data.naechste.find((g) => !g.verstorben) ?? data.naechste[0];

  return (
    <div className="tile-stats">
      <div className="tile-stat">
        <span className="tile-num accent">{data.naechste.length}</span>
        <span className="tile-lbl">in 60 Tagen</span>
      </div>
      <div className="tile-stat">
        <span className="tile-num">{data.anzahl}</span>
        <span className="tile-lbl">gesamt</span>
      </div>
      {next && (
        <div className="tile-note">
          {next.verstorben ? "† " : ""}{next.name} — {next.tag}. {MONATE[next.monat - 1]} ({wannText(next.tageBis)})
        </div>
      )}
    </div>
  );
}
