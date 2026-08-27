import fs from "node:fs";
import path from "node:path";
import { machRouter } from "../route.js";
import { getSetting, setSetting } from "../db.js";
import { ROOT_DIR } from "../paths.js";
import type { ServerModule } from "./index.js";

/**
 * WAS IST NEU — die Änderungsliste des Programms.
 *
 * Die Quelle ist `CHANGELOG.md` im Projektordner, nicht die Datenbank. Das ist
 * die ganze Idee: Der Text gehört zum Programm, nicht zur Installation. Er
 * kommt mit jedem Update mit, steht im offenen Repo für jeden lesbar da, und
 * niemand muss ihn zweimal pflegen — einmal fuer GitHub und einmal hier.
 *
 * Gelesen wird bei jeder Anfrage neu (die Datei ist klein und aendert sich nur
 * beim Update); zerlegt wird sie hier und nicht im Browser, damit die
 * Oberflaeche kein Markdown koennen muss und „was ist seit Fassung X dazu-
 * gekommen" eine Zeile Vergleich bleibt.
 */

const DATEI = path.join(ROOT_DIR, "CHANGELOG.md");

/** Unter diesem Schluessel steht, bis wohin der Nutzer gelesen hat. */
const GESEHEN = "changelog_gesehen";

export interface Gruppe {
  /** „Neu", „Geändert", „Behoben" — was in der Datei als `###` steht. */
  art: string;
  punkte: string[];
}

export interface Fassung {
  /** „0.2.0" oder „Unveröffentlicht". */
  version: string;
  /** TT.MM.JJJJ, falls angegeben. */
  datum: string | null;
  gruppen: Gruppe[];
  /** Setzt der Router: seit dem letzten Besuch dazugekommen? */
  neu?: boolean;
}

/**
 * Zerlegt die Datei.
 *
 * Bewusst ein kleiner Zeilenleser und kein Markdown-Werkzeug: Der Aufbau ist
 * festgelegt (`##` Fassung, `###` Art, `-` Punkt), und ein vollstaendiger
 * Markdown-Zerleger koennte hier nur mehr Formen durchlassen, als die Anzeige
 * darstellen kann. Was nicht in dieses Raster passt, wird ueberlesen — eine
 * kaputte Zeile darf nicht die ganze Liste verschlucken.
 *
 * Fettdruck bleibt als `**…**` stehen; die Anzeige macht daraus die
 * Hervorhebung. Mehr Auszeichnung gibt es hier nicht.
 */
export function zerlege(text: string): Fassung[] {
  const fassungen: Fassung[] = [];
  let fassung: Fassung | null = null;
  let gruppe: Gruppe | null = null;

  for (const roh of text.split(/\r?\n/)) {
    const zeile = roh.trimEnd();

    const kopf = /^##\s+(.+?)\s*$/.exec(zeile);
    if (kopf && !zeile.startsWith("###")) {
      // „0.2.0 — 17.08.2026" oder nur „Unveröffentlicht"
      const teile = /^(.+?)\s+[—–-]\s+(\d{2}\.\d{2}\.\d{4})\s*$/.exec(kopf[1]);
      fassung = {
        version: (teile ? teile[1] : kopf[1]).trim(),
        datum: teile ? teile[2] : null,
        gruppen: [],
      };
      fassungen.push(fassung);
      gruppe = null;
      continue;
    }

    const art = /^###\s+(.+?)\s*$/.exec(zeile);
    if (art && fassung) {
      gruppe = { art: art[1].trim(), punkte: [] };
      fassung.gruppen.push(gruppe);
      continue;
    }

    const punkt = /^[-*]\s+(.+)$/.exec(zeile);
    if (punkt && gruppe) {
      gruppe.punkte.push(punkt[1].trim());
      continue;
    }

    // Eine eingerueckte Folgezeile gehoert zum Punkt darueber. Ohne das
    // zerfiele jeder umbrochene Satz in zwei halbe Punkte.
    if (gruppe && gruppe.punkte.length > 0 && /^\s+\S/.test(roh)) {
      gruppe.punkte[gruppe.punkte.length - 1] += ` ${zeile.trim()}`;
    }
  }

  // Fassungen ohne Inhalt sind Ueberschriften ohne Text — die haben in einer
  // Liste nichts verloren.
  return fassungen.filter((f) => f.gruppen.some((g) => g.punkte.length > 0));
}

function lies(): Fassung[] {
  try {
    return zerlege(fs.readFileSync(DATEI, "utf8"));
  } catch {
    // Keine Datei, kein Drama — dann gibt es eben nichts zu erzaehlen.
    return [];
  }
}

const router = machRouter();

/**
 * Die ganze Liste, jede Fassung mit der Angabe, ob sie seit dem letzten
 * Besuch dazugekommen ist.
 *
 * „Seit dem letzten Besuch" heisst: alles, was VOR der zuletzt gelesenen
 * Fassung steht — die Liste ist chronologisch, neueste zuerst. Ein Vergleich
 * von Versionsnummern waere hier falsche Genauigkeit: „Unveröffentlicht" hat
 * keine Nummer, und die Reihenfolge in der Datei ist die Wahrheit.
 */
router.get("/", async (_req, res) => {
  const fassungen = lies();
  const gesehen = await gesehenStand(fassungen);
  const grenze = fassungen.findIndex((f) => f.version === gesehen);
  res.json({
    fassungen: fassungen.map((f, i) => ({
      ...f,
      neu: grenze < 0 ? false : i < grenze,
    })),
    gesehen,
  });
});

/**
 * Wie viele Fassungen neu sind — fuer den Punkt in der Seitenleiste.
 *
 * Eigener, winziger Endpunkt: Die Seitenleiste fragt das bei jedem Start, und
 * dafuer die ganze Liste zu uebertragen waere Verschwendung.
 */
router.get("/status", async (_req, res) => {
  const fassungen = lies();
  const gesehen = await gesehenStand(fassungen);
  const grenze = fassungen.findIndex((f) => f.version === gesehen);
  res.json({
    neu: grenze < 0 ? 0 : grenze,
    neuesteFassung: fassungen[0]?.version ?? null,
  });
});

/** Alles als gelesen markieren. */
router.post("/gesehen", async (_req, res) => {
  const fassungen = lies();
  if (fassungen.length > 0) await setSetting(GESEHEN, fassungen[0].version);
  res.json({ ok: true, gesehen: fassungen[0]?.version ?? null });
});

/**
 * Bis wohin wurde gelesen?
 *
 * Steht noch nichts da, gilt die neueste Fassung als gelesen — und zwar
 * dauerhaft, sie wird gleich gespeichert. Sonst leuchtete bei einer frischen
 * Installation ein „Neu!"-Punkt fuer Aenderungen, die es fuer diesen Nutzer
 * nie gab: Er hat nichts verpasst, er faengt gerade erst an. Gemeldet wird
 * damit erst, was NACH diesem Moment dazukommt.
 */
async function gesehenStand(fassungen: Fassung[]): Promise<string | null> {
  const gespeichert = await getSetting(GESEHEN);
  if (gespeichert) return gespeichert;
  const neueste = fassungen[0]?.version ?? null;
  if (neueste) await setSetting(GESEHEN, neueste);
  return neueste;
}

export const changelogModule: ServerModule = {
  id: "changelog",
  title: "Was ist neu",
  router,
};
