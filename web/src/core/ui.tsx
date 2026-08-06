import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode, type RefObject,
} from "react";
import { Icon } from "./Icon";

// --- Dialog-Verhalten (fuer Modal und Bestaetigung gemeinsam) ------------

/**
 * Macht aus einem Kasten einen richtigen Dialog:
 * - Escape schliesst
 * - der Fokus springt beim Oeffnen hinein und beim Schliessen dorthin zurueck,
 *   wo er herkam
 * - Tab laeuft im Kreis, statt hinter den Dialog auf die Seite zu wandern
 *
 * Ohne das ist ein Overlay fuer Tastatur- und Screenreader-Nutzung eine
 * Sackgasse: man tabbt in eine Seite, die man gar nicht sehen kann.
 */
function useDialog(ref: RefObject<HTMLElement>, onClose: () => void) {
  // In einer Ref, damit der Effekt nicht bei jedem Render neu aufgesetzt wird.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const vorher = document.activeElement as HTMLElement | null;

    const box = ref.current;
    const fokussierbare = () =>
      Array.from(
        box?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null);

    // Erstes sinnvolles Element anspringen, sonst den Dialog selbst.
    const ziel = fokussierbare().find((el) => !el.classList.contains("modal-close"));
    (ziel ?? box)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const liste = fokussierbare();
      if (liste.length === 0) return;
      const erster = liste[0];
      const letzter = liste[liste.length - 1];
      if (e.shiftKey && document.activeElement === erster) {
        e.preventDefault();
        letzter.focus();
      } else if (!e.shiftKey && document.activeElement === letzter) {
        e.preventDefault();
        erster.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      vorher?.focus?.();
    };
  }, [ref]);
}

// --- Bestaetigungs-Dialog (ersetzt das native confirm) -------------------

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

function ConfirmBox({
  opts, onAnswer,
}: { opts: ConfirmOptions; onAnswer: (b: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, () => onAnswer(false));

  return (
    <div className="modal-overlay" onClick={() => onAnswer(false)}>
      <div
        className="modal modal-sm"
        onClick={(e) => e.stopPropagation()}
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-titel"
        aria-describedby="confirm-text"
        tabIndex={-1}
      >
        <h3 className="modal-title" id="confirm-titel">{opts.title ?? "Bestätigen"}</h3>
        <p className="modal-msg" id="confirm-text">{opts.message}</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => onAnswer(false)}>Abbrechen</button>
          <button
            className={`btn ${opts.danger ? "btn-danger" : ""}`}
            onClick={() => onAnswer(true)}
          >
            {opts.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (b: boolean) => void } | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setState({ opts, resolve })),
    []
  );

  const close = (val: boolean) => {
    state?.resolve(val);
    setState(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && <ConfirmBox opts={state.opts} onAnswer={close} />}
    </ConfirmCtx.Provider>
  );
}

// --- Generisches Modal ---------------------------------------------------

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titel"
        tabIndex={-1}
      >
        <div className="modal-head">
          <h3 className="modal-title" id="modal-titel">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Schließen"><Icon name="schliessen" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
