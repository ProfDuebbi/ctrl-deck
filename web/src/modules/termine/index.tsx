import type { DashboardModule } from "../../core/modules";
import { View } from "./View";
import { Tile } from "./Tile";

export const termineModule: DashboardModule = {
  id: "termine",
  title: "Termine",
  description: "Geburtstage, Fristen, Zahltage und Abläufe — alles an einem Faden.",
  icon: "termine",
  accent: "blue",
  Tile,
  View,
};
