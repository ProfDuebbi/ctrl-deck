import { sichereAdresse } from "./markdown";

/**
 * Der Rueckweg: was im Editor steht, wieder als Markdown.
 *
 * Der Editor ist ein `contenteditable`. Was darin entsteht, bestimmt zum Teil
 * der Browser — Chrome baut gern `<div>` statt `<p>`, `<b>` statt `<strong>`,
 * und beim Einfuegen kaeme ohne Gegenwehr eine ganze fremde Seite mit. Dieser
 * Uebersetzer nimmt deshalb nur, was er kennt, und macht aus allem anderen
 * schlicht Text. Was er nicht versteht, geht als Formatierung verloren — der
 * INHALT geht nie verloren.
 *
 * Grenzen, bewusst in Kauf genommen:
 * - Verschachtelte Listen werden eingerueckt geschrieben, beim naechsten
 *   Oeffnen aber flach gesetzt (die Grammatik in `markdown.tsx` kennt keine
 *   Verschachtelung).
 * - Sternchen, die jemand woertlich tippt, werden nicht maskiert. Sie kommen
 *   beim naechsten Oeffnen als Auszeichnung zurueck. Das ist der Preis dafuer,
 *   dass der Quelltext lesbar bleibt und nicht voller Schraegstriche steht.
 */

const BLOCK_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "BLOCKQUOTE", "PRE", "HR", "TABLE", "SECTION", "ARTICLE",
]);

/** Geschuetzte Leerzeichen sind im Quelltext unsichtbare Stolpersteine. */
const glatt = (s: string) => s.replace(/ /g, " ");

function inline(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) return glatt(n.textContent ?? "");
  if (!(n instanceof HTMLElement)) return "";

  const kinder = () => Array.from(n.childNodes).map(inline).join("");

  switch (n.tagName) {
    case "BR": return "\n";
    // Ein Kaestchen wird von der Listenzeile gesetzt, nicht hier.
    case "INPUT": return "";
    case "STRONG": case "B": {
      const k = kinder();
      return k.trim() ? `**${k}**` : k;
    }
    case "EM": case "I": {
      const k = kinder();
      return k.trim() ? `*${k}*` : k;
    }
    case "S": case "STRIKE": case "DEL": {
      const k = kinder();
      return k.trim() ? `~~${k}~~` : k;
    }
    case "CODE": {
      const k = glatt(n.textContent ?? "");
      return k.trim() ? `\`${k}\`` : k;
    }
    case "A": {
      const text = kinder();
      const ziel = sichereAdresse(n.getAttribute("href") ?? "");
      if (!ziel || !text.trim()) return text;
      // Eine nackte Adresse als Text braucht keine Klammern.
      return text === ziel ? text : `[${text}](${ziel})`;
    }
    default: return kinder();
  }
}

/** Eine Liste samt ihrer Kaestchen und (eingerueckt) ihrer Unterlisten. */
function liste(el: HTMLElement, tiefe: number): string {
  const nummeriert = el.tagName === "OL";
  const zeilen: string[] = [];
  let n = 1;

  for (const kind of Array.from(el.children)) {
    if (!(kind instanceof HTMLElement) || kind.tagName !== "LI") continue;

    const unter = Array.from(kind.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement && (c.tagName === "UL" || c.tagName === "OL")
    );
    const text = Array.from(kind.childNodes)
      .filter((k) => !unter.includes(k as HTMLElement))
      .map(inline)
      .join("")
      .replace(/\n+/g, " ")
      .trim();

    const marke = nummeriert ? `${n++}. ` : "- ";
    const haken = kind.dataset.haken;
    const kasten = haken === undefined ? "" : haken === "1" ? "[x] " : "[ ] ";
    zeilen.push(`${"  ".repeat(tiefe)}${marke}${kasten}${text}`);

    for (const u of unter) zeilen.push(liste(u, tiefe + 1));
  }
  return zeilen.join("\n");
}

/**
 * Bloecke einer Ebene. Nebeneinanderstehende Textstuecke ohne eigenen Block
 * werden zu EINEM Absatz gesammelt — sonst zerfiele eine Zeile, in der nur
 * ein Wort fett ist, in drei Absaetze.
 */
function bloecke(el: HTMLElement, tiefe = 0): string[] {
  const teile: string[] = [];
  let offen: string[] = [];

  const absatzSchliessen = () => {
    const text = offen.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text) teile.push(text);
    offen = [];
  };

  for (const kind of Array.from(el.childNodes)) {
    if (kind instanceof HTMLElement && BLOCK_TAGS.has(kind.tagName)) {
      absatzSchliessen();
      switch (kind.tagName) {
        case "HR": teile.push("---"); break;
        case "H1": case "H2": teile.push(`# ${inline(kind).trim()}`); break;
        case "H3": teile.push(`## ${inline(kind).trim()}`); break;
        case "H4": case "H5": case "H6": teile.push(`### ${inline(kind).trim()}`); break;
        case "UL": case "OL": teile.push(liste(kind, 0)); break;
        case "PRE": {
          const text = glatt(kind.textContent ?? "").replace(/\n$/, "");
          teile.push("```\n" + text + "\n```");
          break;
        }
        case "BLOCKQUOTE": {
          const innen = bloecke(kind, tiefe + 1).join("\n\n");
          teile.push(innen.split("\n").map((z) => (z ? `> ${z}` : ">")).join("\n"));
          break;
        }
        default: {
          // P, DIV und Unbekanntes: enthaelt es selbst Bloecke, wird es
          // aufgeklappt; sonst ist es ein Absatz.
          const hatBloecke = Array.from(kind.children).some(
            (c) => c instanceof HTMLElement && BLOCK_TAGS.has(c.tagName)
          );
          if (hatBloecke) teile.push(...bloecke(kind, tiefe + 1));
          else {
            const text = inline(kind).replace(/[ \t]+$/gm, "").trim();
            if (text) teile.push(text);
          }
        }
      }
      continue;
    }
    offen.push(inline(kind));
  }
  absatzSchliessen();
  return teile.filter((t) => t !== "");
}

export function nachMarkdown(wurzel: HTMLElement): string {
  return bloecke(wurzel).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
