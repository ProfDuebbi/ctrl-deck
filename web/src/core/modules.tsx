import type { ComponentType } from "react";
import type { IconName } from "./Icon";
import { termineModule } from "../modules/termine";
import { laermprotokollModule } from "../modules/laermprotokoll";
import { stechuhrModule } from "../modules/stechuhr";
import { zaehlerstaendeModule } from "../modules/zaehlerstaende";
import { aufgabenModule } from "../modules/aufgaben";
import { haushaltModule } from "../modules/haushalt";
import { geburtstageModule } from "../modules/geburtstage";
import { fahrzeugModule } from "../modules/fahrzeug";
import { tresorModule } from "../modules/tresor";
import { notizenModule } from "../modules/notizen";
import { dokumenteModule } from "../modules/dokumente";

/**
 * Ein Dashboard-Modul ist eine in sich geschlossene Funktion.
 * - `Tile`  : kompakte Uebersichtskachel fuer die Startseite
 * - `View`  : die vollstaendige Ansicht (spaeter, eigene Seite)
 *
 * Ein neues Feature hinzufuegen = Objekt in `dashboardModules` eintragen.
 * Nichts anderes am Kern muss angefasst werden.
 */
export interface DashboardModule {
  id: string;
  title: string;
  description: string;
  icon: IconName; // Name aus dem Symbolsatz (core/Icon.tsx)
  accent: "blue" | "pink" | "violet";
  Tile?: ComponentType;
  View?: ComponentType;
  /** Optionaler Live-Zähler fürs Sidebar-Badge (z.B. fällige Aufgaben). React-Hook. */
  useBadgeCount?: () => number;
}

export const dashboardModules: DashboardModule[] = [
  termineModule,
  laermprotokollModule,
  stechuhrModule,
  zaehlerstaendeModule,
  aufgabenModule,
  haushaltModule,
  geburtstageModule,
  fahrzeugModule,
  tresorModule,
  notizenModule,
  dokumenteModule,
];

// Vorschau auf geplante Module (nur Anzeige auf der Startseite, noch inaktiv).
export interface PlannedModule {
  title: string;
  description: string;
  icon: IconName;
  accent: "blue" | "pink" | "violet";
}

export const plannedModules: PlannedModule[] = [];
