import { useCallback, useEffect, useState } from "react";
import { hh, euro, parseBetrag, heuteLokal as heute, type Schuld, type Zahlung } from "./api";
import { useConfirm } from "../../core/ui";
import { Icon } from "../../core/Icon";



/**
 * Aussenstaende — wer dem Nutzer noch Geld schuldet und was davon schon
 * zurueckgezahlt ist.
 *
 * ACHTUNG, Richtung: Das Modul hiess urspruenglich „Schulden" und war so
 * beschriftet, als schulde der Nutzer das Geld. Genau andersherum. Tabellen-
 * und Routennamen (`schulden`, `/schulden`) blieben, um die vorhandenen Daten
 * nicht migrieren zu muessen — die Beschriftung ist die Wahrheit.
 */
export function Schulden() {
  const confirm = useConfirm();
  const [liste, setListe] = useState<Schuld[]>([]);
  const [offenId, setOffenId] = useState<number | null>(null);
  const [zahlungen, setZahlungen] = useState<Zahlung[]>([]);
  const [neu, setNeu] = useState({ person: "", gesamt: "", notiz: "" });
  const [zahlung, setZahlung] = useState({ datum: heute(), betrag: "", notiz: "" });
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const laden = useCallback(() => hh.schulden().then(setListe), []);
  useEffect(() => { laden(); }, [laden]);
  useEffect(() => {
    if (offenId == null) return setZahlungen([]);
    hh.zahlungen(offenId).then(setZahlungen);
  }, [offenId]);

  const gesamtOffen = liste.filter((s) => !s.erledigt).reduce((s, x) => s + x.offen, 0);
  const gesamtSchuld = liste.filter((s) => !s.erledigt).reduce((s, x) => s + x.gesamt, 0);

  async function anlegen(e: React.FormEvent) {
    e.preventDefault();
    const person = neu.person.trim();
    if (!person) return setError("Bitte einen Namen angeben.");
    const gesamt = parseBetrag(neu.gesamt);
    if (!Number.isFinite(gesamt) || gesamt <= 0) return setError("Bitte eine Summe größer als 0 angeben.");
    await hh.createSchuld({ person, gesamt, notiz: neu.notiz || null });
    setNeu({ person: "", gesamt: "", notiz: "" });
    setError(null);
    await laden();
    flash(`„${person}" hinzugefügt.`);
  }

  async function zahlen(e: React.FormEvent) {
    e.preventDefault();
    if (offenId == null) return;
    const betrag = parseBetrag(zahlung.betrag);
    if (!Number.isFinite(betrag) || betrag <= 0) return setError("Bitte einen Betrag größer als 0 angeben.");
    await hh.addZahlung(offenId, { datum: zahlung.datum || heute(), betrag, notiz: zahlung.notiz || null });
    setZahlung({ datum: heute(), betrag: "", notiz: "" });
    setError(null);
    setZahlungen(await hh.zahlungen(offenId));
    await laden();
    flash(`${euro(betrag)} verbucht.`);
  }

  async function zahlungLoeschen(z: Zahlung) {
    const ok = await confirm({
      title: "Zahlung löschen",
      message: `${euro(z.betrag)} vom ${z.datum} wirklich entfernen?`,
      confirmLabel: "Löschen", danger: true,
    });
    if (!ok) return;
    await hh.removeZahlung(z.id);
    if (offenId != null) setZahlungen(await hh.zahlungen(offenId));
    await laden();
  }

  async function erledigt(s: Schuld) {
    await hh.updateSchuld(s.id, {
      person: s.person, gesamt: s.gesamt, notiz: s.notiz, erledigt: s.erledigt ? 0 : 1,
    });
    await laden();
  }

  async function loeschen(s: Schuld) {
    const ok = await confirm({
      title: "Eintrag löschen",
      message: `„${s.person}" mit allen verbuchten Zahlungen löschen?`,
      confirmLabel: "Löschen", danger: true,
    });
    if (!ok) return;
    await hh.removeSchuld(s.id);
    if (offenId === s.id) setOffenId(null);
    await laden();
    flash("Eintrag gelöscht.");
  }

  return (
    <>
      <div className="hh-kopf">
        <div className="hh-kachel gross">
          <span className="hh-lbl">Steht noch aus</span>
          <span className="hh-wert grad">{euro(gesamtOffen)}</span>
          <span className="hh-sub">von {euro(gesamtSchuld)} insgesamt</span>
        </div>
        <div className="hh-kachel">
          <span className="hh-lbl">Schon zurückbekommen</span>
          <span className="hh-wert">{euro(gesamtSchuld - gesamtOffen)}</span>
        </div>
      </div>

      {liste.map((s) => {
        const anteil = s.gesamt > 0 ? ((s.gesamt - s.offen) / s.gesamt) * 100 : 0;
        const offen = offenId === s.id;
        return (
          <div className={`panel schuld-karte ${s.erledigt ? "erledigt" : ""}`} key={s.id}>
            <div className="panel-head">
              <h3>
                {s.person}{" "}
                <span className="panel-sub">
                  schuldet dir noch {euro(s.offen)} von {euro(s.gesamt)}
                </span>
              </h3>
              <div className="cell-actions">
                <button className="btn ghost small" onClick={() => setOffenId(offen ? null : s.id)}>
                  {offen ? "schließen" : "Rückzahlungen"}
                </button>
                <button className="icon-btn" title={s.erledigt ? "Wieder öffnen" : "Als vollständig zurückgezahlt markieren"} onClick={() => erledigt(s)}>
                  {s.erledigt ? <Icon name="zurueckholen" /> : <Icon name="haken" />}
                </button>
                <button className="icon-btn danger" title="Löschen" onClick={() => loeschen(s)}><Icon name="loeschen" /></button>
              </div>
            </div>

            <div className="tilgung">
              <span className="tilgung-spur">
                <span className="tilgung-fuell" style={{ width: `${anteil}%` }} />
              </span>
              <span className="tilgung-wert">{Math.round(anteil)} % zurückgezahlt</span>
            </div>
            {s.notiz && <p className="schuld-notiz">{s.notiz}</p>}

            {offen && (
              <div className="zahl-bereich">
                <form className="entry-form" onSubmit={zahlen}>
                  <input type="date" aria-label="Datum der Rückzahlung" value={zahlung.datum} onChange={(e) => { setZahlung({ ...zahlung, datum: e.target.value }); setError(null); }} />
                  <input placeholder="Betrag €" value={zahlung.betrag} onChange={(e) => { setZahlung({ ...zahlung, betrag: e.target.value }); setError(null); }} style={{ maxWidth: 110 }} inputMode="decimal" />
                  <input className="wide" placeholder="Notiz" value={zahlung.notiz} onChange={(e) => setZahlung({ ...zahlung, notiz: e.target.value })} />
                  <button className="btn" type="submit"><Icon name="plus" /> Rückzahlung</button>
                </form>
                <ul className="zahl-liste">
                  {zahlungen.map((z) => (
                    <li key={z.id}>
                      <span className="zahl-datum">{z.datum}</span>
                      <span className="zahl-betrag">{euro(z.betrag)}</span>
                      <span className="zahl-notiz">{z.notiz}</span>
                      <button className="icon-btn danger" title="Rückzahlung entfernen" onClick={() => zahlungLoeschen(z)}><Icon name="loeschen" /></button>
                    </li>
                  ))}
                  {zahlungen.length === 0 && <li className="empty">Noch nichts zurückgezahlt.</li>}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      {liste.length === 0 && <p className="empty">Niemand schuldet dir gerade etwas.</p>}

      <form className={`entry-form ${error ? "has-error" : ""}`} onSubmit={anlegen} noValidate>
        <input placeholder="Name" value={neu.person} onChange={(e) => { setNeu({ ...neu, person: e.target.value }); setError(null); }} style={{ minWidth: 150 }} />
        <input placeholder="Geliehene Summe €" value={neu.gesamt} onChange={(e) => { setNeu({ ...neu, gesamt: e.target.value }); setError(null); }} style={{ maxWidth: 150 }} inputMode="decimal" />
        <input className="wide" placeholder="Notiz" value={neu.notiz} onChange={(e) => setNeu({ ...neu, notiz: e.target.value })} />
        <button className="btn" type="submit"><Icon name="plus" /> Hinzufügen</button>
      </form>
      {error && <div className="form-error" role="alert"><Icon name="warnung" /> {error}</div>}

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
