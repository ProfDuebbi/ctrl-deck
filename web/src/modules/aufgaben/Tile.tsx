import { useEffect, useState } from "react";
import { ag, dueLabel, type Task } from "./api";

export function Tile() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => {
    ag.list().then(setTasks).catch(() => setTasks(null));
  }, []);

  if (!tasks) return <div className="tile-mini">lädt…</div>;

  const open = tasks.filter((t) => !t.erledigt);
  const overdue = open.filter((t) => {
    const d = dueLabel(t);
    return d && (d.state === "overdue" || d.state === "today");
  });
  const next = open.find((t) => t.faellig_datum);

  return (
    <div className="tile-stats">
      <div className="tile-stat">
        <span className="tile-num accent">{open.length}</span>
        <span className="tile-lbl">offen</span>
      </div>
      <div className="tile-stat">
        <span className="tile-num">{overdue.length}</span>
        <span className="tile-lbl">heute / überfällig</span>
      </div>
      {next && (
        <div className="tile-note">
          Nächste: {next.titel}
          {(() => { const d = dueLabel(next); return d ? ` · ${d.text}` : ""; })()}
        </div>
      )}
    </div>
  );
}
