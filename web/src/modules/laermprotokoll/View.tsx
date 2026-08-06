import { useEffect, useState } from "react";
import { lp, minutesBetween, type OwnEntry, type ForeignEntry, type Beteiligte } from "./api";
import { useConfirm, Modal } from "../../core/ui";
import { generateReport } from "./report";
import { Stats } from "./Stats";
import { Icon } from "../../core/Icon";

type Tab = "own" | "foreign";
const emptyOwn = { datum: "", start: "", ende: "", aktivitaet: "Musik", lautstaerke: "", bemerkung: "" };
const emptyForeign = { datum: "", uhrzeit: "", verursacher: "", art: "", bemerkung: "" };

export function View() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("own");
  const [own, setOwn] = useState<OwnEntry[]>([]);
  const [foreign, setForeign] = useState<ForeignEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [ownForm, setOwnForm] = useState({ ...emptyOwn });
  const [ownEditId, setOwnEditId] = useState<number | null>(null);
  const [forForm, setForForm] = useState({ ...emptyForeign });
  const [forEditId, setForEditId] = useState<number | null>(null);

  // Filter (gilt fuer den aktiven Tab)
  const [q, setQ] = useState("");
  const [dFrom, setDFrom] = useState("");
  const [dTo, setDTo] = useState("");

  // PDF-Bericht
  const [showReport, setShowReport] = useState(false);
  const [rFrom, setRFrom] = useState("");
  const [rTo, setRTo] = useState("");
  // Briefkopf des Berichts. Liegt serverseitig in den Einstellungen, damit er
  // nicht bei jedem Bericht neu getippt werden muss.
  const [beteiligte, setBeteiligte] = useState<Beteiligte>({ mieter: "", vermieter: "" });
  function openReportDialog() {
    lp.bericht().then(setBeteiligte).catch(() => { /* leerer Kopf ist erlaubt */ });
    setRFrom(dFrom);
    setRTo(dTo);
    setShowReport(true);
  }
  async function createReport() {
    // Angaben merken, bevor der Bericht aufgeht — sonst tippt man sie jedes Mal.
    try { await lp.setzeBericht(beteiligte); } catch { /* nicht schlimm */ }
    const ok = generateReport(own, foreign, { from: rFrom, to: rTo }, beteiligte);
    setShowReport(false);
    if (!ok) flash("Bitte Popups für diese Seite erlauben, dann erneut versuchen.");
  }
  const clearFilter = () => { setQ(""); setDFrom(""); setDTo(""); };
  const inRange = (datum: string) => (!dFrom || datum >= dFrom) && (!dTo || datum <= dTo);
  const matches = (datum: string, ...fields: (string | null)[]) => {
    if (!inRange(datum)) return false;
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
  };
  const filterActive = !!(q || dFrom || dTo);

  const ownFiltered = own.filter((r) => matches(r.datum, r.datum, r.aktivitaet, r.lautstaerke, r.bemerkung));
  const foreignFiltered = foreign.filter((r) => matches(r.datum, r.datum, r.verursacher, r.art, r.bemerkung));

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const reloadOwn = () => lp.listOwn().then(setOwn);
  const reloadForeign = () => lp.listForeign().then(setForeign);

  useEffect(() => {
    reloadOwn();
    reloadForeign();
  }, []);

  // --- Eigenes Protokoll ---------------------------------------------------
  async function submitOwn(e: React.FormEvent) {
    e.preventDefault();
    if (!ownForm.datum) return flash("Bitte ein Datum angeben.");
    const payload = {
      ...ownForm,
      dauer_min: minutesBetween(ownForm.start || null, ownForm.ende || null),
    };
    if (ownEditId != null) await lp.updateOwn(ownEditId, payload);
    else await lp.createOwn(payload);
    setOwnForm({ ...emptyOwn });
    setOwnEditId(null);
    await reloadOwn();
    flash(ownEditId != null ? "Eintrag aktualisiert." : "Eintrag gespeichert.");
  }

  function editOwn(r: OwnEntry) {
    setTab("own");
    setOwnEditId(r.id);
    setOwnForm({
      datum: r.datum,
      start: r.start ?? "",
      ende: r.ende ?? "",
      aktivitaet: r.aktivitaet,
      lautstaerke: r.lautstaerke ?? "",
      bemerkung: r.bemerkung ?? "",
    });
  }

  async function delOwn(id: number) {
    const ok = await confirm({ title: "Eintrag löschen", message: "Diesen Eintrag im eigenen Protokoll wirklich löschen?", confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    await lp.deleteOwn(id);
    await reloadOwn();
    flash("Eintrag gelöscht.");
  }

  // --- Fremdgeräusche ------------------------------------------------------
  async function submitForeign(e: React.FormEvent) {
    e.preventDefault();
    if (!forForm.datum) return flash("Bitte ein Datum angeben.");
    if (!forForm.verursacher) return flash("Bitte den Verursacher angeben.");
    if (forEditId != null) await lp.updateForeign(forEditId, forForm);
    else await lp.createForeign(forForm);
    setForForm({ ...emptyForeign });
    setForEditId(null);
    await reloadForeign();
    flash(forEditId != null ? "Vorfall aktualisiert." : "Vorfall gespeichert.");
  }

  function editForeign(r: ForeignEntry) {
    setTab("foreign");
    setForEditId(r.id);
    setForForm({
      datum: r.datum,
      uhrzeit: r.uhrzeit ?? "",
      verursacher: r.verursacher,
      art: r.art,
      bemerkung: r.bemerkung ?? "",
    });
  }

  async function delForeign(id: number) {
    const ok = await confirm({ title: "Vorfall löschen", message: "Diesen dokumentierten Vorfall wirklich löschen?", confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    await lp.deleteForeign(id);
    await reloadForeign();
    flash("Vorfall gelöscht.");
  }

  // --- Export ---------------------------------------------------------------
  async function doExport() {
    const r = await lp.export();
    flash(`Exportiert nach data\\exports\\ (2 Dateien).`);
    console.log("Export:", r.ownPath, r.forPath);
  }

  const filterBar = (count: number, total: number) => (
    <div className="filter-bar">
      <div className="suchfeld">
        <Icon name="suchen" />
        <input placeholder="Suche (Text, Verursacher, Bemerkung…)" aria-label="Suche" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <span className="filter-lbl">von</span>
      <input type="date" aria-label="Zeitraum von" value={dFrom} onChange={(e) => setDFrom(e.target.value)} />
      <span className="filter-lbl">bis</span>
      <input type="date" aria-label="Zeitraum bis" value={dTo} onChange={(e) => setDTo(e.target.value)} />
      {filterActive && <button className="filter-clear" onClick={clearFilter}>zurücksetzen</button>}
      <span className="filter-count">{filterActive ? `${count} von ${total}` : `${total} Einträge`}</span>
    </div>
  );

  return (
    <div className="module-view">
      <div className="view-toolbar">
        <div className="tabs">
          <button className={`tab ${tab === "own" ? "active" : ""}`} onClick={() => setTab("own")}>
            Eigenes Protokoll
          </button>
          <button className={`tab ${tab === "foreign" ? "active" : ""}`} onClick={() => setTab("foreign")}>
            Fremdgeräusche
          </button>
        </div>
        <div className="toolbar-actions">
          <button className="btn" onClick={openReportDialog}><Icon name="dokument" /> PDF-Bericht</button>
          <button className="btn ghost" onClick={doExport}><Icon name="export" /> TXT-Export</button>
        </div>
      </div>

      {tab === "own" ? (
        <>
          <form className="entry-form" onSubmit={submitOwn}>
            <input type="date" aria-label="Datum" value={ownForm.datum} onChange={(e) => setOwnForm({ ...ownForm, datum: e.target.value })} />
            <input type="time" title="Start" value={ownForm.start} onChange={(e) => setOwnForm({ ...ownForm, start: e.target.value })} />
            <input type="time" title="Ende" value={ownForm.ende} onChange={(e) => setOwnForm({ ...ownForm, ende: e.target.value })} />
            <input placeholder="Aktivität" value={ownForm.aktivitaet} onChange={(e) => setOwnForm({ ...ownForm, aktivitaet: e.target.value })} />
            <input placeholder="Lautstärke z.B. Stufe 14/44" value={ownForm.lautstaerke} onChange={(e) => setOwnForm({ ...ownForm, lautstaerke: e.target.value })} />
            <input className="wide" placeholder="Bemerkung" value={ownForm.bemerkung} onChange={(e) => setOwnForm({ ...ownForm, bemerkung: e.target.value })} />
            <button className="btn" type="submit">{ownEditId != null ? "Speichern" : <><Icon name="plus" /> Hinzufügen</>}</button>
            {ownEditId != null && (
              <button type="button" className="btn ghost" onClick={() => { setOwnEditId(null); setOwnForm({ ...emptyOwn }); }}>Abbrechen</button>
            )}
          </form>

          {filterBar(ownFiltered.length, own.length)}

          <Stats tab="own" own={ownFiltered} foreign={foreignFiltered} />

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Datum</th><th>Start</th><th>Ende</th><th>Dauer</th><th>Aktivität</th><th>Lautstärke</th><th>Bemerkung</th><th></th></tr>
              </thead>
              <tbody>
                {ownFiltered.map((r) => (
                  <tr key={r.id} className={r.dauer_min == null ? "rest-row" : ""}>
                    <td>{r.datum}</td>
                    <td>{r.start ?? "–"}</td>
                    <td>{r.ende ?? "–"}</td>
                    <td>{r.dauer_min != null ? `${r.dauer_min} min` : "–"}</td>
                    <td>{r.aktivitaet}</td>
                    <td>{r.lautstaerke ?? "–"}</td>
                    <td className="cell-note">{r.bemerkung}</td>
                    <td className="cell-actions">
                      <button className="icon-btn" title="Bearbeiten" onClick={() => editOwn(r)}><Icon name="bearbeiten" /></button>
                      <button className="icon-btn danger" title="Löschen" onClick={() => delOwn(r.id)}><Icon name="loeschen" /></button>
                    </td>
                  </tr>
                ))}
                {ownFiltered.length === 0 && <tr><td colSpan={8} className="empty">{own.length === 0 ? "Noch keine Einträge." : "Keine Treffer für den Filter."}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <form className="entry-form" onSubmit={submitForeign}>
            <input type="date" aria-label="Datum" value={forForm.datum} onChange={(e) => setForForm({ ...forForm, datum: e.target.value })} />
            <input type="time" title="Uhrzeit" value={forForm.uhrzeit} onChange={(e) => setForForm({ ...forForm, uhrzeit: e.target.value })} />
            <input placeholder="Verursacher z.B. Wohnung oben" value={forForm.verursacher} onChange={(e) => setForForm({ ...forForm, verursacher: e.target.value })} />
            <input placeholder="Art des Lärms" value={forForm.art} onChange={(e) => setForForm({ ...forForm, art: e.target.value })} />
            <input className="wide" placeholder="Bemerkung / Einordnung" value={forForm.bemerkung} onChange={(e) => setForForm({ ...forForm, bemerkung: e.target.value })} />
            <button className="btn" type="submit">{forEditId != null ? "Speichern" : <><Icon name="plus" /> Hinzufügen</>}</button>
            {forEditId != null && (
              <button type="button" className="btn ghost" onClick={() => { setForEditId(null); setForForm({ ...emptyForeign }); }}>Abbrechen</button>
            )}
          </form>

          {filterBar(foreignFiltered.length, foreign.length)}

          <Stats tab="foreign" own={ownFiltered} foreign={foreignFiltered} />

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Datum</th><th>Uhrzeit</th><th>Verursacher</th><th>Art des Lärms</th><th>Bemerkung</th><th></th></tr>
              </thead>
              <tbody>
                {foreignFiltered.map((r) => (
                  <tr key={r.id}>
                    <td>{r.datum}</td>
                    <td>{r.uhrzeit ?? "–"}</td>
                    <td>{r.verursacher}</td>
                    <td>{r.art}</td>
                    <td className="cell-note">{r.bemerkung}</td>
                    <td className="cell-actions">
                      <button className="icon-btn" title="Bearbeiten" onClick={() => editForeign(r)}><Icon name="bearbeiten" /></button>
                      <button className="icon-btn danger" title="Löschen" onClick={() => delForeign(r.id)}><Icon name="loeschen" /></button>
                    </td>
                  </tr>
                ))}
                {foreignFiltered.length === 0 && <tr><td colSpan={6} className="empty">{foreign.length === 0 ? "Noch keine Vorfälle." : "Keine Treffer für den Filter."}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showReport && (
        <Modal title="PDF-Bericht erstellen" onClose={() => setShowReport(false)}>
          <p className="modal-msg">
            Erzeugt ein vorzeigbares Dokument mit beiden Tabellen und einer Auswertung.
            Lass die Felder leer für den gesamten Zeitraum.
          </p>
          <div className="report-range">
            <label>Von<input type="date" value={rFrom} onChange={(e) => setRFrom(e.target.value)} /></label>
            <label>Bis<input type="date" value={rTo} onChange={(e) => setRTo(e.target.value)} /></label>
          </div>
          <div className="report-range">
            <label>Mieter
              <input value={beteiligte.mieter} placeholder="Vor- und Nachname"
                onChange={(e) => setBeteiligte({ ...beteiligte, mieter: e.target.value })} />
            </label>
            <label>Vermieter
              <input value={beteiligte.vermieter} placeholder="Name oder Verwaltung"
                onChange={(e) => setBeteiligte({ ...beteiligte, vermieter: e.target.value })} />
            </label>
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setShowReport(false)}>Abbrechen</button>
            <button className="btn" onClick={createReport}>Bericht öffnen</button>
          </div>
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
