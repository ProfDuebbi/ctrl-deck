import type { OwnEntry, ForeignEntry } from "./api";

const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Vorfall in der Nachtruhe 22:00–06:00? */
function isNight(uhrzeit: string | null): boolean {
  if (!uhrzeit) return false;
  const h = Number(uhrzeit.split(":")[0]);
  return !Number.isNaN(h) && (h >= 22 || h < 6);
}

/** Zeitspanne in Wochen zwischen erstem und letztem Datum (min. 1). */
function weekSpan(dates: string[]): number {
  const valid = dates.filter(Boolean).sort();
  if (valid.length < 2) return 1;
  const a = new Date(valid[0]).getTime();
  const b = new Date(valid[valid.length - 1]).getTime();
  return Math.max(1, Math.round((b - a) / (7 * 864e5)) || 1);
}

/** Horizontale Balkenzeile fuer die Auswertung. */
function bar(label: string, count: number, max: number, accent: string): string {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return `
    <div class="bar-row">
      <span class="bar-label">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${accent}"></span></span>
      <span class="bar-count">${count}</span>
    </div>`;
}

export interface ReportRange {
  from: string; // "" = offen
  to: string;
}

/**
 * Briefkopf des Beweispapiers. Stand frueher fest im Code — in einem
 * Dokument, das man einem Vermieter vorlegt, ist das genau die Stelle, an der
 * jeder seine eigenen Angaben braucht. Leere Felder werden weggelassen.
 */
export interface Beteiligte {
  mieter: string;
  vermieter: string;
}

