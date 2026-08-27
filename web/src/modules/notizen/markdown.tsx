import type { ReactNode } from "react";

/**
 * Markdown, einmal zerlegt und zweimal gesetzt.
 *
 * Gespeichert wird Markdown-Quelltext — er ist auch dann noch lesbar, wenn es
 * dieses Programm nicht mehr gibt. Gesehen bekommt ihn niemand: Die Ansicht
 * zeigt gesetzten Text, und der Editor laesst darin schreiben.
 *
 * Beides braucht dieselbe Grammatik, und genau deshalb steht sie hier EINMAL:
 * `zerlege()` macht aus Text Bloecke, `Markdown` setzt sie als React-Elemente
 * (Ansicht), `alsHtml()` als HTML-Zeichenkette (Startfuellung des Editors).
 * Zwei getrennte Uebersetzer wuerden auseinanderlaufen, und der Unterschied
 * faellt erst auf, wenn eine Notiz beim Bearbeiten anders aussieht als beim
 * Lesen.
 *
 * Warum kein fertiges Paket? Das Frontend haengt an React und einer
 * Schriftart, sonst an nichts. Ein Markdown-Paket brauchte einen Saeuberer
 * dazu, weil es HTML ausspuckt. Hier entsteht entweder ein React-Element
 * (nichts zu saeubern) oder eine Zeichenkette, in der jeder fremde Text
 * maskiert ist — spitze Klammern bleiben spitze Klammern.
 *
 * Bewusst NICHT unterstuetzt: Tabellen, Fussnoten, eingebettetes HTML,
 * Bilder, verschachtelte Listen. Wer das braucht, schreibt keine Notiz mehr,
 * sondern ein Dokument.
 *
 * Eine Abweichung vom Standard, mit Absicht: Ein einfacher Zeilenumbruch
 * bleibt ein Zeilenumbruch. In echtem Markdown wuerde er zu einem Leerzeichen
 * — bei einer Einkaufsliste ohne Aufzaehlungszeichen ist das nur aergerlich.
 */

// --- Die Bausteine --------------------------------------------------------

export type Inline =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "stark"; teile: Inline[] }
  | { t: "kursiv"; teile: Inline[] }
  | { t: "durch"; teile: Inline[] }
  | { t: "link"; text: string; ziel: string };

export type Punkt = {
  /** null = gewoehnlicher Punkt, sonst Kaestchen an/aus. */
  haken: boolean | null;
  teile: Inline[];
};

export type Block =
  | { t: "ueberschrift"; stufe: 1 | 2 | 3; teile: Inline[] }
  | { t: "absatz"; zeilen: Inline[][] }
  | { t: "liste"; nummeriert: boolean; punkte: Punkt[] }
  | { t: "zitat"; zeilen: Inline[][] }
  | { t: "codeblock"; text: string }
  | { t: "trenner" };

// --- Zeichen im Fliesstext -----------------------------------------------

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|(\[[^\]\n]*\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+)/g;

/** Nur Adressen, die im Browser harmlos sind — `javascript:` gehoert nicht dazu. */
export function sichereAdresse(url: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
}

function zerlegeZeile(text: string): Inline[] {
  const out: Inline[] = [];
  let letzte = 0;
  const schub = (s: string) => { if (s) out.push({ t: "text", text: s }); };

  for (const treffer of text.matchAll(INLINE)) {
    const i = treffer.index ?? 0;
    if (i > letzte) schub(text.slice(letzte, i));
    const s = treffer[0];
    if (s.startsWith("`")) out.push({ t: "code", text: s.slice(1, -1) });
    else if (s.startsWith("**") || s.startsWith("__")) out.push({ t: "stark", teile: zerlegeZeile(s.slice(2, -2)) });
    else if (s.startsWith("~~")) out.push({ t: "durch", teile: zerlegeZeile(s.slice(2, -2)) });
    else if (s.startsWith("[")) {
      const schnitt = s.indexOf("](");
      out.push({ t: "link", text: s.slice(1, schnitt), ziel: s.slice(schnitt + 2, -1) });
    } else if (s.startsWith("http")) out.push({ t: "link", text: s, ziel: s });
    else out.push({ t: "kursiv", teile: zerlegeZeile(s.slice(1, -1)) });
    letzte = i + s.length;
  }
  if (letzte < text.length) schub(text.slice(letzte));
  return out;
}

// --- Zeilen zu Bloecken ---------------------------------------------------

