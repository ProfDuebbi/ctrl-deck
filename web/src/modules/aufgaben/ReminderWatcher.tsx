import { useEffect, useState } from "react";
import { ag } from "./api";
import { notifyDue } from "./notify";
import { setDueCount } from "./dueStore";
import { Icon } from "../../core/Icon";

const POLL_MS = 45_000;

/**
 * Läuft global (unabhängig vom aktiven Modul): fragt regelmäßig fällige
 * Aufgaben ab, feuert Desktop-Benachrichtigungen und zeigt einen In-App-Hinweis.
 */
export function ReminderWatcher() {
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;

    async function check() {
      try {
        const due = await ag.due();
        if (stopped) return;
        setDueCount(due.length);
        const fresh = notifyDue(due);
        if (fresh.length > 0) {
          setBanner(
            fresh.length === 1
              ? `Erinnerung: ${fresh[0].titel}`
              : `${fresh.length} Aufgaben sind fällig`
          );
          setTimeout(() => setBanner(null), 8000);
        }
      } catch {
        /* Backend evtl. offline — still ignorieren */
      }
    }

    check();
    const id = setInterval(check, POLL_MS);
    // beim Zurückkehren zum Tab sofort prüfen
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (!banner) return null;
  // Ein Knopf, kein anklickbares <div>: die Erinnerung muss auch per Tastatur
  // wegzubekommen sein. role="alert" sagt sie zusaetzlich sofort an.
  return (
    <button className="reminder-banner" onClick={() => setBanner(null)} role="alert">
      <Icon name="glocke" /> {banner}
      <span className="sr-only"> — zum Schließen bestätigen</span>
    </button>
  );
}
