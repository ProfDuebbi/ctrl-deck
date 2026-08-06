import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, type Me } from "./api";
import { Avatar } from "./Avatar";
import { BildEditor } from "./BildEditor";
import { useKopf } from "./kopf";
import { Icon, type IconName } from "./Icon";
import { dashboardModules } from "./modules";
import {
  baueRaster, dabeiSeit, langesDatum, ladeStatistik, monatKurz, tagMitWochentag, vorWieLange,
  type ProfilEreignis, type ProfilGruppe, type ProfilZahl, type Statistik,
} from "./statistik";

/**
 * Die Profilseite — wer man ist, und was man in diesem Programm hinterlassen
 * hat.
 *
 * Vorher stand hier eine Karteikarte: Bild, Name und fuenf Zahlen, von denen
 * drei aus dem Kern kamen („Module sichtbar", „ausgeblendet"). Das ist kein
 * Profil, sondern eine Bestandsliste des Programms.
 *
 * Jetzt zeigt die Seite, was sonst nur nach vielen Klicks zu sehen war: ein
 * Jahr Aktivitaet als Raster, die eigenen Serien, die Kennzahlen jedes Moduls
 * und die letzten Eintraege quer durch alle. Die Daten dafuer sammelt das
 * Backend-Modul `profil` aus der Registry — diese Datei rechnet nichts aus,
 * sie ordnet nur an.
 *
 * Name und Bild bleiben HIER aenderbar — sie sind das Profil, nicht eine
 * Einstellung daran. Alles Uebrige liegt hinter dem Einstellungen-Knopf.
 */

/** Symbol und Kennfarbe eines Moduls, aus der Frontend-Registry. */
function modulInfo(id: string): { icon: IconName; accent: string; titel: string } {
  const m = dashboardModules.find((x) => x.id === id);
  return { icon: m?.icon ?? "uebersicht", accent: m?.accent ?? "blue", titel: m?.title ?? id };
}

/** Eine Zahl mit Beschriftung. Regel 4: die Zahl steht gross, das Wort klein. */
function Kennzahl({ zahl }: { zahl: ProfilZahl }) {
  return (
    <div className={`pk-zahl ton-${zahl.ton}`}>
      <div className="pk-zahl-wert">{zahl.wert}</div>
      <div className="pk-zahl-label">{zahl.label}</div>
      {zahl.hinweis && <div className="pk-zahl-hinweis">{zahl.hinweis}</div>}
    </div>
  );
}

/**
 * Das Aktivitaetsraster: ein Kaestchen je Tag, vier Stufen.
 *
 * Bewusst OHNE Einblenden (Regel 5): 371 Kaestchen, die nacheinander
 * auftauchen, waeren eine Show und keine Antwort. Das Raster steht sofort da,
 * und die Bewegung, die es gibt, ist die des Mauszeigers.
 */
