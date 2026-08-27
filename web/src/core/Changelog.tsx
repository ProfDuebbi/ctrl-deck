import { useEffect, useState } from "react";
import { api } from "./api";
import { Icon } from "./Icon";

/**
 * WAS IST NEU — die Änderungsliste des Programms.
 *
 * Die Einträge kommen aus `CHANGELOG.md` im Projektordner; der Server zerlegt
 * sie und sagt dazu, was seit dem letzten Besuch dazugekommen ist. Hier steht
 * deshalb kein Markdown-Setzer, nur Anzeige.
 */

interface Gruppe { art: string; punkte: string[] }
interface Fassung { version: string; datum: string | null; gruppen: Gruppe[]; neu?: boolean }

export function useChangelogNeu(): number {
  const [neu, setNeu] = useState(0);
  useEffect(() => {
    api<{ neu: number }>("/changelog/status")
      .then((a) => setNeu(a.neu))
      .catch(() => setNeu(0));
  }, []);
  return neu;
}

/**
 * Zwei Auszeichnungen aus der Datei übernehmen: **fett** und `code`.
 *
 * Bewusst von Hand statt mit dem Markdown-Setzer aus den Notizen: Der kann
 * Überschriften, Listen, Tabellen, Zitate und Links, und nichts davon hat in
 * einer Änderungszeile etwas verloren. Ein Werkzeug, das mehr durchlässt, als
 * die Anzeige darstellen kann, lädt nur dazu ein, die Datei zu überfrachten.
 *
 * Fett hebt hervor, worum es geht; `code` steht für Dateinamen, Ordner und
 * Einstellungen — in der Änderungsliste eines Programms kommt beides
 * zwangsläufig vor, und roh hingeschriebene Backticks sähen aus wie ein
 * Fehler.
 */
function MitAuszeichnung({ text }: { text: string }) {
  const teile = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {teile.map((t, i) => {
        if (t.startsWith("**") && t.endsWith("**") && t.length > 4)
          return <strong key={i}>{t.slice(2, -2)}</strong>;
        if (t.startsWith("`") && t.endsWith("`") && t.length > 2)
          return <code key={i}>{t.slice(1, -1)}</code>;
        return <span key={i}>{t}</span>;
      })}
    </>
  );
}

/** Kennfarbe je Art — Farbe bedeutet hier etwas (theme.css, Regel 3). */
function artKlasse(art: string): string {
  const a = art.toLowerCase();
  if (a.startsWith("neu")) return "neu";
  if (a.startsWith("behoben") || a.startsWith("beh")) return "behoben";
  return "geaendert";
}

export function Changelog({ onGelesen }: { onGelesen?: () => void }) {
  const [fassungen, setFassungen] = useState<Fassung[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let verworfen = false;
    api<{ fassungen: Fassung[] }>("/changelog")
      .then(async (a) => {
        if (verworfen) return;
        setFassungen(a.fassungen);
        // Gelesen ist gelesen: Wer hier steht, hat es gesehen. Der Punkt in
        // der Seitenleiste verschwindet beim nächsten Start — nicht sofort
        // unter den Augen des Lesers, das wirkte wie ein Fehler.
        if (a.fassungen.some((f) => f.neu)) {
          await api("/changelog/gesehen", { method: "POST" }).catch(() => {});
          onGelesen?.();
        }
      })
      .catch(() => { if (!verworfen) setFehler("Die Änderungsliste ließ sich nicht laden."); });
    return () => { verworfen = true; };
    // Absichtlich nur beim Öffnen: `onGelesen` neu zu binden dürfte nicht
    // dazu führen, dass erneut „gesehen" gemeldet wird.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (fehler) return <p className="empty"><Icon name="warnung" /> {fehler}</p>;
  if (!fassungen) return <p className="empty">lädt…</p>;
  if (fassungen.length === 0) {
    return <p className="empty">Es gibt noch keine Einträge — `CHANGELOG.md` fehlt oder ist leer.</p>;
  }

  return (
    <div className="cl-liste">
      {fassungen.map((f) => (
        <section className={`panel cl-fassung ${f.neu ? "ist-neu" : ""}`} key={f.version}>
          <div className="cl-kopf">
            <h2 className="cl-version">{f.version}</h2>
            {f.datum && <span className="cl-datum">{f.datum}</span>}
            {f.neu && <span className="cl-marke">neu für dich</span>}
          </div>
          {f.gruppen.map((g) => (
            <div className="cl-gruppe" key={g.art}>
              <h3 className={`cl-art ${artKlasse(g.art)}`}>{g.art}</h3>
              <ul className="cl-punkte">
                {g.punkte.map((p, i) => (
                  <li key={i}><MitAuszeichnung text={p} /></li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
