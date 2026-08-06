import { useState } from "react";
import { Fixkosten } from "./Fixkosten";
import { Einnahmen } from "./Einnahmen";
import { Buchungen } from "./Buchungen";
import { Jahresbericht } from "./Jahresbericht";
import { Schulden } from "./Schulden";
import { Rechner } from "./Rechner";
import { Modal } from "../../core/ui";
import { Icon } from "../../core/Icon";

type Tab = "fixkosten" | "einnahmen" | "buchungen" | "jahr" | "schulden";

const TABS: { id: Tab; label: string }[] = [
  { id: "fixkosten", label: "Fixkosten" },
  { id: "einnahmen", label: "Einnahmen" },
  { id: "buchungen", label: "Buchungen" },
  { id: "jahr", label: "Jahresbericht" },
  { id: "schulden", label: "Außenstände" },
];

export function View() {
  const [tab, setTab] = useState<Tab>("fixkosten");
  const [rechner, setRechner] = useState(false);

  return (
    <div className="module-view">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        {/* Steht neben den Tabs, nicht darin: der Rechner ist ein Werkzeug,
            kein weiterer Bereich — er soll aus jedem Tab erreichbar sein. */}
        <button className="tab rechner-knopf" title="Taschenrechner" onClick={() => setRechner(true)}>
          <Icon name="rechner" /> Rechner
        </button>
      </div>

      {rechner && (
        <Modal title="Rechner" onClose={() => setRechner(false)}>
          <Rechner />
        </Modal>
      )}

      {tab === "fixkosten" && <Fixkosten />}
      {tab === "einnahmen" && <Einnahmen />}
      {tab === "buchungen" && <Buchungen />}
      {tab === "jahr" && <Jahresbericht />}
      {tab === "schulden" && <Schulden />}
    </div>
  );
}