const UEBERSCHRIFT = /^(#{1,6})\s+(.*)$/;
const TRENNER = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const PUNKT = /^(\s*)[-*+]\s+(.*)$/;
const NUMMER = /^(\s*)\d+[.)]\s+(.*)$/;
const KAESTCHEN = /^\[([ xX])\]\s+(.*)$/;

const istSonderzeile = (z: string) =>
  UEBERSCHRIFT.test(z) || TRENNER.test(z) || PUNKT.test(z) || NUMMER.test(z) ||
  /^\s*>/.test(z) || z.trimStart().startsWith("```");

export function zerlege(text: string): Block[] {
  const zeilen = text.replace(/\r\n?/g, "\n").split("\n");
  const bloecke: Block[] = [];
  let i = 0;

  while (i < zeilen.length) {
    const zeile = zeilen[i];

    if (!zeile.trim()) { i++; continue; }

    // Codeblock
    if (zeile.trimStart().startsWith("```")) {
      const inhalt: string[] = [];
      i++;
      while (i < zeilen.length && !zeilen[i].trimStart().startsWith("```")) inhalt.push(zeilen[i++]);
      i++; // schliessende Zeile
      bloecke.push({ t: "codeblock", text: inhalt.join("\n") });
      continue;
    }

    if (TRENNER.test(zeile)) { bloecke.push({ t: "trenner" }); i++; continue; }

    const u = UEBERSCHRIFT.exec(zeile);
    if (u) {
      const stufe = Math.min(u[1].length, 3) as 1 | 2 | 3;
      bloecke.push({ t: "ueberschrift", stufe, teile: zerlegeZeile(u[2]) });
      i++;
      continue;
    }

    // Zitat: alle zusammenhaengenden Zeilen
    if (/^\s*>/.test(zeile)) {
      const zitat: Inline[][] = [];
      while (i < zeilen.length && /^\s*>/.test(zeilen[i]))
        zitat.push(zerlegeZeile(zeilen[i++].replace(/^\s*>\s?/, "")));
      bloecke.push({ t: "zitat", zeilen: zitat });
      continue;
    }

    // Aufzaehlung
    if (PUNKT.test(zeile) || NUMMER.test(zeile)) {
      const nummeriert = NUMMER.test(zeile);
      const muster = nummeriert ? NUMMER : PUNKT;
      const punkte: Punkt[] = [];
      while (i < zeilen.length && muster.test(zeilen[i])) {
        const inhalt = muster.exec(zeilen[i])![2];
        const k = KAESTCHEN.exec(inhalt);
        punkte.push(
          k ? { haken: k[1].toLowerCase() === "x", teile: zerlegeZeile(k[2]) }
            : { haken: null, teile: zerlegeZeile(inhalt) }
        );
        i++;
      }
      bloecke.push({ t: "liste", nummeriert, punkte });
      continue;
    }

    // Absatz: alles bis zur naechsten Leerzeile oder zum naechsten Sonderfall
    const absatz: Inline[][] = [];
    while (i < zeilen.length && zeilen[i].trim() && !istSonderzeile(zeilen[i]))
      absatz.push(zerlegeZeile(zeilen[i++]));
    bloecke.push({ t: "absatz", zeilen: absatz });
  }

  return bloecke;
}

// --- Setzen als React (die Ansicht) --------------------------------------

function reactInline(teile: Inline[], praefix: string): ReactNode[] {
  return teile.map((s, n) => {
    const key = `${praefix}-${n}`;
    switch (s.t) {
      case "text": return <span key={key}>{s.text}</span>;
      case "code": return <code key={key}>{s.text}</code>;
      case "stark": return <strong key={key}>{reactInline(s.teile, key)}</strong>;
      case "kursiv": return <em key={key}>{reactInline(s.teile, key)}</em>;
      case "durch": return <s key={key}>{reactInline(s.teile, key)}</s>;
      case "link": {
        const ziel = sichereAdresse(s.ziel);
        if (!ziel) return <span key={key}>{s.text}</span>;
        return <a key={key} href={ziel} target="_blank" rel="noreferrer noopener">{s.text}</a>;
      }
    }
  });
}

function reactZeilen(zeilen: Inline[][], key: string): ReactNode[] {
  return zeilen.map((z, n) => (
    <span key={n}>
      {n > 0 && <br />}
      {reactInline(z, `${key}-${n}`)}
    </span>
  ));
}

