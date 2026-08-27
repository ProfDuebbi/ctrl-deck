import { machRouter } from "../route.js";
import { db } from "../db.js";
import {
  fruehestes, tageZaehlen,
  type ProfilBeitrag, type ProfilZahl, type ServerModule, type Termin, type Treffer,
} from "./index.js";

/**
 * NOTIZEN — der einzige Ort in diesem Dashboard mit freiem Text.
 *
 * Geschrieben wird in Markdown, gespeichert wird der Quelltext. Das ist
 * Absicht: Was hier liegt, soll auch dann noch lesbar sein, wenn es dieses
 * Programm nicht mehr gibt — eine Notiz in einem eigenen Binaerformat waere
 * genau die Falle, aus der man Notizen sonst befreien muss.
 *
 * EINE NOTIZ KANN VERSCHLUESSELT SEIN. Dann sind `titel` und `inhalt`
 * Chiffrate aus dem Browser (derselbe Schluessel wie im Tresor), und dieses
 * Modul weiss von ihnen nicht mehr, als dass es sie gibt. Im Klartext bleibt
 * — wie beim Tresor das Ablaufdatum — nur, was eine Ansicht auch ohne
 * offenen Tresor braucht: Schlagworte, Wiedervorlage, Zeitstempel.
 * Verschluesselte Notizen erscheinen deshalb NICHT in der globalen Suche.
 */

// --- Schema ---------------------------------------------------------------

/** Nach dieser Frist raeumt der Papierkorb sich selbst. */
const PAPIERKORB_TAGE = 30;

