import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../core/Icon";
import { useConfirm } from "../../core/ui";
import { Einrichten, Entsperren, PasswortWechseln, SchluesselAnzeige } from "./Schloss";
import { wiederherstellungsSchluessel } from "./crypto";
import { holeSchluessel, sperren, useEntsperrt } from "./vault";
import { FRIST_SEKUNDEN, kopiereFluechtig, zwischenablageLeeren } from "./zwischenablage";
import { aktualisiereStatus } from "./statusStore";
import {
  anhangHochladen,
  anhangHolen,
  eintraegeLaden,
  eintragAnlegen,
  eintragSpeichern,
  groesseText,
  tr,
  type Anhang,
  type Eintrag,
  type EintragEingabe,
  type TresorMeta,
} from "./api";
import {
  anzeigeWert,
  KATEGORIEN,
  kategorieTitel,
  vorlage,
  VORLAGEN,
  type Kategorie,
  type Pruefergebnis,
} from "./vorlagen";

// --- Formular -------------------------------------------------------------

const leeresFormular = () => ({
  vorlage: "frei",
  titel: "",
  wert: "",
  notiz: "",
  kategorie: "sonstiges" as Kategorie,
  ablauf: "",
  vorwarn_tage: "60",
});
type Formular = ReturnType<typeof leeresFormular>;

/**
 * Angefangene, noch nicht gespeicherte Eingabe.
 *
 * Sie liegt bewusst AUSSERHALB der Komponente: Wenn die Leerlaufsperre
 * zuschlaegt oder man kurz in ein anderes Modul wechselt, wird die Ansicht
 * ausgehaengt — und mit ihr waere die halb getippte Nummer weg gewesen, ohne
 * Warnung, ohne Weg zurueck. Nur im Arbeitsspeicher, nie im localStorage: ein
 * Entwurf enthaelt Klartext.
 */
let entwurf: { form: Formular; editId: number | null } | null = null;
const entwurfLeer = (f: Formular) => !f.titel && !f.wert && !f.notiz && !f.ablauf;

/** Feste Punktzahl — die echte Laenge ist selbst schon eine Auskunft. */
const MASKE = "•".repeat(12);

const datumDe = (iso: string) => iso.split("-").reverse().join(".");

/** "läuft in 12 Tagen ab" — die Zahl allein sagt einem nichts. */
function ablaufText(tage: number): string {
  if (tage < 0) return `abgelaufen seit ${Math.abs(tage)} ${Math.abs(tage) === 1 ? "Tag" : "Tagen"}`;
  if (tage === 0) return "läuft heute ab";
  if (tage === 1) return "läuft morgen ab";
  if (tage <= 60) return `läuft in ${tage} Tagen ab`;
  const monate = Math.round(tage / 30);
  return monate < 24 ? `noch ${monate} Monate` : `noch ${Math.floor(monate / 12)} Jahre`;
}

// --- Ein Eintrag in der Liste --------------------------------------------

