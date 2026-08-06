import { useState } from "react";
import { su, fmtHM, PROJEKT_FARBEN, type Project } from "./api";
import { Modal, useConfirm } from "../../core/ui";
import { Icon } from "../../core/Icon";

/** Verwaltung: anlegen, umbenennen, faerben, archivieren, loeschen. */
export function ProjectsModal({
  projects,
  onClose,
  onChanged,
}: {
  projects: Project[];
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const confirm = useConfirm();
  const [neu, setNeu] = useState("");
  const [neuFarbe, setNeuFarbe] = useState<string>(PROJEKT_FARBEN[0]);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

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
      await onChanged();
    } catch (err) { melde(err); }
  }

  async function speichern(p: Project) {
    const name = editName.trim();
    if (!name) return setError("Der Name darf nicht leer sein.");
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

  async function archiv(p: Project) {
    await su.updateProject(p.id, { name: p.name, farbe: p.farbe, archiviert: !p.archiviert });
    await onChanged();
  }

  async function loeschen(p: Project) {
    const ok = await confirm({
      title: "Projekt löschen",
      message: `„${p.name}" wirklich löschen? Die ${p.eintraege} erfassten Zeiten bleiben erhalten, verlieren aber ihre Zuordnung.`,
      confirmLabel: "Löschen",
      danger: true,
    });
    if (!ok) return;
    await su.removeProject(p.id);
    await onChanged();
  }

  return (
    <Modal title="Projekte verwalten" onClose={onClose}>
      <form className="proj-add" onSubmit={anlegen}>
        <input
          placeholder="Neues Projekt…"
          value={neu}
          onChange={(e) => { setNeu(e.target.value); setError(null); }}
        />
        <div className="farb-wahl">
          {PROJEKT_FARBEN.map((f) => (
            <button
              key={f}
              type="button"
              title={f}
              className={`farb-punkt p-${f} ${neuFarbe === f ? "aktiv" : ""}`}
              onClick={() => setNeuFarbe(f)}
            />
          ))}
        </div>
        <button className="btn" type="submit"><Icon name="plus" /> Anlegen</button>
      </form>
      {error && <div className="form-error" role="alert"><Icon name="warnung" /> {error}</div>}

      <ul className="proj-liste">
        {projects.map((p) => (
          <li key={p.id} className={`proj-zeile ${p.archiviert ? "archiviert" : ""}`}>
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
                onClick={() => { setEditId(p.id); setEditName(p.name); }}
              >
                {p.name}
              </button>
            )}
            <span className="proj-zeit">{fmtHM(p.gesamtMin)}</span>
            <div className="farb-wahl klein">
              {PROJEKT_FARBEN.map((f) => (
                <button
                  key={f}
                  type="button"
                  title={f}
                  className={`farb-punkt p-${f} ${p.farbe === f ? "aktiv" : ""}`}
                  onClick={() => farbe(p, f)}
                />
              ))}
            </div>
            <button className="icon-btn" title={p.archiviert ? "Wieder aktivieren" : "Archivieren"} onClick={() => archiv(p)}>
              {p.archiviert ? <Icon name="zurueckholen" /> : <Icon name="archiv" />}
            </button>
            <button className="icon-btn danger" title="Löschen" onClick={() => loeschen(p)}><Icon name="loeschen" /></button>
          </li>
        ))}
        {projects.length === 0 && <li className="empty">Noch keine Projekte angelegt.</li>}
      </ul>
    </Modal>
  );
}
