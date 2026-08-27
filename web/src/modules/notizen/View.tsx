import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../core/Icon";
import { useConfirm } from "../../core/ui";
import { useEntsperrt, holeSchluessel } from "../tresor/vault";
import { Aufschliessen } from "../tresor/Aufschliessen";
import { Editor } from "./Editor";
import { Markdown } from "./markdown";
import {
  datumDe, heuteLokal, kurzfassung, leererEntwurf, nz, OHNE_TITEL, schlagwortListe,
  titelKlartext, wannText, zumBearbeiten, zumSenden,
  type Entwurf, type NotizZeile,
} from "./api";

/**
 * NOTIZEN — links die Ablage, rechts das Blatt.
 *
 * Drei Entscheidungen praegen diese Ansicht:
 *
 * 1. LESEN UND SCHREIBEN SIND ZWEI ZUSTAENDE. Eine Notiz liegt normalerweise
 *    zum Lesen da; wer sie aendern will, drueckt „Bearbeiten" und danach
 *    „Speichern". Das schuetzt vor dem Tippfehler, den man beim Nachschlagen
 *    macht, ohne es zu merken — und es macht „gespeichert" zu einer Aussage
 *    statt zu einer Vermutung.
 * 2. ES GIBT KEINE ORDNER. Ordner sind Arbeit bei JEDEM Anlegen, Schlagworte
 *    sind Arbeit nur dann, wenn man sie will. Sortiert wird nach „zuletzt
 *    angefasst", und was oben bleiben soll, wird angeheftet.
 * 3. WAS GESCHRIEBEN WIRD, SIEHT AUS WIE DAS ERGEBNIS. Der Editor zeigt
 *    fetten Text fett; das Markdown darunter bekommt niemand zu sehen.
 */

type Modus = "lesen" | "bearbeiten";

const gleich = (a: Entwurf, b: Entwurf) =>
  a.titel === b.titel && a.inhalt === b.inhalt && a.schlagworte === b.schlagworte &&
  a.wiedervorlage === b.wiedervorlage && a.verschluesselt === b.verschluesselt;

