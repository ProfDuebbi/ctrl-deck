import { Router } from "express";
import { getSetting } from "../db.js";
import {
  serverModules,
  type ProfilBeitrag,
  type ProfilEreignis,
  type ProfilZahl,
  type ServerModule,
} from "./index.js";

/**
 * PROFIL — was in einem Jahr zusammengekommen ist.
 *
 * Die Profilseite zeigte bisher fuenf Zahlen, die alle aus dem Kern kamen
 * („Module sichtbar", „Tresor verschlossen"). Das ist eine Karteikarte, kein
 * Profil: Die interessanten Zahlen — wie viele Stunden gestempelt, wie viel
 * im Monat fest weg, wie lange schon jeden Tag etwas eingetragen — lagen
 * verstreut in neun Modulen, jede hinter zwei bis vier Klicks.
 *
 * Dieses Modul hat **keine eigene Tabelle**. Es fragt die Modul-Registry, wer
 * `profil()` anbietet, und legt das Ergebnis zusammen — gleiche Machart wie
 * der Terminfaden. Ein Modul, das spaeter dazukommt, erscheint hier von
 * allein.
 *
 * Ausgeblendete Module bleiben draussen. Wer den Haushalt versteckt, will ihn
 * nicht auf der Profilseite wiederfinden — das waere die Ausblenden-Einstellung
 * mit anderen Mitteln ausgehebelt.
 */

const p2 = (n: number) => String(n).padStart(2, "0");

/** Lokales Datum als YYYY-MM-DD. `toISOString()` waere UTC (siehe CLAUDE.md). */
function isoLokal(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function minusTage(d: Date, tage: number): Date {
  const k = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  k.setDate(k.getDate() - tage);
  return k;
}

/** Ausgeblendete Module — dieselbe Einstellung, die die Kachelwand liest. */
function versteckte(): Set<string> {
  try {
    const roh = getSetting("module_hidden");
    const geparst = roh ? JSON.parse(roh) : [];
    return new Set(Array.isArray(geparst) ? geparst.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

interface Gruppe {
  modul: string;
  titel: string;
  zahlen: (ProfilZahl & { modul: string })[];
}

/**
 * Alles einsammeln.
 *
 * Ein Modul, das beim Rechnen stolpert, darf nicht die ganze Seite reissen —
 * dann fehlt eben sein Block, und der Grund steht im Log. Genau wie beim
 * Terminfaden.
 */
function sammle(von: string, bis: string) {
  const aus = versteckte();
  const gruppen: Gruppe[] = [];
  const tage: Record<string, number> = {};
  const ereignisse: ProfilEreignis[] = [];
  const fehler: string[] = [];
  let seit: string | null = null;

  for (const mod of serverModules as ServerModule[]) {
    if (!mod.profil || aus.has(mod.id)) continue;
    let beitrag: ProfilBeitrag;
    try {
      beitrag = mod.profil(von, bis);
    } catch (e) {
      fehler.push(mod.id);
      console.warn(`[profil] Modul „${mod.id}" konnte nichts liefern:`, e);
      continue;
    }

    if (beitrag.zahlen?.length) {
      gruppen.push({
        modul: mod.id,
        titel: mod.title,
        zahlen: beitrag.zahlen.map((z) => ({ ton: "neutral", ...z, modul: mod.id })),
      });
    }
    for (const [tag, n] of Object.entries(beitrag.tage ?? {})) {
      tage[tag] = (tage[tag] ?? 0) + n;
    }
    if (beitrag.ereignisse?.length) ereignisse.push(...beitrag.ereignisse);
    if (beitrag.seit && (!seit || beitrag.seit < seit)) seit = beitrag.seit;
  }

  ereignisse.sort((a, b) => (a.datum === b.datum ? a.titel.localeCompare(b.titel, "de") : b.datum.localeCompare(a.datum)));
  return { gruppen, tage, ereignisse, fehler, seit };
}

/**
 * Serien im Aktivitaetsraster.
 *
 * `aktuell` zaehlt rueckwaerts ab heute und laesst den heutigen Tag aus,
 * solange er leer ist: Um neun Uhr morgens ist noch nichts passiert, und eine
 * Serie, die deshalb jeden Morgen auf 0 faellt, waere schlicht falsch.
 */
function serien(tage: Record<string, number>, heute: Date, fenster: number) {
  let laengste = 0;
  let laufend = 0;
  let aktuell = 0;
  let aktuellOffen = true;

  // Von hinten nach vorn: der juengste Tag zuerst.
  for (let i = 0; i < fenster; i++) {
    const tag = isoLokal(minusTage(heute, i));
    const aktiv = (tage[tag] ?? 0) > 0;
    if (aktiv) {
      laufend++;
      if (aktuellOffen) aktuell++;
    } else {
      laengste = Math.max(laengste, laufend);
      laufend = 0;
      // Ein leerer HEUTE beendet die laufende Serie noch nicht — der Tag
      // ist ja noch nicht vorbei.
      if (i > 0) aktuellOffen = false;
    }
  }
  return { aktuell, laengste: Math.max(laengste, laufend) };
}

const router = Router();

/**
 * Die ganze Profilseite in einer Antwort.
 *
 * `tage` bestimmt die Laenge des Rueckblicks (28–730, Vorgabe ein Jahr). Eine
 * Anfrage je Modul waere hier zehn Anfragen fuer eine einzige Seite.
 */
router.get("/", (req, res) => {
  const fenster = Math.min(Math.max(Number(req.query.tage) || 364, 28), 730);
  const heute = new Date();
  const bis = isoLokal(heute);
  const von = isoLokal(minusTage(heute, fenster - 1));

  const { gruppen, tage, ereignisse, fehler, seit } = sammle(von, bis);

  const eintraege = Object.entries(tage)
    .map(([datum, anzahl]) => ({ datum, anzahl }))
    .sort((a, b) => a.datum.localeCompare(b.datum));

  res.json({
    von,
    bis,
    fenster,
    seit,
    fehler,
    gruppen,
    tage: eintraege,
    gesamt: eintraege.reduce((s, t) => s + t.anzahl, 0),
    aktiveTage: eintraege.length,
    serie: serien(tage, heute, fenster),
    // Der Verlauf ist eine Leseprobe, keine Chronik: wer alles sehen will,
    // geht ins Modul. Zwoelf Zeilen passen ohne Scrollen unter das Raster.
    verlauf: ereignisse.slice(0, 12),
  });
});

export const profilModule: ServerModule = {
  id: "profil",
  title: "Profil",
  router,
};