function Raster({ stat }: { stat: Statistik }) {
  const { wochen, monate } = useMemo(
    () => baueRaster(stat.von, stat.bis, stat.tage),
    [stat.von, stat.bis, stat.tage]
  );
  const [gezeigt, setGezeigt] = useState<string | null>(null);

  const tagText = (d: string, n: number) =>
    `${tagMitWochentag(d)} — ${n === 0 ? "nichts eingetragen" : `${n} ${n === 1 ? "Eintrag" : "Einträge"}`}`;

  return (
    <div className="pk-raster">
      {/*
        Die Spaltenzahl geht als Variable ins CSS: die Kaestchen sollen die
        vorhandene Breite FUELLEN, nicht bei fester Groesse links kleben. Eine
        feste Breite waere auf einem breiten Fenster ein Briefmarkenraster in
        einer leeren Karte.
      */}
      <div
        className="pk-raster-rollen"
        style={{ "--wochen": wochen.length } as React.CSSProperties}
      >
        <div className="pk-raster-monate" aria-hidden="true">
          {monate.map((m) => (
            <span key={`${m.spalte}-${m.monat}`} style={{ gridColumnStart: m.spalte + 1 }}>
              {monatKurz(m.monat)}
            </span>
          ))}
        </div>
        {/* Das Gitter ist Zierde fuer den Screenreader — die Aussage steht
            als Satz darunter, und dort steht sie vollstaendig. */}
        <div className="pk-raster-gitter" aria-hidden="true">
          {wochen.map((woche, i) => (
            <div className="pk-raster-woche" key={i}>
              {woche.map((tag) => (
                <span
                  key={tag.datum}
                  className={`pk-tag s${tag.stufe} ${tag.leer ? "aus" : ""}`}
                  title={tag.leer ? undefined : tagText(tag.datum, tag.anzahl)}
                  onMouseEnter={() => !tag.leer && setGezeigt(tagText(tag.datum, tag.anzahl))}
                  onMouseLeave={() => setGezeigt(null)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="pk-raster-fuss">
        {/* Der Platz bleibt belegt, auch wenn nichts unter dem Zeiger liegt —
            sonst huepft die Legende beim Ueberfahren eine Zeile hoch. */}
        <p className="pk-raster-lese">
          {gezeigt ?? `An ${stat.aktiveTage} von ${stat.fenster} Tagen etwas eingetragen — ${stat.gesamt} insgesamt.`}
        </p>
        <div className="pk-legende" aria-hidden="true">
          <span>weniger</span>
          {[0, 1, 2, 3, 4].map((s) => <i key={s} className={`pk-tag s${s}`} />)}
          <span>mehr</span>
        </div>
      </div>
    </div>
  );
}

/** Ein Modulblock: Kopfzeile mit Sprung ins Modul, darunter seine Zahlen. */
function Modulblock({ gruppe, onModul }: { gruppe: ProfilGruppe; onModul: (id: string) => void }) {
  const info = modulInfo(gruppe.modul);
  return (
    <section className="pk-block">
      <button className={`pk-block-kopf accent-${info.accent}`} onClick={() => onModul(gruppe.modul)}>
        <span className="pk-block-ico"><Icon name={info.icon} /></span>
        <span className="pk-block-titel">{gruppe.titel}</span>
        <span className="pk-block-weiter">
          öffnen <Icon name="vor" />
        </span>
      </button>
      <div className="pk-zahlen">
        {gruppe.zahlen.map((z) => <Kennzahl key={z.id} zahl={z} />)}
      </div>
    </section>
  );
}

/** Eine Zeile im Verlauf. */
function Verlaufszeile({ e, onModul }: { e: ProfilEreignis; onModul: (id: string) => void }) {
  const info = modulInfo(e.modul);
  return (
    <li className="pk-vz">
      <button className={`pk-vz-knopf accent-${info.accent}`} onClick={() => onModul(e.modul)} title={`In ${info.titel} öffnen`}>
        <span className="pk-vz-ico"><Icon name={info.icon} /></span>
        <span className="pk-vz-text">
          <span className="pk-vz-titel">{e.titel}</span>
          <span className="pk-vz-unter">
            {e.art}
            {e.detail && <> · {e.detail}</>}
          </span>
        </span>
        <span className="pk-vz-wann">{vorWieLange(e.datum)}</span>
      </button>
    </li>
  );
}

export function Profil({
  me,
  setMe,
  onEinstellungen,
  onModul,
  moduleGesamt,
  versteckt,
}: {
  me: Me;
  setMe: (m: Me) => void;
  onEinstellungen: () => void;
  /** Sprung in ein Modul — jede Zahl auf dieser Seite hat einen Herkunftsort. */
  onModul: (id: string) => void;
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
  const [stat, setStat] = useState<Statistik | null>(null);
  const dateiFeld = useRef<HTMLInputElement>(null);

  const melde = (t: string) => { setToast(t); setTimeout(() => setToast(null), 3500); };

  useEffect(() => { setName(me.name); }, [me.name]);

  /**
   * Eine Anfrage fuer die ganze Seite. Frueher standen hier drei
   * Einzelaufrufe; inzwischen legt das Backend-Modul `profil` alles zusammen,
   * inklusive der Frage, welche Module ueberhaupt eingeblendet sind.
   *
   * Faellt sie aus, bleibt der Kopf trotzdem stehen und bedienbar — Name und
   * Bild haengen nicht an der Statistik.
   */
  useEffect(() => { ladeStatistik().then(setStat).catch(() => setStat(null)); }, []);

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

  const sichtbar = moduleGesamt - versteckt;

  return (
    <div className="profilseite">
      {/*
        Die Kopfkarte. Sie benutzt dasselbe Kopfbild wie die Startseite —
        ein zweites dafuer zu verlangen waere Arbeit ohne Gewinn.

        Es liegt als BANNER ueber dem Inhalt, nicht dahinter. Vorher lag es
        hinter Name und Zeilen: ein Bild mit Struktur (Schrift, Muster) macht
        genau dort jeden Text unleserlich, und eine Deckkraft, die den Text
        rettet, ruiniert das Bild. Getrennt uebereinander koennen beide voll
        gezeigt werden — und das Profilbild darf ueber die Kante ragen, wie
        man es von einem Profil erwartet.
      */}
      <section className={`pk-karte ${kopf.bild ? "mit-banner" : ""}`}>
        {kopf.bild && (
          <span
            className="pk-banner"
            aria-hidden="true"
            style={{
              backgroundImage: `url(${kopf.bild})`,
              backgroundPosition: `center ${kopf.position === "oben" ? "top" : kopf.position === "unten" ? "bottom" : "center"}`,
            }}
          />
        )}

        <div className="pk-inhalt">
          <div className="pk-bild">
            <Avatar name={me.name} bild={me.avatar} groesse={152} />
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

            {/*
              Die Zeile, die aus einer Karteikarte ein Profil macht: seit wann,
              wie viel, wie stetig. Sie steht IM Kopf, weil sie zur Person
              gehoert und nicht zu einem Modul.
            */}
            {stat && (
              <p className="pk-fakten">
                {stat.seit && (
                  <span title={`erste Spur am ${langesDatum(stat.seit)}`}>
                    <Icon name="termine" /> dabei seit {dabeiSeit(stat.seit)}
                  </span>
                )}
                <span><Icon name="uebersicht" /> {sichtbar} {sichtbar === 1 ? "Modul" : "Module"} im Einsatz</span>
                {stat.serie.aktuell > 1 && (
                  <span className="gut">
                    <Icon name="haken" /> {stat.serie.aktuell} Tage am Stück
                  </span>
                )}
              </p>
            )}

          </div>

          {/* Rechte Spalte = alles, was man TUT. „Bild entfernen" stand vorher
              unter den Fakten und las sich wie eine vierte Angabe zur Person. */}
          <div className="pk-aktionen">
            <button className="btn" onClick={onEinstellungen}>
              <Icon name="einstellungen" /> Einstellungen
            </button>
            {me.avatar && (
              <button className="btn ghost small" disabled={laeuft} onClick={() => bildSetzen(null)}>
                <Icon name="loeschen" /> Bild entfernen
              </button>
            )}
          </div>
        </div>
      </section>

      {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}

      {stat && (
        <>
          {/* Vier Zahlen ueber alles hinweg — der Anlauf zum Raster darunter. */}
          <section className="pk-zahlen pk-bilanz">
            <div className="pk-zahl">
              <div className="pk-zahl-wert">{stat.gesamt}</div>
              <div className="pk-zahl-label">Einträge im Jahr</div>
              <div className="pk-zahl-hinweis">seit {langesDatum(stat.von)}</div>
            </div>
            <div className="pk-zahl">
              <div className="pk-zahl-wert">{stat.aktiveTage}</div>
              <div className="pk-zahl-label">aktive Tage</div>
              <div className="pk-zahl-hinweis">
                {Math.round((stat.aktiveTage / stat.fenster) * 100)} % der Zeit
              </div>
            </div>
            <div className={`pk-zahl ${stat.serie.aktuell > 1 ? "ton-gut" : ""}`}>
              <div className="pk-zahl-wert">{stat.serie.aktuell}</div>
              <div className="pk-zahl-label">Tage Serie</div>
              <div className="pk-zahl-hinweis">{stat.serie.aktuell > 0 ? "läuft gerade" : "heute noch nichts"}</div>
            </div>
            <div className="pk-zahl">
              <div className="pk-zahl-wert">{stat.serie.laengste}</div>
              <div className="pk-zahl-label">längste Serie</div>
              <div className="pk-zahl-hinweis">im Rückblick</div>
            </div>
          </section>

          <section className="pk-abschnitt">
            <h3 className="pk-h3">Ein Jahr auf einen Blick</h3>
            <Raster stat={stat} />
          </section>

          {stat.gruppen.length > 0 && (
            <section className="pk-abschnitt">
              <h3 className="pk-h3">
                Was in den Modulen steckt
                <span className="pk-h3-unter">sonst je zwei bis vier Klicks entfernt</span>
              </h3>
              <div className="pk-bloecke">
                {stat.gruppen.map((g) => <Modulblock key={g.modul} gruppe={g} onModul={onModul} />)}
              </div>
            </section>
          )}

          {stat.verlauf.length > 0 && (
            <section className="pk-abschnitt">
              <h3 className="pk-h3">Zuletzt passiert</h3>
              <ul className="pk-verlauf">
                {stat.verlauf.map((e) => <Verlaufszeile key={e.id} e={e} onModul={onModul} />)}
              </ul>
            </section>
          )}

          {versteckt > 0 && (
            <p className="pk-fussnote">
              {versteckt} {versteckt === 1 ? "Modul ist" : "Module sind"} ausgeblendet und
              {versteckt === 1 ? " zählt" : " zählen"} hier nicht mit.
            </p>
          )}
          {stat.fehler.length > 0 && (
            <p className="pk-fussnote warnung">
              <Icon name="warnung" /> Ohne Zahlen geblieben: {stat.fehler.join(", ")}.
            </p>
          )}
        </>
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
