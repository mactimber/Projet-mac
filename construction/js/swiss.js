// Outils géographiques : conversion WGS84 <-> LV95 (formules approchées de swisstopo,
// précision ~1 m), surfaces, longueurs et volumes.

/** WGS84 (degrés) -> LV95 { E, N } */
export function wgs84ToLV95(lat, lng) {
  const phi = (lat * 3600 - 169028.66) / 10000;
  const lam = (lng * 3600 - 26782.5) / 10000;
  const E = 2600072.37 + 211455.93 * lam - 10938.51 * lam * phi - 0.36 * lam * phi * phi - 44.54 * lam ** 3;
  const N = 1200147.07 + 308807.95 * phi + 3745.25 * lam * lam + 76.63 * phi * phi - 194.56 * lam * lam * phi + 119.79 * phi ** 3;
  return { E, N };
}

/** LV95 -> WGS84 { lat, lng }. Accepte aussi LV03 (6 chiffres). */
export function lv95ToWgs84(E, N) {
  if (E < 2000000) E += 2000000;
  if (N < 1000000) N += 1000000;
  const y = (E - 2600000) / 1e6;
  const x = (N - 1200000) / 1e6;
  const lam = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3;
  const phi = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x ** 3;
  return { lat: (phi * 100) / 36, lng: (lam * 100) / 36 };
}

export function formatLV95(lat, lng) {
  const { E, N } = wgs84ToLV95(lat, lng);
  return `${fmtThousands(Math.round(E))}, ${fmtThousands(Math.round(N))}`;
}

function fmtThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
}

/** Essaie de lire des coordonnées LV95/LV03 ou WGS84 dans un texte libre. */
export function parseCoordinates(text) {
  const nums = (text.replace(/['’’\s](?=\d{3}\b)/g, '').match(/-?\d+(?:[.,]\d+)?/g) || [])
    .map((s) => parseFloat(s.replace(',', '.')));
  if (nums.length !== 2) return null;
  let [a, b] = nums;
  // LV95 / LV03 : grands nombres
  if (a > 100000 && b > 50000) {
    if (b > a) [a, b] = [b, a]; // E est toujours > N en Suisse
    const ll = lv95ToWgs84(a, b);
    if (ll.lat > 45 && ll.lat < 48.5 && ll.lng > 5 && ll.lng < 11.5) return ll;
    return null;
  }
  // WGS84 (lat, lng)
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    if (a < b && b > 40) [a, b] = [b, a];
    return { lat: a, lng: b };
  }
  return null;
}

/** Surface (m²) d'un anneau de coordonnées [lat, lng], calculée en LV95. */
export function ringArea(latlngs) {
  if (latlngs.length < 3) return 0;
  const pts = latlngs.map((ll) => wgs84ToLV95(ll.lat, ll.lng));
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.E * q.N - q.E * p.N;
  }
  return Math.abs(s) / 2;
}

/** Surface d'un polygone Leaflet (avec trous éventuels), en m². */
export function polygonArea(layer) {
  let rings = layer.getLatLngs();
  // Normaliser vers [[outer, hole...], ...] (multipolygone)
  if (rings.length && rings[0] && !Array.isArray(rings[0])) rings = [[rings]];
  else if (rings.length && Array.isArray(rings[0]) && rings[0].length && !Array.isArray(rings[0][0])) rings = [rings];
  let total = 0;
  for (const poly of rings) {
    poly.forEach((ring, i) => {
      total += (i === 0 ? 1 : -1) * ringArea(ring);
    });
  }
  return total;
}

/** Longueur d'une polyligne/périmètre (m) */
export function pathLength(latlngs, closed = false) {
  let d = 0;
  for (let i = 1; i < latlngs.length; i++) d += latlngs[i - 1].distanceTo(latlngs[i]);
  if (closed && latlngs.length > 2) d += latlngs[latlngs.length - 1].distanceTo(latlngs[0]);
  return d;
}

export function flatLatLngs(layer) {
  const flat = [];
  const walk = (a) => (Array.isArray(a) ? a.forEach(walk) : flat.push(a));
  walk(layer.getLatLngs());
  return flat;
}

export function formatArea(m2) {
  if (!m2) return '0 m²';
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${Math.round(m2).toLocaleString('fr-CH')} m² (${(m2 / 10000).toFixed(3)} ha)`;
}

export function formatLength(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/**
 * Volume indicatif de la tige (sylve, m³) : π/4 · d² · h · f
 * @param dhp diamètre à 1,3 m en cm, @param h hauteur en m, @param f coefficient de forme
 */
export function treeVolume(dhp, h, f) {
  if (!dhp || !h) return 0;
  const d = dhp / 100;
  return (Math.PI / 4) * d * d * h * f;
}

export function bearingLabel(deg) {
  if (deg === '' || deg == null || isNaN(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return `${Math.round(deg)}° (${dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8]})`;
}

/**
 * Point au « milieu » d'une parcelle (anneau [{lat,lng}]) : centre de gravité,
 * ou, si la parcelle est en forme de L / U et que ce centre tombe dehors,
 * le milieu du plus large segment intérieur passant à sa hauteur.
 */
export function parcelCenter(ring) {
  const pts = ring.map((ll) => wgs84ToLV95(ll.lat, ll.lng));
  const n = pts.length;
  if (n < 3) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const f = p.E * q.N - q.E * p.N;
    a += f;
    cx += (p.E + q.E) * f;
    cy += (p.N + q.N) * f;
  }
  if (Math.abs(a) < 1e-9) return null;
  let c = { E: cx / (3 * a), N: cy / (3 * a) };
  if (!pointInRing(c, pts)) {
    // intersections de l'horizontale N = c.N avec les côtés
    const xs = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      if ((p.N > c.N) !== (q.N > c.N)) xs.push(p.E + ((c.N - p.N) / (q.N - p.N)) * (q.E - p.E));
    }
    xs.sort((x, y) => x - y);
    let best = null;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
    }
    if (best) c = { E: (best[0] + best[1]) / 2, N: c.N };
  }
  return lv95ToWgs84(c.E, c.N);
}

function pointInRing(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.N > p.N) !== (b.N > p.N) && p.E < ((b.E - a.E) * (p.N - a.N)) / (b.N - a.N) + a.E) inside = !inside;
  }
  return inside;
}