export function Markdown({ text }: { text: string }): ReactNode {
  const bloecke = zerlege(text).map((b, i) => {
    const key = `b${i}`;
    switch (b.t) {
      case "trenner": return <hr key={key} />;
      case "codeblock": return <pre key={key}><code>{b.text}</code></pre>;
      case "ueberschrift": {
        const Tag = `h${b.stufe + 1}` as "h2";
        return <Tag key={key}>{reactInline(b.teile, key)}</Tag>;
      }
      case "zitat":
        return (
          <blockquote key={key}>
            {b.zeilen.map((z, n) => <p key={n}>{reactInline(z, `${key}-${n}`)}</p>)}
          </blockquote>
        );
      case "liste": {
        const punkte = b.punkte.map((p, n) =>
          p.haken === null ? (
            <li key={n}>{reactInline(p.teile, `${key}-${n}`)}</li>
          ) : (
            <li key={n} className={`nz-haken ${p.haken ? "an" : ""}`}>
              {/* Nur Anzeige: Angehakt wird im Editor, nicht beim Lesen —
                  sonst gaebe es zwei Wahrheiten fuer denselben Satz. */}
              <input type="checkbox" checked={p.haken} readOnly tabIndex={-1} aria-hidden="true" />
              <span>{reactInline(p.teile, `${key}-${n}`)}</span>
            </li>
          )
        );
        return b.nummeriert ? <ol key={key}>{punkte}</ol> : <ul key={key}>{punkte}</ul>;
      }
      case "absatz": return <p key={key}>{reactZeilen(b.zeilen, key)}</p>;
    }
  });
  return <>{bloecke}</>;
}

// --- Setzen als HTML (die Startfuellung des Editors) ---------------------

/**
 * Maskiert JEDEN fremden Text. Diese Zeichenkette landet als `innerHTML` im
 * Editor; alles, was nicht aus diesem Modul stammt, muss vorher entschaerft
 * sein — sonst waere ein `<script>` in einer Notiz genau das, wonach es
 * aussieht.
 */
function maskiere(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlInline(teile: Inline[]): string {
  return teile.map((s) => {
    switch (s.t) {
      case "text": return maskiere(s.text);
      case "code": return `<code>${maskiere(s.text)}</code>`;
      case "stark": return `<strong>${htmlInline(s.teile)}</strong>`;
      case "kursiv": return `<em>${htmlInline(s.teile)}</em>`;
      case "durch": return `<s>${htmlInline(s.teile)}</s>`;
      case "link": {
        const ziel = sichereAdresse(s.ziel);
        return ziel
          ? `<a href="${maskiere(ziel)}">${maskiere(s.text)}</a>`
          : maskiere(s.text);
      }
    }
  }).join("");
}

/** Ein Kaestchen im Editor. `contenteditable="false"` haelt den Schreibfluss
 *  davon fern; `data-haken` ist das, was beim Speichern gelesen wird. */
function htmlHaken(an: boolean): string {
  return `<input type="checkbox" contenteditable="false"${an ? " checked" : ""}>`;
}

export function alsHtml(text: string): string {
  const bloecke = zerlege(text).map((b) => {
    switch (b.t) {
      case "trenner": return "<hr>";
      case "codeblock": return `<pre>${maskiere(b.text) || "<br>"}</pre>`;
      case "ueberschrift": return `<h${b.stufe + 1}>${htmlInline(b.teile)}</h${b.stufe + 1}>`;
      case "zitat":
        return `<blockquote>${b.zeilen.map((z) => `<p>${htmlInline(z)}</p>`).join("")}</blockquote>`;
      case "liste": {
        const tag = b.nummeriert ? "ol" : "ul";
        const punkte = b.punkte.map((p) =>
          p.haken === null
            ? `<li>${htmlInline(p.teile)}</li>`
            : `<li class="nz-haken${p.haken ? " an" : ""}" data-haken="${p.haken ? 1 : 0}">` +
              `${htmlHaken(p.haken)}<span>${htmlInline(p.teile)}</span></li>`
        ).join("");
        return `<${tag}>${punkte}</${tag}>`;
      }
      case "absatz": return `<p>${b.zeilen.map(htmlInline).join("<br>")}</p>`;
    }
  }).join("");
  // Ein leeres Feld braucht einen Absatz, sonst schreibt der Browser beim
  // ersten Zeichen nackten Text an die Wurzel.
  return bloecke || "<p><br></p>";
}
