import { useState } from "react";
import { su, fmtHM, PROJEKT_FARBEN, type Project } from "./api";
import { useConfirm } from "../../core/ui";
import { Icon } from "../../core/Icon";

/**
 * Die Projektuebersicht — direkt auf der Seite, nicht in einem Fenster.
 *
 * Sie beantwortet drei Fragen auf einen Blick: woran laeuft die Uhr gerade, was
 * ist noch offen, und was ist durch. Deshalb steht in jeder Zeile alles, was
 * ein Projekt zu einem Projekt macht: erfasste Zeit, Zeit dieser Woche, Zahl
 * der Eintraege, letzter Tag.
 *
 * „Beenden" ist bewusst nicht „Loeschen": ein beendetes Projekt verschwindet
 * aus der Stempelauswahl, behaelt aber seine Eintraege samt Zuordnung und
 * bleibt in jeder Auswertung sichtbar. Nur das Loeschen loest die Zuordnung —
 * darum steht es klein am Rand und sagt vorher, was es kostet.
 */
export function ProjektePanel({
  projects,
  laufendId,
  laeuft,
  onStarten,
  onAusstempeln,
  onChanged,
}: {
  projects: Project[];
  laufendId: number | null;
  laeuft: boolean;
  onStarten: (projektId: number) => void | Promise<void>;
  onAusstempeln: () => void | Promise<void>;
  onChanged: () => void | Promise<void>;
}) {
  const confirm = useConfirm();
  const [neu, setNeu] = useState("");
  const [neuFarbe, setNeuFarbe] = useState<string>(PROJEKT_FARBEN[0]);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [zeigeBeendet, setZeigeBeendet] = useState(false);

  const offen = projects.filter((p) => !p.archiviert);
  const beendet = projects.filter((p) => p.archiviert);

  const melde = (e: unknown) =>
    setError(String(e).includes("409") ? "Ein Projekt mit diesem Namen gibt es schon." : "Das hat nicht geklappt.");

  async function anlegen(e: React.FormEvent) {
    e.preventDefault();
    const name = neu.trim();
    if (!name) return setError("Bitte einen Namen angeben.");
    try {
      await su.createProject(name, neuFarbe);
      setNeu("");
      setError(null);
      // Naechste Farbe vorschlagen, damit zwei frische Projekte nicht gleich aussehen.
      const i = PROJEKT_FARBEN.indexOf(neuFarbe as (typeof PROJEKT_FARBEN)[number]);
      setNeuFarbe(PROJEKT_FARBEN[(i + 1) % PROJEKT_FARBEN.length]);
      await onChanged();
    } catch (err) { melde(err); }
  }

  async function speichern(p: Project) {
    const name = editName.trim();
    if (!name) return setError("Der Name darf nicht leer sein.");
    if (name === p.name) { setEditId(null); return; }
    try {
      await su.updateProject(p.id, { name, farbe: p.farbe, archiviert: !!p.archiviert });
      setEditId(null);
      setError(null);
      await onChanged();
    } catch (err) { melde(err); }
  }

  async function farbe(p: Project, f: string) {
    await su.updateProject(p.id, { name: p.name, farbe: f, archiviert: !!p.archiviert });
    await onChanged();
  }

  /**
   * Beenden. Laeuft die Uhr noch auf diesem Projekt, wird sie zuerst gebucht —
   * sonst liefe Zeit weiter auf ein Projekt, das aus jeder Auswahl verschwunden
   * ist, und die Minuten landeten nirgends.
   */
  async function beenden(p: Project) {
    if (laeuft && laufendId === p.id) {
      const ok = await confirm({
        title: "Projekt beenden",
        message: `Auf „${p.name}" läuft die Uhr noch. Sie wird zuerst ausgestempelt — die Zeit bleibt gebucht.`,
        confirmLabel: "Ausstempeln und beenden",
      });
      if (!ok) return;
      await onAusstempeln();
    }
    await su.updateProject(p.id, { name: p.name, farbe: p.farbe, archiviert: true });
    await onChanged();
  }

  async function wiederOeffnen(p: Project) {
    await su.updateProject(p.id, { name: p.name, farbe: p.farbe, archiviert: false });
    await onChanged();
  }

  async function loeschen(p: Project) {
    const ok = await confirm({
      title: "Projekt löschen",
      message: p.eintraege
        ? `„${p.name}" wirklich löschen? Die ${p.eintraege} erfassten Zeiten (${fmtHM(p.gesamtMin)}) bleiben erhalten, verlieren aber ihre Zuordnung — sie zählen danach als „ohne Projekt". Wer das Projekt nur abschließen will, nimmt „Beenden".`
        : `„${p.name}" wirklich löschen? Es hängen keine Zeiten daran.`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await su.removeProject(p.id);
    await onChanged();
  }

  const istLaufend = (p: Project) => laeuft && laufendId === p.id;

  const zeile = (p: Project) => (
    // Die Projektfarbe (`--pf`) haengt an der ganzen Zeile, nicht nur am Punkt:
    // die Haut „Nexus" macht daraus den Farbstreifen am Rand und braucht sie dort.
    <li key={p.id} className={`proj-zeile p-${p.farbe} ${p.archiviert ? "archiviert" : ""} ${istLaufend(p) ? "laufend" : ""}`}>
      <span className={`proj-punkt p-${p.farbe}`} />

      {editId === p.id ? (
        <input
          className="proj-name-edit"
          value={editName}
          autoFocus
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") speichern(p);
            if (e.key === "Escape") setEditId(null);
          }}
          onBlur={() => speichern(p)}
        />
      ) : (
        <button
          className="proj-name"
          title="Umbenennen"
          onClick={() => { setEditId(p.id); setEditName(p.name); setError(null); }}
        >
          {p.name}
        </button>
      )}

      <span className="proj-zeit">{fmtHM(p.gesamtMin)}</span>
      <span className="proj-meta">
        {!p.archiviert && p.wocheMin > 0 && <>diese Woche {fmtHM(p.wocheMin)} · </>}
        {p.eintraege} {p.eintraege === 1 ? "Eintrag" : "Einträge"}
        {p.zuletzt && <> · zuletzt {p.zuletzt.split("-").reverse().join(".")}</>}
      </span>

      <div className="farb-wahl klein">
        {PROJEKT_FARBEN.map((f) => (
          <button
            key={f}
            type="button"
            title={`Farbe ${f}`}
            className={`farb-punkt p-${f} ${p.farbe === f ? "aktiv" : ""}`}
            onClick={() => farbe(p, f)}
          />
        ))}
      </div>

      <div className="proj-aktionen">
        {p.archiviert ? (
          <button className="btn ghost small" onClick={() => wiederOeffnen(p)}>
            <Icon name="zurueckholen" /> Wieder öffnen
          </button>
        ) : istLaufend(p) ? (
          <span className="proj-laeuft"><span className="live-dot" /> läuft</span>
        ) : (
          <button
            className="btn ghost small"
            title={laeuft ? "Laufende Zeit buchen und hier weitermachen" : "Auf dieses Projekt einstempeln"}
            onClick={() => onStarten(p.id)}
          >
            <Icon name="abspielen" /> {laeuft ? "Wechseln" : "Einstempeln"}
          </button>
        )}
        {!p.archiviert && (
          <button className="btn ghost small" title="Projekt abschließen — die erfassten Zeiten bleiben" onClick={() => beenden(p)}>
            <Icon name="archiv" /> Beenden
          </button>
        )}
        <button className="icon-btn danger" title="Löschen" onClick={() => loeschen(p)}>
          <Icon name="loeschen" />
        </button>
      </div>
    </li>
  );

  return (
    <div className="panel proj-panel">
      <div className="panel-head">
        <h3>
          Projekte{" "}
          <span className="panel-sub">
            {offen.length} offen{beendet.length > 0 ? ` · ${beendet.length} beendet` : ""}
          </span>
        </h3>
      </div>

      <form className="proj-add" onSubmit={anlegen}>
        <input
          placeholder="Neues Projekt eröffnen…"
          value={neu}
          onChange={(e) => { setNeu(e.target.value); setError(null); }}
        />
        <div className="farb-wahl">
          {PROJEKT_FARBEN.map((f) => (
            <button
              key={f}
              type="button"
              title={`Farbe ${f}`}
              className={`farb-punkt p-${f} ${neuFarbe === f ? "aktiv" : ""}`}
              onClick={() => setNeuFarbe(f)}
            />
          ))}
        </div>
        <button className="btn" type="submit"><Icon name="plus" /> Eröffnen</button>
      </form>
      {error && <div className="form-error" role="alert"><Icon name="warnung" /> {error}</div>}

      <ul className="proj-liste">
        {offen.map(zeile)}
        {offen.length === 0 && (
          <li className="empty">
            Kein offenes Projekt. Oben eines eröffnen — gestempelte Zeit ohne Projekt geht nicht
            verloren, sie zählt als „ohne Projekt".
          </li>
        )}
      </ul>

      {beendet.length > 0 && (
        <div className="proj-gruppe">
          <button
            className={`proj-gruppe-kopf ${zeigeBeendet ? "offen" : ""}`}
            aria-expanded={zeigeBeendet}
            onClick={() => setZeigeBeendet(!zeigeBeendet)}
          >
            <Icon name="vor" />
            Beendet ({beendet.length})
            <span className="proj-gruppe-hinweis">Zeiten bleiben erhalten</span>
          </button>
          {zeigeBeendet && <ul className="proj-liste">{beendet.map(zeile)}</ul>}
        </div>
      )}
    </div>
  );
}
