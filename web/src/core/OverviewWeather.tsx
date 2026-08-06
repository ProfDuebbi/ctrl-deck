import { wetterIcon, type Weather } from "../modules/wetter/api";
import type { Groesse } from "./kopf";
import { Icon } from "./Icon";

/**
 * Kompaktes aktuelles Wetter — sitzt oben im Kopfbereich neben der Uhr.
 *
 * Was davon zu sehen ist, ist einstellbar (Profil → Startseite). Die Grade
 * und die Lage bleiben immer stehen: ohne sie waere es kein Wetter mehr,
 * sondern ein leerer Platz.
 */
export function HeroWeather({
  data,
  details = true,
  ort = true,
  groesse = "gross",
}: {
  data: Weather;
  details?: boolean;
  ort?: boolean;
  groesse?: Groesse;
}) {
  const c = data.current;
  return (
    <div className={`hero-weather ${c.isDay ? "day" : "night"} ${groesse === "kompakt" ? "klein" : ""}`}>
      <span className="hero-weather-icon"><Icon name={wetterIcon(c.art, c.isDay)} /></span>
      <div className="hero-weather-body">
        <div className="hero-weather-temp">{c.temp}°</div>
        <div className="hero-weather-text">{c.text}</div>
        {ort && <div className="hero-weather-place"><Icon name="ort" /> {data.label}</div>}
      </div>
      {details && (
        <div className="hero-weather-metrics">
          <span><i>Gefühlt</i> {c.feels}°</span>
          <span><i>Feuchte</i> {c.humidity}%</span>
          <span><i>Wind</i> {c.wind} km/h</span>
          <span><i>Regen</i> {c.precipitation} mm</span>
        </div>
      )}
    </div>
  );
}
