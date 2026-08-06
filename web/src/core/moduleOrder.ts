import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";

/**
 * Selbst gewaehlte Reihenfolge der Module.
 *
 * Sie liegt im Backend (settings-Tabelle), nicht im localStorage: Sie gehoert
 * zum Dashboard, nicht zum Browser — nach einem Profilwechsel oder auf einem
 * zweiten Fenster soll dieselbe Anordnung stehen.
 *
 * Eine leere Liste bedeutet „wie im Code deklariert". Deshalb ist
 * Zuruecksetzen einfach das Speichern einer leeren Liste.
 */

/**
 * Sortiert nach gespeicherter Reihenfolge. Module, die noch nicht darin
 * vorkommen (weil sie spaeter dazugebaut wurden), haengen hinten an, statt zu
 * verschwinden — sonst waere ein neues Modul nach dem ersten Umsortieren
 * unsichtbar.
 */
export function sortiereModule<T extends { id: string }>(module: T[], reihenfolge: string[]): T[] {
  if (reihenfolge.length === 0) return module;
  const rang = new Map(reihenfolge.map((id, i) => [id, i]));
  return module
    .map((m, i) => ({ m, r: rang.get(m.id) ?? reihenfolge.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.m);
}

/** Verschiebt `was` an die Stelle von `wohin`. Gibt bei Nicht-Aenderung dieselbe Liste zurueck. */
export function verschiebe(ids: string[], was: string, wohin: string): string[] {
  const von = ids.indexOf(was);
  const nach = ids.indexOf(wohin);
  if (von < 0 || nach < 0 || von === nach) return ids;
  const neu = [...ids];
  neu.splice(von, 1);
  neu.splice(nach, 0, was);
  return neu;
}

export function useModuleOrder<T extends { id: string }>(alle: T[]) {
  const [reihenfolge, setReihenfolge] = useState<string[]>([]);
  const [versteckt, setVersteckt] = useState<string[]>([]);

  useEffect(() => {
    api<{ order: string[] }>("/module-order")
      .then((r) => setReihenfolge(r.order))
      .catch(() => setReihenfolge([]));
    api<{ hidden: string[] }>("/module-hidden")
      .then((r) => setVersteckt(r.hidden))
      .catch(() => setVersteckt([]));
  }, []);

  /** Sofort anzeigen, im Hintergrund sichern — das Ziehen soll nicht ruckeln. */
  const speichern = useCallback((ids: string[]) => {
    setReihenfolge(ids);
    api("/module-order", { method: "PUT", body: JSON.stringify({ order: ids }) }).catch(() => {
      /* Backend offline — die Anordnung gilt dann nur bis zum Neuladen */
    });
  }, []);

  /** Ein Modul ein- oder ausblenden. Daten bleiben, nur die Anzeige aendert sich. */
  const umschalten = useCallback((id: string) => {
    setVersteckt((bisher) => {
      const neu = bisher.includes(id) ? bisher.filter((x) => x !== id) : [...bisher, id];
      api("/module-hidden", { method: "PUT", body: JSON.stringify({ hidden: neu }) }).catch(() => {
        /* Backend offline — gilt dann nur bis zum Neuladen */
      });
      return neu;
    });
  }, []);

  const alleSortiert = useMemo(() => sortiereModule(alle, reihenfolge), [alle, reihenfolge]);
  // `module` ist das, was Kachelwand und Seitenleiste zeigen. `alleSortiert`
  // braucht der Verwaltungsdialog — dort muessen auch die ausgeblendeten
  // stehen, sonst kaeme man nie wieder an sie heran.
  const module = useMemo(
    () => alleSortiert.filter((m) => !versteckt.includes(m.id)),
    [alleSortiert, versteckt]
  );

  return {
    module,
    alleSortiert,
    versteckt,
    umschalten,
    speichern,
    zuruecksetzen: useCallback(() => speichern([]), [speichern]),
    angepasst: reihenfolge.length > 0,
  };
}
