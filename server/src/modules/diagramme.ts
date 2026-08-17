import { machRouter } from "../route.js";
import { getSetting } from "../db.js";
import { serverModules, type Diagramm, type ServerModule } from "./index.js";

/**
 * DIAGRAMME — die Uebersicht als Bild statt als Kachelwand.
 *
 * Die Kachelwand beantwortet „wie steht es gerade?". Sie kann nicht
 * beantworten, wie es dorthin gekommen ist: Ob die Stunden steigen, ob der
 * Monat besser lief als der davor, ob der Stromverbrauch anzieht. Genau dafuer
 * gibt es diese zweite Ansicht — dieselben Module, andere Frage.
 *
 * Wie `termine`, `suche` und `profil` hat dieses Modul **keine eigene Tabelle**.
 * Es fragt die Registry, wer `diagramme()` anbietet, und legt zusammen.
 *
 * Ein gemeinsamer Zeitraum fuer ALLE Diagramme ist Absicht: Filter je Karte
 * waeren vier verschiedene Zeitraeume nebeneinander, und dann vergleicht man
 * Bilder, die nicht vergleichbar sind.
 */

const p2 = (n: number) => String(n).padStart(2, "0");

/** Lokales Datum als YYYY-MM-DD. `toISOString()` waere UTC (siehe CLAUDE.md). */
function isoLokal(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/**
 * Anfang des Zeitraums: `monate` volle Monate zurueck, immer auf den Ersten.
 *
 * Auf den Monatsersten gerundet, weil die Diagramme in Monaten buendeln. Ein
 * Fenster, das am 17. beginnt, macht den ersten Balken zu einem halben —
 * und ein halber Balken sieht aus wie ein Einbruch.
 */
function fensterStart(heute: Date, monate: number): string {
  const d = new Date(heute.getFullYear(), heute.getMonth() - (monate - 1), 1);
  return isoLokal(d);
}

/** Ausgeblendete Module — dieselbe Einstellung, die die Kachelwand liest. */
async function versteckte(): Promise<Set<string>> {
  try {
    const roh = await getSetting("module_hidden");
    const geparst = roh ? JSON.parse(roh) : [];
    return new Set(Array.isArray(geparst) ? geparst.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Hat ein Diagramm ueberhaupt etwas zu zeigen? */
function hatInhalt(d: Diagramm): boolean {
  return d.reihen.some((r) => r.punkte.some((p) => p.y !== 0));
}

const router = machRouter();

/**
 * Alle Diagramme in einer Antwort. `monate` ist 1–120 (Vorgabe 12); `0` steht
 * fuer „alles, was da ist" und schiebt den Anfang auf ein sehr frueh
 * liegendes Datum.
 */
router.get("/", async (req, res) => {
  const roh = Number(req.query.monate);
  const alles = roh === 0;
  const monate = alles ? 0 : Math.min(Math.max(Number.isFinite(roh) ? roh : 12, 1), 120);

  const heute = new Date();
  const bis = isoLokal(heute);
  const von = alles ? "0001-01-01" : fensterStart(heute, monate);

  const aus = await versteckte();
  const diagramme: Diagramm[] = [];
  const fehler: string[] = [];

  for (const mod of serverModules as ServerModule[]) {
    if (!mod.diagramme || aus.has(mod.id)) continue;
    try {
      for (const d of await mod.diagramme(von, bis)) {
        // Ein Diagramm ohne einen einzigen Wert ungleich null ist eine leere
        // Flaeche mit Ueberschrift. Lieber gar nicht zeigen.
        if (hatInhalt(d)) diagramme.push({ ...d, modul: mod.id });
      }
    } catch (e) {
      fehler.push(mod.id);
      console.warn(`[diagramme] Modul „${mod.id}" konnte nichts liefern:`, e);
    }
  }

  res.json({ von, bis, monate, alles, fehler, diagramme });
});

export const diagrammeModule: ServerModule = {
  id: "diagramme",
  title: "Diagramme",
  router,
};