async function einrichten(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notizen (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      titel          TEXT NOT NULL DEFAULT '',   -- Klartext, oder Chiffrat
      inhalt         TEXT NOT NULL DEFAULT '',   -- Klartext, oder Chiffrat
      schlagworte    TEXT NOT NULL DEFAULT '',   -- immer Klartext, ", "-getrennt
      angeheftet     INTEGER NOT NULL DEFAULT 0,
      verschluesselt INTEGER NOT NULL DEFAULT 0,
      wiedervorlage  TEXT,                       -- 'JJJJ-MM-TT', Klartext
      geloescht_at   TEXT,                       -- gesetzt = im Papierkorb
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notizen_papierkorb ON notizen (geloescht_at);
  `);

  /*
   * Der Papierkorb raeumt beim Start auf, nicht per Uhr im Hintergrund.
   * Ein lokales Dashboard laeuft nicht monatelang durch, und ein Zeitgeber,
   * der im Stillen Daten loescht, muesste man beim Lesen erst finden.
   */
  const grenze = new Date(Date.now() - PAPIERKORB_TAGE * 86400000).toISOString();
  await db.schreibe(
    "DELETE FROM notizen WHERE geloescht_at IS NOT NULL AND geloescht_at < ?",
    grenze
  );
}

const now = () => new Date().toISOString();

// --- Helfer ---------------------------------------------------------------

/** Titel fuer Listen, wenn keiner vergeben wurde. */
const OHNE_TITEL = "Ohne Titel";

/**
 * Erste Zeilen als Fliesstext — fuer die Liste, ohne den ganzen Inhalt zu
 * uebertragen.
 *
 * Bewusst grob: Markdown-Zeichen fallen weg, damit in der Liste nicht
 * "## Einkauf" steht. Es geht ums Wiedererkennen, nicht um Wiedergabe.
 */
function auszug(md: string): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")                // Codebloecke ganz raus
    .replace(/^\s{0,3}[#>]+\s*/gm, "")              // Ueberschrift, Zitat
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, "")   // Listenpunkt, Kaestchen
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")      // Link/Bild -> Beschriftung
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

/**
 * Schlagworte aufraeumen: trimmen, Leere weg, Doppelte weg (ohne Ruecksicht
 * auf Gross- und Kleinschreibung), gedeckelt. Kommt als Zeichenkette oder
 * als Liste.
 */
function schlagworte(roh: unknown): string {
  const teile = Array.isArray(roh) ? roh.map(String) : String(roh ?? "").split(",");
  const gesehen = new Set<string>();
  const out: string[] = [];
  for (const t of teile) {
    const wort = t.trim().replace(/\s+/g, " ").slice(0, 32);
    if (!wort) continue;
    const k = wort.toLowerCase();
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    out.push(wort);
    if (out.length >= 12) break;
  }
  return out.join(", ");
}

const istDatum = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Obergrenzen. Der Body-Parser laesst 1 MB durch, und ein Chiffrat ist als
 * Base64 rund ein Drittel groesser als sein Klartext.
 */
const MAX_INHALT = 200_000;
const MAX_TITEL = 200;

type Zeile = {
  id: number;
  titel: string;
  inhalt: string;
  schlagworte: string;
  angeheftet: number;
  verschluesselt: number;
  wiedervorlage: string | null;
  geloescht_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Nimmt entgegen, was der Browser schickt, und gibt zurueck, was wirklich
 * geschrieben werden darf — oder eine Meldung.
 *
 * `nurGesetzte` ist der Unterschied zwischen Anlegen und Aendern: Beim
 * Aendern schickt die Ansicht oft nur ein einziges Feld (Anheften), und ein
 * fehlendes Feld darf dann nicht als "leer" durchgehen.
 */
function felderAus(b: Record<string, unknown>, nurGesetzte: boolean):
  { felder: Record<string, string | number | null> } | { fehler: string } {
  const f: Record<string, string | number | null> = {};

  if (!nurGesetzte || b.titel !== undefined) {
    const titel = String(b.titel ?? "");
    // Ein Chiffrat ist laenger als sein Klartext — die Grenze gilt nur dort,
    // wo der Server ueberhaupt Klartext sieht.
    if (!b.verschluesselt && titel.length > MAX_TITEL)
      return { fehler: `Der Titel ist zu lang (höchstens ${MAX_TITEL} Zeichen).` };
    f.titel = titel;
  }
  if (!nurGesetzte || b.inhalt !== undefined) {
    const inhalt = String(b.inhalt ?? "");
    if (inhalt.length > MAX_INHALT) return { fehler: "Die Notiz ist zu lang." };
    f.inhalt = inhalt;
  }
  if (!nurGesetzte || b.schlagworte !== undefined) f.schlagworte = schlagworte(b.schlagworte);
  if (!nurGesetzte || b.angeheftet !== undefined) f.angeheftet = b.angeheftet ? 1 : 0;
  if (!nurGesetzte || b.verschluesselt !== undefined) f.verschluesselt = b.verschluesselt ? 1 : 0;
  if (!nurGesetzte || b.wiedervorlage !== undefined) {
    const w = b.wiedervorlage == null ? "" : String(b.wiedervorlage);
    if (w && !istDatum(w)) return { fehler: "Die Wiedervorlage ist kein gültiges Datum." };
    f.wiedervorlage = w || null;
  }
  return { felder: f };
}

/** Listenform: alles ausser dem vollen Inhalt. */
function fuerListe(r: Zeile) {
  return {
    id: r.id,
    titel: r.titel,
    // Ein gekuerztes Chiffrat waere Zeichensalat. Fuer verschluesselte
    // Notizen holt sich die Ansicht den Auszug selbst, sobald sie den
    // Schluessel hat.
    auszug: r.verschluesselt ? "" : auszug(r.inhalt),
    schlagworte: r.schlagworte,
    angeheftet: r.angeheftet,
    verschluesselt: r.verschluesselt,
    wiedervorlage: r.wiedervorlage,
    geloescht_at: r.geloescht_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// --- Router ---------------------------------------------------------------

const router = machRouter();

/**
 * Die Liste. `?papierkorb=1` zeigt das Geloeschte statt des Bestands.
 *
 * Gefiltert und gesucht wird in der Ansicht, nicht hier: Verschluesselte
 * Notizen koennte der Server ohnehin nicht durchsuchen, und ein Suchfeld,
 * das einen Teil des Bestands stillschweigend uebergeht, waere schlimmer als
 * keines. Die Liste ist klein — es sind Notizen, keine Messreihen.
 */
router.get("/", async (req, res) => {
  const imPapierkorb = req.query.papierkorb === "1";
  const rows = await db.alle<Zeile>(
    `SELECT * FROM notizen
      WHERE geloescht_at IS ${imPapierkorb ? "NOT" : ""} NULL
      ORDER BY ${imPapierkorb ? "geloescht_at DESC" : "angeheftet DESC, updated_at DESC"}`
  );
  res.json(rows.map(fuerListe));
});

/** Papierkorb leeren. Steht VOR "/:id", sonst faengt die Zahl-Route das ab. */
router.delete("/papierkorb", async (_req, res) => {
  const info = await db.schreibe("DELETE FROM notizen WHERE geloescht_at IS NOT NULL");
  res.json({ ok: true, geloescht: info.zeilen });
});

/** Eine Notiz mit allem, was drinsteht. */
router.get("/:id", async (req, res) => {
  const r = await db.eine<Zeile>("SELECT * FROM notizen WHERE id=?", req.params.id);
  if (!r) return res.status(404).json({ error: "Notiz nicht gefunden" });
  res.json(r);
});

router.post("/", async (req, res) => {
  const geprueft = felderAus(req.body ?? {}, false);
  if ("fehler" in geprueft) return res.status(400).json({ error: geprueft.fehler });
  const f = geprueft.felder;
  const t = now();
  const info = await db.schreibe(
    `INSERT INTO notizen
       (titel, inhalt, schlagworte, angeheftet, verschluesselt, wiedervorlage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    f.titel, f.inhalt, f.schlagworte, f.angeheftet, f.verschluesselt, f.wiedervorlage, t, t
  );
  res.json({ id: info.id, created_at: t, updated_at: t });
});

