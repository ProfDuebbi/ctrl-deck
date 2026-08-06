import { useRef, useState } from "react";
import { Icon } from "../../core/Icon";
import { Modal } from "../../core/ui";
import { entschluesseln, schluesselAusText, wiederherstellungsSchluessel } from "./crypto";
import { entsperren } from "./vault";
import { passwortAendern, tr, tresorEinrichten, tresorOeffnen, type TresorMeta } from "./api";

/**
 * Alles, was mit dem Schloss selbst zu tun hat: einrichten, entsperren,
 * Passwort wechseln, Wiederherstellungsschluessel zeigen.
 */

const MIN_LAENGE = 10;

/** Grobe Einschaetzung — keine Wissenschaft, nur ein ehrlicher Wink. */
function guete(pw: string): { stufe: 0 | 1 | 2 | 3; text: string } {
  if (pw.length < MIN_LAENGE) return { stufe: 0, text: `noch ${MIN_LAENGE - pw.length} Zeichen` };
  const arten = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 20 || (pw.length >= 14 && arten >= 3)) return { stufe: 3, text: "stark" };
  if (pw.length >= 12 && arten >= 2) return { stufe: 2, text: "brauchbar" };
  return { stufe: 1, text: "schwach — lieber ein paar Wörter aneinanderreihen" };
}

// --- Wiederherstellungsschluessel ----------------------------------------

export function SchluesselAnzeige({
  schluessel, onSchliessen, ersteinrichtung,
}: { schluessel: string; onSchliessen: () => void; ersteinrichtung?: boolean }) {
  const [kopiert, setKopiert] = useState(false);
  const [verstanden, setVerstanden] = useState(!ersteinrichtung);

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(schluessel);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2500);
    } catch {
      setKopiert(false);
    }
  }

  return (
    <Modal title="Wiederherstellungsschlüssel" onClose={verstanden ? onSchliessen : () => {}}>
      <p className="modal-msg">
        Damit kommst du auch dann an deine Daten, wenn du das Master-Passwort vergisst.
        Es ist der einzige Ersatz — ohne Passwort und ohne diesen Schlüssel ist der Inhalt
        des Tresors endgültig verloren.
      </p>
      <div className="tresor-recovery">{schluessel}</div>
      <p className="tresor-hinweis">
        <Icon name="warnung" /> Ausdrucken oder handschriftlich notieren und getrennt vom Rechner
        aufbewahren. Eine Datei auf derselben Platte hebt den Schutz wieder auf.
      </p>
      {ersteinrichtung && (
        <label className="check-lbl" style={{ marginTop: 4 }}>
          <input type="checkbox" checked={verstanden} onChange={(e) => setVerstanden(e.target.checked)} />
          Ich habe den Schlüssel sicher notiert.
        </label>
      )}
      <div className="modal-actions">
        <button className="btn ghost" onClick={kopieren}>
          <Icon name="kopieren" /> {kopiert ? "Kopiert" : "In die Zwischenablage"}
        </button>
        <button className="btn" onClick={onSchliessen} disabled={!verstanden}>
          Fertig
        </button>
      </div>
    </Modal>
  );
}

// --- Ersteinrichtung ------------------------------------------------------

