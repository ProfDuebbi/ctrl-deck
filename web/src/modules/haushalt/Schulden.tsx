import { useCallback, useEffect, useMemo, useState } from "react";
import {
  hh, euro, parseBetrag, datumLabel, heuteLokal as heute,
  type Schuld, type Zahlung, type Posten,
} from "./api";
import { useConfirm } from "../../core/ui";
import { Icon } from "../../core/Icon";

/** Eine Zeile im Verlauf — geliehen (+) oder zurueckgezahlt (−). */
type Art = "leihe" | "rueck";
interface Zeile { art: Art; id: number; datum: string; betrag: string; notiz: string | null }

const leeresFormular = () => ({ art: "rueck" as Art, datum: heute(), betrag: "", notiz: "" });

/**
 * Aussenstaende — wer dem Nutzer noch Geld schuldet und was davon schon
 * zurueckgezahlt ist.
 *
 * ACHTUNG, Richtung: Das Modul hiess urspruenglich „Schulden" und war so
 * beschriftet, als schulde der Nutzer das Geld. Genau andersherum. Tabellen-
 * und Routennamen (`schulden`, `/schulden`) blieben, um die vorhandenen Daten
 * nicht migrieren zu muessen — die Beschriftung ist die Wahrheit.
 *
 * Die Summe eines Eintrags ist NICHT frei eingebbar, sondern die Summe seiner
 * Posten (Leihen). Wer sich verschrieben hat, korrigiert den Posten; wer noch
 * einmal etwas geliehen hat, haengt einen an. So bleibt nachvollziehbar,
 * woraus sich eine Summe zusammensetzt, statt dass sie sich still aendert.
 */
