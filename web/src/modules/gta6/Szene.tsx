/*
 * Der gezeichnete Sonnenuntergang. Nur Zierde — deshalb komplett
 * `aria-hidden`, es steht keine Aussage darin, die nicht auch im Text
 * daneben steht.
 *
 * Nichts davon stammt von Rockstar: kein Logo, kein Bildmaterial, keine
 * Schrift. Sonne, Boden und Palmen sind gezeichnet.
 *
 * Zur Bauweise: jede Ebene haengt an einem festen Anker aus gta6.css
 * (--gta-horizont, --gta-sonne-oben), und die Buehne hat eine feste
 * Hoehe. Nur deshalb stehen Sonne, Horizont und Textzeilen ueberall
 * gleich zueinander. Ein einzelnes grosses SVG, das sich ueber die
 * Flaeche legt, waere einfacher gewesen und haette je nach Fenster
 * anders beschnitten — dann steht die Sonne mal hinter dem Titel und
 * mal hinter der Datumszeile.
 */

/* Ein Wedel, neunmal gedreht. Von Hand gezeichnet waere das neunmal
   dieselbe Kurve mit anderen Zahlen. Der Kasten reicht links bis -200,
   weil die Wedel so weit ausladen. */
const STAMM = "M-16 0 C -14 150 -4 322 40 540 L 86 540 C 40 322 26 150 22 0 Z";
const WEDEL = "M0 -6 C -46 -46 -106 -48 -154 0 C -118 -32 -60 -30 -6 8 Z";

/* Fest verdrahtete Pseudozufaelligkeit: bei jedem Aufbau dieselben
   Sterne. Echtes Math.random() liesse sie bei jedem Takt der Uhr — also
   jede Sekunde — neu wuerfeln. */
const STERNE = Array.from({ length: 44 }, (_, i) => ({
  cx: (i * 271 + (i % 7) * 13) % 1440,
  cy: 12 + ((i * 97) % 340),
  r: 0.9 + (i % 5) * 0.34,
  o: 0.22 + (i % 4) * 0.17,
}));

/* Der Bodenraster. Fluchtpunkt oben in der Mitte — das ist der
   Horizont, weil dieses SVG genau unter ihm anfaengt. Die Querlinien
   ruecken nach oben hin zusammen (daher der Exponent), sonst saehe der
   Boden flach aus statt zu liegen. */
const SENKRECHTE = Array.from({ length: 27 }, (_, i) => -1400 + (i * 4240) / 26);
const WAAGERECHTE = Array.from({ length: 13 }, (_, i) => 340 * Math.pow((i + 1) / 13, 2.3));

function Palme({ klasse, versatz, wedel, nuss }: { klasse: string; versatz: number; wedel: number; nuss: boolean }) {
  return (
    <svg className={`gta-palme ${klasse}`} viewBox="-200 -80 330 640">
      <path d={STAMM} />
      {Array.from({ length: wedel }, (_, i) => (
        <path key={i} d={WEDEL} transform={`rotate(${versatz + (i * 360) / wedel})`} />
      ))}
      {nuss && <circle cx="-2" cy="16" r="7" />}
      {nuss && <circle cx="14" cy="22" r="6" />}
    </svg>
  );
}

export function Szene() {
  return (
    <div aria-hidden="true">
      <svg className="gta-sterne" viewBox="0 0 1440 400" preserveAspectRatio="xMidYMid slice">
        <g fill="#f4f7fc">
          {STERNE.map((s, i) => (
            <circle key={i} cx={s.cx} cy={s.cy} r={s.r} opacity={s.o} />
          ))}
        </g>
      </svg>

      <div className="gta-sonne" />
      <div className="gta-schein" />

      {/* Gestreckt ohne Ruecksicht auf das Seitenverhaeltnis: ein Raster
          ist eine Abstraktion, es darf sich dehnen. */}
      <svg className="gta-boden" viewBox="0 0 1440 340" preserveAspectRatio="none">
        <g stroke="#f5379c" strokeWidth="1.4" opacity="0.4" fill="none">
          {SENKRECHTE.map((x, i) => (
            <path key={`s${i}`} d={`M720 0 L${x} 340`} />
          ))}
          {WAAGERECHTE.map((y, i) => (
            <path key={`w${i}`} d={`M0 ${y} L1440 ${y}`} />
          ))}
        </g>
      </svg>

      <div className="gta-horizontlinie" />

      <Palme klasse="links" versatz={0} wedel={9} nuss />
      <Palme klasse="rechts" versatz={20} wedel={9} nuss />
      <Palme klasse="fern" versatz={10} wedel={8} nuss={false} />
    </div>
  );
}
