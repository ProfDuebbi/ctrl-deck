import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";

export const zaehlerstaendeModule: DashboardModule = {
  id: "zaehlerstaende",
  title: "Zählerstände",
  description: "Strom, Gas & Wasser ablesen — Verbrauch und Hochrechnung im Blick.",
  icon: "zaehler",
  accent: "violet",
  Tile,
  View,
};
