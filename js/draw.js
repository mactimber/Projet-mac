// Dessin de la parcelle et des symboles sur une carte Leaflet
// (carte principale et carte de la fiche de secours).

import { SYMBOL_BY_KIND, symbolSvg, arrowHeadSvg } from './symbols.js';

export const PARCEL_STYLE = { color: '#ffeb3b', weight: 4, fillColor: '#ffeb3b', fillOpacity: 0.12, dashArray: null };
export const PARCEL_STYLE_OUTLINE = { color: '#111', weight: 7, fill: false, opacity: 0.55, interactive: false };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Cap (degrés, 0 = nord, sens horaire) de a vers b, en Web Mercator. */
export function bearing(a, b) {
  const p = L.CRS.EPSG3857.project(L.latLng(a));
  const q = L.CRS.EPSG3857.project(L.latLng(b));
  return ((Math.atan2(q.x - p.x, q.y - p.y) * 180) / Math.PI + 360) % 360;
}

export function pointIcon(kind, size = 34, text = '') {
  if (kind === 'texte') {
    return L.divIcon({ className: 'sym sym-text', html: `<span>${esc(text || 'Texte')}</span>`, iconSize: null, iconAnchor: [0, 12] });
  }
  return L.divIcon({ className: 'sym', html: symbolSvg(kind, size), iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

/**
 * Crée la couche Leaflet d'un symbole.
 * @param {object} s symbole { kind, lat, lng, lat2, lng2, text }
 * @param {object} opt { interactive, draggable, scale }
 */
export function symbolLayer(s, opt = {}) {
  const def = SYMBOL_BY_KIND[s.kind];
  if (!def) return null;
  const scale = opt.scale || 1;
  if (def.mode === 'arrow') {
    const a = [s.lat, s.lng];
    const b = [s.lat2, s.lng2];
    const g = L.featureGroup();
    L.polyline([a, b], {
      color: def.color,
      weight: def.weight * scale,
      opacity: def.opacity ?? 1,
      dashArray: def.dash,
      lineCap: 'round',
      interactive: !!opt.interactive,
    }).addTo(g);
    const size = Math.round((def.kind === 'travail' ? 30 : 22) * scale);
    L.marker(b, {
      icon: L.divIcon({
        className: 'sym-head',
        html: `<div style="transform:rotate(${bearing(a, b)}deg)">${arrowHeadSvg(def.color, size)}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      }),
      interactive: !!opt.interactive,
      keyboard: false,
    }).addTo(g);
    if (def.tree) {
      L.circleMarker(a, { radius: 6 * scale, color: '#fff', weight: 2, fillColor: '#2e7d32', fillOpacity: 1, interactive: !!opt.interactive }).addTo(g);
    }
    return g;
  }
  return L.marker([s.lat, s.lng], {
    icon: pointIcon(s.kind, Math.round(34 * scale), s.text),
    draggable: !!opt.draggable,
    interactive: !!opt.interactive,
    keyboard: false,
    zIndexOffset: s.kind === 'heli' ? 1000 : 0,
  });
}
