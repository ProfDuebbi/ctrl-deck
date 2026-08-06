import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hh, euro, parseBetrag, datumLabel, periodeLabel, periodeHeute, heuteLokal,
  EINNAHME_KATEGORIEN, EINNAHME_NAMEN, MONATE,
  type Einnahme, type Buchung, type Summary,
} from "./api";
import { useConfirm } from "../../core/ui";
import { Icon } from "../../core/Icon";
import { useKonten } from "./auswahl";

const leeresFormular = () => ({
  name: "", betrag: "", tag: "1", kategorie: "", konto: "",
  start: periodeHeute(), ende: "", notiz: "",
});

const leereSondereinnahme = () => ({
  datum: heuteLokal(), betrag: "", name: "", kategorie: "", konto: "", notiz: "",
});

/**
 * Wiederkehrende monatliche Einnahmen. Der Server bucht sie am Zahltag von
 * selbst — hier werden nur die Regeln gepflegt. Darunter die Schnellerfassung
 * fuer einmalige Sondereinnahmen.
 */
export function Einnahmen() {
  const konten = useKonten();
  const confirm = useConfirm();
  const [liste, setListe] = useState<Einnahme[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [monat, setMonat] = useState<Buchung[]>([]);
  const [form, setForm] = useState(leeresFormular());
  const [editId, setEditId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sonder, setSonder] = useState(leereSondereinnahme());
  const [sonderError, setSonderError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [zeigeInaktive, setZeigeInaktive] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const sonderBetragRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  // Zeitraum des laufenden Monats — fuer die Uebersicht "was kam diesen Monat rein".
  const { von, bis, monatsLabel } = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const j = d.getFullYear(), m = d.getMonth();
    const letzter = new Date(j, m + 1, 0).getDate();
    return {
      von: `${j}-${p(m + 1)}-01`,
      bis: `${j}-${p(m + 1)}-${p(letzter)}`,
      monatsLabel: `${MONATE[m]} ${j}`,
    };
  }, []);

  const laden = useCallback(async () => {
    const [l, s, b] = await Promise.all([hh.einnahmen(), hh.summary(), hh.buchungen(von, bis)]);
    setListe(l);
    setSummary(s);
    setMonat(b.filter((x) => x.art === "eingang"));
  }, [von, bis]);
  useEffect(() => { laden(); }, [laden]);

  const sichtbar = useMemo(
    () => liste.filter((e) => zeigeInaktive || e.aktiv),
    [liste, zeigeInaktive]
  );

  const monatsSumme = useMemo(() => monat.reduce((s, b) => s + b.betrag, 0), [monat]);

  const upd = (patch: Partial<ReturnType<typeof leeresFormular>>) => {
    setForm({ ...form, ...patch });
    setFormError(null);
  };
  const updSonder = (patch: Partial<ReturnType<typeof leereSondereinnahme>>) => {
    setSonder({ ...sonder, ...patch });
    setSonderError(null);
  };

  // --- wiederkehrende Einnahme -------------------------------------------

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { setFormError("Bitte einen Namen angeben — z. B. „Gehalt“."); nameRef.current?.focus(); return; }
    const betrag = parseBetrag(form.betrag);
    if (!Number.isFinite(betrag) || betrag <= 0) {
      setFormError("Bitte einen Betrag größer als 0 angeben.");
      return;
    }
    const tag = Number(form.tag);
    if (!Number.isInteger(tag) || tag < 1 || tag > 31) {
      setFormError("Der Zahltag muss zwischen 1 und 31 liegen.");
      return;
    }
    if (form.ende && form.ende < form.start) {
      setFormError("Das Ende darf nicht vor dem Start liegen.");
      return;
    }
    const payload = {
      name, betrag, tag,
      kategorie: form.kategorie || null, konto: form.konto || null,
      start: form.start || periodeHeute(), ende: form.ende || null,
      notiz: form.notiz || null,
    };
    const res = editId != null
      ? await hh.updateEinnahme(editId, { ...payload, aktiv: 1 })
      : await hh.createEinnahme(payload);
    setForm(leeresFormular());
    setEditId(null);
    setFormError(null);
    await laden();
    const nachgebucht = res.gebucht > 0 ? ` — ${res.gebucht} fällige Buchung(en) angelegt.` : "";
    flash((editId != null ? "Einnahme aktualisiert." : `„${name}“ angelegt.`) + nachgebucht);
  }

  function edit(e: Einnahme) {
    setEditId(e.id);
    setFormError(null);
    setForm({
      name: e.name,
      betrag: String(e.betrag).replace(".", ","),
      tag: String(e.tag),
      kategorie: e.kategorie ?? "",
      konto: e.konto ?? "",
      start: e.start,
      ende: e.ende ?? "",
      notiz: e.notiz ?? "",
    });
    nameRef.current?.focus();
  }

  async function umschalten(e: Einnahme) {
    await hh.updateEinnahme(e.id, { ...e, aktiv: !e.aktiv });
    await laden();
    flash(e.aktiv ? `„${e.name}“ pausiert — wird nicht mehr gebucht.` : `„${e.name}“ läuft wieder.`);
  }

  async function jetztBuchen(e: Einnahme) {
    const res = await hh.einnahmeJetzt(e.id);
    await laden();
    flash(res.gebucht > 0 ? `${euro(e.betrag)} gebucht.` : "Für diesen Monat ist bereits gebucht.");
  }

  async function loeschen(e: Einnahme) {
    const ok = await confirm({
      title: "Einnahme löschen",
      message: `„${e.name}“ wirklich löschen? Bereits gebuchte Beträge bleiben im Haushaltsbuch stehen.`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await hh.removeEinnahme(e.id);
    await laden();
    flash("Einnahme gelöscht.");
  }

  // --- Sondereinnahme ------------------------------------------------------

  async function sonderBuchen(e: React.FormEvent) {
    e.preventDefault();
    if (!sonder.datum) { setSonderError("Bitte ein Datum angeben."); return; }
    const betrag = parseBetrag(sonder.betrag);
    if (!Number.isFinite(betrag) || betrag <= 0) {
      setSonderError("Bitte einen Betrag größer als 0 angeben.");
      sonderBetragRef.current?.focus();
      return;
    }
    await hh.createBuchung({
      datum: sonder.datum, art: "eingang", betrag,
      kategorie: sonder.kategorie || null,
      empfaenger: sonder.name.trim() || null,
      konto: sonder.konto || null,
      notiz: sonder.notiz || null,
    });
    setSonder({ ...leereSondereinnahme(), konto: sonder.konto });
    setSonderError(null);
    await laden();
    flash(`Sondereinnahme über ${euro(betrag)} gebucht.`);
  }

  async function sonderLoeschen(b: Buchung) {
    const ok = await confirm({
      title: "Buchung löschen",
      message: `${euro(b.betrag)} vom ${datumLabel(b.datum)} wirklich löschen?`,
      confirmLabel: "Löschen", danger: true,
    });
    if (!ok) return;
    await hh.removeBuchung(b.id);
    await laden();
    flash("Buchung gelöscht.");
  }

  return (
    <>
      {/* Kopfzahlen */}
      <div className="hh-kopf">
        <div className="hh-kachel gross">
          <span className="hh-lbl">Feste Einnahmen</span>
          <span className="hh-wert grad">{summary ? euro(summary.einnahmenProMonat) : "—"}</span>
          <span className="hh-sub">{liste.filter((e) => e.aktiv).length} aktive pro Monat</span>
        </div>
        <div className="hh-kachel">
          <span className="hh-lbl">Fixkosten</span>
          <span className="hh-wert">{summary ? `− ${euro(summary.proMonat)}` : "—"}</span>
        </div>
        <div className={`hh-kachel ${summary && summary.uebrigProMonat < 0 ? "warn" : ""}`}>
          <span className="hh-lbl">Bleibt übrig</span>
          <span className="hh-wert">{summary ? euro(summary.uebrigProMonat) : "—"}</span>
          <span className="hh-sub">nach den Fixkosten</span>
        </div>
      </div>

      {/* Eingabe: wiederkehrende Einnahme */}
      <form className={`entry-form ${formError ? "has-error" : ""}`} onSubmit={submit} noValidate>
        <input
          ref={nameRef} placeholder="Name (z. B. Gehalt)" value={form.name} list="hh-einnahme-namen"
          onChange={(ev) => upd({ name: ev.target.value })} style={{ minWidth: 170 }}
        />
        <input
          placeholder="Betrag €" value={form.betrag} inputMode="decimal" style={{ maxWidth: 110 }}
          onChange={(ev) => upd({ betrag: ev.target.value })}
        />
        <label className="feld-mit-label" title="Zahltag im Monat">
          <span>am</span>
          <input
            type="number" min={1} max={31} value={form.tag} style={{ maxWidth: 64 }}
            onChange={(ev) => upd({ tag: ev.target.value })}
          />
          <span>.</span>
        </label>
        <select value={form.kategorie} onChange={(ev) => upd({ kategorie: ev.target.value })} title="Kategorie">
          <option value="">— Kategorie —</option>
          {EINNAHME_KATEGORIEN.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={form.konto} onChange={(ev) => upd({ konto: ev.target.value })} title="Konto">
          <option value="">— Konto —</option>
          {konten.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <label className="feld-mit-label" title="Ab welchem Monat gebucht wird">
          <span>ab</span>
          <input type="month" value={form.start} onChange={(ev) => upd({ start: ev.target.value })} />
        </label>
        <label className="feld-mit-label" title="Letzter Monat (leer = unbefristet)">
          <span>bis</span>
          <input type="month" value={form.ende} onChange={(ev) => upd({ ende: ev.target.value })} />
        </label>
        <input className="wide" placeholder="Notiz" value={form.notiz} onChange={(ev) => upd({ notiz: ev.target.value })} />
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
          <input type="checkbox" checked={zeigeInaktive} onChange={(ev) => setZeigeInaktive(ev.target.checked)} />
          pausierte Einnahmen anzeigen
        </label>
      </div>

      {/* Liste der wiederkehrenden Einnahmen */}
      <div className="panel">
        <div className="panel-head">
          <h3>Jeden Monat <span className="panel-sub">wird automatisch gebucht</span></h3>
        </div>
        <ul className="hh-liste">
          {sichtbar.map((e) => (
            <li key={e.id} className={`hh-zeile einnahme ${e.aktiv ? "" : "pausiert"}`}>
              <span className="hh-name">{e.name}</span>
              <span className="hh-betrag ein">+ {euro(e.betrag)}</span>
              <span className="hh-intervall">am {e.tag}.</span>
              <span className="hh-konto">{e.konto ?? "–"}</span>
              <span className="hh-faellig" title="nächster Zahltag">
                {e.aktiv
                  ? e.naechster ? `nächste: ${datumLabel(e.naechster)}` : "ausgelaufen"
                  : "pausiert"}
              </span>
              <span className="hh-zuletzt" title="zuletzt gebucht">
                {e.zuletzt ? `zuletzt ${periodeLabel(e.zuletzt.periode)}` : "noch nie"}
              </span>
              <span className="cell-actions">
                <button className="icon-btn" title="Diesen Monat sofort buchen" onClick={() => jetztBuchen(e)} disabled={!e.aktiv}><Icon name="export" /></button>
                <button className="icon-btn" title={e.aktiv ? "Pausieren" : "Wieder aktivieren"} onClick={() => umschalten(e)}>
                  {e.aktiv ? <Icon name="pause" /> : <Icon name="abspielen" />}
                </button>
                <button className="icon-btn" title="Bearbeiten" onClick={() => edit(e)}><Icon name="bearbeiten" /></button>
                <button className="icon-btn danger" title="Löschen" onClick={() => loeschen(e)}><Icon name="loeschen" /></button>
              </span>
            </li>
          ))}
        </ul>
        {sichtbar.length === 0 && <p className="empty">Noch keine wiederkehrende Einnahme angelegt.</p>}
      </div>

      {/* Sondereinnahme */}
      <div className="panel">
        <div className="panel-head">
          <h3>Sondereinnahme <span className="panel-sub">einmalig, gilt nur für dieses Datum</span></h3>
        </div>
        <form className={`entry-form ${sonderError ? "has-error" : ""}`} onSubmit={sonderBuchen} noValidate>
          <input type="date" title="Datum" value={sonder.datum} onChange={(ev) => updSonder({ datum: ev.target.value })} />
          <input
            ref={sonderBetragRef} placeholder="Betrag €" value={sonder.betrag} inputMode="decimal"
            style={{ maxWidth: 110 }} onChange={(ev) => updSonder({ betrag: ev.target.value })}
          />
          <input
            placeholder="Woher? (z. B. Steuererstattung)" value={sonder.name} list="hh-einnahme-namen"
            onChange={(ev) => updSonder({ name: ev.target.value })} style={{ minWidth: 190 }}
          />
          <select value={sonder.kategorie} onChange={(ev) => updSonder({ kategorie: ev.target.value })} title="Kategorie">
            <option value="">— Kategorie —</option>
            {EINNAHME_KATEGORIEN.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select value={sonder.konto} onChange={(ev) => updSonder({ konto: ev.target.value })} title="Konto">
            <option value="">— Konto —</option>
            {konten.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input className="wide" placeholder="Notiz" value={sonder.notiz} onChange={(ev) => updSonder({ notiz: ev.target.value })} />
          <button className="btn" type="submit"><Icon name="plus" /> Buchen</button>
        </form>
        {sonderError && <div className="form-error" role="alert"><Icon name="warnung" /> {sonderError}</div>}
      </div>

      {/* Was diesen Monat reinkam */}
      <div className="panel">
        <div className="panel-head">
          <h3>
            Eingegangen in {monatsLabel} <span className="panel-sub">{euro(monatsSumme)}</span>
          </h3>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Datum</th><th>Betrag</th><th>Woher</th><th>Kategorie</th><th>Konto</th><th>Notiz</th><th>Aktionen</th></tr>
            </thead>
            <tbody>
              {monat.map((b) => (
                <tr key={b.id}>
                  <td>{datumLabel(b.datum)}</td>
                  <td className="buch-betrag eingang">+ {euro(b.betrag)}</td>
                  <td>
                    {b.empfaenger ?? "–"}
                    {b.einnahme_id ? <span className="hh-auto" title="automatisch gebucht"><Icon name="wiederholen" /></span> : null}
                  </td>
                  <td>{b.kategorie ?? "–"}</td>
                  <td>{b.konto ?? "–"}</td>
                  <td className="cell-note">{b.notiz}</td>
                  <td className="cell-actions">
                    <button className="icon-btn danger" title="Löschen" onClick={() => sonderLoeschen(b)}><Icon name="loeschen" /></button>
                  </td>
                </tr>
              ))}
              {monat.length === 0 && (
                <tr><td colSpan={7} className="empty">In {monatsLabel} ist noch nichts eingegangen.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <datalist id="hh-einnahme-namen">
        {EINNAHME_NAMEN.map((n) => <option key={n} value={n} />)}
      </datalist>

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
