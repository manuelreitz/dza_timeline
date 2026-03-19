// ═══════════════════════════════════════════════════════════════
//  DATENQUELLE  –  Inhalt spiegelt data.csv exakt wider.
//  Änderungen hier oder in data.csv haben denselben Effekt.
//  Mit lokalem Webserver (z.B. VS Code Live Server) wird
//  data.csv automatisch geladen; sonst greift dieser Fallback.
// ═══════════════════════════════════════════════════════════════
const FALLBACK_CSV = `jahr,mitarbeiter
2021,12
2022,23
2023,35
2024,56
2025,83
2026,108`;

// ── Koordinatensystem (aus SVG-Vorlage) ──────────────────────
const Y_AXIS = { val25: 811.12, val125: 181.47 };           // y-Pixel für Wert 25 / 125
const PX_PER_UNIT = (Y_AXIS.val25 - Y_AXIS.val125) / 100;  // ≈ 6.297 px pro Mitarbeiter

// X-Mittelpunkte der Jahres-Labels (rect.x + rect.width/2)
const YEAR_CX = {
  2021: 261.43,
  2022: 588.24,
  2023: 914.96,
  2024: 1241.67,
  2025: 1568.38,
  2026: 1895.47
};

function yearToCx(year)  { return YEAR_CX[year] ?? 261.43 + (year - 2021) * 326.71; }
function valueToCy(val)  { return Y_AXIS.val25 - (val - 25) * PX_PER_UNIT; }

// ── CSV-Parser ───────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = isNaN(vals[i]) ? vals[i] : Number(vals[i]); });
    return obj;
  });
}

// ── Smooth Bezier durch Punktliste (Cardinal Spline) ─────────
function smoothPath(pts, tension = 0.35) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 2)];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[Math.min(pts.length - 1, i + 1)];
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

// ── Radius aus Mitarbeiterzahl  (Fläche ∝ Mitarbeiter)
//    r = K · √(mitarbeiter)  →  Fläche = π · K² · mitarbeiter
const RADIUS_SCALE = 13;
function calcRadius(mitarbeiter) {
  return RADIUS_SCALE * Math.sqrt(mitarbeiter);
}

// ── Schriftgröße proportional zum Kreis-Radius ───────────────
function fontSize(radius) {
  return Math.max(24, Math.round(radius * 0.44));
}

