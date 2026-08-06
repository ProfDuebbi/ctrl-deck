import { useEffect, useState } from "react";
import { zs, fmtNum, type MeterSummary } from "./api";

export function Tile() {
  const [rows, setRows] = useState<MeterSummary[] | null>(null);
  useEffect(() => {
    zs.summary().then(setRows).catch(() => setRows(null));
  }, []);

  if (!rows) return <div className="tile-mini">lädt…</div>;
  if (rows.length === 0) return <div className="tile-mini">Noch keine Zähler angelegt.</div>;

  return (
    <div className="tile-stats">
      {rows.slice(0, 3).map((m) => (
        <div className="tile-stat" key={m.id}>
          <span className={`tile-num ${m.accent === "pink" ? "accent" : ""}`}>
            {m.lastStand != null ? fmtNum(m.lastStand) : "–"}
            <span className="tile-unit"> {m.einheit}</span>
          </span>
          <span className="tile-lbl">{m.name}{m.lastDatum ? ` · ${m.lastDatum}` : ""}</span>
        </div>
      ))}
    </div>
  );
}
