import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";

export const haushaltModule: DashboardModule = {
  id: "haushalt",
  title: "Haushalt",
  description: "Fixkosten, Buchungen, Jahresbericht und offene Außenstände.",
  icon: "haushalt",
  accent: "pink",
  Tile,
  View,
};
