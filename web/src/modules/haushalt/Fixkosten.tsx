import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hh, euro, monatsAnteil, datumLabel, vertragsText, heuteLokal, nachDringlichkeit,
  INTERVALLE, FRIST_EINHEITEN,
  type Fixkost, type Intervall, type Summary, type FristEinheit,
} from "./api";
// Bewusste Modul-Grenzüberschreitung: eine fällige Kündigung soll sich als
// echte Aufgabe mit Erinnerung eintragen lassen, statt nur hier zu stehen.
import { ag } from "../aufgaben/api";
import { useConfirm, Modal } from "../../core/ui";
import { Icon } from "../../core/Icon";
import { useKategorien, useKonten } from "./auswahl";

const leeresFormular = () => ({
  name: "", betrag: "", intervall: "monatlich" as Intervall,
  faellig: "", konto: "", kategorie: "", notiz: "",
});

/** Formularzustand des Vertrags-Modals — Zahlen als Text, damit Leeren möglich bleibt. */
type VertragForm = {
  pos: Fixkost;
  ende: string;
  wert: string;
  einheit: FristEinheit;
  verlaengerung: string;
};

/** N Tage vor dem Stichtag, aber nie in der Vergangenheit. */
function vorlauf(datum: string, tage: number): string {
  const [j, m, t] = datum.split("-").map(Number);
  const d = new Date(j, m - 1, t);
  d.setDate(d.getDate() - tage);
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return iso < heuteLokal() ? heuteLokal() : iso;
}

