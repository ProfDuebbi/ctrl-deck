import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";

export const notizenModule: DashboardModule = {
  id: "notizen",
  title: "Notizen",
  description: "Freier Text in Markdown, mit Schlagworten, Wiedervorlage und Papierkorb.",
  icon: "notizen",
  accent: "violet",
  Tile,
  View,
};
