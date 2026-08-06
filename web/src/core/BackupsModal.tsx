import { useEffect, useState } from "react";
import { api } from "./api";
import { Modal, useConfirm } from "./ui";
import { Icon } from "./Icon";

interface BackupInfo {
  name: string;
  size: number;
  at: string;
  auto: boolean;
  safety: boolean;
  /** Mitgesicherte Tresor-Anhänge. */
  dateien: number;
}

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Zustand der Sicherung auf dem zweiten Laufwerk (siehe server/src/externBackup.ts). */
interface ExternStatus {
  pfad: string;
  aktiv: boolean;
  erreichbar: boolean;
  zuletzt: string | null;
  fehler: string | null;
  anzahl: number;
  groesse: number;
  behalten: number;
}

interface ExternErgebnis {
  ok: boolean;
  kopiert: number;
  entfernt: number;
  uebersprungen: boolean;
  fehler: string | null;
  status: ExternStatus;
}

const tagesStempel = (d: Date) => d.toLocaleDateString("sv-SE"); // lokal, nicht UTC

/** „heute 03:12" / „gestern" / „vor 5 Tagen" — die Zahl zaehlt Kalendertage. */
function wann(iso: string): { text: string; tage: number } {
  const d = new Date(iso);
  const heute = new Date();
  const gestern = new Date(heute);
  gestern.setDate(gestern.getDate() - 1);
  const stempel = tagesStempel(d);
  const tage = Math.max(
    0,
    Math.round(
      (new Date(tagesStempel(heute)).getTime() - new Date(stempel).getTime()) / 86400000
    )
  );
  if (stempel === tagesStempel(heute))
    return { text: `heute ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`, tage };
  if (stempel === tagesStempel(gestern)) return { text: "gestern", tage };
  return { text: `vor ${tage} Tagen`, tage };
}

/**
 * Sicherung auf ein zweites Laufwerk.
 *
 * Ohne sie liegen Datenbank, Tresor-Anhaenge und alle Sicherungen auf
 * derselben Platte — ein Hardware-Ausfall nimmt alles zusammen mit.
 */
function ExternPanel({ frisch }: { frisch: number }) {
  const [st, setSt] = useState<ExternStatus | null>(null);
  const [pfad, setPfad] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const uebernehmen = (s: ExternStatus) => { setSt(s); setPfad(s.pfad); };
  // `frisch` zaehlt hoch, sobald nebenan gesichert wurde — der Server hat dann
  // schon mitgespiegelt, und diese Anzeige holt sich den neuen Stand.
  useEffect(() => { api<ExternStatus>("/extern").then(uebernehmen); }, [frisch]);

  function melde(e: ExternErgebnis) {
    uebernehmen(e.status);
    setMsg(
      e.ok
        ? e.kopiert > 0
          ? `${e.kopiert} Sicherung${e.kopiert === 1 ? "" : "en"} kopiert`
          : "war bereits aktuell"
        : e.fehler ?? (e.uebersprungen ? "kein Ziel eingerichtet" : "nicht möglich")
    );
    setTimeout(() => setMsg(null), 5000);
  }

  async function lauf(was: "speichern" | "sync") {
    setBusy(was === "speichern" ? "prüft Ziel…" : "spiegelt…");
    try {
      const e =
        was === "speichern"
          ? await api<ExternErgebnis>("/extern", { method: "PUT", body: JSON.stringify({ pfad }) })
          : await api<ExternErgebnis>("/extern/sync", { method: "POST" });
      melde(e);
    } catch {
      setMsg("Server nicht erreichbar");
    } finally {
      setBusy(null);
    }
  }

  if (!st) return null;

  const letzte = st.zuletzt ? wann(st.zuletzt) : null;
  // Achtung ist faellig, wenn das Laufwerk fehlt, etwas schiefging oder seit
  // mehreren Tagen nichts mehr extern liegt.
  const achtung = st.aktiv && (!st.erreichbar || !!st.fehler || !letzte || letzte.tage >= 3);

  return (
    <div className="extern-panel">
      <div className="extern-kopf">
        <span className="extern-titel"><Icon name="platte" /> Zweites Laufwerk</span>
        {st.aktiv && (
          <span className={`extern-status${achtung ? " warn" : ""}`}>
            {achtung && <Icon name="warnung" />}
            {!st.erreichbar
              ? "Laufwerk nicht erreichbar"
              : letzte
                ? `zuletzt gespiegelt: ${letzte.text}`
                : "noch nie gespiegelt"}
          </span>
        )}
      </div>

      <div className="extern-zeile">
        <input
          className="extern-pfad"
          value={pfad}
          onChange={(e) => setPfad(e.target.value)}
          placeholder="z. B. D:\CTRL-DECK-Backups"
          aria-label="Zielordner auf dem zweiten Laufwerk"
          spellCheck={false}
        />
        <button className="btn ghost small" disabled={busy !== null || pfad.trim() === st.pfad} onClick={() => lauf("speichern")}>
          Ziel speichern
        </button>
        <button className="btn ghost small" disabled={busy !== null || !st.aktiv} onClick={() => lauf("sync")}>
          <Icon name="platte" /> Jetzt spiegeln
        </button>
        {(busy || msg) && <span className="backup-inline-msg">{busy ?? msg}</span>}
      </div>

      <div className="extern-hinweis">
        {st.aktiv ? (
          <>
            {st.erreichbar
              ? `${st.anzahl} Stände dort · ${fmtSize(st.groesse)}`
              : "wird beim nächsten Start automatisch nachgeholt"}
            {" · "}Läuft bei jeder Sicherung mit, die letzten {st.behalten} bleiben liegen.
            {st.fehler && st.erreichbar && ` · Letzter Fehler: ${st.fehler}`}
          </>
        ) : (
          "Nicht eingerichtet — Datenbank, Tresor-Anhänge und alle Sicherungen liegen auf derselben Platte. Ein Ordner auf einem anderen Laufwerk genügt."
        )}
      </div>
    </div>
  );
}

