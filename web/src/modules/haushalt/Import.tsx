import { useMemo, useState } from "react";
import { hh, euro, datumLabel, type ImportVorschau, type ImportZeile } from "./api";
import { Icon } from "../../core/Icon";
import { useKategorien, useKonten, auswahlNeuLaden } from "./auswahl";
import { Waehler } from "./Waehler";

/** Banken exportieren mal UTF-8, mal Windows-1252 — erst streng UTF-8, sonst das andere. */
async function leseText(datei: File): Promise<string> {
  const roh = await datei.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(roh);
  } catch {
    return new TextDecoder("windows-1252").decode(roh);
  }
}

// Die Grenze des Servers liegt bei 1 MB JSON — das ist ein Jahr Umsätze mit Luft.
const MAX_BYTES = 900_000;

/**
 * Umsätze aus einer CSV des Onlinebankings übernehmen. Liest, zeigt vorher
 * jede Zeile mit ihrer Einordnung und schreibt erst auf ausdrücklichen Klick.
 */
export function Import({ onFertig, onSchliessen }: {
  onFertig: (meldung: string) => void;
  onSchliessen: () => void;
}) {
  const konten = useKonten();
  const kategorien = useKategorien();
  const [konto, setKonto] = useState("");
  const [vorschau, setVorschau] = useState<ImportVorschau | null>(null);
  const [zeilen, setZeilen] = useState<(ImportZeile & { an: boolean })[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function datei(f: File | undefined) {
    if (!f) return;
    setFehler(null);
    setVorschau(null);
    if (f.size > MAX_BYTES) {
      setFehler("Die Datei ist zu groß. Bitte einen kürzeren Zeitraum exportieren (höchstens etwa ein Jahr).");
      return;
    }
    setLaeuft(true);
    try {
      const v = await hh.importVorschau(await leseText(f));
      setVorschau(v);
      // Vorbelegt ist nur, was wirklich neu ist. Was schon von Hand erfasst
      // scheint, bleibt aus — doppelt gebucht ist schlimmer als vergessen.
      setZeilen(v.zeilen.map((z) => ({ ...z, an: z.status === "neu" })));
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  const zahl = useMemo(() => {
    const n = { neu: 0, erfasst: 0, importiert: 0, an: 0 };
    for (const z of zeilen) { n[z.status]++; if (z.an) n.an++; }
    return n;
  }, [zeilen]);

  const setze = (ref: string, patch: Partial<ImportZeile & { an: boolean }>) =>
    setZeilen((alt) => alt.map((z) => (z.ref === ref ? { ...z, ...patch } : z)));

  async function uebernehmen() {
    setLaeuft(true);
    try {
      const r = await hh.importieren({
        konto: konto || null,
        zeilen: zeilen
          .filter((z) => z.an && z.status !== "importiert")
          .map(({ ref, datum, art, betrag, empfaenger, notiz, kategorie }) =>
            ({ ref, datum, art, betrag, empfaenger, notiz, kategorie })),
        // Abgewählte Treffer gelten als „hab ich schon" — die Buchung merkt
        // sich die Auszugszeile und taucht beim nächsten Import nicht wieder auf.
        zuordnen: zeilen
          .filter((z) => !z.an && z.status === "erfasst" && z.treffer)
          .map((z) => ({ buchung_id: z.treffer!.id, ref: z.ref })),
      });
      const teile = [`${r.angelegt} ${r.angelegt === 1 ? "Buchung" : "Buchungen"} übernommen`];
      if (r.zugeordnet) teile.push(`${r.zugeordnet} vorhandene zugeordnet`);
      if (r.doppelt) teile.push(`${r.doppelt} waren schon da`);
      auswahlNeuLaden();
      onFertig(teile.join(", ") + ".");
    } catch (e) {
      setFehler((e as Error).message);
      setLaeuft(false);
    }
  }

  return (
    <div className="panel hh-import">
      <div className="panel-head">
        <h3>Kontoauszug importieren <span className="panel-sub">CSV aus dem Onlinebanking</span></h3>
        <button className="icon-btn" onClick={onSchliessen} aria-label="Import schließen"><Icon name="schliessen" /></button>
      </div>

      <div className="hh-import-wahl">
        <label className="btn ghost">
          <Icon name="dokument" /> {vorschau ? "Andere Datei" : "Datei wählen"}
          <input
            type="file" accept=".csv,.txt,text/csv" hidden
            onChange={(e) => { datei(e.target.files?.[0]); e.target.value = ""; }}
          />
        </label>
        <Waehler wert={konto} onWahl={setKonto} liste={konten} platzhalter="Konto" title="Konto, auf das gebucht wird" className="hh-waehler" />
        <p className="modal-hinweis">
          Im Onlinebanking die Umsätze als CSV exportieren (Commerzbank, Sparkasse, ING, DKB, PayPal …).
          Die Datei wird nur von diesem CTRL·DECK gelesen. Vor dem Übernehmen siehst du jede Zeile.
        </p>
      </div>

      {laeuft && !vorschau && <p className="empty">Lese die Datei …</p>}
      {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}

      {vorschau && (
        <>
          <p className="hh-import-info">
            {zeilen.length} Umsätze erkannt: {zahl.neu} neu
            {zahl.erfasst > 0 && <>, {zahl.erfasst} vermutlich schon von Hand erfasst</>}
            {zahl.importiert > 0 && <>, {zahl.importiert} schon importiert</>}
            {vorschau.uebersprungen > 0 && <>, {vorschau.uebersprungen} Zeilen ohne Datum oder Betrag übersprungen</>}.
            <span className="hh-import-spalten">
              Gelesen aus „{vorschau.spalten.datum}“, „{vorschau.spalten.betrag}“
              {vorschau.spalten.empfaenger && <>, „{vorschau.spalten.empfaenger}“</>}
              {vorschau.spalten.zweck && <>, „{vorschau.spalten.zweck}“</>}
            </span>
          </p>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th></th><th>Datum</th><th>Betrag</th><th>Empfänger</th><th>Kategorie</th><th>Stand</th></tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.ref} className={z.an ? "" : "hh-import-aus"}>
                    <td>
                      <input
                        type="checkbox" checked={z.an} disabled={z.status === "importiert"}
                        aria-label="übernehmen" onChange={(e) => setze(z.ref, { an: e.target.checked })}
                      />
                    </td>
                    <td>{datumLabel(z.datum)}</td>
                    <td className={`buch-betrag ${z.art}`}>{z.art === "eingang" ? "+" : "−"} {euro(z.betrag)}</td>
                    <td>
                      <input
                        className="hh-import-feld" value={z.empfaenger ?? ""} title={z.notiz ?? ""}
                        onChange={(e) => setze(z.ref, { empfaenger: e.target.value || null })}
                        disabled={z.status === "importiert"}
                      />
                    </td>
                    <td>
                      <Waehler
                        wert={z.kategorie ?? ""} liste={kategorien} platzhalter="Kategorie"
                        className="hh-import-feld" disabled={z.status === "importiert"}
                        onWahl={(v) => setze(z.ref, { kategorie: v || null })}
                      />
                    </td>
                    <td className="cell-note">
                      {z.status === "neu" && "neu"}
                      {z.status === "importiert" && "schon importiert"}
                      {z.status === "erfasst" && z.treffer && (
                        <>schon erfasst am {datumLabel(z.treffer.datum)}{z.treffer.empfaenger ? ` (${z.treffer.empfaenger})` : ""}</>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="modal-actions">
            <button className="btn ghost" onClick={onSchliessen}>Abbrechen</button>
            <button className="btn" onClick={uebernehmen} disabled={laeuft || (zahl.an === 0 && zahl.erfasst === 0)}>
              <Icon name="haken" /> {zahl.an} übernehmen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