export function View() {
  const confirm = useConfirm();
  const entsperrt = useEntsperrt();

  const [liste, setListe] = useState<NotizZeile[] | null>(null);
  const [papierkorb, setPapierkorb] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  /** Der gespeicherte Stand der gewaehlten Notiz — das, was die Ansicht zeigt. */
  const [gespeichert, setGespeichert] = useState<Entwurf | null>(null);
  /** Die Arbeitskopie im Editor. Existiert nur zwischen „Bearbeiten" und Schluss. */
  const [arbeit, setArbeit] = useState<Entwurf | null>(null);
  const [modus, setModus] = useState<Modus>("lesen");
  /** Die gewaehlte Notiz ist verschluesselt und der Tresor ist zu. */
  const [zu, setZu] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [suchtext, setSuchtext] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  /** Aufgeschlossene Titel verschluesselter Notizen — nur im Arbeitsspeicher. */
  const [klartitel, setKlartitel] = useState<Map<number, string>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  /** Eine frisch angelegte Notiz, die noch nie etwas enthielt. */
  const frisch = useRef<number | null>(null);
  const titelFeld = useRef<HTMLInputElement>(null);

  const geaendert = !!arbeit && !!gespeichert && !gleich(arbeit, gespeichert);

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 3000);
  };

  // --- Laden ------------------------------------------------------------

  const laden = async (imPapierkorb = papierkorb) => {
    const l = await nz.liste(imPapierkorb);
    setListe(l);
    return l;
  };

  useEffect(() => { void laden(false); }, []);

  /**
   * Titel verschluesselter Notizen aufschliessen, sobald der Tresor offen
   * ist. Der Inhalt bleibt dabei unangetastet — fuer die Liste reicht der
   * Titel, und was nicht geholt wird, kann auch nicht herumliegen.
   */
  useEffect(() => {
    const key = holeSchluessel();
    if (!liste || !key) return;
    const offen = liste.filter((z) => z.verschluesselt && !klartitel.has(z.id));
    if (offen.length === 0) return;
    let abgebrochen = false;
    void (async () => {
      const paare: [number, string][] = [];
      for (const z of offen) {
        try { paare.push([z.id, await titelKlartext(z, key)]); } catch { /* defekt */ }
      }
      if (abgebrochen || paare.length === 0) return;
      setKlartitel((m) => {
        const neu = new Map(m);
        for (const [id, t] of paare) neu.set(id, t);
        return neu;
      });
    })();
    return () => { abgebrochen = true; };
  }, [liste, entsperrt, klartitel]);

  // --- Speichern --------------------------------------------------------

  const speichern = async (): Promise<boolean> => {
    if (gewaehlt == null || !arbeit) return true;
    const id = gewaehlt;
    const stand = arbeit;
    setLaeuft(true);
    try {
      const koerper = await zumSenden(stand, holeSchluessel());
      const res = await nz.aendernRoh(id, koerper);
      // Die Zeile in der Liste nachziehen, statt alles neu zu holen.
      setListe((l) =>
        l?.map((z) => z.id !== id ? z : {
          ...z,
          titel: String(koerper.titel ?? ""),
          auszug: stand.verschluesselt ? "" : kurzfassung(stand.inhalt),
          schlagworte: stand.schlagworte,
          verschluesselt: stand.verschluesselt ? 1 : 0,
          wiedervorlage: stand.wiedervorlage || null,
          updated_at: res.updated_at,
        }) ?? l
      );
      if (stand.verschluesselt) setKlartitel((m) => new Map(m).set(id, stand.titel));
      setGespeichert(stand);
      setArbeit(null);
      setModus("lesen");
      setFehler(null);
      frisch.current = null;
      return true;
    } catch (e) {
      setFehler(e instanceof Error ? e.message : "Gespeichert wurde nicht.");
      return false;
    } finally {
      setLaeuft(false);
    }
  };

  /** Ist an dieser Notiz ueberhaupt etwas dran? */
  const leer = (e: Entwurf) =>
    !e.titel.trim() && !e.inhalt.trim() && !e.schlagworte.trim() && !e.wiedervorlage;

  const abbrechen = async () => {
    if (geaendert) {
      const ok = await confirm({
        title: "Änderungen verwerfen",
        message: "Was du seit dem letzten Speichern geschrieben hast, geht verloren.",
        confirmLabel: "Verwerfen",
        danger: true,
      });
      if (!ok) return;
    }
    // Eine nie gefuellte neue Notiz hinterlaesst keinen leeren Zettel.
    if (frisch.current != null && gespeichert && leer(gespeichert)) {
      const id = frisch.current;
      frisch.current = null;
      await nz.loeschen(id, true).catch(() => {});
      setListe((l) => l?.filter((z) => z.id !== id) ?? l);
      setGewaehlt(null);
      setGespeichert(null);
    }
    setArbeit(null);
    setModus("lesen");
    setFehler(null);
  };

  /**
   * Vor jedem Wechsel: Offene Aenderungen muessen entschieden werden.
   *
   * Bewusst ohne „einfach verwerfen"-Ausgang — den gibt es an genau einer
   * Stelle, und die heisst „Abbrechen". Ein Dialog, bei dem der bequeme Knopf
   * Text wegwirft, ist eine Falle.
   */
  const darfWechseln = async (): Promise<boolean> => {
    if (modus !== "bearbeiten" || !geaendert) return true;
    const ok = await confirm({
      title: "Ungespeicherte Änderungen",
      message: "Diese Notiz ist noch nicht gespeichert. Jetzt speichern und weiter?",
      confirmLabel: "Speichern",
    });
    if (!ok) return false;
    return speichern();
  };

  // --- Auswahl ----------------------------------------------------------

  const oeffne = async (id: number) => {
    try {
      const roh = await nz.eine(id);
      const e = await zumBearbeiten(roh, holeSchluessel());
      setGespeichert(e);
      setZu(false);
    } catch (err) {
      setGespeichert(null);
      // „verschlossen" ist kein Fehler, sondern ein Zustand.
      if (err instanceof Error && err.message === "verschlossen") setZu(true);
      else setFehler(err instanceof Error ? err.message : "Die Notiz ließ sich nicht laden.");
    }
  };

  const waehle = async (id: number) => {
    if (id === gewaehlt) return;
    if (!(await darfWechseln())) return;
    // Erst jetzt neu sortieren — waehrend des Schreibens bleibt die Liste stehen.
    setListe((l) => l && [...l].sort(
      (a, b) => b.angeheftet - a.angeheftet || b.updated_at.localeCompare(a.updated_at)
    ));
    setGewaehlt(id);
    setGespeichert(null);
    setArbeit(null);
    setModus("lesen");
    setFehler(null);
    await oeffne(id);
  };

  /**
   * Sperrt der Tresor, verschwindet der Klartext — auch der in der Liste.
   * Ein zugesperrter Tresor, neben dem noch alle Titel stehen, waere ein
   * Schloss mit Fenster.
   *
   * EINE Ausnahme: Wer gerade schreibt, verliert seinen Text nicht. Dann
   * bleibt das Feld stehen, und der Fuss sagt, dass zum Speichern erst
   * aufgeschlossen werden muss. Ungespeicherte Saetze wegzuwerfen waere ein
   * groesserer Schaden als der Blick auf einen Bildschirm, vor dem ohnehin
   * gerade jemand sitzt.
   */
  useEffect(() => {
    if (!entsperrt) {
      setKlartitel(new Map());
      if (gespeichert?.verschluesselt && modus === "lesen") {
        setGespeichert(null);
        setZu(true);
      }
    }
    if (entsperrt && zu && gewaehlt != null) void oeffne(gewaehlt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entsperrt]);

  const neu = async () => {
    if (!(await darfWechseln())) return;
    const e = leererEntwurf();
    const res = await nz.anlegenRoh(await zumSenden(e, null));
    await laden(false);
    frisch.current = res.id;
    setGewaehlt(res.id);
    setGespeichert(e);
    setArbeit({ ...e });
    setModus("bearbeiten");
    setZu(false);
    setFehler(null);
    window.setTimeout(() => titelFeld.current?.focus(), 0);
  };

  const bearbeiten = () => {
    if (!gespeichert) return;
    setArbeit({ ...gespeichert });
    setModus("bearbeiten");
    setFehler(null);
  };

  const aendere = (teil: Partial<Entwurf>) => setArbeit((a) => (a ? { ...a, ...teil } : a));

  // --- Einzelne Handgriffe ---------------------------------------------

  const anheften = async (z: NotizZeile) => {
    const an = z.angeheftet ? 0 : 1;
    await nz.aendernRoh(z.id, { angeheftet: an });
    setListe((l) => l?.map((x) => (x.id === z.id ? { ...x, angeheftet: an } : x)) ?? l);
  };

  const inPapierkorb = async (id: number) => {
    const ok = await confirm({
      title: "In den Papierkorb",
      message: "Die Notiz landet im Papierkorb und lässt sich von dort zurückholen.",
      confirmLabel: "In den Papierkorb",
    });
    if (!ok) return;
    await nz.loeschen(id);
    frisch.current = null;
    setGewaehlt(null);
    setGespeichert(null);
    setArbeit(null);
    setModus("lesen");
    await laden();
    flash("In den Papierkorb gelegt.");
  };

  const zurueckholen = async (id: number) => {
    await nz.zurueck(id);
    await laden();
    flash("Zurückgeholt.");
  };

  const endgueltig = async (z: NotizZeile) => {
    const ok = await confirm({
      title: "Endgültig löschen",
      message: `„${zeilenTitel(z)}" wird unwiderruflich gelöscht.`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await nz.loeschen(z.id, true);
    await laden();
  };

  const leeren = async () => {
    const ok = await confirm({
      title: "Papierkorb leeren",
      message: "Alle Notizen im Papierkorb werden unwiderruflich gelöscht.",
      confirmLabel: "Leeren",
      danger: true,
    });
    if (!ok) return;
    const r = await nz.papierkorbLeeren();
    await laden();
    flash(`${r.geloescht} ${r.geloescht === 1 ? "Notiz" : "Notizen"} gelöscht.`);
  };

  const schlossUmlegen = async () => {
    if (!arbeit) return;
    if (!arbeit.verschluesselt) {
      if (!holeSchluessel()) {
        setFehler("Zum Verschlüsseln muss der Tresor offen sein.");
        return;
      }
      aendere({ verschluesselt: true });
      flash("Wird beim Speichern verschlüsselt — und ist dann nicht mehr durchsuchbar.");
      return;
    }
    const ok = await confirm({
      title: "Verschlüsselung aufheben",
      message:
        "Die Notiz liegt nach dem Speichern im Klartext in der Datenbank und erscheint wieder in der globalen Suche.",
      confirmLabel: "Aufheben",
    });
    if (!ok) return;
    aendere({ verschluesselt: false });
  };

  const papierkorbUmschalten = async () => {
    if (!(await darfWechseln())) return;
    const neuerModus = !papierkorb;
    setPapierkorb(neuerModus);
    setGewaehlt(null);
    setGespeichert(null);
    setArbeit(null);
    setModus("lesen");
    setZu(false);
    setTag(null);
    setListe(null);
    await laden(neuerModus);
  };

  // --- Abgeleitetes -----------------------------------------------------

  const zeilenTitel = (z: NotizZeile): string =>
    z.verschluesselt
      ? klartitel.get(z.id) || "— verschlüsselt —"
      : z.titel.trim() || OHNE_TITEL;

  const schlagworte = useMemo(() => {
    const zaehler = new Map<string, number>();
    for (const z of liste ?? [])
      for (const w of schlagwortListe(z.schlagworte)) zaehler.set(w, (zaehler.get(w) ?? 0) + 1);
    return [...zaehler.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"));
  }, [liste]);

  const gefiltert = useMemo(() => {
    const q = suchtext.trim().toLowerCase();
    return (liste ?? []).filter((z) => {
      if (tag && !schlagwortListe(z.schlagworte).some((w) => w.toLowerCase() === tag.toLowerCase()))
        return false;
      if (!q) return true;
      // Bei verschluesselten Notizen kann nur getroffen werden, was der
      // Browser gerade offen hat — der Text selbst liegt hier nicht.
      return [zeilenTitel(z), z.auszug, z.schlagworte].join(" ").toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liste, suchtext, tag, klartitel]);

  /** Die Zeile zur offenen Notiz — fuer Anheften und Zeitangabe. */
  const offeneZeile = liste?.find((z) => z.id === gewaehlt) ?? null;
  const tresorFehlt = modus === "bearbeiten" && !!arbeit?.verschluesselt && !entsperrt;

  // --- Anzeige ----------------------------------------------------------

  return (
    <div className="module-view nz">
      <div className="nz-raster">
        <aside className="nz-spalte">
          <div className="nz-spalte-kopf">
            <button className="btn small" onClick={() => void neu()} disabled={papierkorb}>
              <Icon name="plus" /> Neue Notiz
            </button>
            <button
              className={`icon-btn ${papierkorb ? "an" : ""}`}
              title={papierkorb ? "Zurück zu den Notizen" : "Papierkorb"}
              aria-pressed={papierkorb}
              onClick={() => void papierkorbUmschalten()}
            >
              <Icon name={papierkorb ? "zurueck" : "loeschen"} />
            </button>
          </div>

          <div className="suchfeld nz-suchfeld">
            <Icon name="suchen" />
            <input
              placeholder={papierkorb ? "Papierkorb durchsuchen…" : "Notizen durchsuchen…"}
              value={suchtext}
              onChange={(e) => setSuchtext(e.target.value)}
            />
          </div>

          {!papierkorb && schlagworte.length > 0 && (
            <div className="nz-tags">
              {schlagworte.map(([wort, n]) => (
                <button
                  key={wort}
                  className={`nz-tag ${tag === wort ? "an" : ""}`}
                  onClick={() => setTag(tag === wort ? null : wort)}
                >
                  {wort} <span className="nz-tag-zahl">{n}</span>
                </button>
              ))}
            </div>
          )}

          <ul className="nz-liste">
            {liste === null && <li className="empty">lädt…</li>}
            {liste !== null && gefiltert.length === 0 && (
              <li className="empty">
                {papierkorb
                  ? "Der Papierkorb ist leer."
                  : liste.length === 0
                    ? "Noch keine Notiz. Fang oben an."
                    : "Nichts gefunden."}
              </li>
            )}
            {gefiltert.map((z) => (
              <li
                key={z.id}
                className={`nz-zeile ${z.id === gewaehlt ? "an" : ""} ${z.angeheftet ? "fest" : ""}`}
              >
                <button
                  className="nz-zeile-text"
                  onClick={() => (papierkorb ? undefined : void waehle(z.id))}
                  disabled={papierkorb}
                >
                  <span className="nz-zeile-titel">
                    {/* `!!` ist Pflicht: `verschluesselt` ist 0 oder 1, und
                        React setzt eine 0 als Text in die Zeile. */}
                    {!!z.verschluesselt && <Icon name="schloss" />}
                    {zeilenTitel(z)}
                  </span>
                  <span className="nz-zeile-auszug">
                    {z.verschluesselt && !z.auszug ? "verschlüsselt" : z.auszug || "leer"}
                  </span>
                  <span className="nz-zeile-fuss">
                    {wannText(z.geloescht_at ?? z.updated_at)}
                    {z.wiedervorlage && (
                      <>
                        {" · "}
                        <Icon name="glocke" /> {z.wiedervorlage.slice(8)}.{z.wiedervorlage.slice(5, 7)}.
                      </>
                    )}
                    {schlagwortListe(z.schlagworte).map((w) => (
                      <span className="nz-zeile-tag" key={w}>{w}</span>
                    ))}
                  </span>
                </button>
                <div className="nz-zeile-knoepfe">
                  {papierkorb ? (
                    <>
                      <button className="icon-btn" title="Zurückholen" onClick={() => void zurueckholen(z.id)}>
                        <Icon name="zurueckholen" />
                      </button>
                      <button className="icon-btn danger" title="Endgültig löschen" onClick={() => void endgueltig(z)}>
                        <Icon name="loeschen" />
                      </button>
                    </>
                  ) : (
                    <button
                      className={`icon-btn ${z.angeheftet ? "an" : ""}`}
                      title={z.angeheftet ? "Nicht mehr anheften" : "Oben anheften"}
                      aria-pressed={!!z.angeheftet}
                      onClick={() => void anheften(z)}
                    >
                      <Icon name="nadel" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {papierkorb && (liste?.length ?? 0) > 0 && (
            <button className="btn ghost small nz-leeren" onClick={() => void leeren()}>
              Papierkorb leeren
            </button>
          )}
          {papierkorb && (
            <p className="nz-fussnote">
              Was länger als 30 Tage hier liegt, wird beim nächsten Start des Servers gelöscht.
            </p>
          )}
        </aside>

        <section className="nz-blatt">
          {papierkorb ? (
            <p className="empty">
              Gelöschte Notizen lassen sich zurückholen oder endgültig entfernen —
              geschrieben wird hier nicht.
            </p>
          ) : gewaehlt == null ? (
            <div className="nz-leerblatt">
              <Icon name="notizen" />
              <p>Links eine Notiz wählen — oder oben eine neue anfangen.</p>
              <p className="nz-leerblatt-klein">
                Geschrieben wird mit Knöpfen wie in einem Textprogramm; gespeichert
                wird trotzdem eine schlichte Textdatei.
              </p>
            </div>
          ) : zu ? (
            <Aufschliessen hinweis="Diese Notiz ist verschlüsselt. Zum Lesen den Tresor aufschließen." />
          ) : gespeichert === null ? (
            <p className="empty">lädt…</p>
          ) : modus === "lesen" ? (
            // --- Ansicht ---------------------------------------------------
            <>
              <div className="nz-blatt-kopf">
                <h2 className="nz-titel-fest">
                  {gespeichert.verschluesselt && <Icon name="schloss" />}
                  {gespeichert.titel.trim() || OHNE_TITEL}
                </h2>
                <div className="nz-werkzeuge">
                  <button className="btn small" onClick={bearbeiten}>
                    <Icon name="bearbeiten" /> Bearbeiten
                  </button>
                  {offeneZeile && (
                    <button
                      className={`icon-btn ${offeneZeile.angeheftet ? "an" : ""}`}
                      title={offeneZeile.angeheftet ? "Nicht mehr anheften" : "Oben anheften"}
                      aria-pressed={!!offeneZeile.angeheftet}
                      onClick={() => void anheften(offeneZeile)}
                    >
                      <Icon name="nadel" />
                    </button>
                  )}
                  <button
                    className="icon-btn danger"
                    title="In den Papierkorb"
                    onClick={() => void inPapierkorb(gewaehlt)}
                  >
                    <Icon name="loeschen" />
                  </button>
                </div>
              </div>

              <div className="nz-schild">
                {schlagwortListe(gespeichert.schlagworte).map((w) => (
                  <span className="nz-zeile-tag" key={w}>{w}</span>
                ))}
                {gespeichert.wiedervorlage && (
                  <span className="nz-schild-teil">
                    <Icon name="glocke" /> Wiedervorlage {datumDe(gespeichert.wiedervorlage)}
                  </span>
                )}
                {gespeichert.verschluesselt && (
                  <span className="nz-schild-teil">
                    <Icon name="schloss" /> verschlüsselt · nicht in der globalen Suche
                  </span>
                )}
                {offeneZeile && (
                  <span className="nz-schild-teil rechts">
                    zuletzt geändert {wannText(offeneZeile.updated_at)}
                  </span>
                )}
              </div>

              <div className="nz-md nz-lesen">
                {gespeichert.inhalt.trim()
                  ? <Markdown text={gespeichert.inhalt} />
                  : <p className="empty">Noch nichts geschrieben. Über „Bearbeiten" geht es los.</p>}
              </div>
            </>
          ) : (
            // --- Bearbeiten ------------------------------------------------
            arbeit && (
              <>
                <div className="nz-blatt-kopf">
                  <input
                    ref={titelFeld}
                    className="nz-titel"
                    placeholder="Titel"
                    value={arbeit.titel}
                    onChange={(e) => aendere({ titel: e.target.value })}
                  />
                  <div className="nz-werkzeuge">
                    <button
                      className={`icon-btn ${arbeit.verschluesselt ? "an" : ""}`}
                      title={arbeit.verschluesselt ? "Verschlüsselung aufheben" : "Verschlüsseln"}
                      aria-pressed={arbeit.verschluesselt}
                      onClick={() => void schlossUmlegen()}
                    >
                      <Icon name={arbeit.verschluesselt ? "schloss" : "schluessel"} />
                    </button>
                  </div>
                </div>

                <div className="nz-meta">
                  <label className="feld-mit-label">
                    <span>Schlagworte</span>
                    <input
                      placeholder="z. B. Haus, Auto"
                      value={arbeit.schlagworte}
                      onChange={(e) => aendere({ schlagworte: e.target.value })}
                    />
                  </label>
                  <label className="feld-mit-label" title="Erscheint an diesem Tag im Terminfaden">
                    <span>Wiedervorlage</span>
                    <input
                      type="date"
                      min={heuteLokal()}
                      value={arbeit.wiedervorlage}
                      onChange={(e) => aendere({ wiedervorlage: e.target.value })}
                    />
                  </label>
                </div>

                <Editor
                  key={gewaehlt}
                  start={gespeichert.inhalt}
                  onChange={(md) => aendere({ inhalt: md })}
                  onSpeichern={() => void speichern()}
                />

                {tresorFehlt && (
                  <div className="nz-warnung">
                    <p>
                      <Icon name="warnung" /> Der Tresor hat sich zwischendurch gesperrt.
                      Dein Text steht noch da — zum Speichern bitte aufschließen.
                    </p>
                    <Aufschliessen hinweis="" />
                  </div>
                )}

                <div className="nz-fuss">
                  <span className={`nz-stand ${geaendert ? "geaendert" : ""}`}>
                    {laeuft ? "wird gespeichert…" : geaendert ? "nicht gespeichert" : "keine Änderung"}
                  </span>
                  {fehler && <span className="nz-fuss-fehler" role="alert"><Icon name="warnung" /> {fehler}</span>}
                  <span className="nz-fuss-knoepfe">
                    <button className="btn ghost small" onClick={() => void abbrechen()} disabled={laeuft}>
                      Abbrechen
                    </button>
                    <button
                      className="btn small"
                      onClick={() => void speichern()}
                      disabled={laeuft || tresorFehlt}
                      title="Strg+S"
                    >
                      Speichern
                    </button>
                  </span>
                </div>
              </>
            )
          )}
        </section>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
