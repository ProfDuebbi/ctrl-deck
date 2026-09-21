/*
 * CTRL·DECK — modulares Control-Dashboard, das lokal laeuft.
 * Copyright (C) 2026 ProfDuebbi
 *
 * Freie Software unter der GNU Affero General Public License, Version 3 oder
 * spaeter. Weitergabe und Aenderung erlaubt; ohne jede Gewaehrleistung.
 * Der volle Lizenztext steht in der Datei LICENSE.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./core/App";
import { ConfirmProvider } from "./core/ui";
import { Tuer } from "./core/Tuer";
import { ReminderWatcher } from "./modules/aufgaben/ReminderWatcher";
import "./core/theme.css";
// Die zweite Haut. Reihenfolge ist Absicht: erst das Hausdesign, dann das
// Kit, zuletzt die Bruecke, die beide verbindet. Alles daran haengt unter
// `html[data-haut="nexus"]` bzw. `.nx` — ohne die Haut ist es wirkungslos.
import "./haut/nexus/nexus.css";
import "./haut/nexus/bruecke.css";
// Setzt `data-haut` und die Akzentfarbe, bevor React das erste Mal zeichnet.
import "./haut/haut";

// Alles Datenfuehrende liegt hinter der Tuer — auch der ReminderWatcher, der
// sonst im Hintergrund gegen einen verschlossenen Server pollen wuerde.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <Tuer>
        <App />
        <ReminderWatcher />
      </Tuer>
    </ConfirmProvider>
  </React.StrictMode>
);