export function Einrichten({ onFertig }: { onFertig: (meta: TresorMeta) => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);

  const g = guete(pw);

  async function anlegen(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < MIN_LAENGE) return setFehler(`Das Passwort braucht mindestens ${MIN_LAENGE} Zeichen.`);
    if (pw !== pw2) return setFehler("Die beiden Eingaben stimmen nicht überein.");
    setLaeuft(true);
    setFehler(null);
    try {
      const dek = await tresorEinrichten(pw);
      setRecovery(await wiederherstellungsSchluessel(dek));
      entsperren(dek);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Der Tresor konnte nicht angelegt werden.");
    } finally {
      setLaeuft(false);
    }
  }

  async function fertig() {
    const { meta } = await tr.meta();
    if (meta) onFertig(meta);
  }

  return (
    <div className="module-view">
      <div className="panel tresor-tor">
        <div className="tresor-tor-ico"><Icon name="tresor" /></div>
        <h2 className="tresor-tor-titel">Tresor einrichten</h2>
        <p className="tresor-tor-text">
          Steuer-ID, Sozialversicherungsnummer, Ausweisnummern — hier liegen sie verschlüsselt.
          Vergeben wird ein Master-Passwort, aus dem der Schlüssel entsteht. Es wird nirgends
          gespeichert und verlässt diesen Rechner nicht. Nimm bitte ein <strong>anderes</strong> als
          dein Anmeldepasswort: dieses hier bekommt der Server nie zu sehen, und genau das ist der
          Schutz.
        </p>
        <form className="tresor-tor-form" onSubmit={anlegen}>
          <input
            type="password"
            autoFocus
            autoComplete="new-password"
            placeholder="Master-Passwort"
            value={pw}
            onChange={(e) => { setPw(e.target.value); setFehler(null); }}
          />
          {pw.length > 0 && (
            <div className={`tresor-guete s${g.stufe}`}>
              <span className="tresor-guete-balken"><i /><i /><i /></span>
              {g.text}
            </div>
          )}
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Passwort wiederholen"
            value={pw2}
            onChange={(e) => { setPw2(e.target.value); setFehler(null); }}
          />
          <button className="btn" type="submit" disabled={laeuft}>
            {laeuft ? "Schlüssel wird erzeugt…" : "Tresor anlegen"}
          </button>
        </form>
        {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}
        <p className="tresor-hinweis">
          <Icon name="warnung" /> Ein vergessenes Passwort kann niemand zurücksetzen — auch dieses
          Programm nicht. Gleich nach dem Anlegen bekommst du einen Wiederherstellungsschlüssel.
        </p>
      </div>

      {recovery && <SchluesselAnzeige schluessel={recovery} ersteinrichtung onSchliessen={fertig} />}
    </div>
  );
}

// --- Entsperren -----------------------------------------------------------

/**
 * Prueft, ob ein Schluessel wirklich zu diesem Tresor gehoert. Beim Passwort
 * erledigt das die Pruefsumme beim Auswickeln; ein eingetippter
 * Wiederherstellungsschluessel dagegen ist erst einmal nur ein Haufen Bytes —
 * ohne diese Probe wuerde ein Tippfehler einen scheinbar leeren Tresor oeffnen.
 */
async function passtZumTresor(key: CryptoKey): Promise<boolean> {
  const liste = await tr.liste();
  if (liste.length === 0) return true; // nichts da, woran man es merken koennte
  try {
    await entschluesseln(key, liste[0].titel);
    return true;
  } catch {
    return false;
  }
}

