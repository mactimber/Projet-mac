// Partage d'un plan de coupe par QR code : le plan (parcelle + symboles) est compressé
// dans le lien lui-même. Rien n'est envoyé sur un serveur.
//
// Format (avant compression) : { v:1, n: nom, o:[E0,N0], p:[dE,dN,...], s:[[code, ...], ...] }
// Coordonnées LV95 arrondies au mètre, relatives à l'origine o.

import { wgs84ToLV95, lv95ToWgs84 } from './swiss.js';
import { SYMBOL_BY_KIND } from './symbols.js';

const KINDS = ['heli', 'point_t', 'vehicule', 'barriere_bois', 'passerelle', 'escalier', 'caisson', 'mur', 'rigole', 'mobilier',
  'panneau', 'ouvrage', 'depot_mat', 'zone', 'circulation', 'distance', 'triopan', 'bache', 'barriere', 'texte'];

const b64url = {
  enc: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};

async function pipe(bytes, Stream) {
  const out = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Objet compact du plan. */
function compact(chantier) {
  const pts = [...(chantier.parcel || [])];
  chantier.symbols.forEach((s) => { if (s.lat != null) pts.push([s.lat, s.lng]); });
  if (!pts.length) return null;
  const o = wgs84ToLV95(pts[0][0], pts[0][1]);
  const O = [Math.round(o.E), Math.round(o.N)];
  const rel = (lat, lng) => {
    const { E, N } = wgs84ToLV95(lat, lng);
    return [Math.round(E) - O[0], Math.round(N) - O[1]];
  };
  const flat = (list) => list.flatMap(([lat, lng]) => rel(lat, lng));
  const s = [];
  for (const x of chantier.symbols) {
    const k = KINDS.indexOf(x.kind);
    const def = SYMBOL_BY_KIND[x.kind];
    if (k < 0 || !def) continue;
    if (def.mode === 'line' || def.mode === 'zone') {
      if (!x.pts?.length) continue;
      const e = [k, flat(x.pts)];
      if (def.mode === 'zone') e.push(x.text || '', x.color || '');
      else if (x.text) e.push(x.text);
      s.push(e);
    } else if (def.mode === 'arrow') {
      s.push([k, ...rel(x.lat, x.lng), ...rel(x.lat2, x.lng2)]);
    } else {
      const e = [k, ...rel(x.lat, x.lng)];
      if (def.mode === 'wedge' || def.mode === 'orient') e.push(Math.round(x.angle ?? 90));
      if (x.text) e.push(x.text);
      s.push(e);
    }
  }
  return { v: 1, n: chantier.info?.name || '', o: O, p: chantier.parcel ? flat(chantier.parcel) : [], s };
}

/** Lien à mettre dans le QR code. Retourne null si le plan est vide. */
export async function planLink(chantier) {
  const c = compact(chantier);
  if (!c) return null;
  const json = new TextEncoder().encode(JSON.stringify(c));
  let data;
  if (typeof CompressionStream === 'function') data = `z${b64url.enc(await pipe(json, CompressionStream))}`;
  else data = `j${b64url.enc(json)}`;
  const base = location.href.split('#')[0].split('?')[0];
  return `${base}#plan=${data}`;
}

/** Relit un plan depuis le lien. */
export async function readPlan(hash) {
  const m = /plan=([^&]+)/.exec(hash || '');
  if (!m) return null;
  const raw = m[1];
  let bytes = b64url.dec(raw.slice(1));
  if (raw[0] === 'z') bytes = await pipe(bytes, DecompressionStream);
  const c = JSON.parse(new TextDecoder().decode(bytes));
  const ll = (dE, dN) => {
    const { lat, lng } = lv95ToWgs84(c.o[0] + dE, c.o[1] + dN);
    return [lat, lng];
  };
  const unflat = (a) => {
    const r = [];
    for (let i = 0; i + 1 < a.length; i += 2) r.push(ll(a[i], a[i + 1]));
    return r;
  };
  const symbols = [];
  for (const e of c.s || []) {
    const kind = KINDS[e[0]];
    const def = SYMBOL_BY_KIND[kind];
    if (!def) continue;
    if (def.mode === 'line' || def.mode === 'zone') {
      symbols.push({ kind, pts: unflat(e[1]), text: e[2] || '', color: e[3] || undefined });
    } else if (def.mode === 'arrow') {
      const [a, b] = [ll(e[1], e[2]), ll(e[3], e[4])];
      symbols.push({ kind, lat: a[0], lng: a[1], lat2: b[0], lng2: b[1] });
    } else {
      const [lat, lng] = ll(e[1], e[2]);
      const s = { kind, lat, lng };
      let i = 3;
      if (def.mode === 'wedge' || def.mode === 'orient') s.angle = e[i++];
      if (e[i] != null) s.text = e[i];
      symbols.push(s);
    }
  }
  return { info: { name: c.n }, parcel: c.p.length ? unflat(c.p) : null, symbols };
}

/** SVG du QR code pour un texte (bibliothèque qrcode-generator, chargée dans index.html). */
export function qrSvg(text) {
  const qr = window.qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 2, margin: 2, scalable: true });
}
