/**
 * Kleiner Rechenausdruck-Auswerter für den Haushalts-Taschenrechner.
 *
 * Bewusst ein eigener Parser statt eval(): Nutzereingabe wird hier niemals
 * als Code ausgeführt. Unterstützt + − × ÷, Klammern, Vorzeichen und
 * deutsche Kommazahlen ("12,50 + 3").
 */

type Token = { t: "num"; v: number } | { t: "op"; v: string };

function tokenize(eingabe: string): Token[] {
  // Anzeigezeichen auf Rechenzeichen normalisieren, Komma auf Punkt.
  const src = eingabe
    .replace(/\s+/g, "")
    .replace(/[×xX*]/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/,/g, ".");

  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const roh = src.slice(i, j);
      const zahl = Number(roh);
      if (!Number.isFinite(zahl)) throw new Error(`„${roh}" ist keine gültige Zahl`);
      out.push({ t: "num", v: zahl });
      i = j;
    } else if ("+-*/()".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new Error(`Mit „${c}" kann ich nichts anfangen`);
    }
  }
  return out;
}

/**
 * Rekursiver Abstieg:
 *   ausdruck := term (('+' | '-') term)*
 *   term     := faktor (('*' | '/') faktor)*
 *   faktor   := ('-' | '+') faktor | '(' ausdruck ')' | zahl
 */
function parse(tokens: Token[]): number {
  let pos = 0;
  const schau = () => tokens[pos];
  const istOp = (v: string) => {
    const t = schau();
    return t && t.t === "op" && t.v === v;
  };

  function ausdruck(): number {
    let wert = term();
    while (istOp("+") || istOp("-")) {
      const op = (tokens[pos] as { v: string }).v;
      pos++;
      const rechts = term();
      wert = op === "+" ? wert + rechts : wert - rechts;
    }
    return wert;
  }

  function term(): number {
    let wert = faktor();
    while (istOp("*") || istOp("/")) {
      const op = (tokens[pos] as { v: string }).v;
      pos++;
      const rechts = faktor();
      if (op === "/" && rechts === 0) throw new Error("Durch null teilen geht nicht");
      wert = op === "*" ? wert * rechts : wert / rechts;
    }
    return wert;
  }

  function faktor(): number {
    if (istOp("-")) { pos++; return -faktor(); }
    if (istOp("+")) { pos++; return faktor(); }
    if (istOp("(")) {
      pos++;
      const wert = ausdruck();
      if (!istOp(")")) throw new Error("Da fehlt eine schließende Klammer");
      pos++;
      return wert;
    }
    const t = schau();
    if (!t) throw new Error("Der Ausdruck hört mitten drin auf");
    if (t.t !== "num") throw new Error(`„${t.v}" steht an einer Stelle, wo eine Zahl hingehört`);
    pos++;
    return t.v;
  }

  const ergebnis = ausdruck();
  if (pos < tokens.length) throw new Error("Da steht etwas zu viel am Ende");
  return ergebnis;
}

export interface RechenErgebnis {
  wert: number | null;
  fehler: string | null;
}

/** Wertet einen Ausdruck aus. Leere Eingabe ergibt still null, keinen Fehler. */
export function rechne(eingabe: string): RechenErgebnis {
  if (!eingabe.trim()) return { wert: null, fehler: null };
  try {
    const wert = parse(tokenize(eingabe));
    if (!Number.isFinite(wert)) return { wert: null, fehler: "Das Ergebnis ist keine Zahl" };
    return { wert, fehler: null };
  } catch (e) {
    return { wert: null, fehler: e instanceof Error ? e.message : "Das kann ich nicht rechnen" };
  }
}

/** Zahl deutsch formatiert — mindestens 2, höchstens 4 Nachkommastellen. */
export const fmtZahl = (n: number) =>
  n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
