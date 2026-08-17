import { machRouter } from "../route.js";
import { getSetting, setSetting } from "../db.js";
import type { ServerModule } from "./index.js";

// Open-Meteo: kostenlos, kein API-Key, keine Anmeldung.
// Geocoding wandelt Ortsname -> Koordinaten, Forecast liefert das Wetter.

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// WMO-Wettercodes -> deutscher Text + Emoji + Kategorie.
// `art` ist die Kategorie, aus der das Frontend sein Konturensymbol waehlt.
// Das Emoji bleibt fuer Bestandsaufrufer (z. B. /summary) erhalten.
export type WetterArt =
  | "klar" | "leicht-bewoelkt" | "bewoelkt" | "nebel"
  | "niesel" | "regen" | "schnee" | "gewitter" | "unbekannt";

const WMO: Record<number, { text: string; icon: string; art: WetterArt }> = {
  0: { text: "Klar", icon: "☀️", art: "klar" },
  1: { text: "Überwiegend klar", icon: "🌤️", art: "leicht-bewoelkt" },
  2: { text: "Teils bewölkt", icon: "⛅", art: "leicht-bewoelkt" },
  3: { text: "Bewölkt", icon: "☁️", art: "bewoelkt" },
  45: { text: "Nebel", icon: "🌫️", art: "nebel" },
  48: { text: "Reifnebel", icon: "🌫️", art: "nebel" },
  51: { text: "Leichter Niesel", icon: "🌦️", art: "niesel" },
  53: { text: "Niesel", icon: "🌦️", art: "niesel" },
  55: { text: "Starker Niesel", icon: "🌦️", art: "niesel" },
  56: { text: "Gefrierender Niesel", icon: "🌧️", art: "niesel" },
  57: { text: "Gefrierender Niesel", icon: "🌧️", art: "niesel" },
  61: { text: "Leichter Regen", icon: "🌦️", art: "regen" },
  63: { text: "Regen", icon: "🌧️", art: "regen" },
  65: { text: "Starker Regen", icon: "🌧️", art: "regen" },
  66: { text: "Gefrierender Regen", icon: "🌧️", art: "regen" },
  67: { text: "Gefrierender Regen", icon: "🌧️", art: "regen" },
  71: { text: "Leichter Schneefall", icon: "🌨️", art: "schnee" },
  73: { text: "Schneefall", icon: "❄️", art: "schnee" },
  75: { text: "Starker Schneefall", icon: "❄️", art: "schnee" },
  77: { text: "Schneegriesel", icon: "🌨️", art: "schnee" },
  80: { text: "Leichte Schauer", icon: "🌦️", art: "regen" },
  81: { text: "Schauer", icon: "🌧️", art: "regen" },
  82: { text: "Heftige Schauer", icon: "⛈️", art: "gewitter" },
  85: { text: "Schneeschauer", icon: "🌨️", art: "schnee" },
  86: { text: "Starke Schneeschauer", icon: "❄️", art: "schnee" },
  95: { text: "Gewitter", icon: "⛈️", art: "gewitter" },
  96: { text: "Gewitter mit Hagel", icon: "⛈️", art: "gewitter" },
  99: { text: "Schweres Gewitter", icon: "⛈️", art: "gewitter" },
};
const decode = (code: number) => WMO[code] ?? { text: "Unbekannt", icon: "❓", art: "unbekannt" as WetterArt };

interface Location {
  label: string;
  lat: number;
  lon: number;
}

// Der Standort kommt aus der Ersteinrichtung und steht in den Einstellungen.
// Frueher stand hier ein fest verdrahteter Ort, der bei jedem Start erzwungen
// wurde — das ging nur, solange diese Installation genau einem Menschen
// gehoerte. Ohne gespeicherten Ort bleibt die Wetteranzeige einfach leer.
async function savedLocation(): Promise<Location | null> {
  const label = await getSetting("wetter_label");
  const lat = await getSetting("wetter_lat");
  const lon = await getSetting("wetter_lon");
  if (!label || !lat || !lon) return null;
  return { label, lat: Number(lat), lon: Number(lon) };
}

// Kleiner Cache, damit wir die API nicht bei jedem Aufruf treffen.
let cache: { key: string; at: number; data: any } | null = null;
const CACHE_MS = 10 * 60 * 1000;

