// Nom de lieu d'après la carte nationale (services de geo.admin.ch) :
// lieu-dit le plus proche (swissNAMES3D), commune, adresse de bâtiment (RegBL).

import { wgs84ToLV95 } from './swiss.js';

const API = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify';

/** Interroge une couche autour d'un point. rayon en mètres. */
async function identify(layer, E, N, rayon) {
  // 200 px pour 2 km → 10 m par pixel : tolérance en pixels = rayon / 10
  const params = new URLSearchParams({
    geometryType: 'esriGeometryPoint',
    geometry: `${E.toFixed(1)},${N.toFixed(1)}`,
    sr: '2056',
    layers: `all:${layer}`,
    tolerance: String(Math.max(0, Math.round(rayon / 10))),
    mapExtent: `${E - 1000},${N - 1000},${E + 1000},${N + 1000}`,
    imageDisplay: '200,200,96',
    returnGeometry: 'true',
    geometryFormat: 'geojson',
    lang: 'fr',
    limit: '50',
  });
  const r = await fetch(`${API}?${params}`);
  if (!r.ok) throw new Error(r.status);
  const j = await r.json();
  return j.results || [];
}

/** Distance (m) entre le point et la géométrie d'un résultat (points seulement, sinon 0). */
function dist(res, E, N) {
  const g = res.geometry;
  const c = g?.type === 'Point' ? g.coordinates : g?.type === 'MultiPoint' ? g.coordinates[0] : null;
  if (!c) return 0;
  return Math.hypot(c[0] - E, c[1] - N);
}

const props = (res) => res.properties || res.attributes || {};
const first = (v) => (Array.isArray(v) ? v[0] : v);

function nearest(results, E, N, nameOf) {
  let best = null;
  for (const r of results) {
    const name = nameOf(r);
    if (!name) continue;
    const d = dist(r, E, N);
    if (!best || d < best.d) best = { name, d, r };
  }
  return best;
}

/**
 * Recherche lieu-dit, commune et (facultatif) adresse proche.
 * @returns {Promise<{lieu?:string, commune?:string, adresse?:string, label:string}>}
 */
export async function lookupPlace(lat, lng, { adresse = false } = {}) {
  const { E, N } = wgs84ToLV95(lat, lng);
  const [noms, communes, batiments] = await Promise.all([
    identify('ch.swisstopo.swissnames3d', E, N, 600).catch(() => []),
    identify('ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill', E, N, 0).catch(() => []),
    adresse ? identify('ch.bfs.gebaeude_wohnungs_register', E, N, 250).catch(() => []) : [],
  ]);

  const lieu = nearest(noms, E, N, (r) => props(r).name || r.label)?.name;
  const communeRes = communes[0];
  const commune = communeRes && (props(communeRes).gemname || props(communeRes).name || communeRes.label);

  let adr;
  if (adresse) {
    const b = nearest(batiments, E, N, (r) => {
      const p = props(r);
      const rue = first(p.strname_deinr) || [first(p.strname), first(p.deinr)].filter(Boolean).join(' ');
      return rue || null;
    });
    if (b) {
      const p = props(b.r);
      const npa = [first(p.dplz4), first(p.dplzname)].filter(Boolean).join(' ');
      adr = [b.name, npa].filter(Boolean).join(', ');
    }
  }

  const lieuCommune = [lieu, commune && commune !== lieu ? commune : null].filter(Boolean).join(', ');
  const label = [lieuCommune, adr].filter(Boolean).join(' – ');
  return { lieu, commune, adresse: adr, label };
}
