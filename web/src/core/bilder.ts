/**
 * Bilder im Browser verkleinern, bevor sie zum Server gehen.
 *
 * Absichtlich hier und nicht auf dem Server: so wandern nie 12 Megapixel
 * durchs Netz, und der Server braucht keine Bildbibliothek — er sieht nur ein
 * fertiges, kleines Bild und prueft dessen Groesse.
 *
 * Gemeinsame Falle beider Funktionen: **`toDataURL` faellt bei einem Format,
 * das der Browser nicht schreiben kann, still auf PNG zurueck.** Ein PNG-Foto
 * ist um ein Vielfaches groesser als ein WebP und reisst die Groessengrenze
 * des Servers. Deshalb wird das Ergebnis geprueft statt geglaubt.
 */

/** Bild laden und dabei die Objekt-URL wieder freigeben. */
function laden(datei: File): Promise<HTMLImageElement> {
  return new Promise((fertig, fehler) => {
    const url = URL.createObjectURL(datei);
    const bild = new Image();
    bild.onload = () => { URL.revokeObjectURL(url); fertig(bild); };
    bild.onerror = () => {
      URL.revokeObjectURL(url);
      fehler(new Error("Diese Datei ist kein Bild, das der Browser lesen kann."));
    };
    bild.src = url;
  });
}

function alsDatenUrl(flaeche: HTMLCanvasElement, guete: number): string {
  const webp = flaeche.toDataURL("image/webp", guete);
  return webp.startsWith("data:image/webp") ? webp : flaeche.toDataURL("image/jpeg", guete);
}

function stift(flaeche: HTMLCanvasElement): CanvasRenderingContext2D {
  const s = flaeche.getContext("2d");
  if (!s) throw new Error("Der Browser kann das Bild nicht zeichnen.");
  return s;
}

/** Mittiger quadratischer Beschnitt — fuer Profilbilder. */
export async function aufQuadrat(datei: File, kante = 256, guete = 0.85): Promise<string> {
  const bild = await laden(datei);
  const seite = Math.min(bild.width, bild.height);
  const flaeche = document.createElement("canvas");
  flaeche.width = kante;
  flaeche.height = kante;
  stift(flaeche).drawImage(
    bild,
    (bild.width - seite) / 2, (bild.height - seite) / 2, seite, seite,
    0, 0, kante, kante
  );
  return alsDatenUrl(flaeche, guete);
}

/**
 * Seitenverhaeltnis behalten, nur die Kanten begrenzen — fuer Kopfbilder.
 *
 * Ein Kopfbild ist breit und flach. Es quadratisch zu beschneiden wuerde
 * genau das wegwerfen, was es zum Kopfbild macht. Nur verkleinert wird, was
 * zu gross ist; ein kleineres Bild wird NICHT hochgerechnet — das brachte nur
 * Unschaerfe und Dateigroesse.
 */
export async function aufBreite(
  datei: File,
  maxBreite = 1920,
  maxHoehe = 720,
  guete = 0.82
): Promise<string> {
  const bild = await laden(datei);
  const faktor = Math.min(1, maxBreite / bild.width, maxHoehe / bild.height);
  const breite = Math.round(bild.width * faktor);
  const hoehe = Math.round(bild.height * faktor);

  const flaeche = document.createElement("canvas");
  flaeche.width = breite;
  flaeche.height = hoehe;
  stift(flaeche).drawImage(bild, 0, 0, breite, hoehe);
  return alsDatenUrl(flaeche, guete);
}
