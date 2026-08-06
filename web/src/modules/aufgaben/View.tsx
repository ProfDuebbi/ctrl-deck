import { useEffect, useState } from "react";
import { ag, dueLabel, WDH_LABEL, type Task, type Prio, type Wdh } from "./api";
import { useConfirm } from "../../core/ui";
import { notificationsSupported, notifPermission, requestNotifPermission } from "./notify";
import { refreshDueCount } from "./dueStore";
import { Icon } from "../../core/Icon";

const emptyForm = () => ({
  titel: "",
  notiz: "",
  prioritaet: "normal" as Prio,
  faellig_datum: "",
  faellig_zeit: "",
  wiederholung: "einmalig" as Wdh,
});

export function View() {
  const confirm = useConfirm();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [editId, setEditId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [perm, setPerm] = useState(notifPermission());

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };
  const reload = () => ag.list().then((t) => { setTasks(t); refreshDueCount(); });

  useEffect(() => {
    reload();
  }, []);

  const open = tasks.filter((t) => !t.erledigt);
  const done = tasks.filter((t) => t.erledigt);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titel.trim()) return flash("Bitte einen Titel angeben.");
    if (form.faellig_zeit && !form.faellig_datum) return flash("Uhrzeit ohne Datum ist nicht möglich.");
    if (editId != null) await ag.update(editId, form);
    else await ag.create(form);
    setForm(emptyForm());
    setEditId(null);
    await reload();
    flash(editId != null ? "Aufgabe aktualisiert." : "Aufgabe hinzugefügt.");
  }

  function edit(t: Task) {
    setEditId(t.id);
    setForm({
      titel: t.titel,
      notiz: t.notiz ?? "",
      prioritaet: t.prioritaet,
      faellig_datum: t.faellig_datum ?? "",
      faellig_zeit: t.faellig_zeit ?? "",
      wiederholung: t.wiederholung,
    });
  }

  async function complete(t: Task) {
    const r = await ag.done(t.id);
    await reload();
    flash(r.recurred ? `Erledigt — nächster Termin: ${r.next}` : "Aufgabe erledigt.");
  }

  async function reopen(id: number) {
    await ag.reopen(id);
    await reload();
  }

  async function remove(t: Task) {
    const ok = await confirm({ title: "Aufgabe löschen", message: `„${t.titel}" wirklich löschen?`, confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    await ag.remove(t.id);
    await reload();
    flash("Aufgabe gelöscht.");
  }

  async function enableNotifs() {
    const p = await requestNotifPermission();
    setPerm(p);
    if (p === "granted") flash("Desktop-Benachrichtigungen aktiviert.");
    else if (p === "denied") flash("Benachrichtigungen wurden im Browser blockiert.");
  }

  const row = (t: Task) => {
    const d = dueLabel(t);
    return (
      <div className={`task-row ${t.erledigt ? "done" : ""} prio-${t.prioritaet}`} key={t.id}>
        <button
          className={`task-check ${t.erledigt ? "on" : ""}`}
          title={t.erledigt ? "Wieder öffnen" : "Als erledigt markieren"}
          onClick={() => (t.erledigt ? reopen(t.id) : complete(t))}
        >
          {t.erledigt ? <Icon name="haken" /> : null}
        </button>
        <div className="task-main">
          <div className="task-titel">
            {t.titel}
            {t.prioritaet === "hoch" && !t.erledigt && <span className="prio-flag">!</span>}
          </div>
          {t.notiz && <div className="task-notiz">{t.notiz}</div>}
          <div className="task-meta">
            {d && <span className={`due-badge due-${d.state}`}><Icon name="glocke" /> {d.text}</span>}
            {t.wiederholung !== "einmalig" && <span className="wdh-badge"><Icon name="wiederholen" /> {WDH_LABEL[t.wiederholung]}</span>}
          </div>
        </div>
        <div className="task-actions">
          <button className="icon-btn" title="Bearbeiten" onClick={() => edit(t)}><Icon name="bearbeiten" /></button>
          <button className="icon-btn danger" title="Löschen" onClick={() => remove(t)}><Icon name="loeschen" /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="module-view">
      {notificationsSupported() && perm !== "granted" && (
        <div className="notif-hint">
          <span><Icon name="glocke" /> Für Desktop-Erinnerungen einmalig die Benachrichtigungen erlauben.</span>
          <button className="btn small" onClick={enableNotifs} disabled={perm === "denied"}>
            {perm === "denied" ? "Im Browser blockiert" : "Aktivieren"}
          </button>
        </div>
      )}

      <form className="entry-form" onSubmit={submit}>
        <input className="wide" placeholder="Neue Aufgabe…" value={form.titel} onChange={(e) => setForm({ ...form, titel: e.target.value })} />
        <select value={form.prioritaet} onChange={(e) => setForm({ ...form, prioritaet: e.target.value as Prio })} title="Priorität">
          <option value="hoch">Hoch</option>
          <option value="normal">Normal</option>
          <option value="niedrig">Niedrig</option>
        </select>
        <input type="date" title="Fällig am" value={form.faellig_datum} onChange={(e) => setForm({ ...form, faellig_datum: e.target.value })} />
        <input type="time" title="Uhrzeit (optional)" value={form.faellig_zeit} onChange={(e) => setForm({ ...form, faellig_zeit: e.target.value })} />
        <select value={form.wiederholung} onChange={(e) => setForm({ ...form, wiederholung: e.target.value as Wdh })} title="Wiederholung">
          <option value="einmalig">einmalig</option>
          <option value="taeglich">täglich</option>
          <option value="woechentlich">wöchentlich</option>
          <option value="monatlich">monatlich</option>
        </select>
        <input className="wide" placeholder="Notiz (optional)" value={form.notiz} onChange={(e) => setForm({ ...form, notiz: e.target.value })} />
        <button className="btn" type="submit">{editId != null ? "Speichern" : <><Icon name="plus" /> Hinzufügen</>}</button>
        {editId != null && (
          <button type="button" className="btn ghost" onClick={() => { setEditId(null); setForm(emptyForm()); }}>Abbrechen</button>
        )}
      </form>

      <div className="task-list">
        {open.length === 0 && <div className="empty" style={{ padding: 30 }}>Keine offenen Aufgaben. <Icon name="feiern" /></div>}
        {open.map(row)}
      </div>

      {done.length > 0 && (
        <div className="done-section">
          <button className="done-toggle" onClick={() => setShowDone((s) => !s)}>
            <span className={`stats-caret ${showDone ? "open" : ""}`}><Icon name="vor" /></span> Erledigt ({done.length})
          </button>
          {showDone && <div className="task-list">{done.map(row)}</div>}
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
