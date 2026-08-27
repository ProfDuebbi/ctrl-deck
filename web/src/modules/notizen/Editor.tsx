import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../../core/Icon";
import { Modal } from "../../core/ui";
import { alsHtml, sichereAdresse } from "./markdown";
import { nachMarkdown } from "./nachMarkdown";

/**
 * Der Editor: Was hier steht, sieht aus wie die fertige Notiz.
 *
 * Geschrieben wird in einem `contenteditable` — fett ist fett, eine
 * Ueberschrift ist gross, Sternchen sieht niemand. Gespeichert wird trotzdem
 * Markdown (`nachMarkdown.ts`), damit eine Notiz eine lesbare Textdatei
 * bleibt und nicht das Innenleben dieses Programms.
 *
 * Das Feld ist ABSICHTLICH ungesteuert: Der Inhalt wird beim Oeffnen EINMAL
 * gesetzt und danach vom Browser verwaltet. Wuerde bei jedem Tastendruck der
 * ganze Text neu hineingeschrieben, spraenge die Schreibmarke bei jedem
 * Zeichen an den Anfang. Nach aussen meldet das Feld nur, was jetzt
 * drinsteht.
 *
 * `document.execCommand` gilt als veraltet — und ist trotzdem die richtige
 * Wahl: Es ist in jedem Browser vorhanden, und die Alternative waere, das
 * Aendern von Auswahl und Struktur von Hand zu bauen (deutlich mehr Code und
 * deutlich mehr Fehler). Sollte es je verschwinden, bleibt der Uebersetzer
 * bestehen; nur die Knopfleiste muesste neu.
 */

interface Werkzeug {
  id: string;
  titel: string;
  /** Buchstabe (B, I) ODER Symbol — Auszeichnungen kennt man als Buchstaben. */
  text?: string;
  icon?: IconName;
  tun: () => void;
}

