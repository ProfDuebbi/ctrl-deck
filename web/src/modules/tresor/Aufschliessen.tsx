import { useEffect, useState } from "react";
import { Icon } from "../../core/Icon";
import { tr, tresorOeffnen, type TresorMeta } from "./api";
import { entsperren } from "./vault";

/**
 * Das kleine Schloss fuer verschluesselte Eintraege in FACHMODULEN.
 *
 * Bewusst nicht die grosse Tresortuer aus `Schloss.tsx`: Die fuellt eine
 * ganze Seite und bietet nebenbei an, den Tresor zurueckzusetzen. Wer hier
 * steht, will eine Notiz lesen oder ein Dokument aufmachen, nicht den Tresor
 * verwalten.
 *
 * Entsperrt wird trotzdem der EINE Tresor — danach sind auch das Tresormodul
 * und alle anderen Fachmodule offen, und die Leerlaufsperre dort gilt genauso.
 *
 * Steht hier und nicht im aufrufenden Modul, weil es inzwischen zwei Nutzer
 * hat (Notizen, Dokumente). Es entsperrt den Tresor — dann gehoert es auch
 * zum Tresor, sonst leiht sich das dritte Modul es beim zweiten.
 */
export function Aufschliessen({ hinweis }: { hinweis: string }) {
  const [meta, setMeta] = useState<TresorMeta | null | undefined>(undefined);
  const [pw, setPw] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  useEffect(() => {
    tr.meta().then((a) => setMeta(a.meta)).catch(() => setMeta(null));
  }, []);

  async function oeffnen(e: React.FormEvent) {
    e.preventDefault();
    if (!meta) return;
    setLaeuft(true);
    setFehler(null);
    try {
      entsperren(await tresorOeffnen(pw, meta));
      setPw("");
    } catch (err) {
      setFehler(
        err instanceof Error && err.message.startsWith("Verschlüsselung")
          ? err.message
          : "Das Passwort stimmt nicht."
      );
    } finally {
      setLaeuft(false);
    }
  }

  if (meta === undefined) return <p className="empty">lädt…</p>;

  if (meta === null) {
    return (
      <div className="schloss-klein">
        <div className="schloss-klein-ico"><Icon name="schloss" /></div>
        <p className="schloss-klein-text">
          Verschlüsselte Notizen brauchen den Tresor — und der ist noch nicht
          eingerichtet. Das geht einmalig im Modul <strong>Tresor</strong>; danach
          gilt dasselbe Master-Passwort auch hier.
        </p>
      </div>
    );
  }

  return (
    <form className="schloss-klein" onSubmit={oeffnen}>
      <div className="schloss-klein-ico"><Icon name="schloss" /></div>
      <p className="schloss-klein-text">{hinweis}</p>
      <input
        type="password"
        placeholder="Master-Passwort"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoComplete="current-password"
      />
      <button className="btn" type="submit" disabled={laeuft || pw.length === 0}>
        {laeuft ? "einen Moment…" : "Aufschließen"}
      </button>
      {fehler && <p className="schloss-klein-fehler" role="alert"><Icon name="warnung" /> {fehler}</p>}
    </form>
  );
}