function kind(b: BackupInfo) {
  if (b.safety) return { label: "vor Wiederherstellung", cls: "q-uebertrag" };
  if (b.auto) return { label: "automatisch", cls: "q-stempel" };
  return { label: "manuell", cls: "q-manuell" };
}

export function BackupsModal({ onClose }: { onClose: () => void }) {
  const confirm = useConfirm();
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [frisch, setFrisch] = useState(0);

  const reload = () => api<BackupInfo[]>("/backups").then(setList);
  useEffect(() => { reload(); }, []);

  async function backupNow() {
    setMsg("sichert…");
    await api("/backup", { method: "POST" });
    await reload();
    setFrisch((n) => n + 1); // der Server hat gerade auch extern gespiegelt
    setMsg("Backup erstellt");
    setTimeout(() => setMsg(null), 3000);
  }

  async function restore(b: BackupInfo) {
    const ok = await confirm({
      title: "Backup wiederherstellen",
      message:
        `„${b.name}" wiederherstellen? Der aktuelle Stand wird vorher automatisch gesichert. ` +
        `Die Tresor-Anhänge werden auf den Stand dieser Sicherung zurückgesetzt${b.dateien > 0 ? ` (${b.dateien} Dateien)` : " (keine Dateien)"}. ` +
        `Danach lädt CTRL·DECK neu.`,
      confirmLabel: "Wiederherstellen",
      danger: true,
    });
    if (!ok) return;
    await api("/backups/restore", { method: "POST", body: JSON.stringify({ name: b.name }) });
    // Nach dem DB-Tausch alles frisch laden.
    window.location.reload();
  }

  async function del(b: BackupInfo) {
    const ok = await confirm({ title: "Backup löschen", message: `„${b.name}" endgültig löschen?`, confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    await api(`/backups/${encodeURIComponent(b.name)}`, { method: "DELETE" });
    await reload();
    setFrisch((n) => n + 1);
  }

  return (
    <Modal title="Backups verwalten" onClose={onClose}>
      <div className="backup-toolbar">
        <button className="btn" onClick={backupNow}><Icon name="backup" /> Jetzt sichern</button>
        {msg && <span className="backup-inline-msg">{msg}</span>}
        <span className="filter-count">Automatisch täglich beim Start · die letzten 14 werden behalten</span>
      </div>

      <ExternPanel frisch={frisch} />

      <div className="backup-list">
        {list === null && <div className="empty">lädt…</div>}
        {list && list.length === 0 && <div className="empty">Noch keine Backups.</div>}
        {list?.map((b) => {
          const k = kind(b);
          return (
            <div className="backup-row" key={b.name}>
              <div className="backup-meta">
                <span className={`q-badge ${k.cls}`}>{k.label}</span>
                <span className="backup-date">
                  {new Date(b.at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
                </span>
                <span className="backup-size">{fmtSize(b.size)}</span>
                {b.dateien > 0 && (
                  <span className="backup-size" title="Verschlüsselte Tresor-Anhänge in dieser Sicherung">
                    <Icon name="anhang" /> {b.dateien}
                  </span>
                )}
              </div>
              <div className="backup-actions">
                <button className="btn ghost small" onClick={() => restore(b)}>Wiederherstellen</button>
                <button className="icon-btn danger" title="Löschen" onClick={() => del(b)}><Icon name="loeschen" /></button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
