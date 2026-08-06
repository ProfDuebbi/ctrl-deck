import { useMemo, useState } from "react";
import type { OwnEntry, ForeignEntry } from "./api";
import { Icon } from "../../core/Icon";

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const WD_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Wochentag-Index Mo=0 … So=6 aus "YYYY-MM-DD". */
function weekdayIdx(datum: string): number | null {
  const d = new Date(datum + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return (d.getDay() + 6) % 7;
}

/** Ist die Uhrzeit (HH:MM) in der Nachtruhe 22:00–06:00? */
function isNight(uhrzeit: string | null): boolean {
  if (!uhrzeit) return false;
  const h = Number(uhrzeit.split(":")[0]);
  if (Number.isNaN(h)) return false;
  return h >= 22 || h < 6;
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/** Zeitspanne in Wochen zwischen erstem und letztem Datum (min. 1). */
function weekSpan(dates: string[]): number {
  const valid = dates.filter(Boolean).sort();
  if (valid.length < 2) return 1;
  const a = new Date(valid[0] + "T00:00:00").getTime();
  const b = new Date(valid[valid.length - 1] + "T00:00:00").getTime();
  return Math.max(1, Math.round((b - a) / (7 * 864e5)) || 1);
}

function Kpi({ num, lbl, accent }: { num: string | number; lbl: string; accent?: boolean }) {
  return (
    <div className="kpi">
      <span className={`kpi-num ${accent ? "accent" : ""}`}>{num}</span>
      <span className="kpi-lbl">{lbl}</span>
    </div>
  );
}

/** Balkendiagramm aus [Label, Wert]-Paaren, absteigend sortiert. */
function BarChart({ title, data, highlight }: { title: string; data: [string, number][]; highlight?: string }) {
  const max = Math.max(1, ...data.map(([, v]) => v));
  const rows = data.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div className="stat-chart">
      <h4 className="stat-chart-title">{title}</h4>
      {rows.length === 0 ? (
        <p className="stat-empty">keine Daten</p>
      ) : (
        rows.map(([label, val]) => (
          <div className="bar-row" key={label}>
            <span className="bar-lbl" title={label}>{label}</span>
            <div className="bar-track">
              <div
                className={`bar-fill ${highlight && label.startsWith(highlight) ? "hot" : ""}`}
                style={{ width: `${(val / max) * 100}%` }}
              />
            </div>
            <span className="bar-val">{val}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function Stats({ tab, own, foreign }: { tab: "own" | "foreign"; own: OwnEntry[]; foreign: ForeignEntry[] }) {
  const [open, setOpen] = useState(true);

  const ownStats = useMemo(() => {
    const sessions = own.filter((r) => r.dauer_min != null);
    const totalMin = sessions.reduce((s, r) => s + (r.dauer_min ?? 0), 0);
    const longest = sessions.reduce((m, r) => Math.max(m, r.dauer_min ?? 0), 0);
    const byDay = WEEKDAYS.map((_, i) => [WD_SHORT[i], 0] as [string, number]);
    for (const r of sessions) {
      const i = weekdayIdx(r.datum);
      if (i != null) byDay[i][1] += 1;
    }
    const byAct = new Map<string, number>();
    for (const r of own) byAct.set(r.aktivitaet || "—", (byAct.get(r.aktivitaet || "—") ?? 0) + 1);
    return {
      count: own.length,
      sessions: sessions.length,
      totalMin,
      avgMin: sessions.length ? Math.round(totalMin / sessions.length) : 0,
      longest,
      byDay,
      byAct: [...byAct.entries()] as [string, number][],
    };
  }, [own]);

  const forStats = useMemo(() => {
    const night = foreign.filter((r) => isNight(r.uhrzeit)).length;
    const sunday = foreign.filter((r) => weekdayIdx(r.datum) === 6).length;
    const weeks = weekSpan(foreign.map((r) => r.datum));
    const byDay = WEEKDAYS.map((_, i) => [WD_SHORT[i], 0] as [string, number]);
    for (const r of foreign) {
      const i = weekdayIdx(r.datum);
      if (i != null) byDay[i][1] += 1;
    }
    const byCause = new Map<string, number>();
    for (const r of foreign) byCause.set(r.verursacher || "—", (byCause.get(r.verursacher || "—") ?? 0) + 1);
    return {
      count: foreign.length,
      night,
      sunday,
      perWeek: foreign.length ? (foreign.length / weeks).toFixed(1) : "0",
      byDay,
      byCause: [...byCause.entries()] as [string, number][],
    };
  }, [foreign]);

  return (
    <section className={`stats-panel ${open ? "" : "closed"}`}>
      <button className="stats-toggle" onClick={() => setOpen((o) => !o)}>
        <span className={`stats-caret ${open ? "open" : ""}`}><Icon name="vor" /></span> Statistik
      </button>

      {open && tab === "own" && (
        <div className="stats-body">
          <div className="stats-kpis">
            <Kpi num={ownStats.sessions} lbl="Sessions" />
            <Kpi num={fmtMin(ownStats.totalMin)} lbl="Gesamtdauer" accent />
            <Kpi num={ownStats.avgMin ? fmtMin(ownStats.avgMin) : "–"} lbl="Ø je Session" />
            <Kpi num={ownStats.longest ? fmtMin(ownStats.longest) : "–"} lbl="längste" />
            <Kpi num={ownStats.count} lbl="Einträge gesamt" />
          </div>
          <div className="stats-charts">
            <BarChart title="Nach Wochentag" data={ownStats.byDay} highlight="So" />
            <BarChart title="Nach Aktivität" data={ownStats.byAct} />
          </div>
        </div>
      )}

      {open && tab === "foreign" && (
        <div className="stats-body">
          <div className="stats-kpis">
            <Kpi num={forStats.count} lbl="Vorfälle gesamt" />
            <Kpi num={forStats.night} lbl="in Nachtruhe (22–6)" accent />
            <Kpi num={forStats.sunday} lbl="an Sonntagen" />
            <Kpi num={forStats.perWeek} lbl="Ø pro Woche" />
          </div>
          <div className="stats-charts">
            <BarChart title="Nach Verursacher" data={forStats.byCause} />
            <BarChart title="Nach Wochentag" data={forStats.byDay} highlight="So" />
          </div>
        </div>
      )}
    </section>
  );
}