export function Entsperren({
  meta, onZurueckgesetzt, onNotentsperrt,
}: { meta: TresorMeta; onZurueckgesetzt: () => void; onNotentsperrt: () => void }) {
  const [pw, setPw] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [notausgang, setNotausgang] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [reset, setReset] = useState(false);
  const [resetWort, setResetWort] = useState("");

  async function oeffnen(e: React.FormEvent) {
    e.preventDefault();
    setLaeuft(true);
    setFehler(null);
    try {
      entsperren(await tresorOeffnen(pw, meta));
      setPw("");
    } catch (err) {
      // Beim Auswickeln wirft der Browser ohne Grundangabe — das ist genau
      // richtig so, aber die Meldung muss ein Mensch verstehen.
      setFehler(
        err instanceof Error && err.message.startsWith("Verschlüsselung")
          ? err.message
          : "Das Passwort stimmt nicht."
      );
    } finally {
      setLaeuft(false);
    }
  }

  async function mitSchluessel(e: React.FormEvent) {
    e.preventDefault();
    setLaeuft(true);
    setFehler(null);
    try {
      const key = await schluesselAusText(recovery);
      if (!(await passtZumTresor(key))) {
        setFehler("Dieser Schlüssel gehört nicht zu diesem Tresor.");
        return;
      }
      entsperren(key);
      setRecovery("");
      onNotentsperrt();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Der Schlüssel wurde nicht erkannt.");
    } finally {
      setLaeuft(false);
    }
  }

  async function allesLoeschen() {
    await tr.zuruecksetzen();
    setReset(false);
    onZurueckgesetzt();
  }

  return (
    <div className="module-view">
      <div className="panel tresor-tor">
        <div className="tresor-tor-ico"><Icon name="schloss" /></div>
        <h2 className="tresor-tor-titel">Tresor ist verschlossen</h2>
        <p className="tresor-tor-text">
          {notausgang
            ? "Gib den Wiederherstellungsschlüssel ein, den du beim Einrichten notiert hast."
            : "Master-Passwort eingeben, um die Einträge zu entschlüsseln."}
        </p>

        {!notausgang ? (
          <form className="tresor-tor-form" onSubmit={oeffnen}>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="Master-Passwort"
              value={pw}
              onChange={(e) => { setPw(e.target.value); setFehler(null); }}
            />
            <button className="btn" type="submit" disabled={laeuft || !pw}>
              {laeuft ? "Entschlüsseln…" : <><Icon name="schloss-offen" /> Entsperren</>}
            </button>
          </form>
        ) : (
          <form className="tresor-tor-form" onSubmit={mitSchluessel}>
            <textarea
              className="tresor-recovery-eingabe"
              autoFocus
              rows={3}
              spellCheck={false}
              placeholder="XXXXX-XXXXX-XXXXX-…"
              value={recovery}
              onChange={(e) => { setRecovery(e.target.value); setFehler(null); }}
            />
            <button className="btn" type="submit" disabled={laeuft || !recovery.trim()}>
              {laeuft ? "Prüfen…" : <><Icon name="schluessel" /> Mit Schlüssel entsperren</>}
            </button>
          </form>
        )}

        {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}

        <div className="tresor-tor-fuss">
          <button className="back-link" onClick={() => { setNotausgang(!notausgang); setFehler(null); }}>
            {notausgang ? "Zurück zum Passwort" : "Passwort vergessen?"}
          </button>
          <button className="back-link danger" onClick={() => setReset(true)}>
            Tresor zurücksetzen
          </button>
        </div>
      </div>

      {reset && (
        <Modal title="Tresor zurücksetzen" onClose={() => setReset(false)}>
          <p className="modal-msg">
            Damit werden alle Einträge und Anhänge gelöscht. Ohne Passwort oder
            Wiederherstellungsschlüssel lassen sie sich nicht mehr entschlüsseln — es bleibt also
            nichts Brauchbares zurück. Wiederherstellen kann man das nur noch aus einer Sicherung
            im Backup-Bereich.
          </p>
          <p className="modal-msg">
            Zum Bestätigen bitte <b>LÖSCHEN</b> eintippen:
          </p>
          <input
            className="tresor-reset-eingabe"
            autoFocus
            value={resetWort}
            onChange={(e) => setResetWort(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setReset(false)}>Abbrechen</button>
            <button className="btn btn-danger" disabled={resetWort.trim().toUpperCase() !== "LÖSCHEN"} onClick={allesLoeschen}>
              Endgültig löschen
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Passwort wechseln ----------------------------------------------------

export function PasswortWechseln({
  dek, meta, onFertig, onSchliessen,
}: { dek: CryptoKey; meta: TresorMeta; onFertig: (m: TresorMeta) => void; onSchliessen: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const feld = useRef<HTMLInputElement>(null);

  const g = guete(pw);

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < MIN_LAENGE) return setFehler(`Das Passwort braucht mindestens ${MIN_LAENGE} Zeichen.`);
    if (pw !== pw2) return setFehler("Die beiden Eingaben stimmen nicht überein.");
    setLaeuft(true);
    setFehler(null);
    try {
      onFertig(await passwortAendern(dek, pw, meta));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Das Passwort konnte nicht gewechselt werden.");
      feld.current?.focus();
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Modal title="Master-Passwort ändern" onClose={onSchliessen}>
      <p className="modal-msg">
        Die Einträge selbst bleiben unangetastet — nur der Schlüssel wird neu verschlossen.
        Der Wiederherstellungsschlüssel gilt weiterhin.
      </p>
      <form className="tresor-tor-form" onSubmit={speichern}>
        <input
          ref={feld}
          type="password"
          autoComplete="new-password"
          placeholder="Neues Master-Passwort"
          value={pw}
          onChange={(e) => { setPw(e.target.value); setFehler(null); }}
        />
        {pw.length > 0 && (
          <div className={`tresor-guete s${g.stufe}`}>
            <span className="tresor-guete-balken"><i /><i /><i /></span>
            {g.text}
          </div>
        )}
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Wiederholen"
          value={pw2}
          onChange={(e) => { setPw2(e.target.value); setFehler(null); }}
        />
        {fehler && <div className="form-error" role="alert"><Icon name="warnung" /> {fehler}</div>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onSchliessen}>Abbrechen</button>
          <button className="btn" type="submit" disabled={laeuft}>
            {laeuft ? "Wird gewechselt…" : "Passwort ändern"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
