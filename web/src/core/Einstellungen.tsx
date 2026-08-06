import { useEffect, useRef, useState } from "react";
import { api, fehlerText } from "./api";
import { BildEditor } from "./BildEditor";
import { kopfApi, kopfSetzen, useKopf, type Kopf } from "./kopf";
import { Icon } from "./Icon";

/**
 * Die Einstellungen — alles, was nicht „wer bin ich" ist.
 *
 * Lagen bis eben zusammen mit dem Profil auf einer Seite. Das war eine lange
 * Rolle, an deren Anfang zwei Felder standen und an deren Ende die
 * Sicherungen lagen; das Profil sah dadurch aus wie eine Formularsammlung
 * und nicht wie ein Profil. Jetzt: das Profil zeigt, wer man ist, und dieser
 * Knopf fuehrt zu allem, was man einstellen kann.
 *
 * Aufteilung nach dem, was jemand aendern WILL, nicht danach, wo es im Code
 * liegt: „die Startseite soll anders aussehen", „mein Passwort soll weg",
 * „das Dashboard soll anders aussehen", „meine Daten".
 */

export function Einstellungen({
  name,
  onModule,
  onBackups,
  angepasst,
  onReihenfolgeZuruecksetzen,
  versteckt,
}: {
  /** Fuer die Vorschau des Kopfbereichs — dort steht die echte Begruessung. */
  name: string;
  onModule: () => void;
  onBackups: () => void;
  angepasst: boolean;
  onReihenfolgeZuruecksetzen: () => void;
  versteckt: number;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const melde = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  return (
    <div className="profil">
      <StartseiteBlock melde={melde} name={name} />
      <KontoBlock melde={melde} />
      <DashboardBlock
        onModule={onModule}
        angepasst={angepasst}
        onReihenfolgeZuruecksetzen={onReihenfolgeZuruecksetzen}
        versteckt={versteckt}
        melde={melde}
      />
      <DatenBlock onBackups={onBackups} melde={melde} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/** Ein Treffer der Ortssuche (Wetter-Standort). */
interface Ort {
  label: string;
  lat: number;
  lon: number;
  einwohner: number | null;
}

/** Ein Abschnitt mit Titel und erklaerender Unterzeile. */
function Block({ titel, erklaerung, children }: { titel: string; erklaerung: string; children: React.ReactNode }) {
  return (
    <section className="profil-block">
      <div className="profil-block-kopf">
        <h2 className="profil-block-titel">{titel}</h2>
        <p className="profil-block-unter">{erklaerung}</p>
      </div>
      {children}
    </section>
  );
}

// --- Startseite -----------------------------------------------------------

/** Ein Schieberegler mit Beschriftung und abgelesenem Wert. */
function Regler({
  titel, wert, von, bis, einheit, onWert, hinweis,
}: {
  titel: string; wert: number; von: number; bis: number; einheit: string;
  onWert: (n: number) => void; hinweis?: string;
}) {
  return (
    <label className="kopf-regler">
      <span className="kopf-regler-kopf">
        {titel}
        <b>{wert}{einheit}</b>
      </span>
      <input type="range" min={von} max={bis} value={wert} onChange={(e) => onWert(Number(e.target.value))} />
      {hinweis && <em>{hinweis}</em>}
    </label>
  );
}

/** Umschalter aus zwei bis drei festen Möglichkeiten. */
function Wahl<T extends string>({
  titel, wert, moeglich, onWert,
}: {
  titel: string; wert: T; moeglich: { wert: T; label: string }[]; onWert: (w: T) => void;
}) {
  return (
    <div className="kopf-wahl">
      <span className="kopf-wahl-titel">{titel}</span>
      <div className="art-wahl">
        {moeglich.map((m) => (
          <button
            key={m.wert}
            type="button"
            className={`seg-btn ${wert === m.wert ? "aktiv" : ""}`}
            onClick={() => onWert(m.wert)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Schalter({
  titel, an, onAn, hinweis,
}: { titel: string; an: boolean; onAn: (b: boolean) => void; hinweis?: string }) {
  return (
    <label className="kopf-schalter">
      <input type="checkbox" checked={an} onChange={(e) => onAn(e.target.checked)} />
      <span>
        {titel}
        {hinweis && <em>{hinweis}</em>}
      </span>
    </label>
  );
}

/**
 * Verkleinerte, aber echte Nachbildung des Kopfbereichs.
 *
 * Sie benutzt dieselben Ebenen und dieselben Werte wie die Startseite, damit
 * die Regler nicht ins Blaue wirken — man sieht beim Schieben, was passiert,
 * ohne die Seite zu wechseln.
 *
 * Eine Sache MUSS umgerechnet werden: die Unschaerfe. `blur(6px)` ist ein
 * absolutes Mass. In einer halb so breiten Nachbildung sieht dieselbe Zahl
 * doppelt so stark aus. Deshalb wird sie mit dem Groessenverhaeltnis
 * skaliert — sonst luegt die Vorschau genau bei dem Regler, für den es sie
 * gibt.
 */
function KopfVorschau({ kopf, name }: { kopf: Kopf; name: string }) {
  const feld = useRef<HTMLDivElement>(null);
  const [breite, setBreite] = useState(0);

  useEffect(() => {
    const el = feld.current;
    if (!el) return;
    setBreite(el.clientWidth);
    const b = new ResizeObserver(([e]) => setBreite(e.contentRect.width));
    b.observe(el);
    return () => b.disconnect();
  }, []);

  // Der echte Kopfbereich ist so breit wie der Hauptbereich — grob 1300 px
  // bei einem ueblichen Fenster. Genauer geht nicht, ohne ihn zu messen,
  // und genauer muss es fuer eine Vorschau auch nicht sein.
  const verhaeltnis = breite ? breite / 1300 : 0.5;
  const unschaerfe = kopf.weichzeichnen * verhaeltnis;

  return (
    <div className="kv" ref={feld}>
      {kopf.bild && (
        <>
          <span
            className="kv-bild"
            aria-hidden="true"
            style={{
              backgroundImage: `url(${kopf.bild})`,
              backgroundPosition: `center ${kopf.position === "oben" ? "top" : kopf.position === "unten" ? "bottom" : "center"}`,
              opacity: kopf.staerke / 100,
              filter: unschaerfe ? `blur(${unschaerfe}px)` : undefined,
              transform: unschaerfe ? `scale(${1 + kopf.weichzeichnen / 40})` : undefined,
            }}
          />
          {kopf.abdunkeln > 0 && (
            <span className="kv-dunkel" aria-hidden="true" style={{ opacity: kopf.abdunkeln / 100 }} />
          )}
        </>
      )}
      <div className="kv-links">
        <span className="kv-eyebrow">Donnerstag, 6. August 2026</span>
        <span className="kv-gruss">Gute Nacht,&nbsp;<b>{name || "…"}</b></span>
        <span className="kv-unter">Dein privates Control-Dashboard.</span>
      </div>
      <div className="kv-rechts">
        {kopf.wetterZeigen && <span className="kv-wetter">18° {kopf.wetterOrt ? "· Bewölkt" : ""}</span>}
        {kopf.uhrZeigen && (
          <span className={`kv-uhr ${kopf.groesse === "kompakt" ? "klein" : ""}`}>
            {kopf.uhrFormat === "12" ? "4:23" : "04:23"}{kopf.uhrSekunden ? ":05" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Kopfbereich der Startseite: eigenes Bild dahinter, dazu Uhr und Wetter.
 *
 * Jede Aenderung geht sofort raus und sofort in den geteilten Speicher —
 * kein „Speichern"-Knopf. Bei Reglern ist das die einzige ehrliche Form: man
 * schiebt, bis es gefaellt, und sieht dabei zu. Ein Knopf danach waere eine
 * zweite Bestaetigung fuer etwas, das man schon gesehen hat.
 */
function StartseiteBlock({ melde, name }: { melde: (t: string) => void; name: string }) {
  const kopf = useKopf();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const dateiFeld = useRef<HTMLInputElement>(null);
  const [zuschnitt, setZuschnitt] = useState<File | null>(null);

  async function aendern(teil: Partial<Kopf>, meldung?: string) {
    setFehler(null);
    // Sofort anzeigen, dann erst schicken: ein Regler, der auf die Antwort
    // des Servers wartet, ruckelt.
    kopfSetzen({ ...kopf, ...teil });
    try {
      const neu = await kopfApi.setzen(teil);
      kopfSetzen(neu);
      if (meldung) melde(meldung);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Ändern nicht möglich.");
      // Zurueckholen, was der Server wirklich hat.
      kopfApi.lesen().then(kopfSetzen).catch(() => { /* dann bleibt es stehen */ });
    }
  }

  async function bildUebernehmen(datenUrl: string) {
    setFehler(null);
    setLaeuft(true);
    try {
      await aendern({ bild: datenUrl }, "Kopfbild gesetzt.");
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Das Bild ließ sich nicht setzen.");
    } finally {
      setLaeuft(false);
      setZuschnitt(null);
    }
  }

  return (
    <Block
      titel="Startseite"
      erklaerung="Ein eigenes Bild hinter der Begrüßung — und was Uhr und Wetter davon zeigen."
    >
      <KopfVorschau kopf={kopf} name={name} />

      <div className="profil-bild-knoepfe">
        <div className="profil-bild-reihe">
          <input
            ref={dateiFeld}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => { const d = e.target.files?.[0]; if (d) setZuschnitt(d); e.target.value = ""; }}
          />
          <button className="btn ghost small" disabled={laeuft} onClick={() => dateiFeld.current?.click()}>
            <Icon name="bild" /> {kopf.bild ? "Anderes Kopfbild" : "Kopfbild wählen"}
          </button>
          {kopf.bild && (
            <button
              className="btn ghost small"
              disabled={laeuft}
              onClick={() => aendern({ bild: null }, "Kopfbild entfernt.")}
            >
              <Icon name="loeschen" /> Entfernen
            </button>
          )}
        </div>
        <p className="profil-hinweis">
          Breite Bilder passen am besten. Wird auf höchstens 1920×720 verkleinert und
          liegt in deiner Datenbank, damit die Sicherung es mitnimmt. Nach unten blendet
          es immer aus, damit die Begrüßung lesbar bleibt.
        </p>
      </div>

      {kopf.bild && (
        <div className="kopf-regler-feld">
          <Regler
            titel="Stärke" wert={kopf.staerke} von={0} bis={60} einheit=" %"
            onWert={(n) => aendern({ staerke: n })}
            hinweis="Wie deutlich das Bild durchkommt."
          />
          <Regler
            titel="Abdunkeln" wert={kopf.abdunkeln} von={0} bis={80} einheit=" %"
            onWert={(n) => aendern({ abdunkeln: n })}
            hinweis="Hilft bei hellen Bildern, damit die Schrift steht."
          />
          <Regler
            titel="Weichzeichnen" wert={kopf.weichzeichnen} von={0} bis={20} einheit=" px"
            onWert={(n) => aendern({ weichzeichnen: n })}
            hinweis="Nimmt unruhigen Bildern die Unruhe."
          />
          <Wahl
            titel="Bildausschnitt"
            wert={kopf.position}
            moeglich={[
              { wert: "oben", label: "Oben" },
              { wert: "mitte", label: "Mittig" },
              { wert: "unten", label: "Unten" },
            ]}
            onWert={(w) => aendern({ position: w })}
          />
        </div>
      )}

      <div className="kopf-regler-feld">
        <Wahl
          titel="Größe von Uhr und Wetter"
          wert={kopf.groesse}
          moeglich={[
            { wert: "gross", label: "Groß" },
            { wert: "kompakt", label: "Kompakt" },
          ]}
          onWert={(w) => aendern({ groesse: w })}
        />

        <div className="kopf-gruppe">
          <Schalter titel="Uhr anzeigen" an={kopf.uhrZeigen} onAn={(b) => aendern({ uhrZeigen: b })} />
          {kopf.uhrZeigen && (
            <>
              <Schalter titel="Sekunden" an={kopf.uhrSekunden} onAn={(b) => aendern({ uhrSekunden: b })} />
              <Wahl
                titel="Format"
                wert={kopf.uhrFormat}
                moeglich={[{ wert: "24", label: "24 Stunden" }, { wert: "12", label: "12 Stunden" }]}
                onWert={(w) => aendern({ uhrFormat: w })}
              />
              <Wahl
                titel="Unter der Uhrzeit"
                wert={kopf.uhrUnterzeile}
                moeglich={[
                  { wert: "ortszeit", label: "„Ortszeit“" },
                  { wert: "datum", label: "Datum" },
                  { wert: "keine", label: "Nichts" },
                ]}
                onWert={(w) => aendern({ uhrUnterzeile: w })}
              />
            </>
          )}
        </div>

        <div className="kopf-gruppe">
          <Schalter titel="Wetter anzeigen" an={kopf.wetterZeigen} onAn={(b) => aendern({ wetterZeigen: b })} />
          {kopf.wetterZeigen && (
            <>
              <Schalter
                titel="Gefühlt, Feuchte, Wind, Regen"
                an={kopf.wetterDetails}
                onAn={(b) => aendern({ wetterDetails: b })}
              />
              <Schalter
                titel="Ortsnamen zeigen"
                an={kopf.wetterOrt}
                onAn={(b) => aendern({ wetterOrt: b })}
                hinweis="Aus, wenn jemand mitschaut."
              />
            </>
          )}
        </div>
      </div>

      {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}

      {zuschnitt && (
        <BildEditor
          datei={zuschnitt}
          // 4:1 — deutlich breiter als hoch, wie der Kopfbereich selbst, aber
          // nicht so extrem flach, dass vom Bild nur ein Streifen bliebe.
          // Den Rest erledigt `background-size: cover` samt Ausschnittwahl.
          seitenverhaeltnis={4}
          zielBreite={1920}
          titel="Kopfbild zuschneiden"
          hinweis="Die Vorschau darunter zeigt danach, wie es im Kopfbereich wirkt."
          guete={0.82}
          onFertig={bildUebernehmen}
          onAbbrechen={() => setZuschnitt(null)}
        />
      )}
    </Block>
  );
}

// --- Konto ----------------------------------------------------------------

function KontoBlock({ melde }: { melde: (t: string) => void }) {
  const [aktuell, setAktuell] = useState("");
  const [neu, setNeu] = useState("");
  const [nochmal, setNochmal] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const kurz = neu !== "" && neu.length < 8;
  const ungleich = nochmal !== "" && neu !== nochmal;
  const bereit = aktuell !== "" && neu.length >= 8 && neu === nochmal;

  async function aendern(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    setLaeuft(true);
    try {
      // Bewusst mit rohem fetch statt api(): ein falsches Passwort antwortet
      // mit 401, und api() deutet jede 401 als „Sitzung abgelaufen" und
      // klappt die Tuer zu. Ein Tippfehler wuerde einen hier hinauswerfen.
      const res = await fetch("/api/auth/passwort", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aktuell, neu }),
      });
      if (!res.ok) {
        setFehler(await fehlerText(res, "Ändern nicht möglich."));
        return;
      }
      setAktuell(""); setNeu(""); setNochmal("");
      melde("Passwort geändert — andere Geräte sind jetzt abgemeldet.");
    } catch {
      setFehler("Der Server antwortet nicht.");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Block
      titel="Konto & Sicherheit"
      erklaerung="Das Passwort für die Anmeldung. Nicht zu verwechseln mit dem Master-Passwort des Tresors — das verlässt deinen Browser nie."
    >
      <form className="profil-felder" onSubmit={aendern}>
        <label className="profil-feld">
          <span>Aktuelles Passwort</span>
          <input type="password" value={aktuell} onChange={(e) => setAktuell(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="profil-feld">
          <span>Neues Passwort <em>mindestens 8 Zeichen</em></span>
          <input type="password" value={neu} onChange={(e) => setNeu(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="profil-feld">
          <span>Neues Passwort wiederholen</span>
          <input type="password" value={nochmal} onChange={(e) => setNochmal(e.target.value)} autoComplete="new-password" />
        </label>

        {kurz && <div className="profil-warn">Noch {8 - neu.length} Zeichen.</div>}
        {ungleich && <div className="profil-warn">Die beiden Passwörter sind nicht gleich.</div>}
        {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}

        <div className="profil-aktion">
          <button className="btn" type="submit" disabled={!bereit || laeuft}>
            {laeuft ? "ändert…" : "Passwort ändern"}
          </button>
          <span className="profil-hinweis">
            Ein Wechsel meldet alle anderen Geräte ab. Dieser Browser bleibt angemeldet.
          </span>
        </div>
      </form>
    </Block>
  );
}

// --- Dashboard ------------------------------------------------------------

function DashboardBlock({
  onModule, angepasst, onReihenfolgeZuruecksetzen, versteckt, melde,
}: {
  onModule: () => void;
  angepasst: boolean;
  onReihenfolgeZuruecksetzen: () => void;
  versteckt: number;
  melde: (t: string) => void;
}) {
  const [ort, setOrt] = useState<{ label: string } | null>(null);
  const [suche, setSuche] = useState("");
  const [treffer, setTreffer] = useState<Ort[] | null>(null);
  const [aendere, setAendere] = useState(false);

  useEffect(() => {
    api<{ label: string } | null>("/wetter/location").then(setOrt).catch(() => setOrt(null));
  }, []);

  useEffect(() => {
    if (!aendere) return;
    const q = suche.trim();
    if (q.length < 2) { setTreffer(null); return; }
    const t = setTimeout(() => {
      api<Ort[]>(`/wetter/orte?q=${encodeURIComponent(q)}`).then(setTreffer).catch(() => setTreffer([]));
    }, 350);
    return () => clearTimeout(t);
  }, [suche, aendere]);

  async function waehle(o: Ort) {
    try {
      const neu = await api<{ label: string }>("/wetter/location", {
        method: "POST",
        body: JSON.stringify({ label: o.label, lat: o.lat, lon: o.lon }),
      });
      setOrt(neu);
      setAendere(false);
      setSuche("");
      setTreffer(null);
      melde(`Standort auf ${neu.label} gesetzt — beim nächsten Laden zeigt das Wetter dorthin.`);
    } catch (e) {
      melde(e instanceof Error ? e.message : "Standort ließ sich nicht setzen.");
    }
  }

  return (
    <Block titel="Dashboard" erklaerung="Welche Module du siehst, in welcher Reihenfolge — und wo das Wetter herkommt.">
      <div className="profil-zeile">
        <div className="profil-zeile-text">
          <strong>Wetter-Standort</strong>
          <span>{ort?.label ?? "Keiner gesetzt — die Wetteranzeige bleibt leer."}</span>
        </div>
        <button className="btn ghost small" onClick={() => { setAendere((a) => !a); setSuche(""); setTreffer(null); }}>
          <Icon name="ort" /> {aendere ? "Abbrechen" : "Ändern"}
        </button>
      </div>

      {aendere && (
        <div className="profil-ortssuche">
          <input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Ort oder Postleitzahl"
            autoFocus
          />
          {treffer !== null && (
            <div className="tuer-treffer">
              {treffer.length === 0 && <span className="profil-hinweis">Nichts gefunden.</span>}
              {treffer.map((o) => (
                <button
                  type="button"
                  key={`${o.lat},${o.lon}`}
                  className="tuer-treffer-zeile"
                  onClick={() => waehle(o)}
                >
                  <span>{o.label}</span>
                  {o.einwohner ? (
                    <span className="tuer-treffer-neben">{o.einwohner.toLocaleString("de-DE")} Ew.</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="profil-zeile">
        <div className="profil-zeile-text">
          <strong>Module</strong>
          <span>{versteckt > 0 ? `${versteckt} ausgeblendet` : "Alle sichtbar"}</span>
        </div>
        <button className="btn ghost small" onClick={onModule}>
          <Icon name="uebersicht" /> Module wählen
        </button>
      </div>

      <div className="profil-zeile">
        <div className="profil-zeile-text">
          <strong>Reihenfolge</strong>
          <span>
            {angepasst
              ? "Selbst angeordnet. Ziehen geht auf der Startseite am Griff der Kachel."
              : "Standard. Auf der Startseite am Griff der Kachel ziehen."}
          </span>
        </div>
        {angepasst && (
          <button className="btn ghost small" onClick={onReihenfolgeZuruecksetzen}>
            <Icon name="neuladen" /> Zurücksetzen
          </button>
        )}
      </div>
    </Block>
  );
}

// --- Daten ----------------------------------------------------------------

function DatenBlock({ onBackups, melde }: { onBackups: () => void; melde: (t: string) => void }) {
  const [mieter, setMieter] = useState("");
  const [vermieter, setVermieter] = useState("");
  const [geladen, setGeladen] = useState<{ mieter: string; vermieter: string } | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    api<{ mieter: string; vermieter: string }>("/laermprotokoll/bericht")
      .then((b) => { setGeladen(b); setMieter(b.mieter); setVermieter(b.vermieter); })
      .catch(() => { /* Modul evtl. ausgeblendet — dann bleibt der Block leer */ });
  }, []);

  const geaendert = !!geladen && (mieter !== geladen.mieter || vermieter !== geladen.vermieter);

  async function speichern() {
    setLaeuft(true);
    try {
      const neu = await api<{ mieter: string; vermieter: string }>("/laermprotokoll/bericht", {
        method: "PUT",
        body: JSON.stringify({ mieter, vermieter }),
      });
      setGeladen(neu);
      melde("Berichtskopf gespeichert.");
    } catch (e) {
      melde(e instanceof Error ? e.message : "Speichern nicht möglich.");
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Block titel="Daten" erklaerung="Alles liegt in einer SQLite-Datei neben dem Programm und verlässt diesen Rechner nicht.">
      <div className="profil-zeile">
        <div className="profil-zeile-text">
          <strong>Sicherungen</strong>
          <span>Automatisch täglich, dazu Spiegelung auf ein zweites Laufwerk.</span>
        </div>
        <button className="btn ghost small" onClick={onBackups}>
          <Icon name="backup" /> Öffnen
        </button>
      </div>

      {geladen && (
        <>
          <div className="profil-felder">
            <label className="profil-feld">
              <span>Mieter <em>für den Kopf des Lärmprotokoll-Berichts</em></span>
              <input value={mieter} onChange={(e) => setMieter(e.target.value)} maxLength={200} />
            </label>
            <label className="profil-feld">
              <span>Vermieter</span>
              <input value={vermieter} onChange={(e) => setVermieter(e.target.value)} maxLength={200} />
            </label>
          </div>
          <div className="profil-aktion">
            <button className="btn" disabled={!geaendert || laeuft} onClick={speichern}>
              {laeuft ? "speichert…" : "Speichern"}
            </button>
            <span className="profil-hinweis">
              Bleiben beide leer, druckt der Bericht die Kopfzeile gar nicht erst.
            </span>
          </div>
        </>
      )}
    </Block>
  );
}

