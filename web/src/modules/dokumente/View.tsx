import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../core/Icon";
import { Modal, useConfirm } from "../../core/ui";
import { Aufschliessen } from "../tresor/Aufschliessen";
import { holeSchluessel, useEntsperrt } from "../tresor/vault";
import { Vorschau } from "./Vorschau";
import {
  dk, dateiHochladen, dateienUmschluesseln, datumDe, dokumentAusDatei, groesseText,
  istVorschaubar, leererEntwurf, schlagwortListe, zumAnzeigen, zumBearbeiten, zumSenden,
  ablaufStatus, ablaufText, MAX_DATEI_BYTES, OHNE_TITEL, VORWARN_STANDARD,
  type Datei, type Dokument, type DokumentRoh, type Entwurf,
} from "./api";

/**
 * DOKUMENTENABLAGE — der Aktenschrank.
 *
 * Drei Dinge unterscheiden ihn von einer Dateiablage:
 *
 * 1. **Die Datei ist optional.** Ein Eintrag darf auch nur sagen, wo das
 *    Papier liegt. Sonst faenden sich hier nur die Sachen wieder, die man
 *    ohnehin schon eingescannt hat — und die sind selten die, die man sucht.
 * 2. **Faecher.** Papierkram ordnet man nach Schublade, nicht nach Datum.
 * 3. **Ablaufdaten.** Ein Ausweis, der abgelaufen ist, ist ungueltig; das
 *    gehoert vorn auf die Karte und in den Terminfaden.
 */
