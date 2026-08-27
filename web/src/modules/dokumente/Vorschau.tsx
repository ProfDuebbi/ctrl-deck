import { useEffect, useState } from "react";
import { Icon } from "../../core/Icon";
import { useDialogTaste } from "./dialog";
import { dateiHolen, groesseText, istVorschaubar, type Datei } from "./api";

/**
 * Der Betrachter: PDF und Bilder direkt ansehen, ohne sie vorher auszupacken.
 *
 * Der Kniff liegt beim Blob. Eine verschluesselte Datei kann der Browser nicht
 * von einer URL laden — das Chiffrat liegt auf dem Server, den Schluessel hat
 * nur diese Seite. Sie wird also geholt, hier entschluesselt und als
 * `blob:`-Adresse eingehaengt. Fuer `<img>` und `<iframe>` ist das eine ganz
 * gewoehnliche Quelle, und der Klartext hat den Browser nie verlassen.
 *
 * Die Adresse wird beim Schliessen wieder freigegeben. Ohne das haelt der
 * Browser jede je geoeffnete Datei im Speicher, bis die Seite neu laedt — bei
 * einem Ordner voller Scans ist das schnell dreistellig in Megabyte.
 */
export function Vorschau({
  datei, chiffriert, schluessel, onClose,
}: {
  datei: Datei;
  chiffriert: boolean;
  schluessel: CryptoKey | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useDialogTaste(onClose);

  useEffect(() => {
    let adresse: string | null = null;
    let verworfen = false;

    dateiHolen(datei, chiffriert, schluessel)
      .then((blob) => {
        // Kam die Antwort erst nach dem Schliessen, gibt es niemanden mehr,
        // der die Adresse je freigäbe — dann gar nicht erst eine anlegen.
        if (verworfen) return;
        adresse = URL.createObjectURL(blob);
        setUrl(adresse);
      })
      .catch((e) => {
        if (!verworfen) setFehler(e instanceof Error ? e.message : "Die Datei ließ sich nicht öffnen.");
      });

    return () => {
      verworfen = true;
      if (adresse) URL.revokeObjectURL(adresse);
    };
  }, [datei, chiffriert, schluessel]);

  const zeigbar = istVorschaubar(datei.typ);

  return (
    <div className="dk-vorschau-huelle" onClick={onClose}>
      <div
        className="dk-vorschau"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={datei.name}
      >
        <div className="dk-vorschau-kopf">
          <span className="dk-vorschau-name">{datei.name}</span>
          <span className="dk-vorschau-meta">{groesseText(datei.groesse)}</span>
          {url && (
            <a className="btn ghost small" href={url} download={datei.name}>
              <Icon name="export" /> Herunterladen
            </a>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Icon name="schliessen" />
          </button>
        </div>

        <div className="dk-vorschau-buehne">
          {fehler && <p className="empty"><Icon name="warnung" /> {fehler}</p>}
          {!fehler && !url && <p className="empty">wird geöffnet…</p>}
          {!fehler && url && !zeigbar && (
            <p className="empty">
              Diesen Dateityp kann der Browser nicht anzeigen — lade sie herunter,
              dann öffnet sie das Programm, das dafür da ist.
            </p>
          )}
          {!fehler && url && zeigbar && datei.typ.startsWith("image/") && (
            <img src={url} alt={datei.name} />
          )}
          {!fehler && url && zeigbar && datei.typ === "application/pdf" && (
            <iframe src={url} title={datei.name} />
          )}
        </div>
      </div>
    </div>
  );
}