export function Fixkosten() {
  const konten = useKonten();
  const kategorien = useKategorien();
  const confirm = useConfirm();
  const [posten, setPosten] = useState<Fixkost[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [form, setForm] = useState(leeresFormular());
  const [editId, setEditId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const [vertragModal, setVertragModal] = useState<VertragForm | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const laden = useCallback(async () => {
    const [l, s] = await Promise.all([hh.list(), hh.summary()]);
    setPosten(l);
    setSummary(s);
  }, []);
  useEffect(() => { laden(); }, [laden]);

  const sichtbar = useMemo(
    () => posten.filter((p) => zeigeInaktive || p.aktiv),
    [posten, zeigeInaktive]
  );

  // Nach Kategorie gruppieren — so sieht man, wofuer das Geld weggeht.
  const gruppen = useMemo(() => {
    const map = new Map<string, Fixkost[]>();
    for (const p of sichtbar) {
      const k = p.kategorie || "ohne Kategorie";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return [...map.entries()].sort((a, b) => {
      const sa = a[1].reduce((s, x) => s + (x.aktiv ? monatsAnteil(x) : 0), 0);
      const sb = b[1].reduce((s, x) => s + (x.aktiv ? monatsAnteil(x) : 0), 0);
      return sb - sa;
    });
  }, [sichtbar]);

  const upd = (patch: Partial<ReturnType<typeof leeresFormular>>) => {
    setForm({ ...form, ...patch });
    setFormError(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { setFormError("Bitte einen Namen angeben."); nameRef.current?.focus(); return; }
    const betrag = Number(form.betrag.replace(",", "."));
    if (!Number.isFinite(betrag) || betrag < 0) {
      setFormError("Der Betrag muss eine Zahl sein — 0 ist erlaubt, wenn du ihn noch nicht kennst.");
      return;
    }
    // Vertragsdaten hängen nicht am Formular — beim Bearbeiten unbedingt
    // durchreichen, sonst löscht ein simples Umbenennen die Kündigungsfrist.
    const alt = editId != null ? posten.find((p) => p.id === editId) : null;
    const payload = {
      name, betrag, intervall: form.intervall,
      faellig: form.faellig || null, konto: form.konto || null,
      kategorie: form.kategorie || null, notiz: form.notiz || null,
      vertrag_ende: alt?.vertrag_ende ?? null,
      frist_wert: alt?.frist_wert ?? null,
      frist_einheit: alt?.frist_einheit ?? null,
      verlaengerung: alt?.verlaengerung ?? null,
    };
    if (editId != null) await hh.update(editId, { ...payload, aktiv: 1 });
    else await hh.create(payload);
    setForm(leeresFormular());
    setEditId(null);
    setFormError(null);
    await laden();
    flash(editId != null ? "Position aktualisiert." : `„${name}" hinzugefügt.`);
  }

  function edit(p: Fixkost) {
    setEditId(p.id);
    setFormError(null);
    setForm({
      name: p.name,
      betrag: p.betrag ? String(p.betrag).replace(".", ",") : "",
      intervall: p.intervall,
      faellig: p.faellig ?? "",
      konto: p.konto ?? "",
      kategorie: p.kategorie ?? "",
      notiz: p.notiz ?? "",
    });
    nameRef.current?.focus();
  }

  async function umschalten(p: Fixkost) {
    await hh.update(p.id, { ...p, aktiv: !p.aktiv });
    await laden();
  }

  async function loeschen(p: Fixkost) {
    const ok = await confirm({
      title: "Position löschen",
      message: `„${p.name}" wirklich aus den Fixkosten löschen?`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await hh.remove(p.id);
    await laden();
    flash("Position gelöscht.");
  }

  // --- Verträge ------------------------------------------------------------

  /** Alle aktiven Positionen mit Vertragsdaten, dringendste zuerst. */
  const vertraege = useMemo(
    () =>
      posten
        .filter((p) => p.aktiv && p.vertrag)
        .sort((a, b) => nachDringlichkeit(a.vertrag!, b.vertrag!)),
    [posten]
  );

  function openVertrag(p: Fixkost) {
    setVertragModal({
      pos: p,
      ende: p.vertrag_ende ?? "",
      wert: p.frist_wert != null ? String(p.frist_wert) : "3",
      einheit: p.frist_einheit ?? "monate",
      verlaengerung: p.verlaengerung != null ? String(p.verlaengerung) : "12",
    });
  }

  async function saveVertrag() {
    if (!vertragModal) return;
    const { pos, ende, wert, einheit, verlaengerung } = vertragModal;
    await hh.update(pos.id, {
      ...pos,
      vertrag_ende: ende || null,
      frist_wert: ende ? Number(wert) || null : null,
      frist_einheit: ende ? einheit : null,
      verlaengerung: ende ? Number(verlaengerung) || 0 : null,
    });
    setVertragModal(null);
    await laden();
    flash(ende ? `Vertragsdaten für „${pos.name}" gespeichert.` : "Vertragsdaten entfernt.");
  }

  /** Kündigungstermin als echte Aufgabe mit Erinnerung anlegen. */
  async function alsAufgabe(p: Fixkost) {
    const v = p.vertrag!;
    await ag.create({
      titel: `${p.name} kündigen`,
      notiz: `Kündigungsfrist läuft am ${datumLabel(v.kuendbarBis)} ab (Laufzeit bis ${datumLabel(v.laufzeitBis)}).`,
      faellig_datum: vorlauf(v.kuendbarBis, 7),
      prioritaet: "hoch",
      wiederholung: "einmalig",
    });
    flash(`Aufgabe angelegt — Erinnerung 7 Tage vor Fristende.`);
  }

  const maxKategorie = Math.max(1, ...(summary?.jeKategorie.map((k) => k.betrag) ?? [1]));

  return (
    <>
      {/* Kopfzahlen */}
      <div className="hh-kopf">
        <div className="hh-kachel gross">
          <span className="hh-lbl">Monatliche Fixkosten</span>
          <span className="hh-wert grad">{summary ? euro(summary.proMonat) : "—"}</span>
          <span className="hh-sub">{summary ? `${summary.anzahl} aktive Positionen` : ""}</span>
        </div>
        <div className="hh-kachel">
          <span className="hh-lbl">Im Jahr</span>
          <span className="hh-wert">{summary ? euro(summary.proJahr) : "—"}</span>
        </div>
        {summary && summary.ohneBetrag > 0 && (
          <div className="hh-kachel warn">
            <span className="hh-lbl">Betrag fehlt</span>
            <span className="hh-wert">{summary.ohneBetrag}</span>
            <span className="hh-sub">nicht in der Summe enthalten</span>
          </div>
        )}
      </div>

      {/* Verträge & Fristen — steht bewusst oben, das ist das Zeitkritische */}
      {vertraege.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>
              Verträge & Fristen <span className="panel-sub">dringendste zuerst</span>
            </h3>
          </div>
          <ul className="vertrag-liste">
            {vertraege.map((p) => (
              <li key={p.id} className={`vertrag-zeile ${p.vertrag!.status}`}>
                <span className="vertrag-name">{p.name}</span>
                <span className="vertrag-text">
                  {vertragsText(p.vertrag!)}
                  {p.vertrag!.verlaengert && (
                    <em title="Laufzeit wurde automatisch weitergerechnet"> · verlängert</em>
                  )}
                </span>
                <span className="cell-actions">
                  {(p.vertrag!.status === "dringend" || p.vertrag!.status === "bald") && (
                    <button className="btn ghost small" onClick={() => alsAufgabe(p)}>
                      <Icon name="wecker" /> Als Aufgabe
                    </button>
                  )}
                  <button className="icon-btn" title="Vertragsdaten bearbeiten" onClick={() => openVertrag(p)}><Icon name="bearbeiten" /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Verteilung */}
      {summary && summary.jeKategorie.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>Wofür <span className="panel-sub">Monatsanteil je Kategorie</span></h3>
          </div>
          <ul className="proj-balken">
            {summary.jeKategorie.map((k) => (
              <li key={k.name}>
                <div className="balken-zeile">
                  <span className="balken-name">{k.name}</span>
                  <span className="balken-spur">
                    <span className="balken-fuell hh-fuell" style={{ width: `${(k.betrag / maxKategorie) * 100}%` }} />
                  </span>
                  <span className="balken-wert">{euro(k.betrag)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary && summary.jeKonto.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>Von welchem Konto</h3>
          </div>
          <div className="konto-chips">
            {summary.jeKonto.map((k) => (
              <span key={k.name} className="konto-chip">
                {k.name} <strong>{euro(k.betrag)}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Eingabe */}
      <form className={`entry-form ${formError ? "has-error" : ""}`} onSubmit={submit} noValidate>
        <input ref={nameRef} placeholder="Name (z. B. Netflix)" value={form.name} onChange={(e) => upd({ name: e.target.value })} style={{ minWidth: 170 }} />
        <input placeholder="Betrag €" value={form.betrag} onChange={(e) => upd({ betrag: e.target.value })} style={{ maxWidth: 110 }} inputMode="decimal" />
        <select value={form.intervall} onChange={(e) => upd({ intervall: e.target.value as Intervall })} title="Intervall">
          {INTERVALLE.map((i) => <option key={i.wert} value={i.wert}>{i.label}</option>)}
        </select>
        <input placeholder="fällig (Tag/Monat)" value={form.faellig} onChange={(e) => upd({ faellig: e.target.value })} style={{ maxWidth: 150 }} list="hh-faellig" />
        <select value={form.konto} onChange={(e) => upd({ konto: e.target.value })} title="Konto">
          <option value="">— Konto —</option>
          {konten.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={form.kategorie} onChange={(e) => upd({ kategorie: e.target.value })} title="Kategorie">
          <option value="">— Kategorie —</option>
          {kategorien.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input className="wide" placeholder="Notiz" value={form.notiz} onChange={(e) => upd({ notiz: e.target.value })} />
        <button className="btn" type="submit">{editId != null ? "Speichern" : <><Icon name="plus" /> Hinzufügen</>}</button>
        {editId != null && (
          <button type="button" className="btn ghost" onClick={() => { setEditId(null); setFormError(null); setForm(leeresFormular()); }}>
            Abbrechen
          </button>
        )}
      </form>
      {formError && <div className="form-error" role="alert"><Icon name="warnung" /> {formError}</div>}

      <div className="view-toolbar">
        <label className="check-lbl">
          <input type="checkbox" checked={zeigeInaktive} onChange={(e) => setZeigeInaktive(e.target.checked)} />
          pausierte Positionen anzeigen
        </label>
      </div>

      {/* Liste nach Kategorie */}
      {gruppen.map(([kategorie, liste]) => (
        <div className="panel" key={kategorie}>
          <div className="panel-head">
            <h3>
              {kategorie}{" "}
              <span className="panel-sub">
                {euro(liste.reduce((s, x) => s + (x.aktiv ? monatsAnteil(x) : 0), 0))} / Monat
              </span>
            </h3>
          </div>
          <ul className="hh-liste">
            {liste.map((p) => (
              <li key={p.id} className={`hh-zeile ${p.aktiv ? "" : "pausiert"}`}>
                <span className="hh-name">
                  {p.name}
                  {p.betrag === 0 && p.aktiv ? <span className="hh-fehlt" title="Betrag noch nicht eingetragen">Betrag?</span> : null}
                </span>
                <span className="hh-betrag">{euro(p.betrag)}</span>
                <span className="hh-intervall">
                  {INTERVALLE.find((i) => i.wert === p.intervall)?.kurz}
                  {p.intervall !== "monatlich" && p.betrag > 0 && (
                    <em title="Monatsanteil"> ≙ {euro(monatsAnteil(p))}</em>
                  )}
                </span>
                <span className="hh-konto">{p.konto ?? "–"}</span>
                <span className="hh-faellig">{p.faellig ?? ""}</span>
                <span className="cell-actions">
                  <button
                    className={`icon-btn ${p.vertrag ? `vertrag-${p.vertrag.status}` : ""}`}
                    title={p.vertrag ? vertragsText(p.vertrag) : "Vertragslaufzeit & Kündigungsfrist"}
                    onClick={() => openVertrag(p)}
                  >
                    <Icon name="dokument" />
                  </button>
                  <button className="icon-btn" title={p.aktiv ? "Pausieren" : "Wieder aktivieren"} onClick={() => umschalten(p)}>
                    {p.aktiv ? <Icon name="pause" /> : <Icon name="abspielen" />}
                  </button>
                  <button className="icon-btn" title="Bearbeiten" onClick={() => edit(p)}><Icon name="bearbeiten" /></button>
                  <button className="icon-btn danger" title="Löschen" onClick={() => loeschen(p)}><Icon name="loeschen" /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {gruppen.length === 0 && <p className="empty">Noch keine Fixkosten erfasst.</p>}

      <datalist id="hh-faellig">
        {["1.", "15.", "Ende", "Januar", "Juli"].map((v) => <option key={v} value={v} />)}
      </datalist>

      {vertragModal && (
        <Modal title={`Vertrag — ${vertragModal.pos.name}`} onClose={() => setVertragModal(null)}>
          <div className="meter-modal-fields">
            <label>Laufzeit endet am
              <input
                type="date" aria-label="Vertragsende" value={vertragModal.ende}
                onChange={(e) => setVertragModal({ ...vertragModal, ende: e.target.value })}
                autoFocus
              />
            </label>
            <label>Kündigungsfrist
              <div className="frist-eingabe">
                <input
                  type="number" min={1} max={999} value={vertragModal.wert}
                  onChange={(e) => setVertragModal({ ...vertragModal, wert: e.target.value })}
                />
                <select
                  aria-label="Einheit der Kündigungsfrist"
                  value={vertragModal.einheit}
                  onChange={(e) => setVertragModal({ ...vertragModal, einheit: e.target.value as FristEinheit })}
                >
                  {FRIST_EINHEITEN.map((f) => <option key={f.wert} value={f.wert}>{f.label}</option>)}
                </select>
                <span>vor Laufzeitende</span>
              </div>
            </label>
            <label>Verlängert sich automatisch um (Monate)
              <input
                type="number" min={0} max={120} value={vertragModal.verlaengerung}
                onChange={(e) => setVertragModal({ ...vertragModal, verlaengerung: e.target.value })}
                placeholder="0 = keine automatische Verlängerung"
              />
            </label>
            <p className="modal-hinweis">
              Bei automatischer Verlängerung rechnet die App das Laufzeitende von selbst weiter —
              du trägst das Datum einmal ein und nie wieder. Datum leeren entfernt die Überwachung.
            </p>
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setVertragModal(null)}>Abbrechen</button>
            <button className="btn" onClick={saveVertrag}>Speichern</button>
          </div>
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
