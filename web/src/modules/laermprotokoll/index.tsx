import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";

export const laermprotokollModule: DashboardModule = {
  id: "laermprotokoll",
  title: "Lärmprotokoll",
  description: "Eigenes Protokoll & Fremdgeräusche dokumentieren, filtern, exportieren.",
  icon: "laerm",
  accent: "pink",
  Tile,
  View,
};
