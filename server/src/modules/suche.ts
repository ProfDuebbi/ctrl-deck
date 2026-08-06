import { Router } from "express";
import { serverModules, type ServerModule, type Treffer } from "./index.js";

/**
 * GLOBALE SUCHE — ein Feld für alles.
 *
 * Wie der Terminfaden greift sie in keine fremde Tabelle, sondern fragt die
 * Registry, welche Module ein `suche()` anbieten. Ein spaeter nachgereichtes
 * Modul ist damit sofort durchsuchbar, ohne dass jemand diese Datei anfasst.
 *
 * **Der Tresor ist absichtlich nicht dabei.** Titel, Werte und Notizen liegen
 * dort nur als Chiffrat; eine Volltextsuche darueber gaebe es nur, wenn der
 * Server die Klartexte kennen wuerde. Das ist keine Luecke, das ist der Punkt.
 */

/** Obergrenze je Modul, damit ein datenreiches Modul die Liste nicht fuellt. */
const JE_MODUL = 6;

const router = Router();

router.get("/", (req, res) => {
  const begriff = String(req.query.q ?? "").trim();
  if (begriff.length < 2) return res.json({ begriff, treffer: [], fehler: [] });

  // LIKE-Sonderzeichen entschaerfen: ein „%" im Suchfeld soll ein Prozent-
  // zeichen suchen und nicht plaetzlich alles finden.
  const sauber = begriff.replace(/[%_]/g, "");
  if (!sauber) return res.json({ begriff, treffer: [], fehler: [] });

  const treffer: Treffer[] = [];
  const fehler: string[] = [];
  for (const mod of serverModules as ServerModule[]) {
    if (!mod.suche) continue;
    try {
      treffer.push(...mod.suche(sauber, JE_MODUL));
    } catch (e) {
      fehler.push(mod.id);
      console.warn(`[suche] Modul „${mod.id}" konnte nicht suchen:`, e);
    }
  }

  // Wer den Begriff am Anfang traegt, steht oben — „Netz" soll
  // „Netzbetreiber" vor „Stromnetz erneuern" zeigen. Danach das Neueste.
  const klein = sauber.toLowerCase();
  treffer.sort((a, b) => {
    const av = a.titel.toLowerCase().startsWith(klein) ? 0 : 1;
    const bv = b.titel.toLowerCase().startsWith(klein) ? 0 : 1;
    if (av !== bv) return av - bv;
    if (a.datum && b.datum && a.datum !== b.datum) return b.datum.localeCompare(a.datum);
    return a.titel.localeCompare(b.titel, "de");
  });

  res.json({ begriff, treffer, fehler });
});

export const sucheModule: ServerModule = {
  id: "suche",
  title: "Suche",
  router,
  // Sucht nicht in sich selbst.
};