// ── Kegel-Pfad aus Kreispositionen berechnen ─────────────────
// Aufbau: obere Bezier-Kurve → rechter Halbkreis-Cap
//       → untere Bezier-Kurve (rückwärts) → linker Halbkreis-Cap → Z
function buildConePath(points) {
  const N = points.length;
  const f = n => n.toFixed(1);
  const T = 0.35;

  // Externe Tangentenpunkte zwischen zwei Kreisen berechnen
  function extTangent(c1, c2, side) {
    const dx = c2.cx - c1.cx, dy = c2.cy - c1.cy;
    const d  = Math.sqrt(dx * dx + dy * dy);
    const a0 = Math.atan2(dy, dx);
    const sinA = (c2.r - c1.r) / d;
    const da   = Math.acos(Math.max(-1, Math.min(1, sinA)));
    // Zwei mögliche Normalvektoren (oben und unten)
    const ns = [a0 + da, a0 - da].map(b => ({ x: Math.cos(b), y: Math.sin(b) }));
    ns.sort((a, b) => a.y - b.y); // ns[0] = oberer (kleineres y), ns[1] = unterer
    const n = side === 'upper' ? ns[0] : ns[1];
    return {
      p1: { x: c1.cx + c1.r * n.x, y: c1.cy + c1.r * n.y },
      p2: { x: c2.cx + c2.r * n.x, y: c2.cy + c2.r * n.y }
    };
  }

  // Arc-Flags berechnen: Bogen von fromPt nach toPt der durch throughAngle (rad) verläuft
  function arcFlags(cx, cy, fromPt, toPt, throughAngle) {
    const nm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const na1 = nm(Math.atan2(fromPt.y - cy, fromPt.x - cx));
    const na2 = nm(Math.atan2(toPt.y - cy, toPt.x - cx));
    const nat = nm(throughAngle);
    const cw  = (na2 - na1 + 2 * Math.PI) % (2 * Math.PI); // CW-Winkelabstand
    const dCW = (nat - na1 + 2 * Math.PI) % (2 * Math.PI);
    return dCW <= cw
      ? { sweep: 1, la: cw > Math.PI ? 1 : 0 }
      : { sweep: 0, la: (2 * Math.PI - cw) > Math.PI ? 1 : 0 };
  }

  // Externe Tangenten für jedes Kreispaar berechnen
  const pairs = [];
  for (let i = 0; i < N - 1; i++) {
    pairs.push({
      up: extTangent(points[i], points[i + 1], 'upper'),
      lo: extTangent(points[i], points[i + 1], 'lower')
    });
  }

  // Tangentenpunkte mitteln für weichen Übergang an inneren Kreisen
  const avg = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const upper = [
    pairs[0].up.p1,
    ...Array.from({ length: N - 2 }, (_, i) => avg(pairs[i].up.p2, pairs[i + 1].up.p1)),
    pairs[N - 2].up.p2
  ];
  const lower = [
    pairs[0].lo.p1,
    ...Array.from({ length: N - 2 }, (_, i) => avg(pairs[i].lo.p2, pairs[i + 1].lo.p1)),
    pairs[N - 2].lo.p2
  ];

  // Cardinal-Spline-Segmente
  function segs(arr) {
    return arr.slice(1).map((p2, i) => {
      const p0 = arr[Math.max(0, i - 1)];
      const p1 = arr[i];
      const p3 = arr[Math.min(arr.length - 1, i + 2)];
      return `C ${f(p1.x + (p2.x - p0.x) * T)},${f(p1.y + (p2.y - p0.y) * T)} ${f(p2.x - (p3.x - p1.x) * T)},${f(p2.y - (p3.y - p1.y) * T)} ${f(p2.x)},${f(p2.y)}`;
    }).join(' ');
  }

  const c0 = points[0], cN = points[N - 1];
  // Linker Cap: Bogen von lower[0] → upper[0] durch den linken Pol (Winkel π)
  const lf = arcFlags(c0.cx, c0.cy, lower[0], upper[0], Math.PI);
  // Rechter Cap: Bogen von upper[N-1] → lower[N-1] durch den rechten Pol (Winkel 0)
  const rf = arcFlags(cN.cx, cN.cy, upper[N - 1], lower[N - 1], 0);

  return [
    `M ${f(upper[0].x)},${f(upper[0].y)}`,
    segs(upper),
    `A ${f(cN.r)},${f(cN.r)} 0 ${rf.la} ${rf.sweep} ${f(lower[N - 1].x)},${f(lower[N - 1].y)}`,
    segs([...lower].reverse()),
    `A ${f(c0.r)},${f(c0.r)} 0 ${lf.la} ${lf.sweep} ${f(upper[0].x)},${f(upper[0].y)}`,
    'Z'
  ].join(' ');
}

// ── SVG-Namespace-Helfer ──────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

// ── Chart rendern ─────────────────────────────────────────────
function renderChart(rows) {
  // Punkte berechnen
  const points = rows.map(d => ({
    jahr: d.jahr,
    mitarbeiter: d.mitarbeiter,
    r: calcRadius(d.mitarbeiter),
    cx: yearToCx(d.jahr),
    cy: valueToCy(d.mitarbeiter)
  }));

  const layer = document.getElementById('data-layer');
  layer.innerHTML = '';   // vorherigen Stand löschen

  // 1 · Wachstumskegel
  layer.appendChild(el('path', {
    d: buildConePath(points),
    fill: '#00b9da',
    opacity: '0.13'
  }));

  // 2 · Kreise + Zahlen
  points.forEach(p => {
    // Gradient-ID je Jahr (bereits in <defs> definiert)
    const gradId = `g${p.jahr}`;

    layer.appendChild(el('circle', {
      cx: p.cx, cy: p.cy, r: p.r,
      fill: `url(#${gradId})`,
      stroke: '#00b9da',
      'stroke-width': '3',
      'stroke-miterlimit': '10'
    }));

    const fs = fontSize(p.r);
    const txt = el('text', {
      x: p.cx,
      y: p.cy,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      fill: '#fff',
      'font-family': 'Montserrat, sans-serif',
      'font-size': fs,
      'font-weight': '700'
    });
    txt.textContent = p.mitarbeiter;
    layer.appendChild(txt);
  });
}

