import { useEffect, useMemo, useState } from "react";
import {
  zs, fmtNum, daysBetween, euro, tageSeit, rechneAbrechnung,
  type Meter, type Reading, type Accent,
} from "./api";
import { useConfirm, Modal } from "../../core/ui";
import { Icon } from "../../core/Icon";

const ACCENTS: Accent[] = ["blue", "pink", "violet"];
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyReading = () => ({ datum: todayISO(), stand: "", notiz: "" });

/** "0,32" -> 0.32; leer -> null. Tariffelder duerfen leer bleiben. */
function parseKomma(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Formularzustand des Zaehler-Modals — Tarife als Text, damit "0,32" tippbar bleibt. */
type MeterForm = {
  id: number | null;
  name: string;
  einheit: string;
  accent: Accent;
  preis: string;
  grundpreis: string;
  abschlag: string;
};

const alsText = (n: number | null | undefined) =>
  n == null ? "" : String(n).replace(".", ",");

export function View() {
  const confirm = useConfirm();
  const [meters, setMeters] = useState<Meter[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [form, setForm] = useState(emptyReading());
  const [editId, setEditId] = useState<number | null>(null);

  // Zähler-Modal (anlegen/bearbeiten)
  const [meterModal, setMeterModal] = useState<MeterForm | null>(null);

  const active = meters.find((m) => m.id === activeId) ?? null;

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3200);
  };

  const loadMeters = () =>
    zs.meters().then((ms) => {
      setMeters(ms);
      setActiveId((cur) => (cur && ms.some((m) => m.id === cur) ? cur : ms[0]?.id ?? null));
    });

  useEffect(() => {
    loadMeters();
  }, []);

  useEffect(() => {
    if (activeId == null) { setReadings([]); return; }
    zs.readings(activeId).then(setReadings);
    setForm(emptyReading());
    setEditId(null);
  }, [activeId]);

  const reloadReadings = () => (activeId != null ? zs.readings(activeId).then(setReadings) : Promise.resolve());

  // --- Statistik (aus aufsteigend sortierten Ablesungen) -------------------
  const stats = useMemo(() => {
    if (readings.length === 0) return null;
    const first = readings[0];
    const last = readings[readings.length - 1];
    const prev = readings[readings.length - 2] ?? null;
    const sinceLast = prev
      ? { delta: last.stand - prev.stand, days: daysBetween(prev.datum, last.datum) }
      : null;
    const totalDays = daysBetween(first.datum, last.datum);
    const totalDelta = last.stand - first.stand;
    const avgPerDay = readings.length >= 2 ? totalDelta / totalDays : null;
    return { first, last, sinceLast, totalDays, totalDelta, avgPerDay };
  }, [readings]);

  // Ablesungen mit Verbrauch zur Vorablesung, neueste zuerst
  const rowsDesc = useMemo(() => {
    return readings
      .map((r, i) => {
        const prev = i > 0 ? readings[i - 1] : null;
        const delta = prev ? r.stand - prev.stand : null;
        const days = prev ? daysBetween(prev.datum, r.datum) : null;
        return { r, delta, days, perDay: delta != null && days ? delta / days : null };
      })
      .reverse();
  }, [readings]);

  const unit = active?.einheit ?? "";

  /**
   * Geldseite. Zwei Blickwinkel aus denselben Zahlen: der letzte tatsaechliche
   * Zeitraum (bei der Jahresablesung ist das genau das Abrechnungsjahr) und
   * die Hochrechnung aufs Jahr.
   */
  const kosten = useMemo(() => {
    if (!active || active.preis == null || !stats) return null;
    const zeitraum = stats.sinceLast
      ? rechneAbrechnung(active, stats.sinceLast.delta, stats.sinceLast.days)
      : null;
    const jahr =
      stats.avgPerDay != null ? rechneAbrechnung(active, stats.avgPerDay * 365, 365) : null;
    return { zeitraum, jahr, standAlter: tageSeit(stats.last.datum) };
  }, [active, stats]);

  // --- Ablesung speichern --------------------------------------------------
  async function submitReading(e: React.FormEvent) {
    e.preventDefault();
    if (activeId == null) return;
    if (!form.datum) return flash("Bitte ein Datum angeben.");
    if (form.stand.trim() === "" || !Number.isFinite(Number(form.stand.replace(",", "."))))
      return flash("Bitte einen gültigen Zählerstand angeben.");
    const payload = { datum: form.datum, stand: Number(form.stand.replace(",", ".")), notiz: form.notiz };
    if (editId != null) await zs.updateReading(editId, payload);
    else await zs.addReading(activeId, payload);
    setForm(emptyReading());
    setEditId(null);
    await reloadReadings();
    flash(editId != null ? "Ablesung aktualisiert." : "Ablesung gespeichert.");
  }

  function editReading(r: Reading) {
    setEditId(r.id);
    setForm({ datum: r.datum, stand: String(r.stand), notiz: r.notiz ?? "" });
  }

  async function delReading(id: number) {
    const ok = await confirm({ title: "Ablesung löschen", message: "Diese Ablesung wirklich löschen?", confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    await zs.deleteReading(id);
    await reloadReadings();
    flash("Ablesung gelöscht.");
  }

  // --- Zähler verwalten ----------------------------------------------------
  function openNewMeter() {
    setMeterModal({ id: null, name: "", einheit: "", accent: "blue", preis: "", grundpreis: "", abschlag: "" });
  }
  function openEditMeter(m: Meter) {
    setMeterModal({
      id: m.id, name: m.name, einheit: m.einheit, accent: m.accent,
      preis: alsText(m.preis), grundpreis: alsText(m.grundpreis), abschlag: alsText(m.abschlag),
    });
  }
  async function saveMeter() {
    if (!meterModal) return;
    if (!meterModal.name.trim()) return flash("Bitte einen Namen angeben.");
    const payload = {
      name: meterModal.name, einheit: meterModal.einheit, accent: meterModal.accent,
      preis: parseKomma(meterModal.preis),
      grundpreis: parseKomma(meterModal.grundpreis),
      abschlag: parseKomma(meterModal.abschlag),
    };
    let newId: number | null = null;
    if (meterModal.id != null) await zs.updateMeter(meterModal.id, payload);
    else newId = (await zs.addMeter(payload)).id;
    setMeterModal(null);
    await loadMeters();
    if (newId != null) setActiveId(newId);
    flash(meterModal.id != null ? "Zähler aktualisiert." : "Zähler angelegt.");
  }
  async function deleteMeter(m: Meter) {
    const ok = await confirm({
      title: "Zähler löschen",
      message: `„${m.name}" samt allen Ablesungen unwiderruflich löschen?`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await zs.deleteMeter(m.id);
    await loadMeters();
    flash("Zähler gelöscht.");
  }

  return (
    <div className="module-view">
      {/* Zähler-Auswahl */}
      <div className="meter-tabs">
        {meters.map((m) => (
          <button
            key={m.id}
            className={`meter-chip accent-${m.accent} ${m.id === activeId ? "active" : ""}`}
            onClick={() => setActiveId(m.id)}
          >
            {m.name}
            <span className="meter-chip-unit">{m.einheit}</span>
          </button>
        ))}
        <button className="meter-chip add" onClick={openNewMeter}><Icon name="plus" /> Zähler</button>
      </div>

      {active ? (
        <>
          <div className="view-toolbar">
            <h3 className="meter-title">
              <span className={`meter-dot accent-${active.accent}`} /> {active.name}
              <span className="meter-unit-lbl">in {active.einheit}</span>
            </h3>
            <div className="toolbar-actions">
              <button className="btn ghost small" onClick={() => openEditMeter(active)}><Icon name="bearbeiten" /> Umbenennen</button>
              <button className="btn ghost small" onClick={() => deleteMeter(active)}><Icon name="loeschen" /> Zähler löschen</button>
            </div>
          </div>

          {/* Statistik */}
          {stats && (
            <div className="stats-kpis">
              <div className="kpi">
                <span className="kpi-num accent">{fmtNum(stats.last.stand)} {unit}</span>
                <span className="kpi-lbl">aktueller Stand · {stats.last.datum}</span>
              </div>
              {stats.sinceLast && (
                <div className="kpi">
                  <span className="kpi-num">{fmtNum(stats.sinceLast.delta)} {unit}</span>
                  <span className="kpi-lbl">seit letzter Ablesung ({stats.sinceLast.days} Tage)</span>
                </div>
              )}
              {stats.avgPerDay != null && (
                <>
                  <div className="kpi">
                    <span className="kpi-num">{fmtNum(stats.avgPerDay)} {unit}</span>
                    <span className="kpi-lbl">Ø pro Tag</span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-num">{fmtNum(stats.avgPerDay * 30)} {unit}</span>
                    <span className="kpi-lbl">Hochrechnung / Monat</span>
                  </div>
                  <div className="kpi">
                    <span className="kpi-num">{fmtNum(stats.avgPerDay * 365)} {unit}</span>
                    <span className="kpi-lbl">Hochrechnung / Jahr</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Geldseite — nur wenn ein Preis hinterlegt ist */}
          {kosten && (
            <div className="panel">
              <div className="panel-head">
                <h3>
                  Was das kostet{" "}
                  <span className="panel-sub">
                    {active.preis!.toLocaleString("de-DE", { maximumFractionDigits: 4 })} € je {unit}
                    {active.grundpreis ? ` · ${euro(active.grundpreis)} Grundpreis/Monat` : ""}
                    {active.abschlag ? ` · ${euro(active.abschlag)} Abschlag/Monat` : ""}
                  </span>
                </h3>
              </div>

              {kosten.zeitraum ? (
                <div className="kosten-block">
                  <div className="kosten-titel">
                    Letzter Zeitraum — {kosten.zeitraum.tage} Tage
                  </div>
                  <div className="kosten-zeile">
                    <span>Verbrauch {fmtNum(kosten.zeitraum.verbrauch)} {unit}</span>
                    <strong>{euro(kosten.zeitraum.kosten)}</strong>
                  </div>
                  {kosten.zeitraum.gezahlt != null && (
                    <>
                      <div className="kosten-zeile">
                        <span>Abschlag im Zeitraum</span>
                        <strong>{euro(kosten.zeitraum.gezahlt)}</strong>
                      </div>
                      <div className={`kosten-ergebnis ${kosten.zeitraum.differenz! < 0 ? "nach" : "gut"}`}>
                        {kosten.zeitraum.differenz! < 0
                          ? `Nachzahlung: rund ${euro(-kosten.zeitraum.differenz!)}`
                          : `Guthaben: rund ${euro(kosten.zeitraum.differenz!)}`}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="empty">
                  Sobald eine zweite Ablesung da ist, steht hier, was der Verbrauch gekostet hat.
                </p>
              )}

              {kosten.jahr && (
                <div className="kosten-block">
                  <div className="kosten-titel">Aufs Jahr hochgerechnet</div>
                  <div className="kosten-zeile">
                    <span>{fmtNum(kosten.jahr.verbrauch)} {unit}</span>
                    <strong>{euro(kosten.jahr.kosten)}</strong>
                  </div>
                  {kosten.jahr.gezahlt != null && (
                    <>
                      <div className="kosten-zeile">
                        <span>Abschlag im Jahr</span>
                        <strong>{euro(kosten.jahr.gezahlt)}</strong>
                      </div>
                      <div className={`kosten-ergebnis ${kosten.jahr.differenz! < 0 ? "nach" : "gut"}`}>
                        {kosten.jahr.differenz! < 0
                          ? `Nachzahlung: rund ${euro(-kosten.jahr.differenz!)}`
                          : `Guthaben: rund ${euro(kosten.jahr.differenz!)}`}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Ehrlichkeit ueber die Datenlage — eine alte Ablesung heisst grobe Schaetzung. */}
              <p className={`kosten-alter ${kosten.standAlter > 45 ? "alt" : ""}`}>
                {kosten.standAlter === 0
                  ? "Stand von heute."
                  : kosten.standAlter <= 45
                  ? `Letzte Ablesung vor ${kosten.standAlter} Tagen.`
                  : `Letzte Ablesung vor ${kosten.standAlter} Tagen — die Hochrechnung ist entsprechend grob.`}
              </p>
            </div>
          )}

          {/* Neue Ablesung */}
          <form className="entry-form" onSubmit={submitReading}>
            <input type="date" aria-label="Ablesedatum" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} />
            <input
              inputMode="decimal"
              placeholder={`Zählerstand (${active.einheit})`}
              value={form.stand}
              onChange={(e) => setForm({ ...form, stand: e.target.value })}
            />
            <input className="wide" placeholder="Notiz (optional)" value={form.notiz} onChange={(e) => setForm({ ...form, notiz: e.target.value })} />
            <button className="btn" type="submit">{editId != null ? "Speichern" : <><Icon name="plus" /> Ablesung</>}</button>
            {editId != null && (
              <button type="button" className="btn ghost" onClick={() => { setEditId(null); setForm(emptyReading()); }}>Abbrechen</button>
            )}
          </form>

          {/* Tabelle */}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Datum</th><th>Stand</th><th>Verbrauch</th><th>Ø / Tag</th><th>Notiz</th><th></th></tr>
              </thead>
              <tbody>
                {rowsDesc.map(({ r, delta, days, perDay }) => (
                  <tr key={r.id}>
                    <td>{r.datum}</td>
                    <td>{fmtNum(r.stand)} {unit}</td>
                    <td>{delta != null ? `${delta >= 0 ? "+" : ""}${fmtNum(delta)} ${unit}${days ? ` · ${days} T` : ""}` : "–"}</td>
                    <td>{perDay != null ? `${fmtNum(perDay)} ${unit}` : "–"}</td>
                    <td className="cell-note">{r.notiz}</td>
                    <td className="cell-actions">
                      <button className="icon-btn" title="Bearbeiten" onClick={() => editReading(r)}><Icon name="bearbeiten" /></button>
                      <button className="icon-btn danger" title="Löschen" onClick={() => delReading(r.id)}><Icon name="loeschen" /></button>
                    </td>
                  </tr>
                ))}
                {rowsDesc.length === 0 && <tr><td colSpan={6} className="empty">Noch keine Ablesungen. Trag oben deinen ersten Zählerstand ein.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="empty" style={{ padding: 40 }}>
          Noch kein Zähler angelegt. Leg oben mit „+ Zähler" deinen ersten an.
        </div>
      )}

      {meterModal && (
        <Modal title={meterModal.id != null ? "Zähler bearbeiten" : "Neuer Zähler"} onClose={() => setMeterModal(null)}>
          <div className="meter-modal-fields">
            <label>Name
              <input value={meterModal.name} onChange={(e) => setMeterModal({ ...meterModal, name: e.target.value })} placeholder="z.B. Strom" autoFocus />
            </label>
            <label>Einheit
              <input value={meterModal.einheit} onChange={(e) => setMeterModal({ ...meterModal, einheit: e.target.value })} placeholder="z.B. kWh, m³" />
            </label>
            <label>Farbe
              <div className="accent-picker">
                {ACCENTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`accent-swatch accent-${a} ${meterModal.accent === a ? "sel" : ""}`}
                    onClick={() => setMeterModal({ ...meterModal, accent: a })}
                    aria-label={a}
                  />
                ))}
              </div>
            </label>

            <div className="modal-trenner">
              Tarif <span>optional — nur damit die App auch in Euro rechnen kann</span>
            </div>
            <label>Preis je {meterModal.einheit.trim() || "Einheit"} (€)
              <input
                inputMode="decimal" placeholder="z. B. 0,32"
                value={meterModal.preis}
                onChange={(e) => setMeterModal({ ...meterModal, preis: e.target.value })}
              />
            </label>
            <label>Grundpreis je Monat (€)
              <input
                inputMode="decimal" placeholder="z. B. 11,50 — leer lassen, wenn keiner"
                value={meterModal.grundpreis}
                onChange={(e) => setMeterModal({ ...meterModal, grundpreis: e.target.value })}
              />
            </label>
            <label>Dein Abschlag je Monat (€)
              <input
                inputMode="decimal" placeholder="z. B. 120"
                value={meterModal.abschlag}
                onChange={(e) => setMeterModal({ ...meterModal, abschlag: e.target.value })}
              />
            </label>
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setMeterModal(null)}>Abbrechen</button>
            <button className="btn" onClick={saveMeter}>{meterModal.id != null ? "Speichern" : "Anlegen"}</button>
          </div>
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
