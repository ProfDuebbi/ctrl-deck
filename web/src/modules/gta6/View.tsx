import { Fragment } from "react";
import { Szene } from "./Szene";
import { useRest } from "./useRest";
import { fortschritt, marken, zwei, TERMIN_TEXT } from "./countdown";
import "./gta6.css";

/*
 * Die Vollansicht: oben das Plakat, unten die ablesbaren Zahlen.
 *
 * Die Teilung ist Absicht. Der obere Teil ist die ausdrueckliche
 * Ausnahme vom Hausstil (Begruendung steht in gta6.css), der untere
 * haelt sich daran — er zeigt Information, und Information bleibt
 * flach, ruhig und ablesbar.
 */

const EINHEITEN = [
  { schluessel: "tage", eins: "Tag", mehr: "Tage", gepolstert: false },
  { schluessel: "stunden", eins: "Stunde", mehr: "Stunden", gepolstert: true },
  { schluessel: "minuten", eins: "Minute", mehr: "Minuten", gepolstert: true },
  { schluessel: "sekunden", eins: "Sekunde", mehr: "Sekunden", gepolstert: true },
] as const;

export function View() {
  const r = useRest();
  const anteil = fortschritt();
  const stufen = marken(r.tage);

  return (
    <div className="gta">
      <div className="gta-buehne">
        <Szene />

        <div className="gta-inhalt">
          <span className="gta-wort">Grand Theft Auto</span>
          <span className="gta-zahlzeichen">VI</span>

          {r.vorbei ? (
            <div className="gta-fertig">
              <span className="gta-fertig-titel">Es ist so weit.</span>
              <span className="gta-fertig-note">
                Der {TERMIN_TEXT} ist da. Bis später, ich bin dann in Leonida.
              </span>
            </div>
          ) : (
            <>
              {/*
                `role="timer"` mit `aria-live="off"`: die Ziffern aendern
                sich jede Sekunde, und ein Bildschirmleser, der das
                mitliest, macht die Seite unbenutzbar. Die Aussage steht
                stattdessen einmal im Satz darunter — und der wird nur
                bei Tageswechsel neu geschrieben, weil er nur Tage nennt.
              */}
              <div className="gta-uhr" role="timer" aria-live="off">
                {EINHEITEN.map((e, i) => {
                  const wert = r[e.schluessel];
                  return (
                    <Fragment key={e.schluessel}>
                      {i > 0 && (
                        <span className="gta-punkt" aria-hidden="true">
                          :
                        </span>
                      )}
                      <div className="gta-feld">
                        <span className="gta-zahl">{e.gepolstert ? zwei(wert) : wert}</span>
                        <span className="gta-einheit">{wert === 1 ? e.eins : e.mehr}</span>
                      </div>
                    </Fragment>
                  );
                })}
              </div>

              <p className="sr-only">
                Noch {r.tage} Tage bis zum Erscheinen von Grand Theft Auto VI am {TERMIN_TEXT}.
              </p>

              <div className="gta-termin">
                <span>{TERMIN_TEXT}</span>
                <span aria-hidden="true" style={{ opacity: 0.4 }}>
                  ·
                </span>
                <span className="ort">Leonida</span>
              </div>
            </>
          )}
        </div>
      </div>

      {!r.vorbei && (
        <div className="gta-unten">
          <div className="gta-block">
            <span className="gta-block-titel">Seit der Ankündigung</span>
            <div className="gta-balken">
              <span style={{ ["--anteil" as string]: `${anteil}%` }} />
            </div>
            <div className="gta-balken-enden">
              <span>Trailer 1</span>
              <span>Erscheinen</span>
            </div>
            <p className="gta-note">
              Der erste Trailer lief am 4. Dezember 2023. Seitdem sind{" "}
              {anteil.toLocaleString("de-DE")} % der Wartezeit vorbei.
            </p>
          </div>

          <div className="gta-block">
            <span className="gta-block-titel">Marken</span>
            <ol className="gta-marken">
              {stufen.map((m) => (
                <li key={m.tage} className={`gta-marke${m.erreicht ? " erreicht" : ""}`}>
                  <span className="gta-marke-punkt" aria-hidden="true" />
                  <span className="gta-marke-label">{m.label}</span>
                  <span className="gta-marke-zustand">{m.erreicht ? "vorbei" : "steht aus"}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      <p className="gta-fussnote">
        Rechnet mit der Uhr dieses Rechners, in dieser Zeitzone. „Grand Theft Auto“, „GTA“ und
        „Rockstar Games“ sind Marken der Take-Two Interactive Software, Inc.; dieses Modul hat
        keine Verbindung dorthin und keinen Anspruch darauf, dass das genannte Datum hält.
      </p>
    </div>
  );
}
