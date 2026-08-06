import { wetterIcon, type Weather } from "../modules/wetter/api";
import { Icon } from "./Icon";

/** Kompaktes aktuelles Wetter — sitzt oben im Kopfbereich neben der Uhr. */
export function HeroWeather({ data }: { data: Weather }) {
  const c = data.current;
  return (
    <div className={`hero-weather ${c.isDay ? "day" : "night"}`}>
      <span className="hero-weather-icon"><Icon name={wetterIcon(c.art, c.isDay)} /></span>
      <div className="hero-weather-body">
        <div className="hero-weather-temp">{c.temp}°</div>
        <div className="hero-weather-text">{c.text}</div>
        <div className="hero-weather-place"><Icon name="ort" /> {data.label}</div>
      </div>
      <div className="hero-weather-metrics">
        <span><i>Gefühlt</i> {c.feels}°</span>
        <span><i>Feuchte</i> {c.humidity}%</span>
        <span><i>Wind</i> {c.wind} km/h</span>
        <span><i>Regen</i> {c.precipitation} mm</span>
      </div>
    </div>
  );
}
