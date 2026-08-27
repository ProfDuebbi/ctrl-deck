import { useEffect, useState } from "react";
import { dk, ablaufStatus, type DokumentRoh } from "./api";

/**
 * Die Kachel beantwortet zwei Fragen: Wie viel liegt hier, und laeuft
 * demnaechst etwas ab? Titel kommen NICHT vor — die Kachelwand ist der
 * offenste Ort der ganzen Anwendung, und was in der Schublade liegt, geht
 * niemanden etwas an, der zufaellig auf den Bildschirm sieht.
 */
export function Tile() {
  const [liste, setListe] = useState<DokumentRoh[] | null>(null);

  useEffect(() => { dk.liste().then(setListe).catch(() => setListe(null)); }, []);

  if (!liste) return <div className="tile-mini">lädt…</div>;
  if (liste.length === 0) return <div className="tile-mini">Noch nichts abgelegt.</div>;

  const mitDatei = liste.filter((d) => d.dateien.length > 0).length;
  const laeuftAb = liste.filter((d) => {
    const s = ablaufStatus(d);
    return s === "bald" || s === "abgelaufen";
  });
  const abgelaufen = laeuftAb.filter((d) => ablaufStatus(d) === "abgelaufen").length;

  return (
    <div className="tile-stats">
      <div className="tile-stat">
        <span className="tile-num accent">{liste.length}</span>
        <span className="tile-lbl">{liste.length === 1 ? "Dokument" : "Dokumente"}</span>
      </div>
      <div className="tile-stat">
        <span className={`tile-num ${laeuftAb.length > 0 ? "aus" : ""}`}>{laeuftAb.length}</span>
        <span className="tile-lbl">läuft ab</span>
      </div>
      <div className="tile-note">
        {mitDatei} als Datei, {liste.length - mitDatei} nur als Verweis
        {abgelaufen > 0 && ` · ${abgelaufen} abgelaufen`}
      </div>
    </div>
  );
}