// ── Daten laden: zuerst data.csv, sonst Fallback ─────────────
async function init() {
  let csvText = FALLBACK_CSV;
  try {
    const res = await fetch('data.csv');
    if (res.ok) csvText = await res.text();
  } catch (_) { /* file://-Protokoll ohne Server → Fallback */ }
  renderChart(parseCSV(csvText));
}

init();

// ── Foto-Daten (chronologisch, alle 44 Einträge) ──────────────
const BASE = 'https://deutscheszentrumastrophysik.de';
const photoData = [
  { date: 'Juli 2021', headline: 'Der erste Meilenstein ist erreicht', body: 'Die Perspektivkommission hat die sechs überzeugendsten Vorschläge ausgewählt und das DZA für die weitere Konzeptentwicklung ausgewählt.', img: '' },
  { date: 'September 2021', headline: 'Das DZA-Büro nimmt die Arbeit auf', body: '', img: '' },
  { date: 'September 2021', headline: 'Gespräche mit den Bürgermeister:innen der Region', body: 'Start einer zukunftsweisenden und partnerschaftlichen Zusammenarbeit.', img: '' },
  { date: 'November 2021', headline: 'Start der ersten Förderphase', body: '', img: '' },
  { date: 'November 2021', headline: 'Erstes Treffen wissenschaftlicher Beirat', body: '', img: '' },
  { date: 'November 2021', headline: 'Vorträge in Hoyerswerda in Schule und der Kulturfabrik', body: '', img: BASE + '/sites/default/files/styles/landscape/public/images/News_Wiss_Beirat_20211103_Hoyerswerda-2_0.jpg' },
  { date: 'Januar 2022', headline: 'Begehung des möglichen Standortes, dem Kahlbaum-Areal in Görlitz, mit Architekten', body: '', img: '' },
  { date: 'Februar 2022', headline: 'Vortragsreihe »Vom Universum in die Lausitz«', body: 'Vortragsreihe (virtuell) mit Einblick in die Welt der Teilchenphysik und Astrophysik.', img: '' },
  { date: 'Februar 2022', headline: 'Die Probebohrungen im Granitstock beginnen', body: '', img: BASE + '/sites/default/files/styles/landscape/public/images/Startschuss_Probebohrung_2022_Paul_Glaser_1400x800-2.jpg' },
  { date: 'März 2022', headline: 'Abschlusstreffen administrativer Beirat in Görlitz', body: '', img: BASE + '/sites/default/files/styles/landscape/public/images/Administrativer_Beirat_Goerlitz_2022_Paul_Glaser_1400x800.jpg' },
  { date: 'März 2022', headline: 'Erstes Treffen des DZA-Industrienetzwerkes', body: '', img: '' },
  { date: 'März 2022', headline: 'Erstes Treffen mit der Domowina', body: 'Treffen mit der Interessenvertretung des sorbischen Volkes.', img: '' },
  { date: 'März 2022', headline: 'Exkursion mit Schülerinnen und Schülern zur Bohrstelle in Ralbitz-Rosenthal', body: '', img: BASE + '/sites/default/files/styles/landscape/public/images/DZA_DESY_Schuelerexkursion_2022-03-16_Paul_Glaser_1400x800_4.jpg' },
  { date: 'April 2022', headline: 'Aktuelle Bohrtiefe: 122 Meter', body: 'Die bisher durchgeführten Messungen bestätigen die seismische Inaktivität der Region.', img: BASE + '/sites/default/files/styles/landscape/public/images/News_Schulexkursion2022_1400x800.jpg' },
  { date: 'Mai 2022', headline: 'Abschluss Probebohrungen und Start seismologische Messungen', body: 'Wir haben mit der Erkundungsbohrung die finale Bohrtiefe von 250 Metern erreicht.', img: BASE + '/sites/default/files/styles/landscape/public/images/DESY_DZA_Praesentation_Probebohrung_2022-05-25_Paul_Glaser_036.jpg' },
  { date: '2. Mai 2022', headline: 'Abgabe des Konzepts', body: '', img: '' },
  { date: 'Mai bis September 2022', headline: 'DZA on tour', body: 'Öffentliche Veranstaltungen in der Region & Austausch zum DZA-Konzept.', img: BASE + '/sites/default/files/styles/landscape/public/images/2023-08-30_DESY_DZA_Grill-Infoabend_Cunnewitz_Paul_Glaser_087_0.jpg' },
  { date: '29. September 2022', headline: 'Wir haben es geschafft!', body: 'Das DZA kommt in die sächsische Lausitz. Wir wurden als einer von zwei Gewinnern des Wettbewerbs ausgezeichnet.', img: BASE + '/sites/default/files/styles/landscape/public/images/9.jpg' },
  { date: 'Seit Oktober 2022', headline: 'DZA im Dialog', body: 'Görlitz, Kamenz, Bautzen, Hoyerswerda und darüber hinaus: Wir stellen das DZA vor und knüpfen neue Netzwerke.', img: BASE + '/sites/default/files/styles/landscape/public/images/image001.jpg' },
  { date: 'Seit Oktober 2022', headline: 'Anbahnung wissenschaftlicher Kooperation', body: 'Das DZA wirkt an wissenschaftlichen Meetings mit und geht Kooperationsvereinbarungen ein.', img: BASE + '/sites/default/files/styles/landscape/public/images/SKAO.jpg' },
  { date: '14. März 2023', headline: 'DZA Büroeröffnung in Hoyerswerda', body: 'Wir freuen uns gemeinsam mit Oberbürgermeister Torsten Ruban-Zeh heute das DZA Büro zu eröffnen.', img: BASE + '/sites/default/files/styles/landscape/public/images/4096-2731-max_0.jpg' },
  { date: '24.–28. Mai 2023', headline: 'Universe on Tour in Hoyerswerda', body: 'Roadshow mit mobilem Planetarium macht vor dem Rathaus halt.', img: BASE + '/sites/default/files/styles/landscape/public/images/Screenshot%202024-11-11%20at%2014.24.14.png' },
  { date: '4. Oktober 2023', headline: 'Kooperation zwischen DZA und Nikhef', body: 'Das DZA und Nikhef in den Niederlanden werden im Bereich der wissenschaftlichen Forschung zusammenarbeiten.', img: BASE + '/sites/default/files/styles/landscape/public/images/Einstein-Teleskop-Rehle-2_0.jpg' },
  { date: '25. Januar 2024', headline: 'Das DZA bezieht den Standort bei ALSTOM in Görlitz', body: '', img: BASE + '/sites/default/files/styles/landscape/public/images/DZA_Alstom_Goerlitz_2024-01-25_Paul_Glaser_067.jpg' },
  { date: '22. Februar 2024', headline: 'DZA eröffnet den Interimsstandort in Görlitz', body: '', img: BASE + '/sites/default/files/styles/landscape/public/images/2024-02-22_DZA_Eroeffnung_Bueros_Goerlitz_Paul_Glaser_027.jpg' },
  { date: '26. März 2024', headline: 'Erster wissenschaftlicher DZA Kongress in Görlitz', body: 'Die deutschen Astronomie- und Astroteilchenphysik-Gemeinschaften treffen sich in Görlitz.', img: BASE + '/sites/default/files/styles/landscape/public/images/Gruppenfoto2_MM_Workshop_Goerlitz.jpg' },
  { date: '22. August 2024', headline: 'DZA kommt auf das Kahlbaum Areal', body: 'Der Campus des DZA kommt auf das Görlitzer Kahlbaum-Areal und Sachsen will das Einstein-Teleskop.', img: BASE + '/sites/default/files/styles/landscape/public/images/1724345793160.gif' },
  { date: '2. Oktober 2024', headline: 'Installation von Spezial-Optik-Tischen bei ALSTOM', body: 'Mit der Lieferung zweier schwingungsgedämpfter Optiktische können nun künftige Experimente aufgebaut werden.', img: BASE + '/sites/default/files/styles/landscape/public/images/2024-10-02_DZA_Lieferung_Optik-Tische_Paul_Glaser_028.jpg' },
  { date: '23. Januar 2025', headline: 'Grundsteinlegung Neustadtforum Hoyerswerda', body: 'Mit der feierlichen Grundsteinlegung beginnt der Umbau des Jugendclubs »OSSI« zum Science Center mit Planetarium.', img: BASE + '/sites/default/files/styles/landscape/public/images/IMG_0867%20Kopie.jpg' },
  { date: '5. März 2025', headline: 'Zukunft der Astrobildung in der Lausitz im Fokus', body: 'Workshop zur »Zukunft der Astrobildung in den Landkreisen Bautzen und Görlitz«.', img: BASE + '/sites/default/files/styles/landscape/public/images/11.jpg' },
  { date: '8. April 2025', headline: '»Probewohnen meets DZA«', body: 'Auftakt für das innovative Rekrutierungsprogramm in Görlitz.', img: BASE + '/sites/default/files/styles/landscape/public/images/3_080425_Probewohnen_Info__0975_1.jpg' },
  { date: '28. April 2025', headline: 'Probebohrung in Hoske (Wittichenau)', body: 'Das DZA lässt einen 250 Meter tiefen Erkundungsbohrkern im Lausitzer Granit abteufen.', img: BASE + '/sites/default/files/styles/landscape/public/images/IMG_1035%20Kopie.jpg' },
  { date: 'April 2025', headline: 'Das DZA Team wächst weiter', body: 'Fürs Sommerfoto hat sich das DZA-Team auf dem Görlitzer Postplatz vor der Muschelminna versammelt.', img: BASE + '/sites/default/files/styles/landscape/public/images/DZA_Team_2025-04-29-4.jpg' },
  { date: '16. Mai 2025', headline: 'DZA kooperiert mit tschechischen Forschungseinrichtungen', body: 'In Prag unterzeichnet der designierte DZA-Gründungsdirektor Prof. Günther Hasinger sechs Kooperationsvereinbarungen.', img: BASE + '/sites/default/files/styles/landscape/public/images/2025-05-16_DZA_Prag_Signing_Letter_of_Intent_Paul_Glaser_084.jpg' },
  { date: '13. Juni 2025', headline: '»First Light – Erstes Licht« für ORCA-TWIN', body: 'Unsere neuartige ORCA-Quest-Kamera am 1,23 m-Teleskop des Calar-Alto-Observatoriums wurde in Dienst gestellt.', img: BASE + '/sites/default/files/styles/landscape/public/images/4_06_Montage_Kamera.jpg' },
  { date: '20. Juni 2025', headline: 'SKAO-Konferenz in Görlitz: Welt zu Gast im Herzen Europas', body: 'Delegationen aus 14 Ländern sind vom 16. bis 20. Juni 2025 im Herzen Europas zu Gast gewesen.', img: BASE + '/sites/default/files/styles/landscape/public/images/2025-06-20-DZA_SKAO_Conference_Groupphoto_Paul_Glaser_017.png' },
  { date: '21.–25. Juli 2025', headline: '»Mission Exoplanet«', body: 'In den Sommerferien initiiert das DZA mit Partnern eine einzigartige Projektwoche für 20 Jugendliche.', img: BASE + '/sites/default/files/styles/landscape/public/images/25-07-25%2011-55-22%200528.jpg' },
  { date: 'August 2025', headline: 'Positive Gesamt-Evaluation', body: 'Drei Jahre nach dem Start des DZA-Aufbaus ziehen Bund und Gutachter eine durchweg positive Bilanz.', img: BASE + '/sites/default/files/styles/landscape/public/images/2025-07-02_DZA_Evaluation_Paul_Glaser_061.jpg' },
  { date: '26. August 2025', headline: 'Besuch der Perspektivkommission', body: 'Die Perspektivkommission mit mehr als 20 Politikerinnen und Politikern hat das DZA besucht.', img: BASE + '/sites/default/files/styles/landscape/public/images/2025-08-26_DZA_Besuch_Kommission_Paul_Glaser_075.jpg' },
  { date: '9. September 2025', headline: 'DZA in Cunnewitz III', body: 'In dem sorbischen Ort Cunnewitz (Konjecy), unweit einer der ersten DZA-Bohrstellen, veranstaltet das DZA zum dritten Mal einen Informationsabend.', img: BASE + '/sites/default/files/styles/landscape/public/images/2025-09-09_DZA_Cunnewitz_Grillen_Paul_Glaser_101.jpg' },
  { date: '15.–19. September 2025', headline: 'Jahrestagung der Astronomischen Gesellschaft in Görlitz', body: 'Erstmals seit 100 Jahren hat wieder eine Tagung der Astronomischen Gesellschaft in Sachsen stattgefunden.', img: BASE + '/sites/default/files/styles/landscape/public/images/2025-09-16_DZA_Konferenz_Astronomische_Gesellschaft_Paul_Glaser_096.jpg' },
  { date: 'September 2025', headline: 'DZA erfolgreich gegründet', body: 'Das DZA wird Anfang September als gemeinnützige GmbH gegründet und beim Amtsgericht Dresden eingetragen.', img: BASE + '/sites/default/files/styles/landscape/public/images/dza-hasinger-henjes-kunst-gruendung-.jpg' },
  { date: '24. Oktober 2025', headline: 'Wissenschaftsaustausch in Breslau', body: 'Eine DZA-Delegation hat die Technische Universität Breslau besucht und Kooperationsmöglichkeiten erkundet.', img: BASE + '/sites/default/files/styles/landscape/public/images/IMG_9413_0.jpg' },
  { date: '9.–13. November 2025', headline: 'ADASS-Konferenz in Görlitz', body: 'Die 35. Astronomical Data Analysis Software & Systems Conference hat in Görlitz stattgefunden.', img: BASE + '/sites/default/files/styles/landscape/public/images/2025-11-10_DZA_ADASS_Konferenz_Paul_Glaser_069.jpg' },
];

