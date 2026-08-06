import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  su, fmtHM, fmtClock, mondayOf, addDays, addMonths, localDate, minutesBetween,
  spanne, monatKurz,
  type TimeEntry, type Status, type Project, type Stats, type VerlaufRow, type Zeitraum,
} from "./api";
import { ProjectsModal } from "./Projects";
import { useConfirm } from "../../core/ui";
import { Icon } from "../../core/Icon";

const QUELLE_LABEL: Record<string, string> = { stempel: "Stempel", manuell: "Manuell", uebertrag: "Übertrag" };

/** Frisches Formular. Als Funktion, damit das Datum auch dann stimmt, wenn die
 *  App ueber Mitternacht offen bleibt — sonst klebt es am Ladetag fest. */
const leeresFormular = (projektId = "") => ({
  datum: localDate(new Date()), von: "", bis: "", dauer: "", notiz: "", projektId,
});

export function View() {
  const confirm = useConfirm();
  const [art, setArt] = useState<Zeitraum>("woche");
  const [anker, setAnker] = useState<Date>(() => new Date());
  const [filterProjekt, setFilterProjekt] = useState<number | null>(null);

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [verlauf, setVerlauf] = useState<VerlaufRow[]>([]);
  const [status, setStatus] = useState<Status>({ running: false, since: null, elapsedMin: 0, projektId: null });

  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState(leeresFormular());
  const [editId, setEditId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [zeigeProjekte, setZeigeProjekte] = useState(false);
  const [stempelProjekt, setStempelProjekt] = useState<string>("");

  const datumRef = useRef<HTMLInputElement>(null);
  const vonRef = useRef<HTMLInputElement>(null);
  const bisRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const { from, to, label } = useMemo(() => spanne(art, anker), [art, anker]);

  const reloadEntries = useCallback(
    () => su.entries(from, to, filterProjekt).then(setEntries),
    [from, to, filterProjekt]
  );
  const reloadStats = useCallback(() => su.stats(from, to).then(setStats), [from, to]);
  const reloadVerlauf = useCallback(
    () => su.verlauf(filterProjekt).then(setVerlauf),
    [filterProjekt]
  );
  const reloadProjects = useCallback(() => su.projects(true).then(setProjects), []);
  const reloadStatus = useCallback(() => su.status().then(setStatus), []);

  useEffect(() => { reloadEntries(); reloadStats(); }, [reloadEntries, reloadStats]);
  useEffect(() => { reloadVerlauf(); }, [reloadVerlauf]);
  useEffect(() => { reloadProjects(); }, [reloadProjects]);
  useEffect(() => {
    reloadStatus();
    const s = setInterval(reloadStatus, 20000); // gelegentlich mit Server abgleichen
    const t = setInterval(() => setTick((x) => x + 1), 1000); // Sekundentakt fuer Live-Timer
    return () => { clearInterval(s); clearInterval(t); };
  }, [reloadStatus]);

  // Das zuletzt gestempelte Projekt als Vorauswahl — meistens macht man weiter.
  useEffect(() => {
    if (stempelProjekt || projects.length === 0) return;
    const aktiv = projects.filter((p) => !p.archiviert);
    if (aktiv.length) setStempelProjekt(String(status.projektId ?? aktiv[0].id));
  }, [projects, status.projektId, stempelProjekt]);

  // Auch das Formular startet auf dem naheliegendsten Projekt statt auf "ohne".
  // Nur einmalig — eine spaetere bewusste Wahl von "ohne Projekt" bleibt stehen.
  const formVorbelegt = useRef(false);
  useEffect(() => {
    if (formVorbelegt.current || projects.length === 0) return;
    const aktiv = projects.filter((p) => !p.archiviert);
    if (!aktiv.length) return;
    formVorbelegt.current = true;
    setForm((f) => (f.projektId ? f : { ...f, projektId: String(aktiv[0].id) }));
  }, [projects]);

  const aktiveProjekte = useMemo(() => projects.filter((p) => !p.archiviert), [projects]);
  const summeMin = useMemo(() => entries.reduce((s, e) => s + e.minuten, 0), [entries]);
  const laufendesProjekt = projects.find((p) => p.id === status.projektId) ?? null;
  const liveSec = status.running && status.since ? Math.max(0, Math.floor((Date.now() - status.since) / 1000)) : 0;
  void tick; // erzwingt Re-Render im Sekundentakt

  const alles = async () => { await Promise.all([reloadEntries(), reloadStats(), reloadVerlauf(), reloadProjects()]); };

  // --- Stempeluhr ---------------------------------------------------------

  async function punch() {
    if (status.running) {
      const r = await su.punchOut();
      await Promise.all([reloadStatus(), alles()]);
      flash(`Ausgestempelt: ${fmtHM(r.minuten)} erfasst.`);
    } else {
      await su.punchIn(Number(stempelProjekt) || null);
      await reloadStatus();
      const p = projects.find((x) => x.id === Number(stempelProjekt));
      flash(p ? `Eingestempelt auf ${p.name}.` : "Eingestempelt. Die Zeit läuft.");
    }
  }

  async function wechsle(projektId: number) {
    const r = await su.punchSwitch(projektId);
    setStempelProjekt(String(projektId));
    await Promise.all([reloadStatus(), alles()]);
    const p = projects.find((x) => x.id === projektId);
    flash(r.vorher ? `${fmtHM(r.vorher.minuten)} gebucht — weiter auf ${p?.name}.` : `Eingestempelt auf ${p?.name}.`);
  }

  // --- Formular -----------------------------------------------------------

  const upd = (patch: Partial<typeof form>) => { setForm({ ...form, ...patch }); setFormError(null); };
  const fail = (msg: string, el?: HTMLInputElement | null) => { setFormError(msg); el?.focus(); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    // Ein nur teilweise ausgefuelltes date/time-Feld liefert value === "": das Feld
    // sieht gefuellt aus, der Code bekommt aber nichts. Ohne diese Pruefung waere
    // der Klick auf "Hinzufuegen" wirkungslos, ohne dass jemand merkt warum.
    if (datumRef.current?.validity.badInput)
      return fail("Das Datum ist unvollständig — bitte Tag, Monat und Jahr angeben.", datumRef.current);
    if (!form.datum) return fail("Bitte ein Datum angeben.", datumRef.current);

    const vonBad = !!vonRef.current?.validity.badInput;
    const bisBad = !!bisRef.current?.validity.badInput;
    if (vonBad || bisBad)
      return fail("Die Uhrzeit ist unvollständig — bitte Stunde und Minute angeben.", vonBad ? vonRef.current : bisRef.current);

    if (form.von && !form.bis) return fail("Es fehlt die Uhrzeit bei „bis“.", bisRef.current);
    if (!form.von && form.bis) return fail("Es fehlt die Uhrzeit bei „von“.", vonRef.current);

    let minuten: number;
    if (form.von && form.bis) {
      const dauer = minutesBetween(form.von, form.bis);
      if (dauer == null) return fail("„von“ und „bis“ sind identisch — das ergibt keine Dauer.", bisRef.current);
      minuten = dauer;
    } else {
      if (!form.dauer.trim()) return fail("Bitte von und bis angeben — oder eine Dauer in Minuten.", vonRef.current);
      minuten = Number(form.dauer);
      if (!Number.isFinite(minuten) || minuten <= 0) return fail("Die Dauer muss eine Zahl größer als 0 sein.");
    }

    const payload = {
      datum: form.datum,
      start: form.von || null,
      ende: form.bis || null,
      minuten: Math.round(minuten),
      notiz: form.notiz || null,
      projektId: Number(form.projektId) || null,
    };
    if (editId != null) await su.update(editId, payload);
    else await su.create(payload);
    setForm(leeresFormular(form.projektId)); // Projekt bleibt stehen
    setEditId(null);
    setFormError(null);
    await alles();
    flash(editId != null ? "Eintrag aktualisiert." : `Eintrag gespeichert: ${fmtHM(Math.round(minuten))}.`);
  }

  function edit(r: TimeEntry) {
    setEditId(r.id);
    setFormError(null);
    setForm({
      datum: r.datum,
      von: r.start ?? "",
      bis: r.ende ?? "",
      dauer: r.start && r.ende ? "" : String(r.minuten),
      notiz: r.notiz ?? "",
      projektId: r.projekt_id ? String(r.projekt_id) : "",
    });
    datumRef.current?.focus();
  }

  async function del(id: number) {
    const ok = await confirm({ title: "Eintrag löschen", message: "Diesen Zeiteintrag wirklich löschen?", confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    await su.remove(id);
    await alles();
    flash("Eintrag gelöscht.");
  }

  // --- Navigation ---------------------------------------------------------

  const blaettern = (richtung: number) =>
    setAnker(art === "monat" ? addMonths(anker, richtung) : addDays(anker, richtung * 7));
  const istJetzt =
    art === "gesamt" ||
    (art === "woche"
      ? localDate(mondayOf(anker)) === localDate(mondayOf(new Date()))
      : anker.getFullYear() === new Date().getFullYear() && anker.getMonth() === new Date().getMonth());

  const maxVerlauf = Math.max(1, ...verlauf.map((v) => v.minuten));

  return (
    <div className="module-view">
      {/* Stempeluhr */}
      <div className={`punch-card ${status.running ? "running" : ""}`}>
        <div className="punch-info">
          <span className="punch-state">
            {status.running ? <><span className="live-dot" /> {laufendesProjekt?.name ?? "Eingestempelt"}</> : "Ausgestempelt"}
          </span>
          <span className="punch-timer">{status.running ? fmtClock(liveSec) : "00:00:00"}</span>
        </div>
        <div className="punch-controls">
          {!status.running && (
            <select
              className="proj-select"
              value={stempelProjekt}
              onChange={(e) => setStempelProjekt(e.target.value)}
              title="Projekt"
            >
              <option value="">— ohne Projekt —</option>
              {aktiveProjekte.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button className={`btn punch-btn ${status.running ? "stop" : ""}`} onClick={punch}>
            {status.running ? <><Icon name="stopp" /> Ausstempeln</> : <><Icon name="abspielen" /> Einstempeln</>}
          </button>
        </div>
      </div>

      {/* Laufendes Projekt wechseln, ohne aus- und wieder einzustempeln */}
      {status.running && aktiveProjekte.length > 1 && (
        <div className="switch-bar">
          <span className="switch-lbl">Wechseln zu:</span>
          {aktiveProjekte
            .filter((p) => p.id !== status.projektId)
            .map((p) => (
              <button key={p.id} className={`chip p-${p.farbe}`} onClick={() => wechsle(p.id)}>
                {p.name}
              </button>
            ))}
        </div>
      )}

      {/* Zeitraum + Summe */}
      <div className="view-toolbar">
        <div className="zeitraum-wahl">
          {(["woche", "monat", "gesamt"] as Zeitraum[]).map((z) => (
            <button
              key={z}
              className={`seg-btn ${art === z ? "aktiv" : ""}`}
              onClick={() => { setArt(z); setAnker(new Date()); }}
            >
              {z === "woche" ? "Woche" : z === "monat" ? "Monat" : "Gesamt"}
            </button>
          ))}
        </div>
        {art !== "gesamt" && (
          <div className="week-nav">
            <button className="icon-btn" onClick={() => blaettern(-1)} aria-label="Vorherige Woche"><Icon name="zurueck" /></button>
            <span className="week-label">{label}</span>
            <button className="icon-btn" onClick={() => blaettern(1)} aria-label="Nächste Woche"><Icon name="vor" /></button>
            {!istJetzt && <button className="btn ghost small" onClick={() => setAnker(new Date())}>heute</button>}
          </div>
        )}
        <div className="week-sum">
          {filterProjekt ? projects.find((p) => p.id === filterProjekt)?.name : "Gesamt"}:{" "}
          <strong className="grad">{fmtHM(summeMin)}</strong>
          {status.running && <span className="week-live"> + läuft {fmtClock(liveSec)}</span>}
        </div>
      </div>

      {/* Auswertung: wo steckt die Zeit? */}
      <div className="panel proj-uebersicht">
        <div className="panel-head">
          <h3>Zeit je Projekt <span className="panel-sub">({label})</span></h3>
          <button className="btn ghost small" onClick={() => setZeigeProjekte(true)}>Projekte verwalten</button>
        </div>
        {stats && stats.proProjekt.length > 0 ? (
          <ul className="proj-balken">
            {stats.proProjekt.map((s) => {
              const max = Math.max(...stats.proProjekt.map((x) => x.minuten), 1);
              const aktiv = filterProjekt === s.id;
              return (
                <li key={s.id}>
                  <button
                    className={`balken-zeile ${aktiv ? "aktiv" : ""}`}
                    title={aktiv ? "Filter aufheben" : `Nur ${s.name} anzeigen`}
                    onClick={() => setFilterProjekt(aktiv ? null : s.id)}
                  >
                    <span className="balken-name">
                      <span className={`proj-punkt p-${s.farbe}`} />
                      {s.name}
                    </span>
                    <span className="balken-spur">
                      <span className={`balken-fuell p-${s.farbe}`} style={{ width: `${(s.minuten / max) * 100}%` }} />
                    </span>
                    <span className="balken-wert">{fmtHM(s.minuten)}</span>
                  </button>
                </li>
              );
            })}
            {stats.ohneProjekt.minuten > 0 && (
              <li className="ohne-projekt">
                ohne Projekt: {fmtHM(stats.ohneProjekt.minuten)} ({stats.ohneProjekt.eintraege} Einträge)
              </li>
            )}
          </ul>
        ) : (
          <p className="empty">In diesem Zeitraum wurde nichts erfasst.</p>
        )}
      </div>

      {/* Verlauf ueber Monate */}
      {verlauf.length > 1 && (
        <div className="panel">
          <div className="panel-head">
            <h3>
              Verlauf{" "}
              <span className="panel-sub">
                {filterProjekt ? projects.find((p) => p.id === filterProjekt)?.name : "alle Projekte"} · pro Monat
              </span>
            </h3>
          </div>
          <div className="verlauf">
            {verlauf.map((v) => (
              <div key={v.monat} className="verlauf-saeule" title={`${monatKurz(v.monat)}: ${fmtHM(v.minuten)}`}>
                <div className="verlauf-bar" style={{ height: `${Math.max(4, (v.minuten / maxVerlauf) * 100)}%` }} />
                <span className="verlauf-lbl">{monatKurz(v.monat)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manueller Eintrag */}
      <form className={`entry-form ${formError ? "has-error" : ""}`} onSubmit={submit} noValidate>
        <input ref={datumRef} type="date" title="Datum" value={form.datum} onChange={(e) => upd({ datum: e.target.value })} />
        <input ref={vonRef} type="time" title="von" value={form.von} onChange={(e) => upd({ von: e.target.value })} />
        <input ref={bisRef} type="time" title="bis" value={form.bis} onChange={(e) => upd({ bis: e.target.value })} />
        <input type="number" min="1" placeholder="oder Dauer (Min)" value={form.dauer} onChange={(e) => upd({ dauer: e.target.value })} style={{ maxWidth: 140 }} />
        <select title="Projekt" value={form.projektId} onChange={(e) => upd({ projektId: e.target.value })}>
          <option value="">— ohne Projekt —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.archiviert ? " (Archiv)" : ""}</option>
          ))}
        </select>
        <input className="wide" placeholder="Notiz — woran hast du gearbeitet?" value={form.notiz} onChange={(e) => upd({ notiz: e.target.value })} />
        <button className="btn" type="submit">{editId != null ? "Speichern" : <><Icon name="plus" /> Hinzufügen</>}</button>
        {editId != null && (
          <button type="button" className="btn ghost" onClick={() => { setEditId(null); setFormError(null); setForm(leeresFormular(form.projektId)); }}>
            Abbrechen
          </button>
        )}
      </form>
      {formError && <div className="form-error" role="alert"><Icon name="warnung" /> {formError}</div>}

      {/* Tabelle */}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Datum</th><th>Start</th><th>Ende</th><th>Dauer</th><th>Projekt</th><th>Quelle</th><th>Notiz</th><th>Aktionen</th></tr>
          </thead>
          <tbody>
            {entries.map((r) => (
              <tr key={r.id} className={r.quelle === "uebertrag" ? "rest-row" : ""}>
                <td>{r.datum}</td>
                <td>{r.start ?? "–"}</td>
                <td>{r.ende ?? "–"}</td>
                <td>{fmtHM(r.minuten)}</td>
                <td>
                  {r.projektName
                    ? <span className={`chip p-${r.projektFarbe ?? "blue"}`}>{r.projektName}</span>
                    : <span className="text-faint">–</span>}
                </td>
                <td><span className={`q-badge q-${r.quelle}`}>{QUELLE_LABEL[r.quelle]}</span></td>
                <td className="cell-note">{r.notiz}</td>
                <td className="cell-actions">
                  <button className="icon-btn" title="Bearbeiten" onClick={() => edit(r)}><Icon name="bearbeiten" /></button>
                  <button className="icon-btn danger" title="Löschen" onClick={() => del(r.id)}><Icon name="loeschen" /></button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={8} className="empty">Keine Einträge in diesem Zeitraum.</td></tr>}
          </tbody>
        </table>
      </div>

      {zeigeProjekte && (
        <ProjectsModal
          projects={projects}
          onClose={() => setZeigeProjekte(false)}
          onChanged={alles}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
