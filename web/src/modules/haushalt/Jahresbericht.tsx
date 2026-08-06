import { useCallback, useEffect, useState } from "react";
import { hh, euro, MONATE, type JahrRow, type JahrDetail } from "./api";

/** Jahresübersicht wie im alten Sheet — Monatszeilen plus Jahresvergleich. */
export function Jahresbericht() {
  const [jahre, setJahre] = useState<JahrRow[]>([]);
  const [gewaehlt, setGewaehlt] = useState<number>(() => new Date().getFullYear());
  const [detail, setDetail] = useState<JahrDetail | null>(null);

  const ladenJahre = useCallback(() => hh.jahre().then(setJahre), []);
  useEffect(() => { ladenJahre(); }, [ladenJahre]);
  useEffect(() => { hh.jahr(gewaehlt).then(setDetail); }, [gewaehlt]);

  const maxJahr = Math.max(1, ...jahre.map((j) => Math.max(j.eingang, j.ausgang)));
  const auswahl = [...new Set([...jahre.map((j) => j.jahr), new Date().getFullYear()])].sort((a, b) => b - a);

  return (
    <>
      {/* Jahresvergleich */}
      <div className="panel">
        <div className="panel-head">
          <h3>Jahre im Vergleich</h3>
        </div>
        {jahre.length === 0 ? (
          <p className="empty">Noch keine Jahresdaten.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Jahr</th><th>Eingang</th><th>Ausgang</th><th>Differenz</th><th>Verlauf</th><th>Quelle</th></tr>
              </thead>
              <tbody>
                {jahre.map((j) => (
                  <tr key={j.jahr} className={j.jahr === gewaehlt ? "jahr-aktiv" : ""}>
                    <td>
                      <button className="jahr-link" onClick={() => setGewaehlt(j.jahr)}>{j.jahr}</button>
                    </td>
                    <td className="buch-betrag eingang">{euro(j.eingang)}</td>
                    <td className="buch-betrag ausgang">{euro(j.ausgang)}</td>
                    <td className={j.differenz < 0 ? "hh-minus" : "hh-plus"}>{euro(j.differenz)}</td>
                    <td>
                      <span className="doppelbalken">
                        <span className="db-ein" style={{ width: `${(j.eingang / maxJahr) * 100}%` }} />
                        <span className="db-aus" style={{ width: `${(j.ausgang / maxJahr) * 100}%` }} />
                      </span>
                    </td>
                    <td>
                      {j.historisch && j.buchungen === 0
                        ? <span className="q-badge">Altbestand</span>
                        : <span className="text-faint">{j.buchungen} Buchungen</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Monatszeilen des gewählten Jahres */}
      <div className="panel">
        <div className="panel-head">
          <h3>
            Monate <span className="panel-sub">{gewaehlt}</span>
          </h3>
          <select className="proj-select" aria-label="Jahr" value={gewaehlt} onChange={(e) => setGewaehlt(Number(e.target.value))}>
            {auswahl.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>

        {detail?.uebertrag && detail.monate.every((m) => !m.eingang && !m.ausgang) && (
          <p className="hinweis">
            Für {gewaehlt} liegen nur die Jahressummen aus dem alten Haushaltsbuch vor
            ({euro(detail.uebertrag.eingang)} ein / {euro(detail.uebertrag.ausgang)} aus) — keine Einzelbuchungen.
          </p>
        )}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Monat</th><th>Eingang</th><th>Ausgang</th><th>Differenz</th></tr>
            </thead>
            <tbody>
              {detail?.monate.map((m) => (
                <tr key={m.monat} className={!m.eingang && !m.ausgang ? "rest-row" : ""}>
                  <td>{MONATE[m.monat - 1]}</td>
                  <td className="buch-betrag eingang">{euro(m.eingang)}</td>
                  <td className="buch-betrag ausgang">{euro(m.ausgang)}</td>
                  <td className={m.eingang - m.ausgang < 0 ? "hh-minus" : ""}>{euro(m.eingang - m.ausgang)}</td>
                </tr>
              ))}
              {detail && (
                <tr className="summen-zeile">
                  <td><strong>Summe {gewaehlt}</strong></td>
                  <td className="buch-betrag eingang"><strong>{euro(detail.eingang)}</strong></td>
                  <td className="buch-betrag ausgang"><strong>{euro(detail.ausgang)}</strong></td>
                  <td className={detail.differenz < 0 ? "hh-minus" : ""}><strong>{euro(detail.differenz)}</strong></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
