import type { DashboardModule } from "../../core/modules";
import { Tile } from "./Tile";
import { View } from "./View";

/*
 * Das einzige Modul ohne Backend: es speichert nichts und fragt nichts
 * ab, sondern rechnet mit der Uhr dieses Rechners. Deshalb steht in
 * `server/src/modules/` nichts dazu — der Eintrag hier genuegt.
 *
 * Es ist ausserdem das einzige, das vom Hausstil abweicht. Die
 * Begruendung dafuer steht ausfuehrlich oben in `gta6.css`; kurz: es
 * zeigt keine Daten, es zeigt Vorfreude.
 */
export const gta6Module: DashboardModule = {
  id: "gta6",
  title: "GTA VI",
  description: "Wie lange noch. Countdown bis zum 19. November 2026.",
  icon: "wecker",
  accent: "pink",
  Tile,
  View,
};
