import { api } from "./api";

/**
 * Die Daten hinter der Profilseite.
 *
 * Sie kommen aus EINER Antwort (`/api/profil`), die der gleichnamige Sammler
 * im Backend aus allen Modulen zusammenlegt. Vorher holte die Profilseite drei
 * Einzelauskuenfte und zeigte fuenf Zahlen; alles Interessante lag hinter zwei
 * bis vier Klicks in einem Modul.
 */

export interface ProfilZahl {
  id: string;
  wert: string;
  label: string;
  hinweis?: string | null;
  ton: "neutral" | "gut" | "achtung" | "schlecht";
  modul: string;
}

export interface ProfilGruppe {
  modul: string;
  titel: string;
  zahlen: ProfilZahl[];
}

export interface ProfilEreignis {
  id: string;
  datum: string;
  titel: string;
  detail?: string | null;
  art: string;
  modul: string;
}

export interface Statistik {
  von: string;
  bis: string;
  fenster: number;
  /** Frueheste Spur im ganzen Programm, oder null bei leerer Installation. */
  seit: string | null;
  fehler: string[];
  gruppen: ProfilGruppe[];
  tage: { datum: string; anzahl: number }[];
  gesamt: number;
  aktiveTage: number;
  serie: { aktuell: number; laengste: number };
  verlauf: ProfilEreignis[];
}

export const ladeStatistik = () => api<Statistik>("/profil");

// --- Datum ----------------------------------------------------------------

const p2 = (n: number) => String(n).padStart(2, "0");

/** Lokales YYYY-MM-DD. `toISOString()` waere UTC (siehe CLAUDE.md). */
export const isoLokal = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

export const alsDate = (iso: string) => {
  const [j, m, t] = iso.split("-").map(Number);
  return new Date(j, m - 1, t);
};

const MONATE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export const monatKurz = (i: number) => MONATE_KURZ[i];

/** „12. März 2024" — ausgeschrieben, weil es einmal auf der Seite steht. */
export function langesDatum(iso: string): string {
  const d = alsDate(iso);
  return `${d.getDate()}. ${MONATE[d.getMonth()]} ${d.getFullYear()}`;
}

/** „Dienstag, 12. März" — fuer die Tooltips im Raster. */
export function tagMitWochentag(iso: string): string {
  const d = alsDate(iso);
  return `${WOCHENTAGE[(d.getDay() + 6) % 7]}, ${d.getDate()}. ${MONATE[d.getMonth()]}`;
}

/**
 * Abstand in Tagen zu heute, als Wort.
 *
 * Im Verlauf steht neben jeder Zeile, wie lange sie her ist. „vor 3 Tagen"
 * beantwortet die Frage sofort; „2026-08-03" muss man erst ausrechnen.
 */
export function vorWieLange(iso: string, heute = new Date()): string {
  const tage = Math.round((+alsDate(isoLokal(heute)) - +alsDate(iso)) / 86_400_000);
  if (tage <= 0) return "heute";
  if (tage === 1) return "gestern";
  if (tage < 7) return `vor ${tage} Tagen`;
  if (tage < 14) return "letzte Woche";
  if (tage < 60) return `vor ${Math.round(tage / 7)} Wochen`;
  if (tage < 365) return `vor ${Math.round(tage / 30.4)} Monaten`;
  return langesDatum(iso);
}

/** Volle Jahre und Restmonate zwischen `iso` und heute, als Wort. */
export function dabeiSeit(iso: string, heute = new Date()): string {
  const tage = Math.round((+alsDate(isoLokal(heute)) - +alsDate(iso)) / 86_400_000);
  if (tage < 31) return `${Math.max(0, tage)} ${tage === 1 ? "Tag" : "Tage"}`;
  const monate = Math.floor(tage / 30.44);
  if (monate < 24) return `${monate} Monate`;
  const jahre = Math.floor(monate / 12);
  const rest = monate % 12;
  return rest ? `${jahre} J. ${rest} Mon.` : `${jahre} Jahre`;
}

// --- Aktivitaetsraster ----------------------------------------------------

export interface RasterTag {
  datum: string;
  anzahl: number;
  /** 0 = nichts, 1–4 = Stufen. Feste Schwellen, nicht relativ zum Maximum:
      sonst saehe derselbe Tag naechste Woche anders aus. */
  stufe: 0 | 1 | 2 | 3 | 4;
  /** Tage, die nur die Woche auffuellen — vor `von` oder nach heute. */
  leer: boolean;
}

const stufeVon = (n: number): RasterTag["stufe"] =>
  n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;

/**
 * Das Raster in Wochenspalten, jede Spalte Montag bis Sonntag.
 *
 * Der Anfang wird auf den Montag davor zurueckgezogen und das Ende auf den
 * Sonntag danach vorgeschoben — sonst haetten die erste und letzte Spalte
 * Loecher an wechselnden Stellen, und das Auge liest ein Loch als „nichts
 * getan" statt als „gibt es nicht".
 */
export function baueRaster(
  von: string,
  bis: string,
  tage: { datum: string; anzahl: number }[]
): { wochen: RasterTag[][]; monate: { spalte: number; monat: number }[] } {
  const zaehler = new Map(tage.map((t) => [t.datum, t.anzahl]));
  const start = alsDate(von);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const ende = alsDate(bis);
  ende.setDate(ende.getDate() + (6 - ((ende.getDay() + 6) % 7)));

  const wochen: RasterTag[][] = [];
  const monate: { spalte: number; monat: number }[] = [];
  let letzterMonat = -1;

  for (const d = new Date(start); d <= ende; d.setDate(d.getDate() + 1)) {
    const iso = isoLokal(d);
    const wochentag = (d.getDay() + 6) % 7;
    if (wochentag === 0) {
      wochen.push([]);
      // Die Monatsbeschriftung sitzt ueber der ersten Spalte, in der ein neuer
      // Monat beginnt — nicht ueber jeder, sonst steht dort ein Wortbrei.
      if (d.getMonth() !== letzterMonat) {
        letzterMonat = d.getMonth();
        monate.push({ spalte: wochen.length - 1, monat: letzterMonat });
      }
    }
    const anzahl = zaehler.get(iso) ?? 0;
    wochen[wochen.length - 1].push({
      datum: iso,
      anzahl,
      stufe: stufeVon(anzahl),
      leer: iso < von || iso > bis,
    });
  }

  // Die erste Beschriftung faellt weg, wenn ihre Spalte nur ein paar
  // Fuelltage enthaelt — sie stuende sonst halb ueber dem Rand.
  if (monate.length > 1 && monate[1].spalte <= 1) monate.shift();
  return { wochen, monate };
}