// ── Hover-Indikatorlinie ──────────────────────────────────────
const hoverIndicator = document.getElementById('hover-indicator');
const hoverLine = document.getElementById('hover-line');
const hoverDot  = document.getElementById('hover-dot');

const MONTH_DE = {
  januar:1, februar:2, märz:3, april:4, mai:5, juni:6,
  juli:7, august:8, september:9, oktober:10, november:11, dezember:12
};

function dateToX(dateStr) {
  const s = dateStr.toLowerCase();
  const yearMatch = s.match(/20\d\d/);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[0]);
  let month = 7; // Fallback: Jahresmitte
  for (const [name, num] of Object.entries(MONTH_DE)) {
    if (s.includes(name)) { month = num; break; }
  }
  const cx = YEAR_CX[year] ?? (261.43 + (year - 2021) * 326.71);
  return cx + (month - 7) * (326.71 / 12);
}

function setHoverLine(idx) {
  const d = photoData[idx];
  if (!d) { hoverIndicator.setAttribute('visibility', 'hidden'); return; }
  const x = dateToX(d.date);
  if (x === null) { hoverIndicator.setAttribute('visibility', 'hidden'); return; }
  hoverLine.setAttribute('x1', x);
  hoverLine.setAttribute('x2', x);
  hoverDot.setAttribute('cx', x);
  hoverIndicator.setAttribute('visibility', 'visible');
}

