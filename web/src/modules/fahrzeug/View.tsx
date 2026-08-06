import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../../core/Icon";
import { useConfirm } from "../../core/ui";
import {
  fz, ARTEN, EINTRAG_ARTEN, euro, fristText, verbrauch,
  type Eintrag, type Fahrzeug, type FahrzeugArt,
} from "./api";

/**
 * Fahrzeug-Ansicht.
 *
 * Oben stehen die Fristen, weil sie das Einzige sind, was Geld kostet, wenn
 * man es verpasst. Alles darunter — Tanken, Wartung, Kilometer — ist
 * Buchfuehrung und darf leer bleiben.
 */

const leeresFormular = () => ({
  name: "", kennzeichen: "", art: "auto" as FahrzeugArt,
  hu_bis: "", versicherung_bis: "", steuer_bis: "", inspektion_bis: "", notiz: "",
});

const heute = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function View() {
  const confirm = useConfirm();
  const [liste, setListe] = useState<Fahrzeug[]>([]);
  const [offenId, setOffenId] = useState<number | null>(null);
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [form, setForm] = useState(leeresFormular());
  const [editId, setEditId] = useState<number | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neuerEintrag, setNeuerEintrag] = useState({
    datum: heute(), art: "tanken", km: "", liter: "", betrag: "", notiz: "",
  });

  const laden = useCallback(() => fz.liste().then(setListe), []);
  useEffect(() => { laden(); }, [laden]);
  useEffect(() => {
    if (offenId == null) { setEintraege([]); return; }
    fz.eintraege(offenId).then(setEintraege);
  }, [offenId]);

  const offen = liste.find((f) => f.id === offenId) ?? null;
  const werte = useMemo(() => verbrauch(eintraege), [eintraege]);
  const kmStand = useMemo(
    () => eintraege.filter((e) => e.km != null).sort((a, b) => (b.km ?? 0) - (a.km ?? 0))[0]?.km ?? null,
    [eintraege]
  );

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setFehler("Bitte einen Namen angeben.");
    const daten = { ...form, name: form.name.trim() };
    try {
      if (editId != null) await fz.aendern(editId, daten);
      else await fz.anlegen(daten);
      setForm(leeresFormular());
      setEditId(null);
      setFehler(null);
      await laden();
    } catch {
      setFehler("Konnte nicht gespeichert werden.");
    }
  }

  function bearbeiten(f: Fahrzeug) {
    setEditId(f.id);
    setFehler(null);
    setForm({
      name: f.name, kennzeichen: f.kennzeichen ?? "", art: f.art,
      hu_bis: f.hu_bis ?? "", versicherung_bis: f.versicherung_bis ?? "",
      steuer_bis: f.steuer_bis ?? "", inspektion_bis: f.inspektion_bis ?? "",
      notiz: f.notiz ?? "",
    });
  }

  async function loeschen(f: Fahrzeug) {
    const ok = await confirm({
      title: "Fahrzeug löschen",
      message: `„${f.name}" mit allen erfassten Tank- und Wartungseinträgen löschen?`,
      confirmLabel: "Löschen", danger: true,
    });
    if (!ok) return;
    await fz.loeschen(f.id);
    if (offenId === f.id) setOffenId(null);
    await laden();
  }

  async function eintragen(e: React.FormEvent) {
    e.preventDefault();
    if (offenId == null) return;
    await fz.eintragen(offenId, {
      datum: neuerEintrag.datum,
      art: neuerEintrag.art as Eintrag["art"],
      km: neuerEintrag.km ? Number(neuerEintrag.km.replace(",", ".")) : null,
      liter: neuerEintrag.liter ? Number(neuerEintrag.liter.replace(",", ".")) : null,
      betrag: neuerEintrag.betrag ? Number(neuerEintrag.betrag.replace(",", ".")) : null,
      notiz: neuerEintrag.notiz || null,
    });
    setNeuerEintrag({ datum: heute(), art: neuerEintrag.art, km: "", liter: "", betrag: "", notiz: "" });
    setEintraege(await fz.eintraege(offenId));
  }

  return (
    <div className="module-view">
      {liste.length === 0 && (
        <p className="empty">Noch kein Fahrzeug erfasst. Trag unten eines ein.</p>
      )}

      {liste.map((f) => (
        <div className={`panel fz-karte ${f.aktiv ? "" : "still"}`} key={f.id}>
          <div className="panel-head">
            <h3>
              {f.name}
              {f.kennzeichen && <span className="panel-sub">{f.kennzeichen}</span>}
            </h3>
            <div className="cell-actions">
              <button className="btn ghost small" onClick={() => setOffenId(offenId === f.id ? null : f.id)}>
                {offenId === f.id ? "schließen" : "Fahrtenbuch"}
              </button>
              <button className="icon-btn" title="Bearbeiten" onClick={() => bearbeiten(f)}><Icon name="bearbeiten" /></button>
              <button className="icon-btn danger" title="Löschen" onClick={() => loeschen(f)}><Icon name="loeschen" /></button>
            </div>
          </div>

          {f.fristen.length === 0 ? (
            <p className="fz-keine-fristen">Keine Termine hinterlegt — trag HU, Versicherung oder Steuer ein, dann tauchen sie im Terminfaden auf.</p>
          ) : (
            <ul className="fz-fristen">
              {f.fristen.map((fr) => (
                <li className={`fz-frist s-${fr.status}`} key={fr.feld}>
                  <span className="fz-frist-label">{fr.label}</span>
                  <span className="fz-frist-datum">{fr.datum.split("-").reverse().join(".")}</span>
                  <span className="fz-frist-rest">{fristText(fr.tage)}</span>
                </li>
              ))}
            </ul>
          )}

          {offenId === f.id && (
            <div className="fz-buch">
              <div className="fz-kpis">
                <div className="hh-kachel">
                  <span className="hh-lbl">Kilometerstand</span>
                  <span className="hh-wert">{kmStand != null ? kmStand.toLocaleString("de-DE") + " km" : "—"}</span>
                </div>
                <div className="hh-kachel">
                  <span className="hh-lbl">Verbrauch</span>
                  <span className="hh-wert">
                    {werte.liter100 != null ? werte.liter100.toFixed(1).replace(".", ",") + " l/100 km" : "—"}
                  </span>
                  {werte.liter100 == null && <span className="hh-sub">ab zwei Tankungen mit km-Stand</span>}
                </div>
                <div className="hh-kachel">
                  <span className="hh-lbl">Kosten gesamt</span>
                  <span className="hh-wert">{euro(eintraege.reduce((s, e) => s + (e.betrag ?? 0), 0))}</span>
                </div>
              </div>

              <form className="entry-form" onSubmit={eintragen}>
                <input type="date" aria-label="Datum" value={neuerEintrag.datum}
                  onChange={(e) => setNeuerEintrag({ ...neuerEintrag, datum: e.target.value })} />
                <select aria-label="Art" value={neuerEintrag.art}
                  onChange={(e) => setNeuerEintrag({ ...neuerEintrag, art: e.target.value })}>
                  {EINTRAG_ARTEN.map((a) => <option key={a.wert} value={a.wert}>{a.label}</option>)}
                </select>
                <input placeholder="km-Stand" inputMode="numeric" style={{ maxWidth: 110 }}
                  value={neuerEintrag.km} onChange={(e) => setNeuerEintrag({ ...neuerEintrag, km: e.target.value })} />
                <input placeholder="Liter" inputMode="decimal" style={{ maxWidth: 90 }}
                  value={neuerEintrag.liter} onChange={(e) => setNeuerEintrag({ ...neuerEintrag, liter: e.target.value })} />
                <input placeholder="Betrag €" inputMode="decimal" style={{ maxWidth: 100 }}
                  value={neuerEintrag.betrag} onChange={(e) => setNeuerEintrag({ ...neuerEintrag, betrag: e.target.value })} />
                <input className="wide" placeholder="Notiz"
                  value={neuerEintrag.notiz} onChange={(e) => setNeuerEintrag({ ...neuerEintrag, notiz: e.target.value })} />
                <button className="btn" type="submit"><Icon name="plus" /> Eintrag</button>
              </form>

              <ul className="fz-liste">
                {eintraege.map((e) => (
                  <li key={e.id}>
                    <span className="fz-datum">{e.datum.split("-").reverse().join(".")}</span>
                    <span className="fz-art">{EINTRAG_ARTEN.find((a) => a.wert === e.art)?.label ?? e.art}</span>
                    <span className="fz-zahl">{e.km != null ? e.km.toLocaleString("de-DE") + " km" : ""}</span>
                    <span className="fz-zahl">{e.liter != null ? e.liter.toFixed(2).replace(".", ",") + " l" : ""}</span>
                    <span className="fz-zahl">{e.betrag != null ? euro(e.betrag) : ""}</span>
                    <span className="fz-notiz">{e.notiz}</span>
                    <button className="icon-btn danger" title="Eintrag entfernen"
                      onClick={async () => { await fz.eintragLoeschen(e.id); setEintraege(await fz.eintraege(f.id)); }}>
                      <Icon name="loeschen" />
                    </button>
                  </li>
                ))}
                {eintraege.length === 0 && <li className="empty">Noch nichts erfasst.</li>}
              </ul>
            </div>
          )}
        </div>
      ))}

      <form className={`panel fz-form ${fehler ? "has-error" : ""}`} onSubmit={speichern} noValidate>
        <h3 className="fz-form-titel">{editId != null ? "Fahrzeug bearbeiten" : "Fahrzeug hinzufügen"}</h3>
        <div className="entry-form">
          <input placeholder="Name (z. B. Golf)" style={{ minWidth: 160 }}
            value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setFehler(null); }} />
          <input placeholder="Kennzeichen" style={{ maxWidth: 150 }}
            value={form.kennzeichen} onChange={(e) => setForm({ ...form, kennzeichen: e.target.value })} />
          <select aria-label="Art" value={form.art}
            onChange={(e) => setForm({ ...form, art: e.target.value as FahrzeugArt })}>
            {ARTEN.map((a) => <option key={a.wert} value={a.wert}>{a.label}</option>)}
          </select>
          <input className="wide" placeholder="Notiz"
            value={form.notiz} onChange={(e) => setForm({ ...form, notiz: e.target.value })} />
        </div>
        <div className="fz-termine-felder">
          <label>Hauptuntersuchung<input type="date" value={form.hu_bis}
            onChange={(e) => setForm({ ...form, hu_bis: e.target.value })} /></label>
          <label>Versicherung<input type="date" value={form.versicherung_bis}
            onChange={(e) => setForm({ ...form, versicherung_bis: e.target.value })} /></label>
          <label>Kfz-Steuer<input type="date" value={form.steuer_bis}
            onChange={(e) => setForm({ ...form, steuer_bis: e.target.value })} /></label>
          <label>Inspektion<input type="date" value={form.inspektion_bis}
            onChange={(e) => setForm({ ...form, inspektion_bis: e.target.value })} /></label>
        </div>
        {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}
        <div className="modal-actions">
          {editId != null && (
            <button type="button" className="btn ghost" onClick={() => { setEditId(null); setForm(leeresFormular()); }}>
              Abbrechen
            </button>
          )}
          <button className="btn" type="submit">
            <Icon name={editId != null ? "haken" : "plus"} /> {editId != null ? "Speichern" : "Hinzufügen"}
          </button>
        </div>
      </form>
    </div>
  );
}