export function Schulden() {
  const confirm = useConfirm();
  const [liste, setListe] = useState<Schuld[]>([]);
  const [offenId, setOffenId] = useState<number | null>(null);
  const [zahlungen, setZahlungen] = useState<Zahlung[]>([]);
  const [posten, setPosten] = useState<Posten[]>([]);
  const [neu, setNeu] = useState({ person: "", gesamt: "", notiz: "" });
  const [form, setForm] = useState(leeresFormular());
  const [editKarte, setEditKarte] = useState<{ id: number; person: string; notiz: string } | null>(null);
  const [editZeile, setEditZeile] = useState<Zeile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zeilenError, setZeilenError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const laden = useCallback(() => hh.schulden().then(setListe), []);
  useEffect(() => { laden(); }, [laden]);

  const verlaufLaden = useCallback(async (id: number) => {
    const [p, z] = await Promise.all([hh.posten(id), hh.zahlungen(id)]);
    setPosten(p);
    setZahlungen(z);
  }, []);

  useEffect(() => {
    setEditZeile(null);
    setZeilenError(null);
    if (offenId == null) { setPosten([]); setZahlungen([]); return; }
    verlaufLaden(offenId);
  }, [offenId, verlaufLaden]);

  // Leihen und Rueckzahlungen stehen in einer gemeinsamen Zeitleiste — nur so
  // sieht man, ob nach der letzten Rate noch einmal etwas dazugekommen ist.
  const verlauf = useMemo<Zeile[]>(() => {
    // Betrag als Text mit Komma: so steht er auch im Eingabefeld, wenn die
    // Zeile bearbeitet wird — ein „200.5" waere dort ein Fremdkoerper.
    const alsText = (n: number) => String(n).replace(".", ",");
    const zeilen: Zeile[] = [
      ...posten.map((p) => ({ art: "leihe" as Art, id: p.id, datum: p.datum, betrag: alsText(p.betrag), notiz: p.notiz })),
      ...zahlungen.map((z) => ({ art: "rueck" as Art, id: z.id, datum: z.datum, betrag: alsText(z.betrag), notiz: z.notiz })),
    ];
    return zeilen.sort((a, b) => b.datum.localeCompare(a.datum) || b.id - a.id);
  }, [posten, zahlungen]);

  const gesamtOffen = liste.filter((s) => !s.erledigt).reduce((s, x) => s + x.offen, 0);
  const gesamtSchuld = liste.filter((s) => !s.erledigt).reduce((s, x) => s + x.gesamt, 0);

  async function anlegen(e: React.FormEvent) {
    e.preventDefault();
    const person = neu.person.trim();
    if (!person) return setError("Bitte einen Namen angeben.");
    const gesamt = parseBetrag(neu.gesamt);
    if (!Number.isFinite(gesamt) || gesamt <= 0) return setError("Bitte eine Summe größer als 0 angeben.");
    await hh.createSchuld({ person, gesamt, notiz: neu.notiz || null, datum: heute() });
    setNeu({ person: "", gesamt: "", notiz: "" });
    setError(null);
    await laden();
    flash(`„${person}" hinzugefügt.`);
  }

  /** Ein Eintrag im Verlauf: neue Leihe oder Rueckzahlung, je nach Umschalter. */
  async function eintragen(e: React.FormEvent) {
    e.preventDefault();
    if (offenId == null) return;
    const betrag = parseBetrag(form.betrag);
    if (!Number.isFinite(betrag) || betrag <= 0) return setZeilenError("Bitte einen Betrag größer als 0 angeben.");
    const nutzlast = { datum: form.datum || heute(), betrag, notiz: form.notiz || null };
    if (form.art === "leihe") await hh.addPosten(offenId, nutzlast);
    else await hh.addZahlung(offenId, nutzlast);
    setForm({ ...leeresFormular(), art: form.art });
    setZeilenError(null);
    await verlaufLaden(offenId);
    await laden();
    flash(form.art === "leihe" ? `${euro(betrag)} dazugekommen.` : `${euro(betrag)} verbucht.`);
  }

  async function zeileSpeichern(e: React.FormEvent) {
    e.preventDefault();
    if (!editZeile || offenId == null) return;
    const betrag = parseBetrag(editZeile.betrag);
    if (!Number.isFinite(betrag) || betrag <= 0) return setZeilenError("Bitte einen Betrag größer als 0 angeben.");
    const nutzlast = { datum: editZeile.datum || heute(), betrag, notiz: editZeile.notiz || null };
    if (editZeile.art === "leihe") await hh.updatePosten(editZeile.id, nutzlast);
    else await hh.updateZahlung(editZeile.id, nutzlast);
    setEditZeile(null);
    setZeilenError(null);
    await verlaufLaden(offenId);
    await laden();
    flash("Eintrag geändert.");
  }

  async function zeileLoeschen(z: Zeile) {
    const ok = await confirm({
      title: z.art === "leihe" ? "Leihe löschen" : "Rückzahlung löschen",
      message:
        z.art === "leihe"
          ? `${euro(parseBetrag(z.betrag))} vom ${datumLabel(z.datum)} entfernen? Die Summe des Eintrags sinkt entsprechend.`
          : `${euro(parseBetrag(z.betrag))} vom ${datumLabel(z.datum)} wirklich entfernen?`,
      confirmLabel: "Löschen", danger: true,
    });
    if (!ok) return;
    if (z.art === "leihe") await hh.removePosten(z.id);
    else await hh.removeZahlung(z.id);
    if (editZeile?.art === z.art && editZeile.id === z.id) setEditZeile(null);
    if (offenId != null) await verlaufLaden(offenId);
    await laden();
  }

  async function karteSpeichern(e: React.FormEvent) {
    e.preventDefault();
    if (!editKarte) return;
    const person = editKarte.person.trim();
    if (!person) return setError("Bitte einen Namen angeben.");
    const s = liste.find((x) => x.id === editKarte.id);
    await hh.updateSchuld(editKarte.id, {
      person, notiz: editKarte.notiz || null, erledigt: s?.erledigt ?? 0,
    });
    setEditKarte(null);
    setError(null);
    await laden();
    flash("Eintrag geändert.");
  }

  async function erledigt(s: Schuld) {
    await hh.updateSchuld(s.id, { person: s.person, notiz: s.notiz, erledigt: s.erledigt ? 0 : 1 });
    await laden();
  }

  async function loeschen(s: Schuld) {
    const ok = await confirm({
      title: "Eintrag löschen",
      message: `„${s.person}" mit allen Leihen und Rückzahlungen löschen?`,
      confirmLabel: "Löschen", danger: true,
    });
    if (!ok) return;
    await hh.removeSchuld(s.id);
    if (offenId === s.id) setOffenId(null);
    if (editKarte?.id === s.id) setEditKarte(null);
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
        const bearbeitet = editKarte?.id === s.id;
        return (
          <div className={`panel schuld-karte ${s.erledigt ? "erledigt" : ""}`} key={s.id}>
            <div className="panel-head">
              {bearbeitet && editKarte ? (
                <form className="entry-form schuld-edit" onSubmit={karteSpeichern} noValidate>
                  <input
                    aria-label="Name" value={editKarte.person} autoFocus style={{ minWidth: 150 }}
                    onChange={(e) => { setEditKarte({ ...editKarte, person: e.target.value }); setError(null); }}
                  />
                  <input
                    className="wide" placeholder="Notiz" aria-label="Notiz" value={editKarte.notiz}
                    onChange={(e) => setEditKarte({ ...editKarte, notiz: e.target.value })}
                  />
                  <button className="btn" type="submit">Speichern</button>
                  <button className="btn ghost" type="button" onClick={() => { setEditKarte(null); setError(null); }}>
                    Abbrechen
                  </button>
                </form>
              ) : (
                <>
                  <h3>
                    {s.person}{" "}
                    <span className="panel-sub">
                      schuldet dir noch {euro(s.offen)} von {euro(s.gesamt)}
                    </span>
                  </h3>
                  <div className="cell-actions">
                    <button className="btn ghost small" onClick={() => setOffenId(offen ? null : s.id)}>
                      {offen ? "schließen" : "Verlauf"}
                    </button>
                    <button
                      className="icon-btn" title="Bearbeiten"
                      onClick={() => { setEditKarte({ id: s.id, person: s.person, notiz: s.notiz ?? "" }); setError(null); }}
                    >
                      <Icon name="bearbeiten" />
                    </button>
                    <button
                      className="icon-btn"
                      title={s.erledigt ? "Wieder öffnen" : "Als vollständig zurückgezahlt markieren"}
                      onClick={() => erledigt(s)}
                    >
                      {s.erledigt ? <Icon name="zurueckholen" /> : <Icon name="haken" />}
                    </button>
                    <button className="icon-btn danger" title="Löschen" onClick={() => loeschen(s)}><Icon name="loeschen" /></button>
                  </div>
                </>
              )}
            </div>

            <div className="tilgung">
              <span className="tilgung-spur">
                <span className="tilgung-fuell" style={{ width: `${anteil}%` }} />
              </span>
              <span className="tilgung-wert">{Math.round(anteil)} % zurückgezahlt</span>
            </div>
            {s.notiz && !bearbeitet && <p className="schuld-notiz">{s.notiz}</p>}

            {offen && (
              <div className="zahl-bereich">
                <form className={`entry-form ${zeilenError ? "has-error" : ""}`} onSubmit={eintragen} noValidate>
                  <div className="art-wahl">
                    <button
                      type="button" className={`seg-btn ${form.art === "leihe" ? "aktiv aus" : ""}`}
                      onClick={() => { setForm({ ...form, art: "leihe" }); setZeilenError(null); }}
                    >
                      geliehen
                    </button>
                    <button
                      type="button" className={`seg-btn ${form.art === "rueck" ? "aktiv ein" : ""}`}
                      onClick={() => { setForm({ ...form, art: "rueck" }); setZeilenError(null); }}
                    >
                      zurückgezahlt
                    </button>
                  </div>
                  <input
                    type="date" aria-label="Datum" value={form.datum}
                    onChange={(e) => { setForm({ ...form, datum: e.target.value }); setZeilenError(null); }}
                  />
                  <input
                    placeholder="Betrag €" aria-label="Betrag" value={form.betrag} inputMode="decimal" style={{ maxWidth: 110 }}
                    onChange={(e) => { setForm({ ...form, betrag: e.target.value }); setZeilenError(null); }}
                  />
                  <input
                    className="wide" placeholder="Notiz" aria-label="Notiz" value={form.notiz}
                    onChange={(e) => setForm({ ...form, notiz: e.target.value })}
                  />
                  <button className="btn" type="submit">
                    <Icon name="plus" /> {form.art === "leihe" ? "Leihe" : "Rückzahlung"}
                  </button>
                </form>
                {zeilenError && <div className="form-error" role="alert"><Icon name="warnung" /> {zeilenError}</div>}

                <ul className="zahl-liste">
                  {verlauf.map((z) => {
                    if (editZeile && editZeile.art === z.art && editZeile.id === z.id) {
                      return (
                        <li key={`${z.art}-${z.id}`} className="zahl-edit">
                          <form className="entry-form" onSubmit={zeileSpeichern} noValidate>
                            <span className="zahl-art">{z.art === "leihe" ? "geliehen" : "zurückgezahlt"}</span>
                            <input
                              type="date" aria-label="Datum" value={editZeile.datum}
                              onChange={(e) => { setEditZeile({ ...editZeile, datum: e.target.value }); setZeilenError(null); }}
                            />
                            <input
                              aria-label="Betrag" value={editZeile.betrag} inputMode="decimal" style={{ maxWidth: 110 }} autoFocus
                              onChange={(e) => { setEditZeile({ ...editZeile, betrag: e.target.value }); setZeilenError(null); }}
                            />
                            <input
                              className="wide" placeholder="Notiz" aria-label="Notiz" value={editZeile.notiz ?? ""}
                              onChange={(e) => setEditZeile({ ...editZeile, notiz: e.target.value })}
                            />
                            <button className="btn" type="submit">Speichern</button>
                            <button className="btn ghost" type="button" onClick={() => { setEditZeile(null); setZeilenError(null); }}>
                              Abbrechen
                            </button>
                          </form>
                        </li>
                      );
                    }
                    return (
                      <li key={`${z.art}-${z.id}`}>
                        <span className="zahl-datum">{datumLabel(z.datum)}</span>
                        <span className={`zahl-betrag ${z.art}`} title={z.art === "leihe" ? "geliehen" : "zurückgezahlt"}>
                          {z.art === "leihe" ? "+" : "−"} {euro(parseBetrag(z.betrag))}
                        </span>
                        <span className="zahl-notiz">{z.notiz}</span>
                        <span className="cell-actions">
                          <button className="icon-btn" title="Bearbeiten" onClick={() => { setEditZeile(z); setZeilenError(null); }}>
                            <Icon name="bearbeiten" />
                          </button>
                          <button className="icon-btn danger" title="Entfernen" onClick={() => zeileLoeschen(z)}>
                            <Icon name="loeschen" />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                  {verlauf.length === 0 && <li className="empty">Noch nichts verbucht.</li>}
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
