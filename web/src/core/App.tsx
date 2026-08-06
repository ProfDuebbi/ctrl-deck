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
import { DiagrammAnsicht } from "./DiagrammAnsicht";
import { Profil } from "./Profil";
import { Einstellungen } from "./Einstellungen";
import { Uhr, datumsZeile } from "./Uhr";
import { useKopf } from "./kopf";
import { ProfilKnopf } from "./ProfilKnopf";
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

export function App() {
  const now = useClock();
  // Leer statt eines Namens: der echte kommt aus der Ersteinrichtung. Frueher
  // stand hier ein fester Vorname — das gehoert nicht in ausgelieferten Code.
  const [me, setMe] = useState<Me>({ name: "", appName: "CTRL·DECK", avatar: null });
  const [online, setOnline] = useState<boolean | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Das Profil ist kein Modul (es hat auf der Kachelwand nichts verloren),
  // aber es fuellt den Hauptbereich wie eines. Deshalb ein eigener Zustand
  // statt einer erfundenen Modul-ID.
  const [showProfil, setShowProfil] = useState(false);
  // Die Einstellungen liegen hinter dem Profil, nicht daneben: man kommt nur
  // ueber die Profilseite dorthin. Deshalb ein eigener Zustand statt eines
  // Reiters — zurueck fuehrt immer aufs Profil.
  const [showEinstellungen, setShowEinstellungen] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [showModule, setShowModule] = useState(false);
  const [showSuche, setShowSuche] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("cd_sidebar_collapsed") === "1");
  /**
   * Zwei Ansichten fuer dieselbe Uebersicht: die Kachelwand („wie steht es
   * gerade?") und die Verlaufsbilder („wie ist es dorthin gekommen?").
   *
   * Die Wahl liegt im localStorage und NICHT in den Servereinstellungen —
   * anders als die Modulreihenfolge. Der Unterschied: Die Reihenfolge gehoert
   * zum Dashboard, diese Wahl gehoert zum Fenster, in dem man gerade sitzt.
   * Ausserdem laege sie sonst hinter einer Anfrage, und die Seite muesste beim
   * Laden erst die Kacheln und danach die Diagramme zeigen.
   *
   * Vorgabe bleibt die Kachelwand.
   */
  const [ansicht, setAnsicht] = useState<"kacheln" | "diagramme">(
    () => (localStorage.getItem("cd_uebersicht") === "diagramme" ? "diagramme" : "kacheln")
  );
  // Eine Quelle fuer beide Listen: Kachelwand und Seitenleiste zeigen
  // zwangslaeufig dieselbe Reihenfolge.
  const { module, alleSortiert, versteckt, umschalten, speichern, zuruecksetzen, angepasst } =
    useModuleOrder(dashboardModules);
  // Aussehen des Kopfbereichs. Liegt in einem geteilten Speicher, damit das
  // Profil beim Verstellen sofort hier ankommt — ohne Zustand durchzureichen.
  const kopf = useKopf();

  useEffect(() => {
    localStorage.setItem("cd_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => { localStorage.setItem("cd_uebersicht", ansicht); }, [ansicht]);

  /**
   * Wechsel in den Hauptbereich — Modul oder Uebersicht.
   *
   * Schliesst immer das Profil mit. Ohne das haette die Seitenleiste tote
   * Knoepfe: man klickt „Haushalt", das Profil bleibt stehen, und es sieht
   * aus, als sei die App haengengeblieben.
   */
  const gehZu = (id: string | null) =>
    mitUebergang(() => { setShowProfil(false); setShowEinstellungen(false); setActiveId(id); });

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

  // Steht in jedem Kopfbereich direkt neben der Ueberschrift — auf der
  // Uebersicht also neben „Gute Nacht, <Name>", wo der Name ohnehin schon
  // steht. Der Zugang darf nicht davon abhaengen, wo man gerade ist,
  // deshalb auch in Modulansichten und im Profil selbst.
  const profilKnopf = (
    <ProfilKnopf
      name={me.name}
      bild={me.avatar}
      aktiv={showProfil || showEinstellungen}
      onClick={() => mitUebergang(() => { setShowEinstellungen(false); setShowProfil(true); })}
    />
  );

  /**
   * Der Umschalter zwischen Kachelwand und Verlaufsbildern.
   *
   * Er steht in BEIDEN Ansichten an derselben Stelle in der Abschnittszeile.
   * Ein Knopf, der beim Umschalten die Seite wechselt, muss dort bleiben, wo
   * die Hand ihn gerade losgelassen hat — sonst sucht man ihn jedes Mal neu.
   */
  const ansichtWechsel = (
    <div className="ansicht-wahl" role="group" aria-label="Ansicht der Übersicht">
      <button
        className={`seg-btn ${ansicht === "kacheln" ? "aktiv" : ""}`}
        onClick={() => mitUebergang(() => setAnsicht("kacheln"))}
        aria-pressed={ansicht === "kacheln"}
        title="Module als Kacheln"
      >
        <Icon name="uebersicht" /> Kacheln
      </button>
      <button
        className={`seg-btn ${ansicht === "diagramme" ? "aktiv" : ""}`}
        onClick={() => mitUebergang(() => setAnsicht("diagramme"))}
        aria-pressed={ansicht === "diagramme"}
        title="Verläufe und Verteilungen"
      >
        <Icon name="diagramm" /> Verläufe
      </button>
    </div>
  );

  // Wochentage und Monatsnamen wohnen jetzt in Uhr.tsx — sie standen hier
  // und dort, und beim naechsten Mal weicht eine der beiden Listen ab.
  const dateLine = datumsZeile(now);
  const active = module.find((m) => m.id === activeId) ?? null;

  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <a className="skip-link" href="#inhalt">Zum Inhalt springen</a>

      <aside className="sidebar">
        <div className="sidebar-head">
          <button className="brand" onClick={() => gehZu(null)}>
            <img className="brand-logo" src="/ctrl_logo.png" alt="" />
            <span className="brand-name">{me.appName}</span>
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
            className={`nav-item ${activeId === null && !showProfil && !showEinstellungen ? "active" : ""}`}
            onClick={() => gehZu(null)}
            title="Übersicht"
            aria-current={activeId === null && !showProfil && !showEinstellungen ? "page" : undefined}
          >
            <span className="nav-ico"><Icon name="uebersicht" /></span> <span className="nav-label">Übersicht</span>
          </button>
          {module.map((m) => (
            <NavItem key={m.id} m={m} active={activeId === m.id && !showProfil && !showEinstellungen} onClick={() => gehZu(m.id)} />
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
        {showEinstellungen ? (
          <>
            <header className="hero module-hero">
              <div>
                {/* Zurueck fuehrt aufs Profil, nicht zur Uebersicht: von dort
                    ist man gekommen, und der Weg muss umkehrbar sein. */}
                <button
                  className="back-link"
                  onClick={() => mitUebergang(() => { setShowEinstellungen(false); setShowProfil(true); })}
                >
                  <Icon name="pfeil-links" /> Profil
                </button>
                <div className="hero-titel">
                  <h1 className="module-h1">
                    <span className="module-h1-ico"><Icon name="einstellungen" /></span>{" "}
                    Einstellungen
                  </h1>
                </div>
                <p className="subtitle">Startseite, Konto, Dashboard und deine Daten.</p>
              </div>
              <Uhr jetzt={now} />
            </header>
            <Einstellungen
              name={me.name}
              onModule={() => setShowModule(true)}
              onBackups={() => setShowBackups(true)}
              angepasst={angepasst}
              onReihenfolgeZuruecksetzen={zuruecksetzen}
              versteckt={versteckt.length}
            />
          </>
        ) : showProfil ? (
          <>
            <header className="hero module-hero">
              <div>
                <button className="back-link" onClick={() => gehZu(null)}>
                  <Icon name="pfeil-links" /> Übersicht
                </button>
                <div className="hero-titel">
                  <h1 className="module-h1">
                    <span className="module-h1-ico"><Icon name="person" /></span>{" "}
                    Profil
                  </h1>
                </div>
                <p className="subtitle">Dein Bild, dein Name — und ein Jahr Dashboard auf einen Blick.</p>
              </div>
              <Uhr jetzt={now} />
            </header>
            <Profil
              me={me}
              setMe={setMe}
              onEinstellungen={() => mitUebergang(() => { setShowProfil(false); setShowEinstellungen(true); })}
              onModul={gehZu}
              moduleGesamt={alleSortiert.length}
              versteckt={versteckt.length}
            />
          </>
        ) : active && active.View ? (
          <>
            <header className="hero module-hero">
              <div>
                <button className="back-link" onClick={() => gehZu(null)}>
                  <Icon name="pfeil-links" /> Übersicht
                </button>
                <div className="hero-titel">
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
                  {profilKnopf}
                </div>
                <p className="subtitle">{active.description}</p>
              </div>
              <Uhr jetzt={now} />
            </header>
            <active.View />
          </>
        ) : (
          <>
            <header className="hero hero-start">
              {/*
                Zwei getrennte Ebenen hinter dem Text, beide nur Zierde
                (`aria-hidden`, keine Mausziele):
                  1. das Bild — Deckkraft, Ausschnitt und Unschaerfe kommen aus
                     den Einstellungen; `scale` verhindert, dass beim
                     Weichzeichnen die Kanten ausfransen.
                  2. eine Abdunklung in Seitenfarbe darueber.
                Ein Verlauf nach unten (im CSS als Maske) sorgt dafuer, dass
                die Trennlinie des Kopfbereichs nicht auf dem Bild endet.
              */}
              {kopf.bild && (
                <>
                  <span
                    className="hero-bild"
                    aria-hidden="true"
                    style={{
                      backgroundImage: `url(${kopf.bild})`,
                      backgroundPosition: `center ${kopf.position === "oben" ? "top" : kopf.position === "unten" ? "bottom" : "center"}`,
                      opacity: kopf.staerke / 100,
                      filter: kopf.weichzeichnen ? `blur(${kopf.weichzeichnen}px)` : undefined,
                      transform: kopf.weichzeichnen ? `scale(${1 + kopf.weichzeichnen / 40})` : undefined,
                    }}
                  />
                  {kopf.abdunkeln > 0 && (
                    <span className="hero-dunkel" aria-hidden="true" style={{ opacity: kopf.abdunkeln / 100 }} />
                  )}
                </>
              )}
              <div>
                <p className="eyebrow">{dateLine}</p>
                <div className="hero-titel">
                  <h1 className="welcome">
                    {/* Ohne Namen kein Komma — sonst steht dort „Gute Nacht," */}
                    {greeting(now.getHours())}
                    {me.name && <>, <span className="grad">{me.name}</span></>}
                  </h1>
                  {profilKnopf}
                </div>
                <p className="subtitle">Dein privates Control-Dashboard. Alles lokal, alles unter Kontrolle.</p>
              </div>
              <div className="hero-aside">
                {weather && kopf.wetterZeigen && (
                  <HeroWeather
                    data={weather}
                    details={kopf.wetterDetails}
                    ort={kopf.wetterOrt}
                    groesse={kopf.groesse}
                  />
                )}
                {kopf.uhrZeigen && (
                  <Uhr
                    jetzt={now}
                    format={kopf.uhrFormat}
                    sekunden={kopf.uhrSekunden}
                    unterzeile={kopf.uhrUnterzeile}
                    groesse={kopf.groesse}
                  />
                )}
              </div>
            </header>

            {ansicht === "diagramme" ? (
              <DiagrammAnsicht onModul={gehZu} wechsel={ansichtWechsel} />
            ) : (
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
                {ansichtWechsel}
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
            )}
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
          onOeffnen={gehZu}
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
