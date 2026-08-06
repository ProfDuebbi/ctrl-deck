import { useEffect, useState } from "react";
import { termine as api, abstand, type Uebersicht } from "./api";

/**
 * Kachel: die Antwort auf „was kommt als Nächstes" in einer Zeile.
 *
 * Absichtlich nicht die Liste im Kleinformat — dafür ist die Ansicht da. Hier
 * stehen drei Zahlen und der nächste Termin im Klartext.
 */
export function Tile() {
  const [d, setD] = useState<Uebersicht | null>(null);

  useEffect(() => {
    api.uebersicht().then(setD).catch(() => setD(null));
  }, []);

  if (!d) return <div className="tile-note">lädt…</div>;

  return (
    <div className="tile-body">
      <div className="tile-stat">
        <span className={`tile-num ${d.heute > 0 ? "" : "leer"}`}>{d.heute}</span>
        <span className="tile-lbl">heute</span>
      </div>
      <div className="tile-stat">
        <span className="tile-num">{d.anzahl}</span>
        <span className="tile-lbl">in 14 Tagen</span>
      </div>
      {d.ueberfaellig > 0 && (
        <div className="tile-stat">
          <span className="tile-num warn">{d.ueberfaellig}</span>
          <span className="tile-lbl">liegen geblieben</span>
        </div>
      )}
      <div className="tile-note">
        {d.naechster
          ? `${d.naechster.titel} — ${abstand(d.naechster.tageBis)}`
          : "In den nächsten 14 Tagen steht nichts an."}
      </div>
    </div>
  );
}