router.put("/:id", async (req, res) => {
  const geprueft = felderAus(req.body ?? {}, true);
  if ("fehler" in geprueft) return res.status(400).json({ error: geprueft.fehler });
  const f = geprueft.felder;
  const namen = Object.keys(f);
  if (namen.length === 0) return res.status(400).json({ error: "Nichts zu ändern" });

  const t = now();
  const satz = [...namen.map((k) => `${k}=?`), "updated_at=?"].join(", ");
  const werte = [...namen.map((k) => f[k]), t, req.params.id];
  const info = await db.schreibe(`UPDATE notizen SET ${satz} WHERE id=?`, ...werte);
  if (info.zeilen === 0) return res.status(404).json({ error: "Notiz nicht gefunden" });
  res.json({ ok: true, updated_at: t });
});

/**
 * Loeschen heisst: in den Papierkorb. `?endgueltig=1` loescht wirklich.
 *
 * Der Umweg ist bei Notizen kein Luxus. Einen Zaehlerstand tippt man aus dem
 * Kopf neu ein, einen Text nicht.
 */
router.delete("/:id", async (req, res) => {
  const endgueltig = req.query.endgueltig === "1";
  const info = endgueltig
    ? await db.schreibe("DELETE FROM notizen WHERE id=?", req.params.id)
    : await db.schreibe(
        "UPDATE notizen SET geloescht_at=? WHERE id=? AND geloescht_at IS NULL",
        now(), req.params.id
      );
  if (info.zeilen === 0) return res.status(404).json({ error: "Notiz nicht gefunden" });
  res.json({ ok: true });
});

router.post("/:id/zurueck", async (req, res) => {
  const info = await db.schreibe(
    "UPDATE notizen SET geloescht_at=NULL, updated_at=? WHERE id=? AND geloescht_at IS NOT NULL",
    now(), req.params.id
  );
  if (info.zeilen === 0) return res.status(404).json({ error: "Notiz nicht im Papierkorb" });
  res.json({ ok: true });
});

// --- Meldungen an die gemeinsamen Sammler ---------------------------------

