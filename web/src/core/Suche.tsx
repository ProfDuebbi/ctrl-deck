import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Icon, type IconName } from "./Icon";
import type { DashboardModule } from "./modules";

/**
 * Globale Suche (Strg+K).
 *
 * Ein Feld über allem: tippen, mit den Pfeiltasten wählen, Enter öffnet das
 * Modul. Bewusst kein eigenes Modul mit Kachel — eine Suche, die man erst
 * anklicken muss, benutzt niemand.
 *
 * Die Ergebnisse liefert das Backend aus allen Modulen, die `suche()`
 * anbieten. **Der Tresor ist nicht dabei** — dort liegt alles verschlüsselt,
 * und das soll so bleiben. Der Hinweis am Fuß sagt das offen, damit niemand
 * denkt, seine Ausweisnummer sei einfach nicht gefunden worden.
 */

interface Treffer {
  id: string;
  titel: string;
  untertitel?: string | null;
  modul: string;
  art: string;
  datum?: string | null;
}

interface Antwort {
  begriff: string;
  treffer: Treffer[];
  fehler: string[];
}

export function Suche({
  module,
  onOeffnen,
  onClose,
}: {
  module: DashboardModule[];
  onOeffnen: (modulId: string) => void;
  onClose: () => void;
}) {
  const [begriff, setBegriff] = useState("");
  const [antwort, setAntwort] = useState<Antwort | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [wahl, setWahl] = useState(0);
  const feld = useRef<HTMLInputElement>(null);

  useEffect(() => { feld.current?.focus(); }, []);

  // Erst suchen, wenn jemand kurz aufhört zu tippen.
  useEffect(() => {
    const q = begriff.trim();
    if (q.length < 2) { setAntwort(null); setLaeuft(false); return; }
    setLaeuft(true);
    const t = setTimeout(() => {
      api<Antwort>(`/suche?q=${encodeURIComponent(q)}`)
        .then((a) => { setAntwort(a); setWahl(0); })
        .catch(() => setAntwort(null))
        .finally(() => setLaeuft(false));
    }, 220);
    return () => clearTimeout(t);
  }, [begriff]);

  const treffer = antwort?.treffer ?? [];
  const symbole = useMemo(() => {
    const m = new Map<string, { icon: IconName; titel: string }>();
    for (const mod of module) m.set(mod.id, { icon: mod.icon, titel: mod.title });
    return m;
  }, [module]);

  function waehlen(t: Treffer) {
    onOeffnen(t.modul);
    onClose();
  }

  function taste(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (treffer.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setWahl((w) => (w + 1) % treffer.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setWahl((w) => (w - 1 + treffer.length) % treffer.length); }
    else if (e.key === "Enter") { e.preventDefault(); waehlen(treffer[wahl]); }
  }

  return (
    <div className="suche-hintergrund" onMouseDown={onClose} role="presentation">
      <div
        className="suche-fenster"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Globale Suche"
      >
        <div className="suche-feld">
          <Icon name="suchen" />
          <input
            ref={feld}
            value={begriff}
            onChange={(e) => setBegriff(e.target.value)}
            onKeyDown={taste}
            placeholder="Suchen — Aufgaben, Buchungen, Namen, Notizen…"
            aria-label="Suchbegriff"
            spellCheck={false}
          />
          <kbd className="suche-esc">Esc</kbd>
        </div>

        <div className="suche-ergebnis">
          {begriff.trim().length < 2 && (
            <p className="suche-hinweis">Mindestens zwei Zeichen.</p>
          )}
          {begriff.trim().length >= 2 && laeuft && <p className="suche-hinweis">sucht…</p>}
          {!laeuft && antwort && treffer.length === 0 && (
            <p className="suche-hinweis">Nichts gefunden für „{antwort.begriff}".</p>
          )}
          {antwort && antwort.fehler.length > 0 && (
            <p className="suche-hinweis warn">
              <Icon name="warnung" /> {antwort.fehler.join(", ")} konnte nicht durchsucht werden.
            </p>
          )}

          <ul className="suche-liste">
            {treffer.map((t, i) => {
              const mod = symbole.get(t.modul);
              return (
                <li key={t.id}>
                  <button
                    className={`suche-zeile ${i === wahl ? "gewaehlt" : ""}`}
                    onClick={() => waehlen(t)}
                    onMouseEnter={() => setWahl(i)}
                  >
                    <span className="suche-ico" aria-hidden="true">
                      <Icon name={mod?.icon ?? "suchen"} />
                    </span>
                    <span className="suche-text">
                      <span className="suche-titel">{t.titel}</span>
                      {t.untertitel && <span className="suche-unter">{t.untertitel}</span>}
                    </span>
                    <span className="suche-art">
                      {t.art}
                      {t.datum && <span className="suche-datum">{t.datum.split("-").reverse().join(".")}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="suche-fuss">
          <span><kbd>↑</kbd><kbd>↓</kbd> wählen · <kbd>Enter</kbd> öffnen</span>
          <span className="suche-fuss-notiz">Der Tresor wird nicht durchsucht — dort liegt alles verschlüsselt.</span>
        </div>
      </div>
    </div>
  );
}
