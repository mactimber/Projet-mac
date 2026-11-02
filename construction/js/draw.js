// Affichage de la parcelle et des symboles sur une carte Leaflet
// (carte principale et carte de la fiche de secours).

import { SYMBOL_BY_KIND, symbolSvg, symbolArt, mapHeight, arrowHeadSvg, WEDGE_SVG, ZONE_COLORS } from './symbols.js';
import { formatLV95, parcelCenter } from './swiss.js';

export const PARCEL_STYLE = { color: '#f4b6b0', weight: 2.5, fillColor: '#ffffff', fillOpacity: 0.38 };
export const PARCEL_STYLE_OUTLINE = { color: '#ffffff', weight: 5, fill: false, opacity: 0.9, interactive: false };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Cap (degrés, 0 = nord, sens horaire) de a vers b. */
export function bearing(a, b) {
  const p = L.CRS.EPSG3857.project(L.latLng(a));
  const q = L.CRS.EPSG3857.project(L.latLng(b));
  return ((Math.atan2(q.x - p.x, q.y - p.y) * 180) / Math.PI + 360) % 360;
}

export function lengthOf(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += L.latLng(pts[i - 1]).distanceTo(pts[i]);
  return d;
}

/** Point situé à mi-longueur d'une ligne. */
function midPoint(pts) {
  const half = lengthOf(pts) / 2;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = L.latLng(pts[i - 1]);
    const b = L.latLng(pts[i]);
    const seg = a.distanceTo(b);
    if (acc + seg >= half) {
      const t = seg ? (half - acc) / seg : 0;
      return L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
    }
    acc += seg;
  }
  return L.latLng(pts[0]);
}

export const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