export function generateReport(
  own: OwnEntry[],
  foreign: ForeignEntry[],
  range: ReportRange,
  beteiligte: Beteiligte
): boolean {
  const inRange = (d: string) => (!range.from || d >= range.from) && (!range.to || d <= range.to);
  const ownF = own.filter((r) => inRange(r.datum)).sort((a, b) => a.datum.localeCompare(b.datum));
  const forF = foreign.filter((r) => inRange(r.datum)).sort((a, b) => a.datum.localeCompare(b.datum) || (a.uhrzeit ?? "").localeCompare(b.uhrzeit ?? ""));

  // Auswertung Fremdgeraeusche
  const byVer = new Map<string, number>();
  const byDay = new Array(7).fill(0);
  let nights = 0;
  for (const r of forF) {
    byVer.set(r.verursacher, (byVer.get(r.verursacher) ?? 0) + 1);
    byDay[new Date(r.datum).getDay()]++;
    if (isNight(r.uhrzeit)) nights++;
  }
  const verRows = [...byVer.entries()].sort((a, b) => b[1] - a[1]);
  const maxVer = Math.max(1, ...verRows.map((x) => x[1]));
  const maxDay = Math.max(1, ...byDay);
  const sundays = byDay[0];
  const weeks = weekSpan(forF.map((r) => r.datum));
  const perWeek = forF.length ? (forF.length / weeks).toFixed(1) : "0";

  // Auswertung Eigenes
  const sessions = ownF.filter((r) => r.dauer_min != null);
  const totalMin = sessions.reduce((s, r) => s + (r.dauer_min ?? 0), 0);
  const longest = sessions.reduce((m, r) => Math.max(m, r.dauer_min ?? 0), 0);
  const avgMin = sessions.length ? Math.round(totalMin / sessions.length) : 0;
  const restCount = ownF.length - sessions.length;
  const ownByDay = new Array(7).fill(0);
  const byAct = new Map<string, number>();
  for (const r of sessions) ownByDay[new Date(r.datum).getDay()]++;
  for (const r of ownF) byAct.set(r.aktivitaet || "—", (byAct.get(r.aktivitaet || "—") ?? 0) + 1);
  const actRows = [...byAct.entries()].sort((a, b) => b[1] - a[1]);
  const maxOwnDay = Math.max(1, ...ownByDay);
  const maxAct = Math.max(1, ...actRows.map((x) => x[1]));

  const zeitraum = range.from || range.to
    ? `${range.from ? fmtDate(range.from) : "Beginn"} – ${range.to ? fmtDate(range.to) : "heute"}`
    : "gesamter erfasster Zeitraum";

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Lärmprotokoll – Bericht</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1a1d27; font-size: 12px; line-height: 1.5; margin: 0; }
  .doc { max-width: 800px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #e5308c; color: #16202e; }
  .accent { color: #2a7de1; }
  .kopf { border: 1px solid #d7dce6; border-radius: 8px; padding: 14px 18px; background: #f6f8fc; margin-top: 14px; }
  .kopf div { margin: 2px 0; }
  .muted { color: #5a6272; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #eef2fb; text-align: left; padding: 7px 9px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; color: #46506a; border: 1px solid #d7dce6; }
  td { padding: 6px 9px; border: 1px solid #e2e7f0; vertical-align: top; }
  tr:nth-child(even) td { background: #fafbfe; }
  .rest td { color: #7a8194; font-style: italic; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  .stat { flex: 1; min-width: 120px; border: 1px solid #d7dce6; border-radius: 8px; padding: 10px 12px; }
  .stat b { display: block; font-size: 19px; }
  .stat span { font-size: 10.5px; color: #5a6272; text-transform: uppercase; letter-spacing: .4px; }
  .bar-row { display: flex; align-items: center; gap: 10px; margin: 5px 0; }
  .bar-label { width: 200px; font-size: 11px; }
  .bar-track { flex: 1; height: 14px; background: #eef2fb; border-radius: 7px; overflow: hidden; }
  .bar-fill { display: block; height: 100%; }
  .bar-count { width: 28px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .hint { background: #fff3f8; border: 1px solid #f3c2d9; border-radius: 8px; padding: 10px 12px; margin-top: 10px; font-size: 11.5px; }
  .foot { margin-top: 30px; padding-top: 10px; border-top: 1px solid #d7dce6; font-size: 10px; color: #8a91a3; }
  .toolbar { position: sticky; top: 0; background: #fff; padding: 12px 0; text-align: right; border-bottom: 1px solid #eee; }
  .toolbar button { font: inherit; cursor: pointer; background: linear-gradient(120deg,#2a7de1,#e5308c); color:#fff; border:none; border-radius:8px; padding:9px 18px; font-weight:600; }
  @media print { .toolbar { display: none; } .doc { padding: 0; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">Als PDF speichern / Drucken</button></div>
<div class="doc">
  <h1>Lärm­protokoll – <span class="accent">Beweis­dokumentation</span></h1>
  <div class="muted">Erstellt am ${fmtDate(new Date().toISOString().slice(0, 10))} · CTRL·DECK</div>

  <div class="kopf">
    ${beteiligte.mieter ? `<div><b>Mieter:</b> ${esc(beteiligte.mieter)}</div>` : ""}
    ${beteiligte.vermieter ? `<div><b>Vermieter:</b> ${esc(beteiligte.vermieter)}</div>` : ""}
    <div><b>Berücksichtigter Zeitraum:</b> ${esc(zeitraum)}</div>
    <div class="muted">Eigene Einträge: ${ownF.length} · Fremdgeräusche/Vorfälle Dritter: ${forF.length}</div>
  </div>

  <h2>Auswertung – Vorfälle durch Dritte</h2>
  <div class="stats">
    <div class="stat"><b>${forF.length}</b><span>Vorfälle gesamt</span></div>
    <div class="stat"><b>${nights}</b><span>in Nachtruhe (22–6 Uhr)</span></div>
    <div class="stat"><b>${sundays}</b><span>an Sonntagen</span></div>
    <div class="stat"><b>${perWeek}</b><span>Ø pro Woche</span></div>
  </div>

  ${verRows.length ? `<h2>Vorfälle nach Verursacher</h2>${verRows.map(([v, c]) => bar(v, c, maxVer, "#e5308c")).join("")}` : ""}
  ${forF.length ? `<h2>Vorfälle nach Wochentag</h2>${byDay.map((c, i) => bar(WEEKDAYS_LONG[i], c, maxDay, i === 0 ? "#e5308c" : "#2a7de1")).join("")}
  ${sundays > 0 ? `<div class="hint"><b>Hinweis:</b> ${sundays} von ${forF.length} dokumentierten Vorfällen ereigneten sich an Sonntagen (Sonn- und Feiertagsruhe).</div>` : ""}
  ${nights > 0 ? `<div class="hint"><b>Hinweis:</b> ${nights} von ${forF.length} dokumentierten Vorfällen fielen in die gesetzliche Nachtruhe (22:00–6:00 Uhr).</div>` : ""}` : ""}

  <h2>Auswertung – Eigenes Protokoll</h2>
  <div class="stats">
    <div class="stat"><b>${sessions.length}</b><span>Sessions</span></div>
    <div class="stat"><b>${fmtDur(totalMin)}</b><span>Gesamtdauer</span></div>
    <div class="stat"><b>${sessions.length ? fmtDur(avgMin) : "–"}</b><span>Ø je Session</span></div>
    <div class="stat"><b>${longest ? fmtDur(longest) : "–"}</b><span>längste Session</span></div>
    <div class="stat"><b>${restCount}</b><span>dok. Ruhephasen</span></div>
  </div>

  ${sessions.length ? `<h2>Eigene Sessions nach Wochentag</h2>${ownByDay.map((c, i) => bar(WEEKDAYS_LONG[i], c, maxOwnDay, i === 0 ? "#e5308c" : "#2a7de1")).join("")}` : ""}
  ${actRows.length ? `<h2>Eigene Einträge nach Aktivität</h2>${actRows.map(([a, c]) => bar(a, c, maxAct, "#2a7de1")).join("")}` : ""}

  <h2>Tabelle 1 – Eigenes Protokoll</h2>
  <table>
    <thead><tr><th>Datum</th><th>Start</th><th>Ende</th><th>Dauer</th><th>Aktivität</th><th>Lautstärke</th><th>Bemerkung</th></tr></thead>
    <tbody>
      ${ownF.length ? ownF.map((r) => `<tr class="${r.dauer_min == null ? "rest" : ""}">
        <td>${fmtDate(r.datum)}</td><td>${esc(r.start) || "–"}</td><td>${esc(r.ende) || "–"}</td>
        <td>${r.dauer_min != null ? fmtDur(r.dauer_min) : "–"}</td><td>${esc(r.aktivitaet)}</td>
        <td>${esc(r.lautstaerke) || "–"}</td><td>${esc(r.bemerkung)}</td></tr>`).join("")
        : `<tr><td colspan="7" style="text-align:center;color:#8a91a3">Keine Einträge im Zeitraum.</td></tr>`}
    </tbody>
  </table>

  <h2>Tabelle 2 – Fremdgeräusche / Lärm durch Dritte</h2>
  <table>
    <thead><tr><th>Datum</th><th>Uhrzeit</th><th>Verursacher</th><th>Art des Lärms</th><th>Bemerkung / Einordnung</th></tr></thead>
    <tbody>
      ${forF.length ? forF.map((r) => `<tr>
        <td>${fmtDate(r.datum)}</td><td>${esc(r.uhrzeit) || "–"}</td><td>${esc(r.verursacher)}</td>
        <td>${esc(r.art)}</td><td>${esc(r.bemerkung)}</td></tr>`).join("")
        : `<tr><td colspan="5" style="text-align:center;color:#8a91a3">Keine Vorfälle im Zeitraum.</td></tr>`}
    </tbody>
  </table>

  <div class="foot">Dieses Dokument wurde automatisch aus dem privaten CTRL·DECK-Dashboard erstellt. Die Einträge beruhen auf eigenen Beobachtungen und Aufzeichnungen.</div>
</div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    URL.revokeObjectURL(url);
    return false;
  }
  // URL nach kurzem Moment freigeben (Tab hat den Inhalt dann geladen).
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
