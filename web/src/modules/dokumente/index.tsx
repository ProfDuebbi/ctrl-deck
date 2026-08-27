import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";

export const dokumenteModule: DashboardModule = {
  id: "dokumente",
  title: "Dokumente",
  description: "Aktenschrank mit Fächern — Scans und Verweise aufs Papier, mit Ablaufdatum.",
  icon: "archiv",
  accent: "blue",
  Tile,
  View,
};
