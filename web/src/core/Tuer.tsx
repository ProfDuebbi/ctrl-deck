import { useEffect, useRef, useState } from "react";
import { api, meldeAbmeldungAn } from "./api";
import { Icon } from "./Icon";

/**
 * Die Tuer vor dem Dashboard.
 *
 * Sie entscheidet genau drei Zustaende: erster Start (noch kein Passwort),
 * abgemeldet, angemeldet. Alles Weitere — auch der ReminderWatcher — laeuft
 * erst hinter ihr, damit eine abgemeldete Oberflaeche den Server nicht mit
 * Anfragen bewirft, die er ohnehin abweist.
 */

interface Status {
  eingerichtet: boolean;
  angemeldet: boolean;
}

interface Ort {
  label: string;
  lat: number;
  lon: number;
  land: string;
  einwohner: number | null;
}

/** Fehlertext aus einer Antwort holen — der Server erklaert dort im Klartext. */
async function fehlerText(res: Response, ersatz: string): Promise<string> {
  try {
    const d = await res.json();
    return typeof d?.error === "string" ? d.error : ersatz;
  } catch {
    return ersatz;
  }
}

export function Tuer({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    api<Status>("/auth/status").then(setStatus).catch(() => setStatus(null));
    // Weist der Server irgendwann eine Anfrage ab, faellt die Tuer wieder zu.
    meldeAbmeldungAn(() => setStatus((s) => (s ? { ...s, angemeldet: false } : s)));
    return () => meldeAbmeldungAn(null);
  }, []);

  if (!status) return <div className="tuer-warten">CTRL·DECK startet…</div>;

  if (!status.eingerichtet)
    return <Ersteinrichtung onFertig={() => setStatus({ eingerichtet: true, angemeldet: true })} />;

  if (!status.angemeldet)
    return <Anmeldung onFertig={() => setStatus({ eingerichtet: true, angemeldet: true })} />;

  return <>{children}</>;
}

