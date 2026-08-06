import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "../../core/Icon";
import {
  termine as api, ART_FARBE, ART_TEXT, abstand, tagesTitel,
  type Faden, type Termin, type TerminArt,
} from "./api";

/**
 * Der Terminfaden.
 *
 * Eine Liste, nach Tagen gruppiert — bewusst kein Monatskalender. Ein Raster
 * mit 31 Kaestchen beantwortet „welcher Wochentag ist der 14.", aber nicht
 * „was kommt auf mich zu". Letzteres ist die Frage, wegen der es dieses Modul
 * gibt.
 */

const ZEITRAEUME = [7, 14, 30, 90] as const;

const ART_ICON: Record<TerminArt, IconName> = {
  geburtstag: "geburtstage",
  aufgabe: "aufgaben",
  frist: "wecker",
  ablauf: "warnung",
  zahltag: "haushalt",
};

/** Filter-Chips: alles, oder nur eine Sorte. */
const SORTEN: { id: TerminArt | "alle"; label: string }[] = [
  { id: "alle", label: "Alles" },
  { id: "aufgabe", label: "Aufgaben" },
  { id: "frist", label: "Fristen" },
  { id: "ablauf", label: "Abläufe" },
  { id: "zahltag", label: "Zahltage" },
  { id: "geburtstag", label: "Geburtstage" },
];

export function View() {
  const [tage, setTage] = useState<number>(() => Number(localStorage.getItem("cd_termine_tage")) || 30);
  const [sorte, setSorte] = useState<TerminArt | "alle">("alle");
  const [faden, setFaden] = useState<Faden | null>(null);
  const [fehler, setFehler] = useState(false);

  useEffect(() => {
    localStorage.setItem("cd_termine_tage", String(tage));
    setFaden(null);
    setFehler(false);
    api.faden(tage).then(setFaden).catch(() => setFehler(true));
  }, [tage]);

  const gefiltert = useMemo(
    () => (faden?.termine ?? []).filter((t) => sorte === "alle" || t.art === sorte),
    [faden, sorte]
  );

  // Überfälliges steht für sich — es gehört nicht unter „Heute", denn es ist
  // gerade nicht heute passiert, sondern liegen geblieben.
  const ueberfaellig = gefiltert.filter((t) => t.tageBis < 0);
  const kommend = gefiltert.filter((t) => t.tageBis >= 0);

  const tage_gruppen = useMemo(() => {
    const map = new Map<string, Termin[]>();
    for (const t of kommend) {
      if (!map.has(t.datum)) map.set(t.datum, []);
      map.get(t.datum)!.push(t);
    }
    return [...map.entries()];
  }, [kommend]);

  const zaehler = useMemo(() => {
    const z: Partial<Record<TerminArt | "alle", number>> = { alle: faden?.termine.length ?? 0 };
    for (const t of faden?.termine ?? []) z[t.art] = (z[t.art] ?? 0) + 1;
    return z;
  }, [faden]);

  return (
    <div className="module-view">
      <div className="tf-leiste">
        <div className="zeitraum-wahl">
          {ZEITRAEUME.map((z) => (
            <button
              key={z}
              className={`seg-btn ${tage === z ? "aktiv" : ""}`}
              onClick={() => setTage(z)}
            >
              {z} Tage
            </button>
          ))}
        </div>
        <div className="tf-chips">
          {SORTEN.map((s) => (
            <button
              key={s.id}
              className={`tf-chip ${sorte === s.id ? "aktiv" : ""}`}
              onClick={() => setSorte(s.id)}
              disabled={s.id !== "alle" && !zaehler[s.id]}
            >
              {s.label}
              {zaehler[s.id] ? <span className="tf-chip-zahl">{zaehler[s.id]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {fehler && (
        <div className="form-error" role="alert">
          <Icon name="warnung" /> Der Terminfaden ließ sich nicht laden.
        </div>
      )}

      {faden && faden.fehler.length > 0 && (
        <div className="tf-luecke" role="status">
          <Icon name="warnung" /> Aus {faden.fehler.join(", ")} fehlen gerade Einträge.
        </div>
      )}

      {faden === null && !fehler && <div className="empty">lädt…</div>}

      {faden && gefiltert.length === 0 && (
        <div className="tf-leer">
          <Icon name="termine" />
          <p>
            {sorte === "alle"
              ? `In den nächsten ${tage} Tagen steht nichts an.`
              : "Nichts dieser Art im Zeitraum."}
          </p>
        </div>
      )}

      {ueberfaellig.length > 0 && (
        <section className="tf-tag ueberfaellig">
          <h2 className="tf-tag-kopf">
            <span className="tf-tag-titel">Liegen geblieben</span>
            <span className="tf-tag-sub">{ueberfaellig.length}</span>
          </h2>
          <ul className="tf-liste">
            {ueberfaellig.map((t) => <Zeile key={t.id} t={t} />)}
          </ul>
        </section>
      )}

      {tage_gruppen.map(([datum, liste]) => (
        <section className="tf-tag" key={datum}>
          <h2 className="tf-tag-kopf">
            <span className="tf-tag-titel">{tagesTitel(datum, liste[0].tageBis)}</span>
            <span className="tf-tag-sub">
              {liste[0].tageBis > 1 ? abstand(liste[0].tageBis) : datum.split("-").reverse().join(".")}
            </span>
          </h2>
          <ul className="tf-liste">
            {liste.map((t) => <Zeile key={t.id} t={t} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Zeile({ t }: { t: Termin }) {
  const farbe = ART_FARBE[t.art];
  return (
    <li className={`tf-zeile f-${farbe}${t.dringend ? " dringend" : ""}`}>
      <span className="tf-ico" aria-hidden="true"><Icon name={ART_ICON[t.art]} /></span>
      <span className="tf-zeit">{t.zeit ?? ""}</span>
      <span className="tf-text">
        <span className="tf-titel">{t.titel}</span>
        {t.notiz && <span className="tf-notiz">{t.notiz}</span>}
      </span>
      <span className="tf-art">{ART_TEXT[t.art]}</span>
    </li>
  );
}