/**
 * Terminfaden: Wiedervorlagen.
 *
 * Eine Wiedervorlage ist keine Frist und kein Ablauf — es verfaellt nichts,
 * wenn sie verstreicht. Deshalb `aufgabe` und kein `dringend`.
 */
async function termine(von: string, bis: string): Promise<Termin[]> {
  const rows = await db.alle<Zeile>(
    `SELECT * FROM notizen
      WHERE wiedervorlage IS NOT NULL AND geloescht_at IS NULL
        AND wiedervorlage BETWEEN ? AND ?`,
    von, bis
  );
  return rows.map((r) => ({
    id: `notizen:wiedervorlage:${r.id}`,
    datum: r.wiedervorlage!,
    // Der Titel einer verschluesselten Notiz ist Chiffrat und bleibt es.
    titel: r.verschluesselt ? "Verschlüsselte Notiz" : r.titel || OHNE_TITEL,
    notiz: "Wiedervorlage",
    art: "aufgabe" as const,
    modul: "notizen",
  }));
}

/** Der Fundort im Text, mit etwas Umgebung. */
function stelle(inhalt: string, begriff: string): string {
  const flach = auszug(inhalt);
  const i = flach.toLowerCase().indexOf(begriff.toLowerCase());
  if (i < 0) return flach.slice(0, 80);
  const von = Math.max(0, i - 30);
  return `${von > 0 ? "…" : ""}${flach.slice(von, von + 90).trim()}…`;
}

/**
 * Globale Suche: Titel, Volltext, Schlagworte.
 *
 * Verschluesselte Notizen bleiben draussen — nicht aus Bequemlichkeit,
 * sondern weil der Server ihren Text nicht kennt und nie kennen soll.
 */
async function suche(begriff: string, grenze: number): Promise<Treffer[]> {
  const rows = await db.alle<Zeile>(
    `SELECT * FROM notizen
      WHERE verschluesselt = 0 AND geloescht_at IS NULL
        AND (titel LIKE ? OR inhalt LIKE ? OR schlagworte LIKE ?)
      ORDER BY angeheftet DESC, updated_at DESC LIMIT ?`,
    `%${begriff}%`, `%${begriff}%`, `%${begriff}%`, grenze
  );
  return rows.map((r) => ({
    id: `notizen:notiz:${r.id}`,
    titel: r.titel || OHNE_TITEL,
    // Wer nach einem Wort im Text sucht, will die Stelle sehen, nicht den
    // Anfang der Notiz.
    untertitel: stelle(r.inhalt, begriff) || r.schlagworte || null,
    modul: "notizen",
    art: "Notiz",
    datum: r.updated_at.slice(0, 10),
  }));
}

/**
 * Profil: wie viel geschrieben wurde und wann.
 *
 * Titel kommen NICHT mit, auch die unverschluesselten nicht. Das Profil ist
 * eine Jahresuebersicht und kein Blick in die Schublade; "so oft hast du
 * geschrieben" sagt dort genug.
 */
async function profil(von: string, bis: string): Promise<ProfilBeitrag> {
  const z = await db.eine<{ n: number; verschluesselt: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(verschluesselt), 0) AS verschluesselt
       FROM notizen WHERE geloescht_at IS NULL`
  );
  if (!z || z.n === 0) return {};

  const zahlen: ProfilZahl[] = [
    {
      id: "notizen:anzahl",
      wert: String(z.n),
      label: z.n === 1 ? "Notiz" : "Notizen",
      hinweis: z.verschluesselt > 0 ? `davon ${z.verschluesselt} verschlüsselt` : null,
    },
  ];

  return {
    zahlen,
    // Fuers Raster zaehlt der Tag, an dem etwas entstanden ist.
    tage: await tageZaehlen(
      "notizen", "date(created_at, 'localtime')", von, bis, "geloescht_at IS NULL"
    ),
    seit: await fruehestes("notizen", "date(created_at, 'localtime')"),
  };
}

export const notizenModule: ServerModule = {
  id: "notizen",
  title: "Notizen",
  router,
  einrichten,
  termine,
  suche,
  profil,
};