/** Rahmen fuer beide Bildschirme — eine Karte in der Mitte, sonst nichts. */
function Schleuse({ titel, unterzeile, children }: { titel: string; unterzeile: string; children: React.ReactNode }) {
  return (
    <div className="tuer">
      <div className="tuer-karte">
        <div className="tuer-kopf">
          <img src="/ctrl_logo.png" alt="" className="tuer-logo" />
          <div>
            <h1 className="tuer-titel">{titel}</h1>
            <p className="tuer-unter">{unterzeile}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Anmeldung({ onFertig }: { onFertig: () => void }) {
  const [passwort, setPasswort] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const feld = useRef<HTMLInputElement>(null);

  useEffect(() => { feld.current?.focus(); }, []);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    setLaeuft(true);
    try {
      const res = await fetch("/api/auth/anmelden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwort }),
      });
      if (!res.ok) {
        setFehler(await fehlerText(res, "Anmeldung nicht möglich."));
        setPasswort("");
        feld.current?.focus();
        return;
      }
      onFertig();
    } catch {
      setFehler("Der Server antwortet nicht.");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Schleuse titel="Willkommen zurück" unterzeile="Bitte gib dein Passwort ein — danach bleibst du 30 Tage angemeldet.">
      <form className="tuer-form" onSubmit={absenden}>
        <label className="tuer-feld">
          <span>Passwort</span>
          <input
            ref={feld}
            type="password"
            value={passwort}
            onChange={(e) => setPasswort(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {fehler && (
          <div className="tuer-fehler" role="alert">
            <Icon name="warnung" /> {fehler}
          </div>
        )}
        <button className="btn" type="submit" disabled={laeuft || passwort === ""}>
          {laeuft ? "prüft…" : "Anmelden"}
        </button>
        <p className="tuer-hinweis">
          Passwort vergessen? Im Projektordner <code>npm run passwort-neu</code> ausführen.
        </p>
      </form>
    </Schleuse>
  );
}

function Ersteinrichtung({ onFertig }: { onFertig: () => void }) {
  const [name, setName] = useState("");
  const [passwort, setPasswort] = useState("");
  const [nochmal, setNochmal] = useState("");
  const [suche, setSuche] = useState("");
  const [treffer, setTreffer] = useState<Ort[] | null>(null);
  const [ort, setOrt] = useState<Ort | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  // Ortssuche erst, wenn jemand kurz aufhoert zu tippen — sonst eine Anfrage
  // an Open-Meteo pro Buchstabe.
  useEffect(() => {
    const q = suche.trim();
    if (ort && q === ort.label) return; // Auswahl steht, nicht erneut suchen
    if (q.length < 2) { setTreffer(null); return; }
    const t = setTimeout(() => {
      api<Ort[]>(`/wetter/orte?q=${encodeURIComponent(q)}`)
        .then(setTreffer)
        .catch(() => setTreffer([]));
    }, 350);
    return () => clearTimeout(t);
  }, [suche, ort]);

  const passwortKurz = passwort !== "" && passwort.length < 8;
  const ungleich = nochmal !== "" && passwort !== nochmal;
  const bereit = name.trim() !== "" && passwort.length >= 8 && passwort === nochmal;

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    setLaeuft(true);
    try {
      const res = await fetch("/api/auth/einrichten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passwort,
          name: name.trim(),
          ort: ort ? { label: ort.label, lat: ort.lat, lon: ort.lon } : null,
        }),
      });
      if (!res.ok) {
        setFehler(await fehlerText(res, "Einrichtung fehlgeschlagen."));
        return;
      }
      onFertig();
    } catch {
      setFehler("Der Server antwortet nicht.");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Schleuse titel="Willkommen bei CTRL·DECK" unterzeile="Einmal einrichten, dann gehört es dir.">
      <form className="tuer-form" onSubmit={absenden}>
        <label className="tuer-feld">
          <span>Wie sollen wir dich nennen?</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" autoFocus />
        </label>

        <label className="tuer-feld">
          <span>Passwort <em>mindestens 8 Zeichen</em></span>
          <input
            type="password"
            value={passwort}
            onChange={(e) => setPasswort(e.target.value)}
            autoComplete="new-password"
          />
        </label>

        <label className="tuer-feld">
          <span>Passwort wiederholen</span>
          <input
            type="password"
            value={nochmal}
            onChange={(e) => setNochmal(e.target.value)}
            autoComplete="new-password"
          />
        </label>

        {passwortKurz && <div className="tuer-hinweis warn">Noch {8 - passwort.length} Zeichen.</div>}
        {ungleich && <div className="tuer-hinweis warn">Die beiden Passwörter sind nicht gleich.</div>}

        <label className="tuer-feld">
          <span>Dein Ort <em>fürs Wetter, freiwillig</em></span>
          <input
            value={suche}
            onChange={(e) => { setSuche(e.target.value); setOrt(null); }}
            placeholder="Ort oder Postleitzahl"
          />
        </label>

        {ort && (
          <div className="tuer-ort-gewaehlt">
            <Icon name="ort" /> {ort.label}
            <button type="button" className="btn ghost small" onClick={() => { setOrt(null); setSuche(""); }}>
              ändern
            </button>
          </div>
        )}

        {!ort && treffer !== null && (
          <div className="tuer-treffer">
            {treffer.length === 0 && <span className="tuer-hinweis">Nichts gefunden.</span>}
            {treffer.map((o) => (
              <button
                type="button"
                key={`${o.lat},${o.lon}`}
                className="tuer-treffer-zeile"
                onClick={() => { setOrt(o); setSuche(o.label); setTreffer(null); }}
              >
                <span>{o.label}</span>
                {o.einwohner ? <span className="tuer-treffer-neben">{o.einwohner.toLocaleString("de-DE")} Ew.</span> : null}
              </button>
            ))}
          </div>
        )}

        {fehler && (
          <div className="tuer-fehler" role="alert">
            <Icon name="warnung" /> {fehler}
          </div>
        )}

        <button className="btn" type="submit" disabled={laeuft || !bereit}>
          {laeuft ? "richtet ein…" : "Los geht's"}
        </button>

        {/* Hier stand einmal eine Erklaerung, dass dies nicht das
            Tresor-Passwort ist. Sie ist richtig, aber am ersten Bildschirm
            verwirrend: Wer CTRL·DECK gerade zum ersten Mal oeffnet, weiss noch
            gar nicht, dass es einen Tresor gibt. Der Unterschied gehoert
            dorthin, wo das zweite Passwort vergeben wird — in den Tresor. */}
      </form>
    </Schleuse>
  );
}
