import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";

export const stechuhrModule: DashboardModule = {
  id: "stechuhr",
  title: "Stechuhr",
  description: "Arbeitszeit erfassen — ein-/ausstempeln, Wochenstunden im Blick.",
  icon: "stechuhr",
  accent: "blue",
  Tile,
  View,
};
