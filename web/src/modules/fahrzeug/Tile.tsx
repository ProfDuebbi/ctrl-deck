import { useEffect, useState } from "react";
import { fz, euro, fristText, type Uebersicht } from "./api";

/** Kachel: die naechste Frist und was das Fahren kostet. */
export function Tile() {
  const [d, setD] = useState<Uebersicht | null>(null);
  useEffect(() => { fz.uebersicht().then(setD).catch(() => setD(null)); }, []);

  if (!d) return <div className="tile-note">lädt…</div>;
  if (d.anzahl === 0) return <div className="tile-note">Noch kein Fahrzeug erfasst.</div>;

  return (
    <div className="tile-body">
      <div className="tile-stat">
        <span className={`tile-num ${d.dringend > 0 ? "warn" : ""}`}>{d.anzahl}</span>
        <span className="tile-lbl">{d.anzahl === 1 ? "Fahrzeug" : "Fahrzeuge"}</span>
      </div>
      {d.kostenJahr > 0 && (
        <div className="tile-stat">
          <span className="tile-num">{euro(d.kostenJahr)}</span>
          <span className="tile-lbl">letzte 12 Monate</span>
        </div>
      )}
      <div className="tile-note">
        {d.naechste
          ? `${d.naechste.label} (${d.naechste.fahrzeug}) — ${fristText(d.naechste.tage)}`
          : "Keine Termine hinterlegt."}
      </div>
    </div>
  );
}