async function fetchWeather(loc: Location) {
  const key = `${loc.lat},${loc.lon}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;

  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: "auto",
    forecast_days: "5",
  });
  const res = await fetch(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const raw = (await res.json()) as any;

  const c = raw.current;
  const data = {
    label: loc.label,
    updated: new Date().toISOString(),
    current: {
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind: Math.round(c.wind_speed_10m),
      precipitation: c.precipitation,
      isDay: c.is_day === 1,
      ...decode(c.weather_code),
    },
    daily: raw.daily.time.map((date: string, i: number) => ({
      date,
      max: Math.round(raw.daily.temperature_2m_max[i]),
      min: Math.round(raw.daily.temperature_2m_min[i]),
      rainProb: raw.daily.precipitation_probability_max[i],
      ...decode(raw.daily.weather_code[i]),
    })),
    sunrise: raw.daily.sunrise?.[0] ?? null,
    sunset: raw.daily.sunset?.[0] ?? null,
  };

  cache = { key, at: Date.now(), data };
  return data;
}

// --- Router ---------------------------------------------------------------

const router = machRouter();

router.get("/location", async (_req, res) => {
  res.json(await savedLocation());
});

/** Beschriftung eines Treffers: „Kiel, Schleswig-Holstein, DE". */
const ortsName = (hit: any) =>
  [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(", ");

/**
 * Ortssuche fuer die Ersteinrichtung — mehrere Treffer zur Auswahl.
 *
 * Ortsnamen sind selten eindeutig — dasselbe Wort findet sich oft in mehreren
 * Laendern. Frueher nahm der Server stillschweigend den ersten Treffer. Wer
 * seinen Standort einmal im Leben einstellt, soll dabei sehen, welchen Ort er
 * bekommt.
 *
 * Diese Route ist die einzige, die ohne Anmeldung erreichbar ist — und auch
 * das nur, solange noch kein Konto existiert (siehe auth.ts).
 */
router.get("/orte", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json([]);
  try {
    const params = new URLSearchParams({ name: q, count: "6", language: "de", format: "json" });
    const geo = (await (await fetch(`${GEO_URL}?${params}`)).json()) as any;
    const treffer = (geo.results ?? []).map((hit: any) => ({
      label: ortsName(hit),
      lat: hit.latitude,
      lon: hit.longitude,
      land: hit.country ?? "",
      einwohner: hit.population ?? null,
    }));
    res.json(treffer);
  } catch {
    res.status(502).json({ error: "Ortssuche nicht erreichbar" });
  }
});

/**
 * Ort setzen — entweder mit fertigen Koordinaten aus der Suche (bevorzugt,
 * dann ist es genau der Ort, den der Mensch angeklickt hat) oder mit einem
 * blossen Namen, den der Server dann selbst nachschlaegt.
 */
router.post("/location", async (req, res) => {
  const lat = Number(req.body?.lat);
  const lon = Number(req.body?.lon);
  const label = String(req.body?.label ?? "").trim();
  if (label && Number.isFinite(lat) && Number.isFinite(lon)) {
    await setSetting("wetter_label", label);
    await setSetting("wetter_lat", String(lat));
    await setSetting("wetter_lon", String(lon));
    cache = null;
    return res.json({ label, lat, lon });
  }

  const city = String(req.body?.city ?? "").trim();
  if (!city) return res.status(400).json({ error: "Ort fehlt" });
  try {
    const params = new URLSearchParams({ name: city, count: "1", language: "de", format: "json" });
    const geo = (await (await fetch(`${GEO_URL}?${params}`)).json()) as any;
    const hit = geo.results?.[0];
    if (!hit) return res.status(404).json({ error: "Ort nicht gefunden" });
    const gefunden = ortsName(hit);
    await setSetting("wetter_label", gefunden);
    await setSetting("wetter_lat", String(hit.latitude));
    await setSetting("wetter_lon", String(hit.longitude));
    cache = null;
    res.json({ label: gefunden, lat: hit.latitude, lon: hit.longitude });
  } catch (e) {
    res.status(502).json({ error: "Geocoding fehlgeschlagen" });
  }
});

router.get("/current", async (_req, res) => {
  const loc = await savedLocation();
  if (!loc) return res.status(404).json({ error: "kein Ort gesetzt" });
  try {
    res.json(await fetchWeather(loc));
  } catch (e) {
    res.status(502).json({ error: "Wetterabruf fehlgeschlagen" });
  }
});

router.get("/summary", async (_req, res) => {
  const loc = await savedLocation();
  if (!loc) return res.json({ set: false });
  try {
    const w = await fetchWeather(loc);
    res.json({ set: true, label: w.label, temp: w.current.temp, icon: w.current.icon, text: w.current.text });
  } catch {
    res.json({ set: true, label: loc.label, error: true });
  }
});

export const wetterModule: ServerModule = {
  id: "wetter",
  title: "Wetter",
  router,
};
