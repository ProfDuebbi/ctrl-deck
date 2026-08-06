import type { DashboardModule } from "../../core/modules";
import { View } from "./View";
import { Tile } from "./Tile";

export const fahrzeugModule: DashboardModule = {
  id: "fahrzeug",
  title: "Fahrzeug",
  description: "HU, Versicherung und Steuer im Blick — dazu Tanken, Wartung und Verbrauch.",
  icon: "fahrzeug",
  accent: "violet",
  Tile,
  View,
};
