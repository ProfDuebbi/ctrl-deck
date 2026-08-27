import { useRest } from "./useRest";
import { naechsteMarke, zwei } from "./countdown";
import "./gta6.css";

/*
 * Die Kachel auf der Startseite. Sie traegt denselben Sonnenuntergang
 * wie die Vollansicht — nur angedeutet, in 92 Pixel passt keine Szene.
 *
 * Ja, sie faellt zwischen den anderen Kacheln auf. Das ist der Punkt:
 * die Ausnahme vom Hausstil ist bewusst gewaehlt (Begruendung steht
 * oben in gta6.css), und eine Ausnahme, die man nicht sieht, waere
 * keine. Der Rand, die Ecken und die Hoehe der KACHEL selbst bleiben
 * die der anderen — abweichend ist nur, was darin steht.
 */
export function Tile() {
  const r = useRest();

  if (r.vorbei) {
    return (
      <div className="gta-kachel">
        <div className="gta-kachel-oben">
          <span className="gta-kachel-tage">Heute</span>
        </div>
        <span className="gta-kachel-note">Es ist so weit.</span>
      </div>
    );
  }

  const naechste = naechsteMarke(r.tage);
  const bisMarke = naechste ? r.tage - naechste.tage : 0;

  return (
    <div className="gta-kachel">
      <div className="gta-kachel-oben">
        <span className="gta-kachel-tage">{r.tage}</span>
        <span className="gta-kachel-einheit">{r.tage === 1 ? "Tag" : "Tage"}</span>
        <span className="gta-kachel-rest">
          {zwei(r.stunden)}:{zwei(r.minuten)}:{zwei(r.sekunden)}
        </span>
      </div>
      {naechste && (
        <span className="gta-kachel-note">
          {naechste.label} — in {bisMarke} {bisMarke === 1 ? "Tag" : "Tagen"}
        </span>
      )}
    </div>
  );
}
