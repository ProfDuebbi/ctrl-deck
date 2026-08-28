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

/**
 * Und hier, WIE VIELE Fassungen es damals gab.
 *
 * Der Name allein taugt nicht als Zeiger: Eine Fassung heisst erst
 * „Unveröffentlicht" und traegt beim Release ploetzlich eine Nummer. Wer sie
 * vorher gelesen hat, dessen gespeicherter Name steht dann nicht mehr in der
 * Datei — der Zeiger geht ins Leere, und ausgerechnet die erste Meldung nach
 * dem Release faellt stillschweigend aus. Die Anzahl uebersteht das
 * Umbenennen, weil die Liste nur oben waechst.
 */
const GESEHEN_ANZAHL = "changelog_gesehen_anzahl";

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
  const stand = await gesehenStand(fassungen);
  const grenze = grenzeFinden(fassungen, stand);
  res.json({
    fassungen: fassungen.map((f, i) => ({ ...f, neu: i < grenze })),
    gesehen: stand.version,
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
  res.json({
    neu: grenzeFinden(fassungen, await gesehenStand(fassungen)),
    neuesteFassung: fassungen[0]?.version ?? null,
  });
});

/** Alles als gelesen markieren. */
router.post("/gesehen", async (_req, res) => {
  const stand = await merke(lies());
  res.json({ ok: true, gesehen: stand.version });
});

/** Bis wohin wurde gelesen — der Name und, verlaesslicher, die Anzahl. */
export interface Stand {
  /** Wie die zuletzt gelesene Fassung hiess. Der genaue, aber zerbrechliche Weg. */
  version: string | null;
  /** Wie viele Fassungen es damals gab. Der grobe, aber haltbare Weg. */
  anzahl: number | null;
}

/**
 * Wie viele Fassungen sind seit dem letzten Besuch dazugekommen?
 *
 * Zuerst wird der Name gesucht: Steht er noch in der Datei, ist sein Platz die
 * genaue Antwort. Findet er sich nicht mehr — umbenannt, umformuliert,
 * entfernt —, zaehlt die Anzahl. Ist auch die unbekannt, wird nichts gemeldet:
 * lieber eine Meldung verpassen als jemanden mit einer Liste begruessen, die
 * er laengst gelesen hat.
 */
export function grenzeFinden(fassungen: Fassung[], stand: Stand): number {
  const platz = fassungen.findIndex((f) => f.version === stand.version);
  if (platz >= 0) return platz;
  if (stand.anzahl !== null) return Math.max(0, fassungen.length - stand.anzahl);
  return 0;
}

/**
 * Den gespeicherten Stand holen — und dabei aufraeumen.
 *
 * Steht noch gar nichts da, gilt die neueste Fassung als gelesen, und zwar
 * dauerhaft: Sonst leuchtete bei einer frischen Installation ein „Neu!"-Punkt
 * fuer Aenderungen, die es fuer diesen Nutzer nie gab. Er hat nichts verpasst,
 * er faengt gerade erst an.
 *
 * Steht ein Name ohne Anzahl da, stammt er aus der Zeit davor. Die Anzahl wird
 * dann einmalig nachgetragen — aus dem Platz des Namens, solange er noch
 * auffindbar ist, sonst als „alles gelesen". Wer schon einmal hier war, soll
 * nicht ploetzlich die ganze Geschichte als neu vorgesetzt bekommen.
 */
async function gesehenStand(fassungen: Fassung[]): Promise<Stand> {
  const version = await getSetting(GESEHEN);
  if (version === null) return merke(fassungen);

  const roh = await getSetting(GESEHEN_ANZAHL);
  if (roh !== null && /^\d+$/.test(roh)) return { version, anzahl: Number(roh) };

  const platz = fassungen.findIndex((f) => f.version === version);
  const anzahl = platz >= 0 ? fassungen.length - platz : fassungen.length;
  await setSetting(GESEHEN_ANZAHL, String(anzahl));
  return { version, anzahl };
}

/** Alles als gelesen festhalten. Name und Anzahl gehoeren dabei zusammen. */
async function merke(fassungen: Fassung[]): Promise<Stand> {
  const stand: Stand = {
    version: fassungen[0]?.version ?? null,
    anzahl: fassungen.length,
  };
  if (stand.version !== null) {
    await setSetting(GESEHEN, stand.version);
    await setSetting(GESEHEN_ANZAHL, String(stand.anzahl));
  }
  return stand;
}

export const changelogModule: ServerModule = {
  id: "changelog",
  title: "Was ist neu",
  router,
};