function headMarker(at, angle, color, size, interactive) {
  return L.marker(at, {
    icon: L.divIcon({
      className: 'sym-head',
      html: `<div style="transform:rotate(${angle}deg)">${arrowHeadSvg(color, size)}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    }),
    interactive,
    keyboard: false,
  });
}

function labelMarker(at, html, cls, interactive, style = '') {
  return L.marker(at, {
    icon: L.divIcon({ className: `sym-tag ${cls}`, html: `<span style="${style}">${html}</span>`, iconSize: null }),
    interactive,
    keyboard: false,
  });
}

/** Icône d'un symbole ponctuel (avec texte ou coordonnées à côté). */
export function pointIcon(s, scale = 1) {
  const def = SYMBOL_BY_KIND[s.kind];
  if (s.kind === 'texte') {
    return L.divIcon({ className: 'sym sym-textbox', html: `<span>${esc(s.text || 'Texte')}</span>`, iconSize: null });
  }
  const h = Math.round(mapHeight(s.kind) * scale);
  const [vw, vh] = symbolArt(s.kind);
  const w = Math.round((h * vw) / vh);
  let label = '';
  if (def.coordLabel) label = `<span class="sym-label lbl-${s.kind}">${formatLV95(s.lat, s.lng).replace(', ', ' / ')}</span>`;
  else if (s.text) label = `<span class="sym-label">${esc(s.text)}</span>`;
  return L.divIcon({
    className: 'sym',
    html: `${symbolSvg(s.kind, h)}${label}`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  });
}

function wedgeIcon(angle, scale = 1) {
  const size = Math.round(34 * scale);
  const ax = size / 2;
  const ay = (size * 37) / 40; // base du triangle = position de l'arbre
  return L.divIcon({
    className: 'sym sym-wedge',
    html: `<div style="transform-origin:${ax}px ${ay}px;transform:rotate(${angle}deg)"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">${WEDGE_SVG}</svg></div>`,
    iconSize: [size, size],
    iconAnchor: [ax, ay],
  });
}

/** Symbole orienté (piles) : tourné selon s.angle, texte à côté non tourné. */
function orientIcon(s, scale = 1) {
  const h = Math.round(mapHeight(s.kind) * scale);
  const [vw, vh] = symbolArt(s.kind);
  const w = Math.round((h * vw) / vh);
  const box = Math.max(w, h);
  const angle = (s.angle ?? 90) - 90; // dessin horizontal = orienté vers l'est
  const rad = (angle * Math.PI) / 180;
  const ext = Math.abs((w / 2) * Math.cos(rad)) + Math.abs((h / 2) * Math.sin(rad)); // demi-largeur après rotation
  const label = s.text ? `<span class="sym-label sym-label-free" style="left:${box / 2 + ext + 3}px">${esc(s.text)}</span>` : '';
  return L.divIcon({
    className: 'sym sym-orient',
    html: `<div style="position:absolute;left:${(box - w) / 2}px;top:${(box - h) / 2}px;width:${w}px;height:${h}px;transform:rotate(${angle}deg)">${symbolSvg(s.kind, h)}</div>${label}`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
  });
}

/**
 * Crée la couche Leaflet d'un symbole.
 * @param {object} s { kind, lat, lng, angle?, lat2?, lng2?, pts?, text? }
 * @param {object} opt { interactive, draggable, scale }
 */
export function symbolLayer(s, opt = {}) {
  const def = SYMBOL_BY_KIND[s.kind];
  if (!def) return null;
  const scale = opt.scale || 1;
  const inter = !!opt.interactive;

  if (def.mode === 'point') {
    return L.marker([s.lat, s.lng], {
      icon: pointIcon(s, scale),
      draggable: !!opt.draggable,
      interactive: inter,
      keyboard: false,
      zIndexOffset: def.coordLabel ? 1000 : 0,
    });
  }

  if (def.mode === 'orient') {
    return L.marker([s.lat, s.lng], { icon: orientIcon(s, scale), draggable: !!opt.draggable, interactive: inter, keyboard: false });
  }

  if (def.mode === 'wedge') {
    return L.marker([s.lat, s.lng], { icon: wedgeIcon(s.angle || 0, scale), draggable: !!opt.draggable, interactive: inter, keyboard: false });
  }

  const g = L.featureGroup();

  if (def.mode === 'arrow') {
    const a = [s.lat, s.lng];
    const b = [s.lat2, s.lng2];
    L.polyline([a, b], { color: '#111', weight: 2.5 * scale, interactive: inter }).addTo(g);
    headMarker(b, bearing(a, b), '#111', Math.round(16 * scale), inter).addTo(g);
    L.circleMarker(a, { radius: 9 * scale, color: '#111', weight: 2, fillColor: def.color, fillOpacity: 1, interactive: inter }).addTo(g);
    return g;
  }

  if (def.mode === 'zone') {
    const pts = s.pts || [];
    if (pts.length < 3) return null;
    const color = s.color || ZONE_COLORS[0];
    L.polygon(pts, { color, weight: 2.5 * scale, dashArray: '7 5', fillColor: color, fillOpacity: 0.18, interactive: inter }).addTo(g);
    if (s.text) {
      const c = parcelCenter(pts.map(([lat, lng]) => ({ lat, lng }))) || L.polygon(pts).getBounds().getCenter();
      labelMarker(c, esc(s.text), 'tag-zone', inter, `border-color:${color};color:${color}`).addTo(g);
    }
    return g;
  }

  // Lignes
  const pts = s.pts || [];
  if (pts.length < 2) return null;
  if (def.outline) L.polyline(pts, { color: def.outline, weight: (def.weight + 3) * scale, interactive: inter, lineCap: 'round', lineJoin: 'round' }).addTo(g);
  L.polyline(pts, { color: def.color, weight: def.weight * scale, interactive: inter, lineCap: 'round', lineJoin: 'round' }).addTo(g);
  // Motif (poteaux de barrière, marches d'escalier)
  if (def.overlay) L.polyline(pts, { color: def.overlay.color, weight: def.overlay.weight * scale, dashArray: def.overlay.dash, lineCap: 'butt', interactive: inter }).addTo(g);
  const n = pts.length;
  const hs = Math.round((def.kind === 'distance' ? 16 : 20) * scale);
  if (def.arrowEnd) headMarker(pts[n - 1], bearing(pts[n - 2], pts[n - 1]), def.color, hs, inter).addTo(g);
  if (def.arrowStart) headMarker(pts[0], bearing(pts[1], pts[0]), def.color, hs, inter).addTo(g);
  if (def.lineLabel) {
    labelMarker(midPoint(pts), `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M8 1L3 8h3.5L5 13l6-8H7.5z" fill="#ffd600" stroke="#111" stroke-width=".8"/></svg>${esc(def.lineLabel)}`, 'tag-elec', inter).addTo(g);
  }
  if (def.measure) labelMarker(midPoint(pts), esc(fmtLen(lengthOf(pts))), 'tag-dist', inter).addTo(g);
  else if (s.text) labelMarker(midPoint(pts), esc(s.text), 'tag-ouvrage', inter).addTo(g);
  return g;
}