export function View() {
  const confirm = useConfirm();
  const entsperrt = useEntsperrt();

  const [roh, setRoh] = useState<DokumentRoh[] | null>(null);
  const [liste, setListe] = useState<Dokument[]>([]);
  const [kategorien, setKategorien] = useState<string[]>([]);
  const [fach, setFach] = useState<string | null>(null);
  const [suchtext, setSuchtext] = useState("");
  const [papierkorb, setPapierkorb] = useState(false);
  const [offenId, setOffenId] = useState<number | null>(null);
  const [formular, setFormular] = useState<{ id: number | null; entwurf: Entwurf } | null>(null);
  const [formFehler, setFormFehler] = useState<string | null>(null);
  const [vorschau, setVorschau] = useState<{ datei: Datei; chiffriert: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  /** Ueber welchem Ziel schwebt gerade eine gezogene Datei? */
  const [ueber, setUeber] = useState<string | null>(null);
  const dateiFeld = useRef<HTMLInputElement>(null);
  const ablegeFeld = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const laden = useCallback(async (imPapierkorb: boolean) => {
    setRoh(await dk.liste(imPapierkorb));
  }, []);

  useEffect(() => { laden(papierkorb); }, [laden, papierkorb]);
  useEffect(() => { dk.kategorien().then(setKategorien).catch(() => setKategorien([])); }, [roh]);

  /*
   * Aufschliessen laeuft hier und nicht beim Laden: Wird der Tresor spaeter
   * geoeffnet, sollen die Titel erscheinen, ohne dass jemand neu laedt — und
   * beim Sperren wieder verschwinden. Deshalb haengt es an `entsperrt`.
   */
  useEffect(() => {
    let verworfen = false;
    if (!roh) { setListe([]); return; }
    const key = entsperrt ? holeSchluessel() : null;
    Promise.all(roh.map((r) => zumAnzeigen(r, key))).then((fertig) => {
      if (!verworfen) setListe(fertig);
    });
    return () => { verworfen = true; };
  }, [roh, entsperrt]);

  const sichtbar = useMemo(() => {
    const begriff = suchtext.trim().toLowerCase();
    return liste.filter((d) => {
      if (fach && d.kategorie !== fach) return false;
      if (!begriff) return true;
      // Ein zugeschlossenes Dokument kann nicht mitsuchen — seine Kategorie
      // und Schlagworte aber schon, die stehen im Klartext.
      const heuhaufen = [
        d.titel, d.kategorie, d.schlagworte, d.ablageort, d.notiz,
        ...d.dateien.map((f) => f.name),
      ].join(" ").toLowerCase();
      return heuhaufen.includes(begriff);
    });
  }, [liste, fach, suchtext]);

  /** Wie viele in jedem Fach liegen — steht neben dem Fach in der Spalte. */
  const faecher = useMemo(() => {
    const zaehler = new Map<string, number>();
    for (const d of liste) {
      const k = d.kategorie || "Ohne Fach";
      zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
    }
    return [...zaehler.entries()].sort((a, b) => a[0].localeCompare(b[0], "de"));
  }, [liste]);

  const offen = sichtbar.find((d) => d.id === offenId) ?? null;

  // --- Schreiben ----------------------------------------------------------

  function neu() {
    const e = leererEntwurf();
    if (fach && fach !== "Ohne Fach") e.kategorie = fach;
    setFormular({ id: null, entwurf: e });
    setFormFehler(null);
  }

  function bearbeiten(d: Dokument) {
    if (d.zu) return;
    setFormular({ id: d.id, entwurf: zumBearbeiten(d) });
    setFormFehler(null);
  }

  async function speichern() {
    if (!formular) return;
    const e = formular.entwurf;
    if (!e.titel.trim()) return setFormFehler("Bitte einen Titel angeben.");
    if (e.verschluesselt && !entsperrt)
      return setFormFehler("Zum Verschlüsseln muss der Tresor offen sein.");
    const key = entsperrt ? holeSchluessel() : null;
    // Wird die Verschluesselung umgestellt, muessen die ANHAENGENDEN DATEIEN
    // mit. Sonst behauptet der Eintrag, verschluesselt zu sein, waehrend seine
    // Dateien im Klartext liegen — und beim naechsten Oeffnen scheitert das
    // Entschluesseln. Der Server kann das nicht tun, er kennt den Schluessel
    // nicht; also laeuft es hier, Datei fuer Datei.
    const alt = formular.id == null ? null : liste.find((d) => d.id === formular.id);
    const wechsel = alt != null && !!alt.verschluesselt !== e.verschluesselt && alt.dateien.length > 0;
    if (wechsel && !entsperrt)
      return setFormFehler("Zum Umstellen der Dateien muss der Tresor offen sein.");
    try {
      if (wechsel) {
        setLaeuft(
          alt!.dateien.length === 1
            ? "Die Datei wird umgestellt…"
            : `${alt!.dateien.length} Dateien werden umgestellt…`
        );
        await dateienUmschluesseln(alt!.id, alt!.dateien, !!alt!.verschluesselt, e.verschluesselt, key);
      }
      const nutzlast = await zumSenden({ ...e, titel: e.titel.trim() }, key);
      if (formular.id == null) {
        const { id } = await dk.anlegenRoh(nutzlast);
        setOffenId(id);
      } else {
        await dk.aendernRoh(formular.id, nutzlast);
      }
      setFormular(null);
      setFormFehler(null);
      await laden(papierkorb);
      flash(formular.id == null ? "Dokument angelegt." : "Dokument geändert.");
    } catch (err) {
      setFormFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setLaeuft(null);
    }
  }

  async function loeschen(d: Dokument) {
    const endgueltig = papierkorb;
    const ok = await confirm({
      title: endgueltig ? "Endgültig löschen" : "In den Papierkorb",
      message: endgueltig
        ? `„${d.titel || OHNE_TITEL}" mit allen Dateien unwiderruflich löschen?`
        : `„${d.titel || OHNE_TITEL}" in den Papierkorb legen? Von dort ist es 30 Tage lang zurückholbar.`,
      confirmLabel: endgueltig ? "Löschen" : "In den Papierkorb",
      danger: true,
    });
    if (!ok) return;
    await dk.loeschen(d.id, endgueltig);
    if (offenId === d.id) setOffenId(null);
    await laden(papierkorb);
    flash(endgueltig ? "Endgültig gelöscht." : "In den Papierkorb gelegt.");
  }

  async function zurueckholen(d: Dokument) {
    await dk.zurueck(d.id);
    await laden(papierkorb);
    flash("Zurückgeholt.");
  }

  async function papierkorbLeeren() {
    const ok = await confirm({
      title: "Papierkorb leeren",
      message: `${liste.length} ${liste.length === 1 ? "Dokument" : "Dokumente"} mit allen Dateien unwiderruflich löschen?`,
      confirmLabel: "Leeren", danger: true,
    });
    if (!ok) return;
    await dk.papierkorbLeeren();
    await laden(true);
    flash("Papierkorb geleert.");
  }

  // --- Dateien ------------------------------------------------------------

  async function dateienAnhaengen(d: Dokument, dateien: FileList | null) {
    if (!dateien || dateien.length === 0) return;
    const chiffriert = !!d.verschluesselt;
    if (chiffriert && !entsperrt) return flash("Der Tresor ist verschlossen.");
    const key = entsperrt ? holeSchluessel() : null;
    let gezaehlt = 0;
    for (const datei of Array.from(dateien)) {
      if (datei.size > MAX_DATEI_BYTES) {
        flash(`„${datei.name}" ist größer als 64 MB und wurde übersprungen.`);
        continue;
      }
      try {
        await dateiHochladen(d.id, datei, chiffriert, key);
        gezaehlt++;
      } catch (err) {
        flash(err instanceof Error ? err.message : `„${datei.name}" ließ sich nicht hochladen.`);
      }
    }
    if (dateiFeld.current) dateiFeld.current.value = "";
    if (gezaehlt > 0) {
      await laden(papierkorb);
      flash(gezaehlt === 1 ? "Datei hinzugefügt." : `${gezaehlt} Dateien hinzugefügt.`);
    }
  }

  /**
   * Dateien ablegen: fuer jede entsteht ein eigenes Dokument, das gleich im
   * richtigen Fach liegt.
   *
   * Welches Fach, entscheidet der Ort, an dem losgelassen wird — auf einem
   * Fach in der Spalte ist es dieses, sonst das gerade gewaehlte. „Alle" und
   * „Ohne Fach" heissen: noch kein Fach, und das ist eine gueltige Antwort.
   * Nachtragen kann man es immer.
   *
   * Neue Eintraege sind NICHT verschluesselt, auch bei offenem Tresor.
   * Verschluesseln ist eine Entscheidung pro Schriftstueck und darf nicht
   * davon abhaengen, ob der Tresor beim Ablegen zufaellig offen stand.
   */
  async function ablegen(dateien: FileList | File[] | null, zielFach?: string) {
    const stapel = dateien ? Array.from(dateien) : [];
    if (stapel.length === 0) return;
    const gewaehlt = zielFach ?? fach ?? "";
    const kategorie = gewaehlt === "Ohne Fach" ? "" : gewaehlt;

    let gezaehlt = 0;
    let letzte: number | null = null;
    for (const [i, datei] of stapel.entries()) {
      setLaeuft(stapel.length === 1 ? `„${datei.name}" wird abgelegt…` : `Datei ${i + 1} von ${stapel.length}…`);
      try {
        letzte = await dokumentAusDatei(datei, kategorie, false, null);
        gezaehlt++;
      } catch (err) {
        flash(err instanceof Error ? err.message : `„${datei.name}" ließ sich nicht ablegen.`);
      }
    }
    setLaeuft(null);
    if (ablegeFeld.current) ablegeFeld.current.value = "";
    if (gezaehlt === 0) return;
    if (gezaehlt === 1 && letzte != null) setOffenId(letzte);
    await laden(papierkorb);
    const wo = kategorie ? ` in „${kategorie}"` : "";
    flash(gezaehlt === 1 ? `Abgelegt${wo}.` : `${gezaehlt} Dokumente abgelegt${wo}.`);
  }

  /** Zieht jemand Dateien (und nicht Text) über die Seite? */
  const sindDateien = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  function ueberZiel(e: React.DragEvent, ziel: string) {
    if (papierkorb || !sindDateien(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setUeber(ziel);
  }

  function abgelegt(e: React.DragEvent, zielFach?: string) {
    if (papierkorb || !sindDateien(e)) return;
    e.preventDefault();
    setUeber(null);
    ablegen(e.dataTransfer.files, zielFach);
  }

  async function dateiLoeschen(d: Dokument, f: Datei) {
    const ok = await confirm({
      title: "Datei entfernen",
      message: `„${f.name}" aus „${d.titel || OHNE_TITEL}" entfernen? Die Datei selbst ist danach weg.`,
      confirmLabel: "Entfernen", danger: true,
    });
    if (!ok) return;
    await dk.dateiLoeschen(f.id);
    await laden(papierkorb);
  }

  // --- Anzeige ------------------------------------------------------------

  const zugeschlossen = liste.filter((d) => d.zu).length;

  return (
    <>
      <div className="dk-leiste">
        <div className="suchfeld dk-suche">
          <Icon name="suchen" />
          <input
            placeholder="Titel, Fach, Schlagwort, Ablageort…"
            value={suchtext}
            onChange={(e) => setSuchtext(e.target.value)}
            aria-label="Dokumente durchsuchen"
          />
          {suchtext && (
            <button className="icon-btn" onClick={() => setSuchtext("")} aria-label="Suche leeren">
              <Icon name="schliessen" />
            </button>
          )}
        </div>
        <button
          className={`btn ghost ${papierkorb ? "an" : ""}`}
          onClick={() => { setPapierkorb(!papierkorb); setOffenId(null); setFach(null); }}
        >
          <Icon name="archiv" /> {papierkorb ? "zurück zur Ablage" : "Papierkorb"}
        </button>
        {papierkorb
          ? liste.length > 0 && (
              <button className="btn ghost danger" onClick={papierkorbLeeren}>
                <Icon name="loeschen" /> Papierkorb leeren
              </button>
            )
          : (
            <>
              <label className="btn ghost dk-ablegen">
                <Icon name="anhang" /> Dateien ablegen
                <input
                  ref={ablegeFeld}
                  type="file"
                  multiple
                  onChange={(e) => ablegen(e.target.files)}
                />
              </label>
              <button className="btn" onClick={neu}><Icon name="plus" /> Dokument</button>
            </>
          )}
      </div>

      {laeuft && <div className="dk-laeuft" role="status">{laeuft}</div>}

      {zugeschlossen > 0 && !papierkorb && (
        <div className="panel dk-warnung">
          <span>
            <Icon name="schloss" /> {zugeschlossen}{" "}
            {zugeschlossen === 1 ? "Dokument ist verschlüsselt" : "Dokumente sind verschlüsselt"}
            {" "}— Titel, Notiz und Dateien bleiben zu, bis der Tresor offen ist.
          </span>
          <Aufschliessen hinweis="" />
        </div>
      )}

      <div className="dk-raster">
        <nav className="dk-faecher" aria-label="Fächer">
          <button
            className={`${fach === null ? "an" : ""} ${ueber === "" ? "ziel" : ""}`}
            onClick={() => setFach(null)}
            onDragOver={(e) => ueberZiel(e, "")}
            onDragLeave={() => setUeber(null)}
            onDrop={(e) => abgelegt(e, "")}
          >
            <span>Alle</span><em>{liste.length}</em>
          </button>
          {faecher.map(([name, anzahl]) => (
            <button
              key={name}
              className={`${fach === name ? "an" : ""} ${ueber === name ? "ziel" : ""}`}
              onClick={() => setFach(name)}
              // Eine Datei auf ein Fach zu ziehen ist die kuerzeste Fassung von
              // „leg das hier ab" — kuerzer als jedes Formular.
              onDragOver={(e) => ueberZiel(e, name)}
              onDragLeave={() => setUeber(null)}
              onDrop={(e) => abgelegt(e, name)}
            >
              <span>{name}</span><em>{anzahl}</em>
            </button>
          ))}
          {faecher.length === 0 && <p className="empty">noch keine Fächer</p>}
        </nav>

        <div
          className={`dk-liste ${ueber === "liste" ? "ziel" : ""}`}
          onDragOver={(e) => ueberZiel(e, "liste")}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setUeber(null); }}
          onDrop={(e) => abgelegt(e)}
        >
          {ueber === "liste" && (
            <p className="dk-zielhinweis">
              Loslassen{fach && fach !== "Ohne Fach" ? ` — landet in „${fach}"` : ""}
            </p>
          )}
          {roh === null && <p className="empty">lädt…</p>}
          {roh !== null && sichtbar.length === 0 && (
            <p className="empty">
              {papierkorb
                ? "Der Papierkorb ist leer."
                : liste.length === 0
                  ? "Noch nichts abgelegt. Zieh eine Datei hierher, oder leg einen Eintrag an, der nur aufs Papier verweist."
                  : "Nichts gefunden."}
            </p>
          )}

          {sichtbar.map((d) => {
            const auf = offenId === d.id;
            const status = ablaufStatus(d);
            return (
              <div className={`panel dk-karte ${auf ? "auf" : ""}`} key={d.id}>
                <div className="dk-kopf" onClick={() => setOffenId(auf ? null : d.id)} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOffenId(auf ? null : d.id); } }}>
                  <span className="dk-titel">
                    {d.zu ? <em className="dk-zu"><Icon name="schloss" /> Verschlüsseltes Dokument</em>
                      : d.defekt ? <em className="dk-zu">— nicht lesbar —</em>
                      : (d.titel || OHNE_TITEL)}
                  </span>
                  <span className="dk-marken">
                    {d.kategorie && <span className="dk-fach">{d.kategorie}</span>}
                    {!!d.verschluesselt && !d.zu && (
                      <span className="dk-schloss" title="verschlüsselt"><Icon name="schloss" /></span>
                    )}
                    {d.dateien.length > 0 && (
                      <span className="dk-dateizahl" title={`${d.dateien.length} Datei(en)`}>
                        <Icon name="anhang" /> {d.dateien.length}
                      </span>
                    )}
                    {status && (
                      <span className={`dk-ablauf ${status}`}>{ablaufText(d)}</span>
                    )}
                  </span>
                  <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
                    {papierkorb ? (
                      <button className="icon-btn" title="Zurückholen" onClick={() => zurueckholen(d)}>
                        <Icon name="zurueckholen" />
                      </button>
                    ) : (
                      <button className="icon-btn" title="Bearbeiten" disabled={d.zu} onClick={() => bearbeiten(d)}>
                        <Icon name="bearbeiten" />
                      </button>
                    )}
                    <button className="icon-btn danger" title={papierkorb ? "Endgültig löschen" : "In den Papierkorb"} onClick={() => loeschen(d)}>
                      <Icon name="loeschen" />
                    </button>
                  </span>
                </div>

                {auf && (
                  <div className="dk-detail">
                    {d.zu ? (
                      <Aufschliessen hinweis="Dieses Dokument ist verschlüsselt. Zum Ansehen den Tresor aufschließen." />
                    ) : (
                      <>
                        <dl className="dk-daten">
                          {d.ablageort && (
                            <><dt>Wo es liegt</dt><dd>{d.ablageort}</dd></>
                          )}
                          {d.datum && <><dt>Ausgestellt</dt><dd>{datumDe(d.datum)}</dd></>}
                          {d.ablauf && (
                            <>
                              <dt>Gültig bis</dt>
                              <dd>
                                {datumDe(d.ablauf)}
                                <em> · Erinnerung {d.vorwarn_tage ?? VORWARN_STANDARD} Tage vorher</em>
                              </dd>
                            </>
                          )}
                          <><dt>Abgelegt</dt><dd>{datumDe(d.created_at.slice(0, 10))}</dd></>
                        </dl>

                        {d.notiz && <p className="dk-notiz">{d.notiz}</p>}

                        {schlagwortListe(d.schlagworte).length > 0 && (
                          <div className="dk-worte">
                            {schlagwortListe(d.schlagworte).map((w) => (
                              <button key={w} className="dk-wort" onClick={() => setSuchtext(w)}>#{w}</button>
                            ))}
                          </div>
                        )}

                        <ul className="dk-dateien">
                          {d.dateien.map((f) => (
                            <li key={f.id}>
                              <Icon name={f.typ.startsWith("image/") ? "bild" : "dokument"} />
                              <button
                                className="dk-dateiname"
                                onClick={() => setVorschau({ datei: f, chiffriert: !!d.verschluesselt })}
                                title={istVorschaubar(f.typ) ? "Ansehen" : "Herunterladen"}
                              >
                                {f.name}
                              </button>
                              <span className="dk-dateigroesse">{groesseText(f.groesse)}</span>
                              {!papierkorb && (
                                <button className="icon-btn danger" title="Datei entfernen" onClick={() => dateiLoeschen(d, f)}>
                                  <Icon name="loeschen" />
                                </button>
                              )}
                            </li>
                          ))}
                          {d.dateien.length === 0 && (
                            <li className="empty">Keine Datei — dieser Eintrag verweist nur aufs Papier.</li>
                          )}
                        </ul>

                        {!papierkorb && (
                          <label className="btn ghost small dk-anhaengen">
                            <Icon name="plus" /> Datei hinzufügen
                            <input
                              ref={dateiFeld}
                              type="file"
                              multiple
                              onChange={(e) => dateienAnhaengen(d, e.target.files)}
                            />
                          </label>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {formular && (
        <Modal
          title={formular.id == null ? "Neues Dokument" : "Dokument bearbeiten"}
          onClose={() => { setFormular(null); setFormFehler(null); }}
        >
          <Formular
            entwurf={formular.entwurf}
            kategorien={kategorien}
            entsperrt={entsperrt}
            aendern={(patch) => {
              setFormular({ ...formular, entwurf: { ...formular.entwurf, ...patch } });
              setFormFehler(null);
            }}
          />
          {formFehler && <div className="form-error" role="alert"><Icon name="warnung" /> {formFehler}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => { setFormular(null); setFormFehler(null); }}>Abbrechen</button>
            <button className="btn" onClick={speichern}>Speichern</button>
          </div>
        </Modal>
      )}

      {vorschau && (
        <Vorschau
          datei={vorschau.datei}
          chiffriert={vorschau.chiffriert}
          schluessel={entsperrt ? holeSchluessel() : null}
          onClose={() => setVorschau(null)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

/** Das Formular selbst — ausgelagert, weil die Ansicht sonst nicht mehr zu lesen ist. */
function Formular({
  entwurf, kategorien, entsperrt, aendern,
}: {
  entwurf: Entwurf;
  kategorien: string[];
  entsperrt: boolean;
  aendern: (patch: Partial<Entwurf>) => void;
}) {
  return (
    <div className="meter-modal-fields dk-formular">
      <label>Titel
        <input
          value={entwurf.titel}
          onChange={(e) => aendern({ titel: e.target.value })}
          placeholder="Kfz-Versicherung 2026"
          autoFocus
        />
      </label>

      <div className="dk-zeile">
        <label>Fach
          <input
            value={entwurf.kategorie}
            onChange={(e) => aendern({ kategorie: e.target.value })}
            list="dk-kategorien"
            placeholder="Versicherung"
          />
          <datalist id="dk-kategorien">
            {kategorien.map((k) => <option key={k} value={k} />)}
          </datalist>
        </label>
        <label>Schlagworte
          <input
            value={entwurf.schlagworte}
            onChange={(e) => aendern({ schlagworte: e.target.value })}
            placeholder="wichtig, 2026"
          />
        </label>
      </div>

      <label>Wo das Papier liegt
        <input
          value={entwurf.ablageort}
          onChange={(e) => aendern({ ablageort: e.target.value })}
          placeholder="Ordner 3, Register Versicherungen"
        />
      </label>

      <div className="dk-zeile">
        <label>Ausgestellt am
          <input type="date" value={entwurf.datum} onChange={(e) => aendern({ datum: e.target.value })} />
        </label>
        <label>Gültig bis
          <input type="date" value={entwurf.ablauf} onChange={(e) => aendern({ ablauf: e.target.value })} />
        </label>
      </div>

      {entwurf.ablauf && (
        <label>Erinnerung — wie viele Tage vorher
          <input
            type="number" min={0} max={365}
            value={entwurf.vorwarn_tage}
            onChange={(e) => aendern({ vorwarn_tage: Number(e.target.value) })}
          />
        </label>
      )}

      <label>Notiz
        <textarea
          rows={3}
          value={entwurf.notiz}
          onChange={(e) => aendern({ notiz: e.target.value })}
          placeholder="Was man dazu wissen muss."
        />
      </label>

      <label className="kopf-schalter">
        <input
          type="checkbox"
          checked={entwurf.verschluesselt}
          disabled={!entsperrt && !entwurf.verschluesselt}
          onChange={(e) => aendern({ verschluesselt: e.target.checked })}
        />
        <span>
          Verschlüsseln
          <em>
            {entsperrt
              ? "Titel, Ablageort, Notiz und alle Dateien werden mit dem Tresor-Schlüssel verschlüsselt. Fach, Schlagworte und Daten bleiben lesbar — sonst könnte die Ablage nichts mehr anzeigen, solange der Tresor zu ist."
              : "Dafür muss der Tresor offen sein."}
          </em>
        </span>
      </label>
    </div>
  );
}
