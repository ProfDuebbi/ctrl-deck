/**
 * Krypto fuer den Tresor — alles im Browser, nichts davon verlaesst den Rechner
 * im Klartext.
 *
 * Aufbau:
 *   Master-Passwort --PBKDF2--> Passwort-Schluessel (KEK)
 *   Passwort-Schluessel wickelt --> Datenschluessel (DEK, 256 Bit Zufall)
 *   Datenschluessel verschluesselt --> Titel, Werte, Notizen, Dateien
 *
 * Der Umweg ueber zwei Schluessel klingt umstaendlich, spart aber genau das,
 * was sonst weh taete: Beim Passwortwechsel wird nur der Datenschluessel neu
 * eingewickelt. Kein Eintrag und keine Datei muss angefasst werden.
 *
 * AES-GCM prueft beim Entschluesseln selbst, ob Schluessel und Daten
 * zusammenpassen — ein falsches Passwort scheitert also mit einem Fehler statt
 * mit Buchstabensalat. Eine zusaetzliche Passwortprobe braucht es nicht.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** OWASP-Empfehlung fuer PBKDF2-SHA256 (Stand 2023). Braucht ~0,5 s. */
export const KDF_ITERATIONEN = 600_000;

const KEIN_WEBCRYPTO =
  "Verschlüsselung steht in diesem Fenster nicht zur Verfügung. " +
  "Bitte CTRL·DECK über http://localhost:5180 öffnen (nicht über die IP-Adresse).";

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new Error(KEIN_WEBCRYPTO);
  return globalThis.crypto.subtle;
}

// --- Base64 ---------------------------------------------------------------

export function zuB64(daten: ArrayBuffer | Uint8Array): string {
  const bytes = daten instanceof Uint8Array ? daten : new Uint8Array(daten);
  let s = "";
  // In Haeppchen, sonst sprengen grosse Dateien den Aufrufstapel.
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Der Rueckgabetyp ist absichtlich der enge: seit TypeScript 5.7 unterscheidet
// die Typisierung ArrayBuffer und SharedArrayBuffer, und WebCrypto nimmt nur
// ersteren. Ein hier belegter Puffer erspart Casts an jeder Aufrufstelle.
export function ausB64(text: string): Uint8Array<ArrayBuffer> {
  const roh = atob(text);
  const out = new Uint8Array(new ArrayBuffer(roh.length));
  for (let i = 0; i < roh.length; i++) out[i] = roh.charCodeAt(i);
  return out;
}

const zufall = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// --- Schluessel -----------------------------------------------------------

/** Leitet den Passwort-Schluessel ab. Bewusst langsam — das ist der Sinn. */
export async function passwortSchluessel(
  passwort: string,
  saltB64: string,
  iterationen: number
): Promise<CryptoKey> {
  const basis = await subtle().importKey("raw", enc.encode(passwort), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: ausB64(saltB64), iterations: iterationen, hash: "SHA-256" },
    basis,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

export const neuesSalz = () => zuB64(zufall(16));

/** Frischer Datenschluessel. Auslesbar, damit er eingewickelt und als
 *  Wiederherstellungsschluessel angezeigt werden kann. */
export function neuerDatenschluessel(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Datenschluessel mit dem Passwort-Schluessel einwickeln -> "iv:paket". */
export async function einwickeln(dek: CryptoKey, kek: CryptoKey): Promise<string> {
  const iv = zufall(12);
  const paket = await subtle().wrapKey("raw", dek, kek, { name: "AES-GCM", iv });
  return `${zuB64(iv)}:${zuB64(paket)}`;
}

/** Auswickeln. Falsches Passwort -> der Aufruf wirft (GCM-Pruefsumme). */
export async function auswickeln(paket: string, kek: CryptoKey): Promise<CryptoKey> {
  const [ivB64, ctB64] = paket.split(":");
  if (!ivB64 || !ctB64) throw new Error("Tresor-Daten beschädigt");
  return subtle().unwrapKey(
    "raw",
    ausB64(ctB64),
    kek,
    { name: "AES-GCM", iv: ausB64(ivB64) },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// --- Wiederherstellungsschluessel -----------------------------------------

/**
 * Der nackte Datenschluessel als lesbare Zeichenkette. Wer ihn hat, kommt auch
 * ohne Passwort an alles — deshalb gehoert er ausgedruckt in den Ordner und
 * nicht in eine Datei neben die Datenbank.
 */
export async function wiederherstellungsSchluessel(dek: CryptoKey): Promise<string> {
  const roh = await subtle().exportKey("raw", dek);
  return (zuB64(roh).match(/.{1,5}/g) ?? []).join("-");
}

export function schluesselAusText(text: string): Promise<CryptoKey> {
  const roh = ausB64(text.replace(/[\s-]/g, ""));
  if (roh.length !== 32) return Promise.reject(new Error("Der Schlüssel hat nicht die richtige Länge."));
  return subtle().importKey("raw", roh, { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

// --- Nutzdaten ------------------------------------------------------------

/** Text -> "v1:iv:paket". Jeder Aufruf bekommt einen eigenen Zufallswert. */
export async function verschluesseln(key: CryptoKey, text: string): Promise<string> {
  const iv = zufall(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return `v1:${zuB64(iv)}:${zuB64(ct)}`;
}

export async function entschluesseln(key: CryptoKey, marke: string): Promise<string> {
  const [v, ivB64, ctB64] = marke.split(":");
  if (v !== "v1" || !ivB64 || !ctB64) throw new Error("Eintrag beschädigt");
  const klar = await subtle().decrypt(
    { name: "AES-GCM", iv: ausB64(ivB64) },
    key,
    ausB64(ctB64)
  );
  return dec.decode(klar);
}

/** Dateiinhalt: die 12 Byte Zufall stehen vorn, danach das Paket. */
export async function verschluesselnBytes(key: CryptoKey, daten: ArrayBuffer): Promise<Uint8Array> {
  const iv = zufall(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, daten));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function entschluesselnBytes(key: CryptoKey, daten: ArrayBuffer): Promise<ArrayBuffer> {
  const roh = new Uint8Array(daten);
  if (roh.length <= 12) throw new Error("Datei beschädigt");
  return subtle().decrypt({ name: "AES-GCM", iv: roh.subarray(0, 12) }, key, roh.subarray(12));
}
