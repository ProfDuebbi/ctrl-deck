import { useEffect, useRef, useState } from "react";
import { api, type Me } from "./api";
import { Avatar } from "./Avatar";
import { BildEditor } from "./BildEditor";
import { useKopf } from "./kopf";
import { Icon } from "./Icon";

/**
 * Die Profilseite — wer man ist, nicht was man einstellen kann.
 *
 * Vorher stand hier eine lange Rolle aus Formularen: oben zwei Felder, unten
 * die Sicherungen. Das sah aus wie eine Einstellungsseite mit einem Namen
 * darauf. Jetzt zeigt die Seite ein Profil (Bild, Name, ein paar Zahlen zum
 * eigenen Bestand) und fuehrt ueber einen Knopf zu den Einstellungen.
 *
 * Name und Bild bleiben HIER aenderbar — sie sind das Profil, nicht eine
 * Einstellung daran. Alles Uebrige liegt hinter dem Knopf.
 */

interface Zahlen {
  module: number;
  versteckt: number;
  aufgaben: number | null;
  termine: number | null;
  tresor: string | null;
}

/** Eine Zahl mit Beschriftung. Regel 4: die Zahl steht gross, das Wort klein. */
function Kennzahl({ wert, label }: { wert: string | number; label: string }) {
  return (
    <div className="pk-zahl">
      <div className="pk-zahl-wert">{wert}</div>
      <div className="pk-zahl-label">{label}</div>
    </div>
  );
}

export function Profil({
  me,
  setMe,
  onEinstellungen,
  moduleGesamt,
  versteckt,
}: {
  me: Me;
  setMe: (m: Me) => void;
  onEinstellungen: () => void;
  moduleGesamt: number;
  versteckt: number;
}) {
  const kopf = useKopf();
  const [name, setName] = useState(me.name);
  const [bearbeitet, setBearbeitet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [zuschnitt, setZuschnitt] = useState<File | null>(null);
  const [zahlen, setZahlen] = useState<Zahlen | null>(null);
  const dateiFeld = useRef<HTMLInputElement>(null);

  const melde = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  useEffect(() => { setName(me.name); }, [me.name]);

  /**
   * Ein paar Zahlen aus den Modulen — sie machen aus einer Karteikarte ein
   * Profil. Jede einzeln geholt und jede einzeln verzichtbar: ein
   * ausgeblendetes Modul antwortet mit 404, und daran soll die Seite nicht
   * scheitern.
   */
  useEffect(() => {
    const still = <T,>(p: Promise<T>) => p.catch(() => null);
    Promise.all([
      still(api<{ anzahl: number }[]>("/aufgaben/due")),
      still(api<{ eintraege: unknown[] }>("/termine?tage=14")),
      still(api<{ eingerichtet: boolean; offen: boolean }>("/tresor/status")),
    ]).then(([aufgaben, termine, tresor]) => {
      setZahlen({
        module: moduleGesamt - versteckt,
        versteckt,
        aufgaben: Array.isArray(aufgaben) ? aufgaben.length : null,
        termine: termine && Array.isArray((termine as any).eintraege) ? (termine as any).eintraege.length : null,
        tresor: tresor ? (!tresor.eingerichtet ? "nicht eingerichtet" : tresor.offen ? "offen" : "verschlossen") : null,
      });
    });
  }, [moduleGesamt, versteckt]);

  async function nameSpeichern() {
    setLaeuft(true);
    setFehler(null);
    try {
      setMe(await api<Me>("/me", { method: "PUT", body: JSON.stringify({ name: name.trim() }) }));
      setBearbeitet(false);
      melde("Name gespeichert.");
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Speichern nicht möglich.");
    } finally {
      setLaeuft(false);
    }
  }

  async function bildSetzen(avatar: string | null) {
    setLaeuft(true);
    setFehler(null);
    try {
      setMe(await api<Me>("/me", { method: "PUT", body: JSON.stringify({ avatar }) }));
      melde(avatar ? "Profilbild gesetzt." : "Profilbild entfernt.");
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Das Bild ließ sich nicht setzen.");
    } finally {
      setLaeuft(false);
      setZuschnitt(null);
    }
  }

  return (
    <div className="profilseite">
      {/*
        Die Kopfkarte. Sie benutzt dasselbe Kopfbild wie die Startseite —
        ein zweites dafuer zu verlangen waere Arbeit ohne Gewinn. Hier steht
        es fester (halbe Staerke), damit es das Profilbild nicht ueberstrahlt.
      */}
      <section className="pk-karte">
        {kopf.bild && (
          <span
            className="pk-hintergrund"
            aria-hidden="true"
            style={{
              backgroundImage: `url(${kopf.bild})`,
              backgroundPosition: `center ${kopf.position === "oben" ? "top" : kopf.position === "unten" ? "bottom" : "center"}`,
              opacity: Math.min(0.35, kopf.staerke / 100 + 0.06),
            }}
          />
        )}

        <div className="pk-inhalt">
          <div className="pk-bild">
            <Avatar name={me.name} bild={me.avatar} groesse={104} />
            <input
              ref={dateiFeld}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => { const d = e.target.files?.[0]; if (d) setZuschnitt(d); e.target.value = ""; }}
            />
            <button
              className="pk-bild-knopf"
              onClick={() => dateiFeld.current?.click()}
              disabled={laeuft}
              title={me.avatar ? "Anderes Profilbild wählen" : "Profilbild wählen"}
            >
              <Icon name="bild" />
              <span className="sr-only">Profilbild ändern</span>
            </button>
          </div>

          <div className="pk-text">
            {bearbeitet ? (
              <div className="pk-name-form">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) nameSpeichern(); }}
                />
                <button className="btn small" disabled={laeuft || !name.trim()} onClick={nameSpeichern}>
                  Speichern
                </button>
                <button
                  className="btn ghost small"
                  onClick={() => { setName(me.name); setBearbeitet(false); setFehler(null); }}
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              <h2 className="pk-name">
                {me.name || "Ohne Namen"}
                <button className="icon-btn" onClick={() => setBearbeitet(true)} title="Namen ändern">
                  <Icon name="bearbeiten" />
                </button>
              </h2>
            )}
            <p className="pk-unter">{me.appName} · lokal auf diesem Rechner</p>

            {me.avatar && (
              <button className="btn ghost small" disabled={laeuft} onClick={() => bildSetzen(null)}>
                <Icon name="loeschen" /> Bild entfernen
              </button>
            )}
          </div>

          <button className="btn pk-einstellungen" onClick={onEinstellungen}>
            <Icon name="einstellungen" /> Einstellungen
          </button>
        </div>
      </section>

      {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}

      {zahlen && (
        <section className="pk-zahlen">
          <Kennzahl wert={zahlen.module} label="Module sichtbar" />
          {zahlen.versteckt > 0 && <Kennzahl wert={zahlen.versteckt} label="ausgeblendet" />}
          {zahlen.aufgaben !== null && <Kennzahl wert={zahlen.aufgaben} label="Aufgaben fällig" />}
          {zahlen.termine !== null && <Kennzahl wert={zahlen.termine} label="Termine in 14 Tagen" />}
          {zahlen.tresor && <Kennzahl wert={zahlen.tresor} label="Tresor" />}
        </section>
      )}

      {zuschnitt && (
        <BildEditor
          datei={zuschnitt}
          seitenverhaeltnis={1}
          zielBreite={256}
          rund
          titel="Profilbild zuschneiden"
          hinweis="Der Kreis zeigt, was später zu sehen ist."
          onFertig={(daten) => bildSetzen(daten)}
          onAbbrechen={() => setZuschnitt(null)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
