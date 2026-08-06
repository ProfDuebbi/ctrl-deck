import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";
import { useDueCount } from "./dueStore";

export const aufgabenModule: DashboardModule = {
  id: "aufgaben",
  title: "Aufgaben & Erinnerungen",
  description: "To-dos mit Fälligkeit, Wiederholung und Desktop-Erinnerung.",
  icon: "aufgaben",
  accent: "pink",
  Tile,
  View,
  useBadgeCount: useDueCount,
};