// ── Frames aus photoData erzeugen ────────────────────────────
const strip = document.querySelector('.photo-strip');
photoData.forEach(d => {
  const div = document.createElement('div');
  div.className = 'photo-frame';
  const h = Math.round(240 * (0.7 + Math.random() * 0.3));
  div.style.setProperty('--base-h', h + 'px');
  if (d.img) {
    const img = document.createElement('img');
    img.src = d.img;
    img.alt = d.headline;
    div.appendChild(img);
  }
  strip.appendChild(div);
});

// ── Fotostreifen Accordion ────────────────────────────────────
const frames  = strip.querySelectorAll('.photo-frame');
const caption = document.querySelector('.photo-caption');
const captionDate     = caption.querySelector('.caption-date');
const captionHeadline = caption.querySelector('.caption-headline');
const captionBody     = caption.querySelector('.caption-body');
let active = false;
let pinned = false;

let captionTimer = null;
let hoverTimer = null;

function updateCaption(idx) {
  const d = photoData[idx] || photoData[0];
  captionDate.textContent     = d.date;
  captionHeadline.textContent = d.headline;
  captionBody.textContent     = d.body;
}

function activate(frame) {
  const wasActive = active;
  active = true;
  strip.classList.add('is-hovered');
  frames.forEach(f => f.classList.remove('is-active'));
  frame.classList.add('is-active');

  const idx = framesArr.indexOf(frame);
  updateCaption(idx);
  setHoverLine(idx);

  // Caption nur beim ersten Hover verzögert einblenden,
  // beim Wechsel zwischen Fotos stehen lassen
  if (!wasActive) {
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => caption.classList.add('is-visible'), 400);
  }
}

