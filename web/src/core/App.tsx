import { useEffect, useState } from "react";
import { api, type Me } from "./api";
import { dashboardModules, plannedModules, type DashboardModule } from "./modules";
import { useModuleOrder } from "./moduleOrder";
import { ModuleGrid } from "./ModuleGrid";
import { HeroWeather } from "./OverviewWeather";
import { wetter, type Weather } from "../modules/wetter/api";
import { BackupsModal } from "./BackupsModal";
import { ModuleVerwaltung } from "./ModuleVerwaltung";
import { Suche } from "./Suche";
import { Icon } from "./Icon";
import { mitUebergang, uebergangsName } from "./bewegung";

/** Rendert das Live-Badge eines Moduls (ruft den Hook unbedingt auf). */
function NavBadge({ useCount }: { useCount: () => number }) {
  const count = useCount();
  if (count <= 0) return null;
  // Die Zahl allein ist ohne Kontext; das versteckte Wort macht sie vorlesbar.
  return (
    <span className="nav-badge">
      {count}
      <span className="sr-only"> fällig</span>
    </span>
  );
}

/** Ein Sidebar-Navigationseintrag für ein Modul (inkl. optionalem Badge). */
function NavItem({ m, active, onClick }: { m: DashboardModule; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`nav-item ${active ? "active" : ""}`}
      onClick={onClick}
      title={m.title}
      aria-current={active ? "page" : undefined}
    >
      <span className="nav-ico"><Icon name={m.icon} /></span> <span className="nav-label">{m.title}</span>
      {m.useBadgeCount && <NavBadge useCount={m.useBadgeCount} />}
    </button>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function greeting(h: number): string {
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 17) return "Willkommen zurück";
  if (h < 22) return "Guten Abend";
  return "Gute Nacht";
}

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export function App() {
  const now = useClock();
  // Leer statt eines Namens: der echte kommt aus der Ersteinrichtung. Frueher
  // stand hier ein fester Vorname — das gehoert nicht in ausgelieferten Code.
  const [me, setMe] = useState<Me>({ name: "", appName: "CTRL·DECK" });
  const [online, setOnline] = useState<boolean | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showBackups, setShowBackups] = useState(false);
  const [showModule, setShowModule] = useState(false);
  const [showSuche, setShowSuche] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("cd_sidebar_collapsed") === "1");
  // Eine Quelle fuer beide Listen: Kachelwand und Seitenleiste zeigen
  // zwangslaeufig dieselbe Reihenfolge.
  const { module, alleSortiert, versteckt, umschalten, speichern, zuruecksetzen, angepasst } =
    useModuleOrder(dashboardModules);

  useEffect(() => {
    localStorage.setItem("cd_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  /**
   * Strg+K oeffnet die Suche — von ueberall, auch mitten in einem Modul.
   *
   * Bewusst NICHT „/" wie in manchen Apps: der Tresor benutzt diese Taste
   * bereits fuer seine eigene Suche, und ein Kuerzel, das je nach Ansicht
   * etwas anderes tut, ist schlimmer als keins.
   */
  useEffect(() => {
    function taste(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSuche(true);
      }
    }
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, []);

  /**
   * Abmelden laedt die Seite neu, statt nur die Tuer zuzuklappen. Das ist hier
   * das ehrlichere Verhalten: sonst blieben geladene Daten — Kontostaende,
   * Schulden, ein entsperrter Tresor — im Speicher des Browsers stehen.
   */
  async function abmelden() {
    try { await api("/auth/abmelden", { method: "POST" }); } catch { /* egal */ }
    window.location.reload();
  }

  useEffect(() => {
    wetter.current().then(setWeather).catch(() => setWeather(null));
  }, []);

  useEffect(() => {
    api<Me>("/me")
      .then((data) => {
        setMe(data);
        setOnline(true);
      })
      .catch(() => setOnline(false));
  }, []);

  const time = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateLine = `${WEEKDAYS[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const active = module.find((m) => m.id === activeId) ?? null;

  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <a className="skip-link" href="#inhalt">Zum Inhalt springen</a>

      <aside className="sidebar">
        <div className="sidebar-head">
          <button className="brand" onClick={() => mitUebergang(() => setActiveId(null))}>
            <img className="brand-logo" src="/ctrl_logo.png" alt="" />
            <span className="brand-name">CTRL·DECK</span>
            <span className="sr-only">— zur Übersicht</span>
          </button>
          <button
            className="sidebar-toggle"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Menü ausklappen" : "Menü einklappen"}
            aria-label={collapsed ? "Menü ausklappen" : "Menü einklappen"}
            aria-expanded={!collapsed}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        <nav className="nav" aria-label="Module">
          <button
            className={`nav-item ${activeId === null ? "active" : ""}`}
            onClick={() => mitUebergang(() => setActiveId(null))}
            title="Übersicht"
            aria-current={activeId === null ? "page" : undefined}
          >
            <span className="nav-ico"><Icon name="uebersicht" /></span> <span className="nav-label">Übersicht</span>
          </button>
          {module.map((m) => (
            <NavItem key={m.id} m={m} active={activeId === m.id} onClick={() => mitUebergang(() => setActiveId(m.id))} />
          ))}
          {plannedModules.map((m) => (
            <span className="nav-item disabled" key={m.title} title={`${m.title} (bald)`}>
              <span className="nav-ico"><Icon name={m.icon} /></span> <span className="nav-label">{m.title}</span>
              <span className="soon">bald</span>
            </span>
          ))}
        </nav>

        <div className="sidebar-tools">
          <button className="backup-btn" onClick={() => setShowSuche(true)} title="Suchen (Strg+K)">
            <span className="nav-ico"><Icon name="suchen" /></span> <span className="nav-label">Suchen</span>
            <kbd className="nav-kbd">Strg K</kbd>
          </button>
          <button className="backup-btn" onClick={() => setShowBackups(true)} title="Backups sichern & wiederherstellen">
            <span className="nav-ico"><Icon name="backup" /></span> <span className="nav-label">Backups</span>
          </button>
          <button className="backup-btn" onClick={abmelden} title="Abmelden — beim nächsten Mal wieder mit Passwort">
            <span className="nav-ico"><Icon name="schloss" /></span> <span className="nav-label">Abmelden</span>
          </button>
          {/* Der farbige Punkt wiederholt nur, was daneben als Wort steht —
              Farbe ist hier nie der einzige Traeger der Information. */}
          <div className="status" role="status">
            <span className={`dot ${online ? "ok" : online === false ? "err" : "wait"}`} aria-hidden="true" />
            <span className="nav-label">
              {online === null ? "verbinde…" : online ? "Backend verbunden" : "Backend offline"}
            </span>
          </div>
        </div>
      </aside>

      <main className="main" id="inhalt">
        {active && active.View ? (
          <>
            <header className="hero module-hero">
              <div>
                <button className="back-link" onClick={() => mitUebergang(() => setActiveId(null))}>
                  <Icon name="pfeil-links" /> Übersicht
                </button>
                <h1 className="module-h1">
                  {/* Traegt denselben Uebergangsnamen wie das Symbol auf der
                      Kachel: der Browser laesst es von dort hierher wandern und
                      beantwortet damit „woher komme ich". */}
                  <span
                    className="module-h1-ico"
                    style={{ viewTransitionName: uebergangsName(active.id) }}
                  >
                    <Icon name={active.icon} />
                  </span>{" "}
                  {active.title}
                </h1>
                <p className="subtitle">{active.description}</p>
              </div>
              <div className="clock">
                <div className="clock-time">{time}</div>
                <div className="clock-label">Ortszeit</div>
              </div>
            </header>
            <active.View />
          </>
        ) : (
          <>
            <header className="hero">
              <div>
                <p className="eyebrow">{dateLine}</p>
                <h1 className="welcome">
                  {/* Ohne Namen kein Komma — sonst steht dort „Gute Nacht," */}
                  {greeting(now.getHours())}
                  {me.name && <>, <span className="grad">{me.name}</span></>}
                </h1>
                <p className="subtitle">Dein privates Control-Dashboard. Alles lokal, alles unter Kontrolle.</p>
              </div>
              <div className="hero-aside">
                {weather && <HeroWeather data={weather} />}
                <div className="clock">
                  <div className="clock-time">{time}</div>
                  <div className="clock-label">Ortszeit</div>
                </div>
              </div>
            </header>

            <section aria-labelledby="titel-module">
              <div className="section-head">
                <h2 className="section-title" id="titel-module">Module</h2>
                <span className="section-hinweis">am Griff ziehen zum Anordnen</span>
                {angepasst && (
                  <button className="btn ghost small" onClick={zuruecksetzen}>
                    <Icon name="neuladen" /> Reihenfolge zurücksetzen
                  </button>
                )}
                <button className="btn ghost small" onClick={() => setShowModule(true)}>
                  <Icon name="uebersicht" /> Module wählen
                  {versteckt.length > 0 && <span className="mv-zaehler">{versteckt.length} aus</span>}
                </button>
              </div>
              {/* Jede Karte hat genau EIN Bedienziel: den Titel (plus den
                  Griff zum Verschieben). Sein ausgedehntes ::after macht die
                  ganze Flaeche klickbar, ohne dass ein zweites, unsichtbares
                  Ziel entsteht. Frueher lag der Klick auf dem <article> — per
                  Tastatur war davon nichts zu erreichen. */}
              <ModuleGrid
                module={module}
                geplant={plannedModules}
                onOeffnen={setActiveId}
                onReihenfolge={speichern}
              />
            </section>
          </>
        )}

        {/*
          Der Quelltext-Hinweis ist keine Zierde: Die AGPL verlangt (§13), dass
          wer diese Oberflaeche ueber ein Netzwerk benutzt, an den Quelltext
          herankommt. Ein Link im Fussbereich erfuellt das.
        */}
        <footer className="foot">
          CTRL·DECK · lokal auf diesem Rechner · {now.getFullYear()} ·{" "}
          <a href="https://github.com/ProfDuebbi/ctrl-deck" target="_blank" rel="noreferrer noopener">
            Quelltext (AGPL-3.0)
          </a>
        </footer>
      </main>

      {showSuche && (
        <Suche
          module={module}
          onOeffnen={(id) => mitUebergang(() => setActiveId(id))}
          onClose={() => setShowSuche(false)}
        />
      )}
      {showBackups && <BackupsModal onClose={() => setShowBackups(false)} />}
      {showModule && (
        <ModuleVerwaltung
          module={alleSortiert}
          versteckt={versteckt}
          umschalten={umschalten}
          onClose={() => setShowModule(false)}
        />
      )}
    </div>
  );
}
