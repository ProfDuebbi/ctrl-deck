import { useEffect, useState } from "react";
import { nz, OHNE_TITEL, wannText, type NotizZeile } from "./api";

/**
 * Die Kachel beantwortet zwei Fragen: Wie viel liegt hier, und was war das
 * Letzte? Titel verschluesselter Notizen bleiben zu — die Kachelwand ist der
 * offenste Ort der ganzen Anwendung.
 */
export function Tile() {
  const [liste, setListe] = useState<NotizZeile[] | null>(null);

  useEffect(() => {
    nz.liste().then(setListe).catch(() => setListe(null));
  }, []);

  if (!liste) return <div className="tile-mini">lädt…</div>;
  if (liste.length === 0) return <div className="tile-mini">Noch keine Notiz.</div>;

  const angeheftet = liste.filter((z) => z.angeheftet).length;
  // Die Liste kommt sortiert: angeheftet zuerst, dann das zuletzt Geaenderte.
  const zuletzt = [...liste].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  return (
    <div className="tile-stats">
      <div className="tile-stat">
        <span className="tile-num accent">{liste.length}</span>
        <span className="tile-lbl">{liste.length === 1 ? "Notiz" : "Notizen"}</span>
      </div>
      <div className="tile-stat">
        <span className="tile-num">{angeheftet}</span>
        <span className="tile-lbl">angeheftet</span>
      </div>
      <div className="tile-note">
        Zuletzt: {zuletzt.verschluesselt ? "verschlüsselte Notiz" : zuletzt.titel.trim() || OHNE_TITEL}
        {" · "}{wannText(zuletzt.updated_at)}
      </div>
    </div>
  );
}
