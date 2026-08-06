import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hh, euro, parseBetrag, MONATE, type Vorschlaege,
  type Buchung, heuteLokal as heute,
} from "./api";
import { useConfirm } from "../../core/ui";
import { Icon } from "../../core/Icon";
import { useKategorien, useKonten } from "./auswahl";


const leeresFormular = () => ({
  datum: heute(), art: "ausgang" as "eingang" | "ausgang", betrag: "",
  kategorie: "", empfaenger: "", konto: "", notiz: "",
});

/** Einnahmen und Ausgaben eines Monats erfassen. */
export function Buchungen() {
  const konten = useKonten();
  const kategorien = useKategorien();
  const confirm = useConfirm();
  const [anker, setAnker] = useState(() => new Date());
  const [rows, setRows] = useState<Buchung[]>([]);
  const [form, setForm] = useState(leeresFormular());
  const [editId, setEditId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Vorschlaege kommen aus den eigenen Buchungen — nach jeder Aenderung neu,
  // damit ein gerade erfasster Empfaenger beim naechsten Mal schon dasteht.
  const [vorschlaege, setVorschlaege] = useState<Vorschlaege>({ empfaenger: [], kategorien: [], konten: [] });
  const datumRef = useRef<HTMLInputElement>(null);
  const betragRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const { from, to, label } = useMemo(() => {
    const j = anker.getFullYear();
    const m = anker.getMonth();
    const p = (n: number) => String(n).padStart(2, "0");
    const letzter = new Date(j, m + 1, 0).getDate();
    return { from: `${j}-${p(m + 1)}-01`, to: `${j}-${p(m + 1)}-${p(letzter)}`, label: `${MONATE[m]} ${j}` };
  }, [anker]);

  const laden = useCallback(() => hh.buchungen(from, to).then(setRows), [from, to]);
  useEffect(() => { laden(); }, [laden]);
  useEffect(() => {
    hh.vorschlaege().then(setVorschlaege).catch(() => { /* Vorschlaege sind Kuer */ });
  }, [rows]);

  const summe = useMemo(() => {
    const ein = rows.filter((r) => r.art === "eingang").reduce((s, r) => s + r.betrag, 0);
    const aus = rows.filter((r) => r.art === "ausgang").reduce((s, r) => s + r.betrag, 0);
    return { ein, aus, diff: ein - aus };
  }, [rows]);

  const upd = (patch: Partial<ReturnType<typeof leeresFormular>>) => {
    setForm({ ...form, ...patch });
    setFormError(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (datumRef.current?.validity.badInput)
      { setFormError("Das Datum ist unvollständig — bitte Tag, Monat und Jahr angeben."); datumRef.current.focus(); return; }
    if (!form.datum) { setFormError("Bitte ein Datum angeben."); datumRef.current?.focus(); return; }
    const betrag = parseBetrag(form.betrag);
    if (!Number.isFinite(betrag) || betrag <= 0) {
      setFormError("Bitte einen Betrag größer als 0 angeben.");
      betragRef.current?.focus();
      return;
    }
    const payload = {
      datum: form.datum, art: form.art, betrag,
      kategorie: form.kategorie || null, empfaenger: form.empfaenger || null,
      konto: form.konto || null, notiz: form.notiz || null,
    };
    if (editId != null) await hh.updateBuchung(editId, payload);
    else await hh.createBuchung(payload);
    setForm({ ...leeresFormular(), art: form.art, konto: form.konto });
    setEditId(null);
    setFormError(null);
    await laden();
    flash(editId != null ? "Buchung aktualisiert." : `${euro(betrag)} gebucht.`);
  }

  function edit(b: Buchung) {
    setEditId(b.id);
    setFormError(null);
    setForm({
      datum: b.datum, art: b.art, betrag: String(b.betrag).replace(".", ","),
      kategorie: b.kategorie ?? "", empfaenger: b.empfaenger ?? "",
      konto: b.konto ?? "", notiz: b.notiz ?? "",
    });
    datumRef.current?.focus();
  }

  async function loeschen(b: Buchung) {
    const ok = await confirm({
      title: "Buchung löschen",
      message: `${euro(b.betrag)} vom ${b.datum} wirklich löschen?`,
      confirmLabel: "Löschen", danger: true,
    });
    if (!ok) return;
    await hh.removeBuchung(b.id);
    await laden();
    flash("Buchung gelöscht.");
  }

  const blaettern = (n: number) => setAnker(new Date(anker.getFullYear(), anker.getMonth() + n, 1));
  const istDieserMonat =
    anker.getFullYear() === new Date().getFullYear() && anker.getMonth() === new Date().getMonth();

  return (
    <>
      <div className="view-toolbar">
        <div className="week-nav">
          <button className="icon-btn" onClick={() => blaettern(-1)} aria-label="Vorheriger Monat"><Icon name="zurueck" /></button>
          <span className="week-label">{label}</span>
          <button className="icon-btn" onClick={() => blaettern(1)} aria-label="Nächster Monat"><Icon name="vor" /></button>
          {!istDieserMonat && <button className="btn ghost small" onClick={() => setAnker(new Date())}>heute</button>}
        </div>
        <div className="buch-summen">
          <span className="bs ein">+ {euro(summe.ein)}</span>
          <span className="bs aus">− {euro(summe.aus)}</span>
          <span className={`bs diff ${summe.diff < 0 ? "minus" : ""}`}>= {euro(summe.diff)}</span>
        </div>
      </div>

      <form className={`entry-form ${formError ? "has-error" : ""}`} onSubmit={submit} noValidate>
        <div className="art-wahl">
          <button type="button" className={`seg-btn ${form.art === "ausgang" ? "aktiv aus" : ""}`} onClick={() => upd({ art: "ausgang" })}>Ausgabe</button>
          <button type="button" className={`seg-btn ${form.art === "eingang" ? "aktiv ein" : ""}`} onClick={() => upd({ art: "eingang" })}>Einnahme</button>
        </div>
        <input ref={datumRef} type="date" title="Datum" value={form.datum} onChange={(e) => upd({ datum: e.target.value })} />
        <input ref={betragRef} placeholder="Betrag €" value={form.betrag} onChange={(e) => upd({ betrag: e.target.value })} style={{ maxWidth: 110 }} inputMode="decimal" />
        <input placeholder="Empfänger" value={form.empfaenger} onChange={(e) => upd({ empfaenger: e.target.value })} list="hh-empfaenger" style={{ minWidth: 150 }} />
        <select value={form.kategorie} onChange={(e) => upd({ kategorie: e.target.value })} title="Kategorie">
          <option value="">— Kategorie —</option>
          {kategorien.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={form.konto} onChange={(e) => upd({ konto: e.target.value })} title="Konto">
          <option value="">— Konto —</option>
          {konten.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input className="wide" placeholder="Notiz" value={form.notiz} onChange={(e) => upd({ notiz: e.target.value })} />
        <button className="btn" type="submit">{editId != null ? "Speichern" : <><Icon name="plus" /> Buchen</>}</button>
        {editId != null && (
          <button type="button" className="btn ghost" onClick={() => { setEditId(null); setFormError(null); setForm(leeresFormular()); }}>
            Abbrechen
          </button>
        )}
      </form>
      {formError && <div className="form-error" role="alert"><Icon name="warnung" /> {formError}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Datum</th><th>Betrag</th><th>Empfänger</th><th>Kategorie</th><th>Konto</th><th>Notiz</th><th>Aktionen</th></tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>{b.datum}</td>
                <td className={`buch-betrag ${b.art}`}>{b.art === "eingang" ? "+" : "−"} {euro(b.betrag)}</td>
                <td>{b.empfaenger ?? "–"}</td>
                <td>{b.kategorie ?? "–"}</td>
                <td>{b.konto ?? "–"}</td>
                <td className="cell-note">{b.notiz}</td>
                <td className="cell-actions">
                  <button className="icon-btn" title="Bearbeiten" onClick={() => edit(b)}><Icon name="bearbeiten" /></button>
                  <button className="icon-btn danger" title="Löschen" onClick={() => loeschen(b)}><Icon name="loeschen" /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">In {label} wurde noch nichts gebucht.</td></tr>}
          </tbody>
        </table>
      </div>

      <datalist id="hh-empfaenger">
        {vorschlaege.empfaenger.map((e) => <option key={e} value={e} />)}
      </datalist>

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