function EintragZeile({
  e, onBearbeiten, onLoeschen, onAnhang, onAnhangWeg, beschaeftigt, fehler,
}: {
  e: Eintrag;
  onBearbeiten: (e: Eintrag) => void;
  onLoeschen: (e: Eintrag) => void;
  onAnhang: (e: Eintrag, datei: File) => void;
  onAnhangWeg: (a: Anhang) => void;
  beschaeftigt: boolean;
  /** Fehler, der zu DIESER Zeile gehoert (z. B. ein gescheiterter Anhang). */
  fehler: string | null;
}) {
  const [offen, setOffen] = useState(false);
  const [kopiert, setKopiert] = useState(false);
  const [frist, setFrist] = useState(0);
  const letzteRegung = useRef(0);
  const dateiFeld = useRef<HTMLInputElement>(null);
  const v = vorlage(e.vorlage);

  // Ein aufgedeckter Wert deckt sich nach einer halben Minute wieder zu —
  // sonst steht die Steuer-ID noch offen auf dem Schirm, wenn Besuch kommt.
  // `frist` startet die Uhr neu, solange jemand an der Zeile arbeitet.
  useEffect(() => {
    if (!offen) return;
    const t = setTimeout(() => setOffen(false), 30_000);
    return () => clearTimeout(t);
  }, [offen, frist]);

  /**
   * Lebenszeichen an dieser Zeile. Wer die Nummer gerade abtippt, soll sie
   * nicht mitten im Satz verlieren. Hoechstens alle 5 s ein neuer Anlauf —
   * `pointermove` feuert sonst im Dutzend pro Sekunde und rendert die Liste tot.
   */
  function regung() {
    if (!offen) return;
    const jetzt = Date.now();
    if (jetzt - letzteRegung.current < 5000) return;
    letzteRegung.current = jetzt;
    setFrist((f) => f + 1);
  }

  async function kopieren() {
    try {
      await kopiereFluechtig(e.wert);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 4000);
    } catch {
      setOffen(true); // Zwischenablage verweigert — dann wenigstens zeigen
    }
  }

  async function herunterladen(a: Anhang) {
    const key = holeSchluessel();
    if (!key) return;
    const blob = await anhangHolen(key, a);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  if (e.defekt)
    return (
      <li className="tresor-eintrag defekt">
        <div className="tresor-kopf">
          <span className="tresor-titel">— nicht lesbar —</span>
          <span className="badge">defekt</span>
          <span className="cell-actions">
            <button className="icon-btn danger" title="Löschen" onClick={() => onLoeschen(e)}>
              <Icon name="loeschen" />
            </button>
          </span>
        </div>
        <p className="tresor-notiz">
          Dieser Eintrag lässt sich mit dem aktuellen Schlüssel nicht entschlüsseln.
        </p>
      </li>
    );

  return (
    <li className="tresor-eintrag" onPointerMove={regung} onFocusCapture={regung}>
      <div className="tresor-kopf">
        <span className="tresor-titel">{e.titel}</span>
        {e.vorlage !== "frei" && <span className="badge">{v.titel}</span>}
        {e.ablauf && e.tageBis != null && (
          <span
            className={`badge ${e.tageBis < 0 ? "abgelaufen" : e.tageBis <= e.vorwarn_tage ? "faellig" : ""}`}
            title={`gültig bis ${datumDe(e.ablauf)}`}
          >
            {ablaufText(e.tageBis)}
          </span>
        )}
        <span className="cell-actions">
          <button
            className="icon-btn"
            title={offen ? "Verbergen" : "Aufdecken"}
            aria-pressed={offen}
            onClick={() => setOffen(!offen)}
          >
            <Icon name={offen ? "auge-zu" : "auge"} />
          </button>
          <button className="icon-btn" title="Wert kopieren" onClick={kopieren}>
            <Icon name="kopieren" />
          </button>
          <button
            className="icon-btn"
            title="Datei anhängen"
            disabled={beschaeftigt}
            onClick={() => dateiFeld.current?.click()}
          >
            <Icon name="anhang" />
          </button>
          <button className="icon-btn" title="Bearbeiten" onClick={() => onBearbeiten(e)}>
            <Icon name="bearbeiten" />
          </button>
          <button className="icon-btn danger" title="Löschen" onClick={() => onLoeschen(e)}>
            <Icon name="loeschen" />
          </button>
        </span>
      </div>

      <div className={`tresor-wert ${offen ? "offen" : ""}`}>
        {offen ? (
          anzeigeWert(e.wert, e.vorlage)
        ) : (
          <>
            {/* Punkte sind fuer ein Vorleseprogramm nur Zeichensalat — der
                Zustand gehoert als Wort daneben, nicht als Symbol. */}
            <span aria-hidden="true">{MASKE}</span>
            <span className="sr-only">Wert verborgen</span>
          </>
        )}
        {kopiert && <span className="tresor-kopiert">kopiert · wird in {FRIST_SEKUNDEN} s geleert</span>}
      </div>

      {e.notiz && <p className="tresor-notiz">{e.notiz}</p>}
      {e.ablauf && <p className="tresor-notiz">gültig bis {datumDe(e.ablauf)}</p>}

      {/* Der Fehler steht an der Zeile, die ihn ausgeloest hat. Oben am
          Formular waere er bei einem Eintrag weit unten ausserhalb des Bildes. */}
      {fehler && <p className="tresor-zeilenfehler" role="alert"><Icon name="warnung" /> {fehler}</p>}

      {e.dateien.length > 0 && (
        <ul className="tresor-anhaenge">
          {e.dateien.map((a) => (
            <li key={a.id}>
              <button className="tresor-anhang" onClick={() => herunterladen(a)} title="Entschlüsseln und öffnen">
                <Icon name="dokument" /> {a.name}
                <span className="tresor-anhang-groesse">{groesseText(a.groesse)}</span>
              </button>
              <button className="icon-btn danger" title="Anhang löschen" onClick={() => onAnhangWeg(a)}>
                <Icon name="loeschen" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={dateiFeld}
        type="file"
        hidden
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          if (f) onAnhang(e, f);
          ev.target.value = "";
        }}
      />
    </li>
  );
}

// --- Der geoeffnete Tresor ------------------------------------------------

function Inhalt({
  meta, onMeta, notentsperrt,
}: { meta: TresorMeta; onMeta: (m: TresorMeta) => void; notentsperrt: boolean }) {
  const confirm = useConfirm();
  const [liste, setListe] = useState<Eintrag[] | null>(null);
  // Angefangene Eingabe ueberlebt Sperre und Modulwechsel (siehe `entwurf`).
  const [form, setForm] = useState<Formular>(() => entwurf?.form ?? leeresFormular());
  const [editId, setEditId] = useState<number | null>(() => entwurf?.editId ?? null);
  const [zeilenFehler, setZeilenFehler] = useState<{ id: number; text: string } | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [beschaeftigt, setBeschaeftigt] = useState(false);
  const [pwWechsel, setPwWechsel] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const titelFeld = useRef<HTMLInputElement>(null);
  const sucheFeld = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const laden = useCallback(async () => {
    const key = holeSchluessel();
    if (!key) return;
    setListe(await eintraegeLaden(key));
    aktualisiereStatus();
  }, []);

  useEffect(() => { laden(); }, [laden]);

  /**
   * Tastenkürzel. Zwei, mehr nicht — was man sich nicht merkt, existiert nicht.
   *
   * `/` springt in die Suche (wie in vielen Werkzeugen), `Strg+Umschalt+L`
   * sperrt. Bewusst NICHT `Strg+L` (das gehört dem Browser, es fokussiert die
   * Adresszeile) und nicht `Esc` (das schließt hier Dialoge; ein Tresor, der
   * beim Wegklicken eines Dialogs zufällt, wäre eine Falle).
   */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const ziel = ev.target as HTMLElement | null;
      const imFeld = !!ziel && /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName);
      if (ev.key === "/" && !imFeld && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        ev.preventDefault();
        sucheFeld.current?.focus();
        sucheFeld.current?.select();
      } else if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === "l") {
        ev.preventDefault();
        zwischenablageLeeren();
        sperren();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Entwurf mitschreiben, damit ein Aushängen der Ansicht nichts verschluckt.
  useEffect(() => {
    entwurf = entwurfLeer(form) && editId === null ? null : { form, editId };
  }, [form, editId]);

  const v = vorlage(form.vorlage);
  const pruefung: Pruefergebnis | null = useMemo(
    () => (form.wert.trim() && v.pruefe ? v.pruefe(form.wert) : null),
    [form.wert, v]
  );

  const gefiltert = useMemo(() => {
    if (!liste) return [];
    const s = suche.trim().toLowerCase();
    if (!s) return liste;
    return liste.filter(
      (e) => e.titel.toLowerCase().includes(s) || e.notiz.toLowerCase().includes(s)
    );
  }, [liste, suche]);

  const nachKategorie = useMemo(() => {
    const m = new Map<string, Eintrag[]>();
    for (const e of gefiltert) {
      if (!m.has(e.kategorie)) m.set(e.kategorie, []);
      m.get(e.kategorie)!.push(e);
    }
    // Reihenfolge der Rubriken wie in KATEGORIEN, nicht wie zufaellig eingetippt.
    const bekannt = KATEGORIEN.map((k) => k.id as string);
    const reihenfolge = [...bekannt, ...[...m.keys()].filter((k) => !bekannt.includes(k))];
    return reihenfolge
      .map((k) => [k, m.get(k) ?? []] as const)
      .filter(([, l]) => l.length > 0);
  }, [gefiltert]);

  function upd(patch: Partial<Formular>) {
    setForm((f) => ({ ...f, ...patch }));
    setFehler(null);
  }

  /** Vorlage gewechselt: Bezeichnung und Rubrik mitziehen, wenn nichts Eigenes drinsteht. */
  function vorlageWechseln(id: string) {
    const neu = vorlage(id);
    const alt = vorlage(form.vorlage);
    const titelBehalten = form.titel && form.titel !== alt.bezeichnung;
    setForm((f) => ({
      ...f,
      vorlage: id,
      titel: titelBehalten ? f.titel : neu.bezeichnung,
      kategorie: neu.kategorie,
    }));
    setFehler(null);
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const key = holeSchluessel();
    if (!key) return;
    const titel = form.titel.trim();
    const rohWert = form.wert.trim();
    if (!titel) { setFehler("Bitte eine Bezeichnung angeben."); titelFeld.current?.focus(); return; }
    if (!rohWert) { setFehler("Ohne Wert hat der Eintrag keinen Zweck."); return; }

    const eingabe: EintragEingabe = {
      titel,
      wert: v.normalisiere ? v.normalisiere(rohWert) : rohWert,
      notiz: form.notiz.trim(),
      kategorie: form.kategorie,
      vorlage: form.vorlage,
      ablauf: form.ablauf || null,
      vorwarn_tage: Number(form.vorwarn_tage) || 60,
    };

    setBeschaeftigt(true);
    try {
      if (editId != null) await eintragSpeichern(key, editId, eingabe);
      else await eintragAnlegen(key, eingabe);
      setForm(leeresFormular());
      setEditId(null);
      await laden();
      flash(editId != null ? "Eintrag aktualisiert." : `„${titel}" verschlüsselt abgelegt.`);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
    } finally {
      setBeschaeftigt(false);
    }
  }

  function bearbeiten(e: Eintrag) {
    setEditId(e.id);
    setFehler(null);
    setForm({
      vorlage: e.vorlage,
      titel: e.titel,
      wert: e.wert,
      notiz: e.notiz,
      kategorie: e.kategorie,
      ablauf: e.ablauf ?? "",
      vorwarn_tage: String(e.vorwarn_tage),
    });
    titelFeld.current?.focus();
    titelFeld.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async function loeschen(e: Eintrag) {
    const ok = await confirm({
      title: "Eintrag löschen",
      message: `„${e.defekt ? "nicht lesbarer Eintrag" : e.titel}" endgültig löschen?${
        e.dateien.length ? ` Die ${e.dateien.length} angehängten Dateien verschwinden mit.` : ""
      }`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await tr.remove(e.id);
    if (editId === e.id) { setEditId(null); setForm(leeresFormular()); }
    await laden();
    flash("Eintrag gelöscht.");
  }

  async function anhaengen(e: Eintrag, datei: File) {
    const key = holeSchluessel();
    if (!key) return;
    const melde = (text: string) => {
      setZeilenFehler({ id: e.id, text });
      setTimeout(() => setZeilenFehler((z) => (z?.id === e.id ? null : z)), 8000);
    };
    if (datei.size > 60 * 1024 * 1024) return melde("Die Datei ist größer als 60 MB.");
    setBeschaeftigt(true);
    setZeilenFehler(null);
    try {
      await anhangHochladen(key, e.id, datei);
      await laden();
      flash(`„${datei.name}" verschlüsselt angehängt.`);
    } catch (err) {
      melde(err instanceof Error ? err.message : "Anhang fehlgeschlagen.");
    } finally {
      setBeschaeftigt(false);
    }
  }

  async function anhangLoeschen(a: Anhang) {
    const ok = await confirm({
      title: "Anhang löschen",
      message: `„${a.name}" löschen?`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await tr.removeDatei(a.id);
    await laden();
    flash("Anhang gelöscht.");
  }

  async function schluesselZeigen() {
    const key = holeSchluessel();
    if (key) setRecovery(await wiederherstellungsSchluessel(key));
  }

  const anzahlDateien = liste?.reduce((n, e) => n + e.dateien.length, 0) ?? 0;

  return (
    <div className="module-view">
      {notentsperrt && (
        <div className="tresor-banner">
          <Icon name="warnung" />
          Mit dem Wiederherstellungsschlüssel entsperrt. Setz dir gleich ein neues Master-Passwort,
          sonst bleibt der Schlüssel der einzige Weg hinein.
          <button className="btn small" onClick={() => setPwWechsel(true)}>Passwort setzen</button>
        </div>
      )}

      <div className="view-toolbar">
        <div className="filter-bar">
          <input
            ref={sucheFeld}
            type="search"
            placeholder="Suchen  /"
            title="Bezeichnung und Notiz durchsuchen — Taste /"
            value={suche}
            onChange={(ev) => setSuche(ev.target.value)}
            onKeyDown={(ev) => {
              // Esc räumt das Feld, statt es nur zu verlassen.
              if (ev.key === "Escape" && suche) { ev.preventDefault(); setSuche(""); }
            }}
          />
        </div>
        <div className="toolbar-actions">
          <button className="btn ghost small" onClick={schluesselZeigen}>
            <Icon name="schluessel" /> Wiederherstellungsschlüssel
          </button>
          <button className="btn ghost small" onClick={() => setPwWechsel(true)}>
            Passwort ändern
          </button>
          <button
            className="btn small"
            title="Tresor sperren (Strg+Umschalt+L)"
            onClick={() => { zwischenablageLeeren(); sperren(); }}
          >
            <Icon name="schloss" /> Sperren
          </button>
        </div>
      </div>

      {/* Eingabe */}
      <form className={`entry-form tresor-form ${fehler ? "has-error" : ""}`} onSubmit={submit} noValidate>
        <select value={form.vorlage} onChange={(ev) => vorlageWechseln(ev.target.value)} title="Vorlage">
          {VORLAGEN.map((x) => <option key={x.id} value={x.id}>{x.titel}</option>)}
        </select>
        <input
          ref={titelFeld}
          placeholder="Bezeichnung"
          value={form.titel}
          onChange={(ev) => upd({ titel: ev.target.value })}
          style={{ minWidth: 170 }}
        />
        <input
          className="wide"
          placeholder={v.platzhalter}
          value={form.wert}
          onChange={(ev) => upd({ wert: ev.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
        <select
          value={form.kategorie}
          onChange={(ev) => upd({ kategorie: ev.target.value as Kategorie })}
          title="Rubrik"
        >
          {KATEGORIEN.map((k) => <option key={k.id} value={k.id}>{k.titel}</option>)}
        </select>
        <input
          type="date"
          title="Gültig bis (optional)"
          value={form.ablauf}
          onChange={(ev) => upd({ ablauf: ev.target.value })}
        />
        {form.ablauf && (
          <label className="feld-mit-label" title="Wie viele Tage vorher gewarnt wird">
            Warnung
            <input
              type="number"
              min="1"
              max="3650"
              value={form.vorwarn_tage}
              onChange={(ev) => upd({ vorwarn_tage: ev.target.value })}
              style={{ maxWidth: 80 }}
            />
            Tage
          </label>
        )}
        <input
          className="wide"
          placeholder="Notiz (optional)"
          value={form.notiz}
          onChange={(ev) => upd({ notiz: ev.target.value })}
        />
        <button className="btn" type="submit" disabled={beschaeftigt}>
          {editId != null ? "Speichern" : <><Icon name="plus" /> Ablegen</>}
        </button>
        {editId != null && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => { setEditId(null); setFehler(null); setForm(leeresFormular()); }}
          >
            Abbrechen
          </button>
        )}
      </form>

      {v.hinweis && <p className="tresor-vorlage-hinweis">{v.hinweis}</p>}
      {pruefung && (
        <p className={`tresor-pruefung ${pruefung.ok ? "ok" : "warn"}`}>
          <Icon name={pruefung.ok ? "haken" : "warnung"} /> {pruefung.text}
          {!pruefung.ok && <span className="tresor-pruefung-zusatz">Speichern geht trotzdem.</span>}
        </p>
      )}
      {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}

      {/* Liste */}
      {liste === null && <p className="empty">wird entschlüsselt…</p>}
      {liste !== null && liste.length === 0 && (
        <p className="empty">
          <Icon name="tresor" /> Noch nichts abgelegt. Steuer-ID, Sozialversicherungsnummer oder
          Ausweisnummer sind ein guter Anfang.
        </p>
      )}
      {liste !== null && liste.length > 0 && gefiltert.length === 0 && (
        <p className="empty">Nichts gefunden.</p>
      )}

      {nachKategorie.map(([kat, eintraege]) => (
        <div className="panel" key={kat}>
          <div className="panel-head">
            <h3>{kategorieTitel(kat)} <span className="panel-sub">{eintraege.length}</span></h3>
          </div>
          <ul className="tresor-liste">
            {eintraege.map((e) => (
              <EintragZeile
                key={e.id}
                e={e}
                beschaeftigt={beschaeftigt}
                fehler={zeilenFehler?.id === e.id ? zeilenFehler.text : null}
                onBearbeiten={bearbeiten}
                onLoeschen={loeschen}
                onAnhang={anhaengen}
                onAnhangWeg={anhangLoeschen}
              />
            ))}
          </ul>
        </div>
      ))}

      {anzahlDateien > 0 && (
        <p className="tresor-fussnote">
          <Icon name="anhang" /> Anhänge liegen verschlüsselt als Dateien unter <code>data/tresor/</code>
          und werden bei jeder Sicherung im Backup-Bereich mitgenommen.
        </p>
      )}

      {pwWechsel && holeSchluessel() && (
        <PasswortWechseln
          dek={holeSchluessel()!}
          meta={meta}
          onSchliessen={() => setPwWechsel(false)}
          onFertig={(m) => { onMeta(m); setPwWechsel(false); flash("Master-Passwort geändert."); }}
        />
      )}
      {recovery && <SchluesselAnzeige schluessel={recovery} onSchliessen={() => setRecovery(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// --- Einstieg -------------------------------------------------------------

export function View() {
  const entsperrt = useEntsperrt();
  // undefined = noch nicht geladen, null = noch nicht eingerichtet
  const [meta, setMeta] = useState<TresorMeta | null | undefined>(undefined);
  const [notentsperrt, setNotentsperrt] = useState(false);

  const holen = useCallback(() => {
    tr.meta().then((m) => setMeta(m.meta)).catch(() => setMeta(null));
  }, []);
  useEffect(() => { holen(); }, [holen]);

  if (meta === undefined) return <p className="empty">lädt…</p>;
  if (meta === null) return <Einrichten onFertig={setMeta} />;
  if (!entsperrt)
    return (
      <Entsperren
        meta={meta}
        onNotentsperrt={() => setNotentsperrt(true)}
        onZurueckgesetzt={() => { setMeta(null); setNotentsperrt(false); }}
      />
    );
  return <Inhalt meta={meta} onMeta={setMeta} notentsperrt={notentsperrt} />;
}
