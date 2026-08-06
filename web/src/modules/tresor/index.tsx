import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";
import { useAblaufBadge } from "./statusStore";

export const tresorModule: DashboardModule = {
  id: "tresor",
  title: "Tresor",
  description: "Steuer-ID, Versicherungsnummern & Ausweise — verschlüsselt hinter einem Master-Passwort.",
  icon: "tresor",
  accent: "blue",
  Tile,
  View,
  useBadgeCount: useAblaufBadge,
};
