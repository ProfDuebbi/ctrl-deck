import { useEffect, useState } from "react";
import { hh, euro, datumLabel, type TileData } from "./api";

/** "in 3 Tagen" / "morgen" / "heute" — Countdown liest sich besser als ein Datum. */
function inTagen(t: number): string {
  if (t <= 0) return "heute";
  if (t === 1) return "morgen";
  return `in ${t} Tagen`;
}

export function Tile() {
  const [d, setD] = useState<TileData | null>(null);
  useEffect(() => {
    hh.tile().then(setD).catch(() => setD(null));
  }, []);

  if (!d) return <div className="tile-mini">lädt…</div>;

  // Die Notizzeile zeigt das Dringendste: eine ablaufende Kuendigungsfrist
  // schlaegt alles andere — die ist terminlich hart und kostet sonst Geld.
  const hinweis =
    d.naechsteFrist ? (
      <span className={d.naechsteFrist.tage <= 30 ? "tile-warnung" : undefined}>
        {d.naechsteFrist.tage < 0
          ? `${d.naechsteFrist.name}: Kündigungsfrist verstrichen`
          : `${d.naechsteFrist.name} kündbar bis ${datumLabel(d.naechsteFrist.kuendbarBis)} (${inTagen(d.naechsteFrist.tage)})`}
      </span>
    ) : d.monat.saldo < 0 ? (
      <span className="tile-warnung">Dieser Monat steht bei {euro(d.monat.saldo)}</span>
    ) : d.ohneBetrag > 0 ? (
      <span>{d.ohneBetrag} Fixkosten ohne Betrag — noch zu prüfen</span>
    ) : d.naechsteEinnahme ? (
      <span>
        Nächste Einnahme: {d.naechsteEinnahme.name} am {datumLabel(d.naechsteEinnahme.datum)}{" "}
        ({inTagen(d.naechsteEinnahme.tage)})
      </span>
    ) : (
      <span>Noch keine wiederkehrende Einnahme angelegt</span>
    );

  return (
    <div className="tile-stats">
      <div className="tile-stat">
        {/* "aus"/"ein" statt "minus"/"plus": .plus ist in theme.css global belegt. */}
        <span className={`tile-num ${d.uebrigProMonat < 0 ? "aus" : "accent"}`}>
          {euro(d.uebrigProMonat)}
        </span>
        <span className="tile-lbl">bleibt übrig</span>
      </div>
      <div className="tile-stat">
        <span className={`tile-num ${d.monat.saldo < 0 ? "aus" : d.monat.saldo > 0 ? "ein" : ""}`}>
          {d.monat.saldo > 0 ? "+ " : ""}
          {euro(d.monat.saldo)}
        </span>
        <span className="tile-lbl">dieser Monat</span>
      </div>
      {/* Aussenstaende: Geld, das ANDERE dem Nutzer schulden. „offen bei 3"
          stand hier vorher und las sich genau andersherum. */}
      {d.schuldenOffen > 0 && (
        <div className="tile-stat">
          <span className="tile-num ein">{euro(d.schuldenOffen)}</span>
          <span className="tile-lbl">
            schulden dir {d.schuldenAnzahl === 1 ? "1 Person" : `${d.schuldenAnzahl} Leute`}
          </span>
        </div>
      )}
      <div className="tile-note">{hinweis}</div>
    </div>
  );
}
