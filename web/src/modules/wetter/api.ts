import { api } from "../../core/api";
import type { IconName } from "../../core/Icon";

/** Wetterkategorie, die das Backend aus dem WMO-Code ableitet. */
export type WetterArt =
  | "klar" | "leicht-bewoelkt" | "bewoelkt" | "nebel"
  | "niesel" | "regen" | "schnee" | "gewitter" | "unbekannt";

/**
 * Kategorie -> Konturensymbol. Tag und Nacht unterscheiden sich nur dort,
 * wo die Sonne im Bild vorkaeme.
 */
export function wetterIcon(art: WetterArt, isDay: boolean): IconName {
  switch (art) {
    case "klar": return isDay ? "sonne" : "mond";
    case "leicht-bewoelkt": return isDay ? "wolke-sonne" : "wolke-mond";
    case "bewoelkt": return "wolke";
    case "nebel": return "nebel";
    case "niesel": return "niesel";
    case "regen": return "regen";
    case "schnee": return "schnee";
    case "gewitter": return "gewitter";
    default: return "unbekannt";
  }
}

export interface Location {
  label: string;
  lat: number;
  lon: number;
}

export interface CurrentWeather {
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  precipitation: number;
  isDay: boolean;
  text: string;
  icon: string;
  art: WetterArt;
}

export interface DailyDay {
  date: string;
  max: number;
  min: number;
  rainProb: number;
  text: string;
  icon: string;
  art: WetterArt;
}

export interface Weather {
  label: string;
  updated: string;
  current: CurrentWeather;
  daily: DailyDay[];
  sunrise: string | null;
  sunset: string | null;
}

export interface WetterSummary {
  set: boolean;
  label?: string;
  temp?: number;
  icon?: string;
  text?: string;
  error?: boolean;
}

const base = "/wetter";

export const wetter = {
  location: () => api<Location | null>(`${base}/location`),
  setLocation: (city: string) =>
    api<Location>(`${base}/location`, { method: "POST", body: JSON.stringify({ city }) }),
  current: () => api<Weather>(`${base}/current`),
  summary: () => api<WetterSummary>(`${base}/summary`),
};