function deactivate() {
  active = false;
  clearTimeout(captionTimer);
  strip.classList.remove('is-hovered');
  frames.forEach(f => f.classList.remove('is-active'));
  caption.classList.remove('is-visible');
  hoverIndicator.setAttribute('visibility', 'hidden');
}

const framesArr = Array.from(frames);

frames.forEach(frame => {
  frame.addEventListener('mouseenter', () => {
    pinned = false;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => activate(frame), 30);
  });
  frame.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
  });
});

// ── Pfeil-Navigation ──────────────────────────────────────────
function navigateTo(idx) {
  const target = framesArr[(idx + framesArr.length) % framesArr.length];
  activate(target);
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

// ── Event-Marker Klick → Foto öffnen ──────────────────────────
document.querySelectorAll('.event-marker').forEach(marker => {
  marker.addEventListener('click', () => {
    const idx = parseInt(marker.dataset.photoIndex, 10);
    const target = framesArr[idx];
    if (!target) return;
    pinned = true;
    activate(target);
    const stripTop = strip.getBoundingClientRect().top + window.scrollY - 20;
    window.scrollTo({ top: stripTop, behavior: 'smooth' });
  });
});

document.querySelector('.caption-nav.prev').addEventListener('click', () => {
  const idx = framesArr.findIndex(f => f.classList.contains('is-active'));
  navigateTo(idx - 1);
});

document.querySelector('.caption-nav.next').addEventListener('click', () => {
  const idx = framesArr.findIndex(f => f.classList.contains('is-active'));
  navigateTo(idx + 1);
});

// Deaktivieren anhand echter Mausposition – unabhängig von Element-Events
document.addEventListener('mousemove', (e) => {
  if (!active) return;
  const sr = strip.getBoundingClientRect();
  const cr = caption.getBoundingClientRect();
  const inStrip   = e.clientX >= sr.left && e.clientX <= sr.right &&
                    e.clientY >= sr.top  && e.clientY <= sr.bottom;
  // extend caption zone upward to cover the gap between strip and caption
  const inCaption = e.clientX >= cr.left && e.clientX <= cr.right &&
                    e.clientY >= sr.bottom && e.clientY <= cr.bottom;
  if (!inStrip && !inCaption && !pinned) deactivate();
});
