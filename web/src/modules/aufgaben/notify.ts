import type { Task } from "./api";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notifPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : "denied";
}

export async function requestNotifPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Eindeutiger Schlüssel pro Aufgabe+Termin — verhindert doppelte Popups. */
function key(t: Task): string {
  return `cd_notified:${t.id}:${t.faellig_datum}:${t.faellig_zeit ?? ""}`;
}

function alreadyNotified(t: Task): boolean {
  return localStorage.getItem(key(t)) === "1";
}
function markNotified(t: Task): void {
  localStorage.setItem(key(t), "1");
}

/**
 * Zeigt für fällige, noch nicht gemeldete Aufgaben eine Desktop-Benachrichtigung
 * und gibt die neu gemeldeten zurück (für einen zusätzlichen In-App-Hinweis).
 */
export function notifyDue(due: Task[]): Task[] {
  const fresh = due.filter((t) => !alreadyNotified(t));
  if (fresh.length === 0) return [];

  const canPopup = notifPermission() === "granted";
  for (const t of fresh) {
    markNotified(t);
    if (canPopup) {
      const body = [t.faellig_zeit ? `Fällig ${t.faellig_zeit}` : "Heute fällig", t.notiz]
        .filter(Boolean)
        .join(" · ");
      try {
        new Notification(`🔔 ${t.titel}`, { body, tag: `cd-task-${t.id}` });
      } catch {
        /* Notification kann in manchen Kontexten werfen — ignorieren */
      }
    }
  }
  return fresh;
}
