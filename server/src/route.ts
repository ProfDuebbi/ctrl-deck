import { Router, type NextFunction, type Request, type Response, type RequestHandler } from "express";

/*
 * Sicherheitsnetz fuer asynchrone Routen.
 *
 * Express 4 kennt nur geworfene Fehler, keine abgelehnten Versprechen. Solange
 * die Datenbank synchron war, war das ohne Belang: Ein Fehler in einem Handler
 * flog, Express fing ihn, fertig. Seit die Handler `async` sind, wird aus
 * demselben Fehler ein abgelehntes Versprechen, das niemanden interessiert —
 * die Anfrage bekommt nie eine Antwort und der Browser dreht sich, bis jemand
 * neu laedt.
 *
 * Der naheliegende Weg waere, jede der rund neunzig Routen in `.catch(next)` zu
 * fassen. Das waere neunzig Mal dieselbe Zeile, die man beim einundneunzigsten
 * Mal vergisst. Stattdessen umhuellt `machRouter()` die Anmeldefunktionen des
 * Routers ein einziges Mal — von aussen sieht er aus wie ein gewoehnlicher
 * Router, und wer eine Route schreibt, muss davon nichts wissen.
 */

/** Die Methoden, mit denen dieses Projekt Routen anmeldet. */
const METHODEN = ["get", "post", "put", "patch", "delete", "all", "use"] as const;

/**
 * Faengt ab, was aus `fn` herausfaellt — geworfen wie abgelehnt.
 *
 * Fehlerbehandler (vier Parameter) bleiben unangetastet: Sie sind das Ziel von
 * `next(fehler)`, nicht dessen Quelle.
 */
export function sicher(fn: RequestHandler): RequestHandler {
  if (fn.length >= 4) return fn;
  return function (this: unknown, req: Request, res: Response, next: NextFunction) {
    try {
      const ergebnis = (fn as Function).call(this, req, res, next);
      if (ergebnis && typeof (ergebnis as Promise<unknown>).catch === "function")
        (ergebnis as Promise<unknown>).catch(next);
      return ergebnis;
    } catch (fehler) {
      next(fehler);
    }
  };
}

/** Ein Router, dessen Handler alle durch `sicher()` gehen. */
export function machRouter(): Router {
  const r = Router();
  for (const methode of METHODEN) {
    const original = (r[methode] as Function).bind(r);
    (r as any)[methode] = (...args: unknown[]) =>
      original(...args.map((a) => (typeof a === "function" ? sicher(a as RequestHandler) : a)));
  }
  return r;
}
