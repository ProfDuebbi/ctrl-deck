import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gb, MONATE, wannText, type Geburtstag } from "./api";
import { useConfirm } from "../../core/ui";
import { Icon } from "../../core/Icon";

const leeresFormular = () => ({ name: "", tag: "", monat: "", jahr: "", verstorben: "", notiz: "" });

export function View() {
  const confirm = useConfirm();
  const [liste, setListe] = useState<Geburtstag[]>([]);
  const [form, setForm] = useState(leeresFormular());
  const [editId, setEditId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [zeigeGedenken, setZeigeGedenken] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };
  const laden = useCallback(() => gb.list().then(setListe), []);
  useEffect(() => { laden(); }, [laden]);

  const sichtbar = useMemo(
    () => liste.filter((g) => zeigeGedenken || !g.verstorben),
    [liste, zeigeGedenken]
  );

  const naechste = useMemo(
    () => [...sichtbar].sort((a, b) => a.tageBis - b.tageBis).slice(0, 5),
    [sichtbar]
  );

  const nachMonat = useMemo(() => {
    const m = new Map<number, Geburtstag[]>();
    for (const g of sichtbar) {
      if (!m.has(g.monat)) m.set(g.monat, []);
      m.get(g.monat)!.push(g);
    }
    for (const l of m.values()) l.sort((a, b) => a.tag - b.tag);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [sichtbar]);

  const upd = (patch: Partial<ReturnType<typeof leeresFormular>>) => {
    setForm({ ...form, ...patch });
    setFormError(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { setFormError("Bitte einen Namen angeben."); nameRef.current?.focus(); return; }
    const tag = Number(form.tag);
    const monat = Number(form.monat);
    if (!(tag >= 1 && tag <= 31)) return setFormError("Der Tag muss zwischen 1 und 31 liegen.");
    if (!(monat >= 1 && monat <= 12)) return setFormError("Bitte einen Monat auswählen.");
    // Der 31. Februar existiert nicht — Date rollt sonst still in den März.
    if (new Date(2024, monat - 1, tag).getMonth() !== monat - 1)
      return setFormError(`Den ${tag}. gibt es im ${MONATE[monat - 1]} nicht.`);

    const payload = {
      name, tag, monat,
      jahr: form.jahr ? Number(form.jahr) : null,
      verstorben: form.verstorben ? Number(form.verstorben) : null,
      notiz: form.notiz || null,
    };
    if (editId != null) await gb.update(editId, payload);
    else await gb.create(payload);
    setForm(leeresFormular());
    setEditId(null);
    setFormError(null);
    await laden();
    flash(editId != null ? "Eintrag aktualisiert." : `„${name}" hinzugefügt.`);
  }

  function edit(g: Geburtstag) {
    setEditId(g.id);
    setFormError(null);
    setForm({
      name: g.name, tag: String(g.tag), monat: String(g.monat),
      jahr: g.jahr ? String(g.jahr) : "",
      verstorben: g.verstorben ? String(g.verstorben) : "",
      notiz: g.notiz ?? "",
    });
    nameRef.current?.focus();
  }

  async function loeschen(g: Geburtstag) {
    const ok = await confirm({
      title: "Eintrag löschen",
      message: `„${g.name}" wirklich aus dem Kalender löschen?`,
      confirmLabel: "Löschen", danger: true,
    });
    if (!ok) return;
    await gb.remove(g.id);
    await laden();
    flash("Eintrag gelöscht.");
  }

  return (
    <div className="module-view">
      {/* Die nächsten Termine */}
      <div className="panel">
        <div className="panel-head">
          <h3>Als Nächstes</h3>
          <label className="check-lbl">
            <input type="checkbox" checked={zeigeGedenken} onChange={(e) => setZeigeGedenken(e.target.checked)} />
            Gedenktage anzeigen
          </label>
        </div>
        <ul className="gb-naechste">
          {naechste.map((g) => (
            <li key={g.id} className={`gb-next ${g.tageBis === 0 ? "heute" : ""} ${g.verstorben ? "gedenken" : ""}`}>
              <span className="gb-datum">{g.tag}. {MONATE[g.monat - 1].slice(0, 3)}</span>
              <span className="gb-name">
                {g.verstorben && <span className="gb-kreuz" title={`verstorben ${g.verstorben}`}>†</span>}
                {g.name}
              </span>
              {g.alter != null && !g.verstorben && <span className="gb-alter">wird {g.alter}</span>}
              <span className="gb-wann">{wannText(g.tageBis)}</span>
            </li>
          ))}
          {naechste.length === 0 && <li className="empty">Keine Einträge.</li>}
        </ul>
      </div>

      {/* Eingabe */}
      <form className={`entry-form ${formError ? "has-error" : ""}`} onSubmit={submit} noValidate>
        <input ref={nameRef} placeholder="Name" value={form.name} onChange={(e) => upd({ name: e.target.value })} style={{ minWidth: 160 }} />
        <input type="number" min="1" max="31" placeholder="Tag" value={form.tag} onChange={(e) => upd({ tag: e.target.value })} style={{ maxWidth: 90 }} />
        <select value={form.monat} onChange={(e) => upd({ monat: e.target.value })} title="Monat">
          <option value="">— Monat —</option>
          {MONATE.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" placeholder="Geburtsjahr" value={form.jahr} onChange={(e) => upd({ jahr: e.target.value })} style={{ maxWidth: 130 }} />
        <input type="number" placeholder="verstorben" title="Todesjahr — macht den Termin zum Gedenktag" value={form.verstorben} onChange={(e) => upd({ verstorben: e.target.value })} style={{ maxWidth: 120 }} />
        <input className="wide" placeholder="Notiz" value={form.notiz} onChange={(e) => upd({ notiz: e.target.value })} />
        <button className="btn" type="submit">{editId != null ? "Speichern" : <><Icon name="plus" /> Hinzufügen</>}</button>
        {editId != null && (
          <button type="button" className="btn ghost" onClick={() => { setEditId(null); setFormError(null); setForm(leeresFormular()); }}>
            Abbrechen
          </button>
        )}
      </form>
      {formError && <div className="form-error" role="alert"><Icon name="warnung" /> {formError}</div>}

      {/* Jahreskalender */}
      {nachMonat.map(([monat, eintraege]) => (
        <div className="panel" key={monat}>
          <div className="panel-head">
            <h3>{MONATE[monat - 1]} <span className="panel-sub">{eintraege.length}</span></h3>
          </div>
          <ul className="gb-liste">
            {eintraege.map((g) => (
              <li key={g.id} className={`gb-zeile ${g.verstorben ? "gedenken" : ""}`}>
                <span className="gb-tag">{g.tag}.</span>
                <span className="gb-name">
                  {g.verstorben && <span className="gb-kreuz" title={`verstorben ${g.verstorben}`}>†</span>}
                  {g.name}
                </span>
                <span className="gb-jahr">{g.jahr ?? ""}</span>
                <span className="gb-notiz">{g.notiz === "aus altem Kalender übernommen" ? "" : g.notiz}</span>
                <span className="cell-actions">
                  <button className="icon-btn" title="Bearbeiten" onClick={() => edit(g)}><Icon name="bearbeiten" /></button>
                  <button className="icon-btn danger" title="Löschen" onClick={() => loeschen(g)}><Icon name="loeschen" /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {nachMonat.length === 0 && <p className="empty">Noch keine Geburtstage erfasst.</p>}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
