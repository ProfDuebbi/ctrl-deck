import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";

export const geburtstageModule: DashboardModule = {
  id: "geburtstage",
  title: "Geburtstage",
  description: "Wer wann Geburtstag hat — mit Vorwarnung, bevor es zu spät ist.",
  icon: "geburtstage",
  accent: "violet",
  Tile,
  View,
};
