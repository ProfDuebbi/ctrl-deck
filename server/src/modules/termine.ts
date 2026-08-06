import { Router } from "express";
import { serverModules, type ServerModule, type Termin } from "./index.js";

/**
 * TERMINFADEN — ein Faden aus allem, was ein Datum hat.
 *
 * Geburtstage, faellige Aufgaben, Kuendigungsfristen, ablaufende Dokumente und
 * Zahltage lagen bisher in fuenf Modulen verstreut. Keine Ansicht beantwortete
 * die einzige Frage, die man morgens hat: *Was kommt die naechsten zwei Wochen
 * auf mich zu?*
 *
 * Dieses Modul hat **keine eigene Tabelle und kein eigenes Datum**. Es fragt
 * die Modul-Registry, welche Module `termine()` anbieten, und sortiert das
 * Ergebnis. Ein Modul, das spaeter dazukommt, erscheint hier von allein —
 * niemand muss diese Datei dafuer anfassen.
 */

const p2 = (n: number) => String(n).padStart(2, "0");

/** Lokales Datum als YYYY-MM-DD. `toISOString()` waere UTC (siehe CLAUDE.md). */
function isoLokal(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function plusTage(d: Date, tage: number): Date {
  const k = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  k.setDate(k.getDate() + tage);
  return k;
}

/**
 * Bei gleichem Tag zaehlt erst die Uhrzeit, dann die Sorte.
 *
 * Die Reihenfolge der Sorten ist eine Aussage: Was verfaellt, steht oben —
 * ein abgelaufener Ausweis oder eine verstrichene Kuendigungsfrist ist nicht
 * nachholbar. Ein Geburtstag ist wichtig, aber er verfaellt nicht.
 */
const RANG: Record<Termin["art"], number> = {
  ablauf: 0,
  frist: 1,
  aufgabe: 2,
  zahltag: 3,
  geburtstag: 4,
};

function sortiere(a: Termin, b: Termin): number {
  if (a.datum !== b.datum) return a.datum.localeCompare(b.datum);
  const za = a.zeit ?? "99:99";
  const zb = b.zeit ?? "99:99";
  if (za !== zb) return za.localeCompare(zb);
  if (RANG[a.art] !== RANG[b.art]) return RANG[a.art] - RANG[b.art];
  return a.titel.localeCompare(b.titel, "de");
}

/**
 * Alle Termine im Fenster einsammeln.
 *
 * Ein Modul, das beim Sammeln stolpert, darf nicht den ganzen Faden reissen —
 * dann fehlt eben seine Zeile, und der Grund steht im Log.
 */
function sammle(von: string, bis: string): { termine: Termin[]; fehler: string[] } {
  const termine: Termin[] = [];
  const fehler: string[] = [];
  for (const mod of serverModules as ServerModule[]) {
    if (!mod.termine) continue;
    try {
      termine.push(...mod.termine(von, bis));
    } catch (e) {
      fehler.push(mod.id);
      console.warn(`[termine] Modul „${mod.id}" konnte nichts liefern:`, e);
    }
  }
  return { termine: termine.sort(sortiere), fehler };
}

/** Tage bis zum Termin, negativ = vorbei. Beide Seiten lokal gerechnet. */
function tageBis(datum: string, heute: string): number {
  const [j1, m1, t1] = heute.split("-").map(Number);
  const [j2, m2, t2] = datum.split("-").map(Number);
  return Math.round((Date.UTC(j2, m2 - 1, t2) - Date.UTC(j1, m1 - 1, t1)) / 86_400_000);
}

const router = Router();

/**
 * Der Faden. `tage` bestimmt, wie weit nach vorn geschaut wird (1–365).
 * Ueberfaelliges liefern die Module unabhaengig davon mit.
 */
router.get("/", (req, res) => {
  const tage = Math.min(Math.max(Number(req.query.tage) || 30, 1), 365);
  const heute = new Date();
  const von = isoLokal(heute);
  const bis = isoLokal(plusTage(heute, tage));
  const { termine, fehler } = sammle(von, bis);

  res.json({
    von,
    bis,
    tage,
    fehler,
    termine: termine.map((t) => ({ ...t, tageBis: tageBis(t.datum, von) })),
  });
});

/** Kurzfassung fuer Kachel und Sidebar-Zaehler. */
router.get("/uebersicht", (req, res) => {
  const tage = Math.min(Math.max(Number(req.query.tage) || 14, 1), 365);
  const heute = new Date();
  const von = isoLokal(heute);
  const bis = isoLokal(plusTage(heute, tage));
  const { termine } = sammle(von, bis);

  const heuteTermine = termine.filter((t) => t.datum === von);
  const ueberfaellig = termine.filter((t) => t.datum < von);
  res.json({
    anzahl: termine.length,
    heute: heuteTermine.length,
    ueberfaellig: ueberfaellig.length,
    dringend: termine.filter((t) => t.dringend).length,
    naechster: termine[0]
      ? { ...termine[0], tageBis: tageBis(termine[0].datum, von) }
      : null,
  });
});

export const termineModule: ServerModule = {
  id: "termine",
  title: "Termine",
  router,
  // Meldet selbst nichts an den Faden — es IST der Faden.
};