export function Editor({
  start, onChange, onSpeichern,
}: {
  /** Markdown-Quelltext beim Oeffnen. Aenderungen daran werden ignoriert. */
  start: string;
  onChange: (markdown: string) => void;
  /** Strg+S im Feld. */
  onSpeichern: () => void;
}) {
  const feld = useRef<HTMLDivElement>(null);
  const [aktiv, setAktiv] = useState<Set<string>>(new Set());
  const [linkOffen, setLinkOffen] = useState(false);
  const [linkZiel, setLinkZiel] = useState("https://");
  const gemerkteAuswahl = useRef<Range | null>(null);
  const speichernRef = useRef(onSpeichern);
  speichernRef.current = onSpeichern;

  // --- Fuellen und melden ------------------------------------------------

  useEffect(() => {
    const el = feld.current;
    if (!el) return;
    el.innerHTML = alsHtml(start);
    // Ohne diese Ansage baut Chrome bei jedem Absatz ein <div>. Das ist zwar
    // uebersetzbar, aber <p> ist das, was auch die Ansicht setzt.
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* egal */ }
    // Schreibmarke ans Ende, damit man sofort weiterschreiben kann.
    el.focus();
    const bereich = document.createRange();
    bereich.selectNodeContents(el);
    bereich.collapse(false);
    const auswahl = window.getSelection();
    auswahl?.removeAllRanges();
    auswahl?.addRange(bereich);
    // Absicht: nur beim Oeffnen. Siehe Kopfkommentar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Vor dem Uebersetzen aufraeumen: Kaestchen und ihre Merkzeichen koennen
   * beim Tippen auseinanderlaufen. Wer das Kaestchen wegloescht, wollte einen
   * gewoehnlichen Listenpunkt; wer mit Enter eine neue Zeile beginnt, bekommt
   * von Chrome eine Kopie samt Haken — die soll leer starten.
   */
  const aufraeumen = (el: HTMLElement) => {
    /*
     * Chrome baut beim Einschalten einer Liste mitten in einem Absatz oder
     * einer Ueberschrift gelegentlich `<p><ul>…</ul></p>`. Das gibt es im HTML
     * nicht, und der naechste Tastendruck darin wird entsprechend
     * unvorhersehbar. Die Liste kommt deshalb eine Ebene hoeher; die leer
     * gewordene Huelle faellt weg.
     */
    for (const inListe of Array.from(el.querySelectorAll("ul, ol"))) {
      const eltern = inListe.parentElement;
      if (!eltern || !NUR_TEXT.has(eltern.tagName)) continue;
      eltern.parentElement?.insertBefore(inListe, eltern);
      if (!eltern.textContent?.trim() && !eltern.querySelector("ul, ol, input")) eltern.remove();
    }

    // Ein Kaestchen ausserhalb eines Listenpunktes ist ein Ueberrest.
    for (const kasten of Array.from(el.querySelectorAll('input[type="checkbox"]')))
      if (!kasten.closest("li")) kasten.remove();

    for (const li of Array.from(el.querySelectorAll("li"))) {
      const kasten = li.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (!kasten) { delete li.dataset.haken; li.classList.remove("nz-haken", "an"); continue; }
      li.classList.add("nz-haken");
      const leer = (li.textContent ?? "").trim() === "";
      const an = leer ? false : kasten.checked;
      kasten.checked = an;
      if (an) kasten.setAttribute("checked", ""); else kasten.removeAttribute("checked");
      li.dataset.haken = an ? "1" : "0";
      li.classList.toggle("an", an);
    }
  };

  const melden = useCallback(() => {
    const el = feld.current;
    if (!el) return;
    aufraeumen(el);
    onChange(nachMarkdown(el));
  }, [onChange]);

  // --- Wo steht die Schreibmarke gerade? ---------------------------------

  useEffect(() => {
    const pruefen = () => {
      const el = feld.current;
      if (!el || !el.contains(document.getSelection()?.anchorNode ?? null)) return;
      const gefunden = new Set<string>();
      for (const [id, kommando] of Object.entries(ZUSTAND)) {
        try { if (document.queryCommandState(kommando)) gefunden.add(id); } catch { /* egal */ }
      }
      const knoten = document.getSelection()?.anchorNode;
      const block = knoten instanceof Element ? knoten : knoten?.parentElement;
      for (const [id, tag] of Object.entries(BLOCK)) {
        if (block?.closest(tag)) gefunden.add(id);
      }
      setAktiv(gefunden);
    };
    document.addEventListener("selectionchange", pruefen);
    return () => document.removeEventListener("selectionchange", pruefen);
  }, []);

  // --- Handgriffe --------------------------------------------------------

  /** Schreibmarke ans Ende von `el`. Der leere Textknoten ist Absicht: In
   *  einem Listenpunkt, der nur aus dem Kaestchen besteht, gaebe es sonst
   *  keine Stelle, an der die Marke stehen koennte. */
  const marke = (el: HTMLElement) => {
    if (!el.lastChild || el.lastChild.nodeType !== Node.TEXT_NODE)
      el.appendChild(document.createTextNode(""));
    const bereich = document.createRange();
    bereich.selectNodeContents(el);
    bereich.collapse(false);
    const auswahl = window.getSelection();
    auswahl?.removeAllRanges();
    auswahl?.addRange(bereich);
  };

  /** Der Listenpunkt, in dem die Schreibmarke gerade steht. */
  const punkt = (): HTMLLIElement | null => {
    const knoten = document.getSelection()?.anchorNode;
    return (knoten instanceof Element ? knoten : knoten?.parentElement)?.closest("li") ?? null;
  };

  const neuesKaestchen = () => {
    const kasten = document.createElement("input");
    kasten.type = "checkbox";
    kasten.contentEditable = "false";
    return kasten;
  };

  const befehl = (name: string, wert?: string) => {
    feld.current?.focus();
    try { document.execCommand(name, false, wert); } catch { /* egal */ }
    melden();
  };

  /** Blockformat setzen — nochmal derselbe Knopf macht wieder einen Absatz. */
  const block = (tag: string) => {
    const knoten = document.getSelection()?.anchorNode;
    const el = knoten instanceof Element ? knoten : knoten?.parentElement;
    befehl("formatBlock", el?.closest(tag) ? "p" : tag);
  };

  /** Auswahl in ein Element wickeln — fuer `code`, das kein Kommando hat. */
  const umschliessen = (tag: string) => {
    const el = feld.current;
    const auswahl = window.getSelection();
    if (!el || !auswahl || auswahl.rangeCount === 0) return;
    const bereich = auswahl.getRangeAt(0);
    if (!el.contains(bereich.commonAncestorContainer)) return;

    const knoten = bereich.startContainer;
    const schon = (knoten instanceof Element ? knoten : knoten.parentElement)?.closest(tag);
    if (schon) {
      // Wieder aufmachen: Inhalt an die Stelle des Elements setzen.
      const eltern = schon.parentNode;
      while (schon.firstChild) eltern?.insertBefore(schon.firstChild, schon);
      eltern?.removeChild(schon);
      melden();
      return;
    }
    if (bereich.collapsed) return;
    const huelle = document.createElement(tag);
    huelle.appendChild(bereich.extractContents());
    bereich.insertNode(huelle);
    auswahl.removeAllRanges();
    const neu = document.createRange();
    neu.selectNodeContents(huelle);
    auswahl.addRange(neu);
    melden();
  };

  /** Aus der aktuellen Zeile einen Punkt mit Kaestchen machen (oder zurueck). */
  const kaestchen = () => {
    const el = feld.current;
    if (!el) return;
    el.focus();
    let li = punkt();
    if (!li) {
      befehl("insertUnorderedList");
      li = punkt();
    }
    if (!li) return;

    const vorhanden = li.querySelector('input[type="checkbox"]');
    if (vorhanden) vorhanden.remove();
    else li.insertBefore(neuesKaestchen(), li.firstChild);
    // Ohne das steht die Schreibmarke danach VOR dem Kaestchen, und der
    // naechste Buchstabe landet ausserhalb des Punktes.
    marke(li);
    melden();
  };

  /**
   * Trennlinie. In einem Listenpunkt legt der Browser sie MITTEN in den
   * Punkt — dort ist sie beim Speichern verloren, weil eine Aufzaehlung nur
   * Text kennt. Deshalb landet sie in dem Fall hinter der Liste.
   */
  const trennlinie = () => {
    const li = punkt();
    if (!li) { befehl("insertHorizontalRule"); return; }
    const liste = li.parentElement;
    const absatz = document.createElement("p");
    absatz.appendChild(document.createElement("br"));
    liste?.after(absatz);
    liste?.after(document.createElement("hr"));
    marke(absatz);
    melden();
  };

  /** Klick auf ein Kaestchen hakt ab — im Editor ist das die eine Stelle,
   *  an der man es tun kann (die Ansicht zeigt nur). */
  const klick = (e: React.MouseEvent) => {
    const ziel = e.target as HTMLElement;
    if (!(ziel instanceof HTMLInputElement) || ziel.type !== "checkbox") return;
    const li = ziel.closest("li");
    if (!li) return;
    const an = !(li.dataset.haken === "1");
    ziel.checked = an;
    melden();
  };

  /**
   * Eingefuegt wird immer als reiner Text.
   *
   * Sonst kaeme aus einer Webseite deren halbes Stilblatt mit — Schriftgroessen,
   * Farben, verschachtelte `<span>`, die der Uebersetzer ohnehin wegwerfen
   * muesste. Zeilenumbrueche und Absaetze bleiben erhalten.
   */
  const einfuegen = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    document.execCommand("insertText", false, text);
    melden();
  };

  const tasten = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      melden();
      speichernRef.current();
      return;
    }

    /*
     * Enter in einem Punkt mit Kaestchen macht der Browser falsch: Er kopiert
     * den Punkt samt Haken, und ob die Schreibmarke danach vor oder hinter dem
     * Kaestchen steht, haengt davon ab, wo sie vorher stand. Deshalb hier von
     * Hand — der neue Punkt hat immer ein LEERES Kaestchen.
     */
    if (e.key === "Enter" && !e.shiftKey) {
      const li = punkt();
      if (!li?.querySelector('input[type="checkbox"]')) return;
      e.preventDefault();

      /*
       * Leerer Punkt + Enter heisst „Liste zu Ende". Auch das von Hand:
       * `insertUnorderedList` reisst in dieser Lage den halben Punkt aus der
       * Liste heraus und laesst eine leere Huelle stehen.
       */
      if (!(li.textContent ?? "").trim()) {
        const liste = li.parentElement;
        const absatz = document.createElement("p");
        absatz.appendChild(document.createElement("br"));
        liste?.after(absatz);
        li.remove();
        if (liste && !liste.querySelector("li")) liste.remove();
        marke(absatz);
        melden();
        return;
      }

      const neuer = document.createElement("li");
      neuer.className = "nz-haken";
      neuer.dataset.haken = "0";
      neuer.appendChild(neuesKaestchen());
      li.after(neuer);
      marke(neuer);
      melden();
    }
  };

  const linkOeffnen = () => {
    const auswahl = window.getSelection();
    gemerkteAuswahl.current =
      auswahl && auswahl.rangeCount > 0 ? auswahl.getRangeAt(0).cloneRange() : null;
    setLinkZiel("https://");
    setLinkOffen(true);
  };

  const linkSetzen = () => {
    const ziel = sichereAdresse(linkZiel.trim());
    setLinkOffen(false);
    if (!ziel) return;
    const el = feld.current;
    const bereich = gemerkteAuswahl.current;
    if (!el || !bereich) return;
    el.focus();
    const auswahl = window.getSelection();
    auswahl?.removeAllRanges();
    auswahl?.addRange(bereich);
    if (bereich.collapsed) {
      // Ohne Markierung: die Adresse selbst als Text einsetzen.
      document.execCommand("insertHTML", false, `<a href="${ziel}">${ziel}</a>`);
    } else {
      document.execCommand("createLink", false, ziel);
    }
    melden();
  };

  // --- Die Leiste --------------------------------------------------------

  const werkzeuge: (Werkzeug | "trenner")[] = [
    { id: "ue1", titel: "Überschrift", text: "Ü1", tun: () => block("h2") },
    { id: "ue2", titel: "Zwischenüberschrift", text: "Ü2", tun: () => block("h3") },
    "trenner",
    { id: "fett", titel: "Fett (Strg+B)", text: "B", tun: () => befehl("bold") },
    { id: "kursiv", titel: "Kursiv (Strg+I)", text: "I", tun: () => befehl("italic") },
    { id: "durch", titel: "Durchgestrichen", text: "S", tun: () => befehl("strikeThrough") },
    "trenner",
    { id: "liste", titel: "Aufzählung", icon: "liste", tun: () => befehl("insertUnorderedList") },
    { id: "nummern", titel: "Nummerierte Liste", icon: "nummern", tun: () => befehl("insertOrderedList") },
    { id: "haken", titel: "Kästchen zum Abhaken", icon: "kaestchen", tun: kaestchen },
    "trenner",
    { id: "zitat", titel: "Zitat", icon: "zitat", tun: () => block("blockquote") },
    { id: "code", titel: "Code im Text", icon: "code", tun: () => umschliessen("code") },
    { id: "codeblock", titel: "Codeblock", icon: "codeblock", tun: () => block("pre") },
    "trenner",
    { id: "link", titel: "Link", icon: "kette", tun: linkOeffnen },
    { id: "linie", titel: "Trennlinie", icon: "linie", tun: trennlinie },
  ];

  return (
    <>
      <div className="nz-leiste" role="toolbar" aria-label="Textformat">
        {werkzeuge.map((w, i) =>
          w === "trenner" ? (
            <span className="nz-leiste-strich" key={`t${i}`} aria-hidden="true" />
          ) : (
            <button
              key={w.id}
              type="button"
              className={`nz-knopf ${w.text ? `zeichen ${w.id}` : ""} ${aktiv.has(w.id) ? "an" : ""}`}
              title={w.titel}
              aria-label={w.titel}
              aria-pressed={aktiv.has(w.id)}
              // Ohne das nimmt der Klick die Markierung mit, und das Werkzeug
              // wuesste nicht mehr, worauf es wirken soll.
              onMouseDown={(e) => e.preventDefault()}
              onClick={w.tun}
            >
              {w.text ?? (w.icon ? <Icon name={w.icon} /> : null)}
            </button>
          )
        )}
      </div>

      <div
        className="nz-md nz-editor"
        ref={feld}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Notiztext"
        spellCheck
        onInput={melden}
        onBlur={melden}
        onClick={klick}
        onPaste={einfuegen}
        onKeyDown={tasten}
      />

      {linkOffen && (
        <Modal title="Link einfügen" onClose={() => setLinkOffen(false)}>
          <p className="modal-msg">
            Nur Web- und E-Mail-Adressen (<code>https://</code>, <code>mailto:</code>).
          </p>
          <input
            className="wide"
            value={linkZiel}
            onChange={(e) => setLinkZiel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") linkSetzen(); }}
            autoFocus
          />
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setLinkOffen(false)}>Abbrechen</button>
            <button className="btn" onClick={linkSetzen} disabled={!sichereAdresse(linkZiel.trim())}>
              Einfügen
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Bloecke, in denen eine Liste nichts zu suchen hat (sie duerfen nur Text
 *  enthalten). `div` und `blockquote` fehlen absichtlich — dort ist eine
 *  Liste erlaubt. */
const NUR_TEXT = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6"]);

/** Kommandos, deren Zustand der Browser selbst kennt. */
const ZUSTAND: Record<string, string> = {
  fett: "bold",
  kursiv: "italic",
  durch: "strikeThrough",
  liste: "insertUnorderedList",
  nummern: "insertOrderedList",
};

/** Bloecke, die man am Vorfahren erkennt. */
const BLOCK: Record<string, string> = {
  ue1: "h2",
  ue2: "h3",
  zitat: "blockquote",
  code: "code",
  codeblock: "pre",
  link: "a",
};
