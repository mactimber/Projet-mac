// Dessin du plan de coupe dans une image PNG (pour le dossier Word).
// Les fonds de carte sont repris de la carte de la fiche ; parcelle et symboles sont redessinés.

import { SYMBOL_BY_KIND, symbolSvg, symbolArt, mapHeight, WEDGE_SVG, ZONE_COLORS, arrowHeadSvg } from './symbols.js';
import { formatLV95, parcelCenter } from './swiss.js';

const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** Convertit un SVG (texte) en PNG de la taille demandée. */
export async function svgToPng(svg, w, h) {
  const img = await loadImage(svgUrl(svg));
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return canvasBytes(c);
}

export async function canvasBytes(canvas) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * @param {L.Map} map carte déjà cadrée, fonds chargés
 * @param {object} chantier
 * @param {number} k facteur de taille des symboles (1 = comme à l'écran)
 * @returns {Promise<{bytes:Uint8Array,width:number,height:number}>}
 */
export async function renderPlan(map, chantier, k = 2) {
  const box = map.getContainer().getBoundingClientRect();
  const W = Math.round(box.width);
  const H = Math.round(box.height);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(0, 0, W, H);

  // 1. Fonds de carte (seulement les couches qui autorisent la copie : CORS)
  for (const img of map.getContainer().querySelectorAll('.leaflet-tile-pane img.leaflet-tile')) {
    if (!img.complete || !img.naturalWidth || img.crossOrigin == null) continue;
    const layer = img.closest('.leaflet-layer');
    const op = layer ? parseFloat(getComputedStyle(layer).opacity) : 1;
    const r = img.getBoundingClientRect();
    ctx.globalAlpha = Number.isFinite(op) ? op : 1;
    try {
      ctx.drawImage(img, r.left - box.left, r.top - box.top, r.width, r.height);
    } catch { /* tuile illisible */ }
  }
  ctx.globalAlpha = 1;

  const P = (ll) => {
    const p = map.latLngToContainerPoint(L.latLng(ll));
    return [p.x, p.y];
  };
  const path = (pts, close) => {
    ctx.beginPath();
    pts.forEach((ll, i) => {
      const [x, y] = P(ll);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    if (close) ctx.closePath();
  };
  const shadow = (on) => {
    ctx.shadowColor = on ? 'rgba(0,0,0,.5)' : 'transparent';
    ctx.shadowBlur = on ? 3 * k : 0;
    ctx.shadowOffsetY = on ? k : 0;
  };
  const font = (px) => `700 ${Math.round(px * k)}px Arial, Helvetica, sans-serif`;

  /** Étiquette (texte dans un cadre). anchor : 'left' (à droite d'un point) ou 'center'. */
  const tag = (text, x, y, { anchor = 'center', size = 13, bg = '#fff', fg = '#111', border = '#111', bw = 2 } = {}) => {
    ctx.font = font(size);
    const tw = ctx.measureText(text).width;
    const padX = 5 * k;
    const h = (size + 6) * k;
    const w = tw + padX * 2;
    const x0 = anchor === 'left' ? x : x - w / 2;
    const y0 = y - h / 2;
    ctx.fillStyle = bg;
    ctx.fillRect(x0, y0, w, h);
    if (bw) {
      ctx.lineWidth = bw * k;
      ctx.strokeStyle = border;
      ctx.strokeRect(x0, y0, w, h);
    }
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x0 + padX, y0 + h / 2 + k * 0.5);
  };

  const imgCache = new Map();
  const svgImg = async (svg) => {
    if (!imgCache.has(svg)) imgCache.set(svg, await loadImage(svgUrl(svg)));
    return imgCache.get(svg);
  };
  const head = async (at, angleDeg, color, size) => {
    const [x, y] = P(at);
    const img = await svgImg(arrowHeadSvg(color, 22));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angleDeg * Math.PI) / 180);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  };
  const bearingPx = (a, b) => {
    const [x1, y1] = P(a);
    const [x2, y2] = P(b);
    return (Math.atan2(x2 - x1, -(y2 - y1)) * 180) / Math.PI;
  };
  const mid = (pts) => {
    const xy = pts.map(P);
    let tot = 0;
    for (let i = 1; i < xy.length; i++) tot += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    let acc = 0;
    for (let i = 1; i < xy.length; i++) {
      const s = Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
      if (acc + s >= tot / 2) {
        const t = s ? (tot / 2 - acc) / s : 0;
        return [xy[i - 1][0] + (xy[i][0] - xy[i - 1][0]) * t, xy[i - 1][1] + (xy[i][1] - xy[i - 1][1]) * t];
      }
      acc += s;
    }
    return xy[0];
  };
  const meters = (pts) => {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += L.latLng(pts[i - 1]).distanceTo(pts[i]);
    return d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`;
  };

  // 2. Parcelle
  if (chantier.parcel?.length > 2) {
    ctx.lineJoin = 'round';
    path(chantier.parcel, true);
    ctx.fillStyle = 'rgba(255,255,255,.38)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 5 * k;
    ctx.stroke();
    ctx.strokeStyle = '#f4b6b0';
    ctx.lineWidth = 2.5 * k;
    ctx.stroke();
  }

  const syms = chantier.symbols || [];
  const order = (s) => {
    const m = SYMBOL_BY_KIND[s.kind]?.mode;
    return m === 'zone' ? 0 : m === 'line' ? 1 : SYMBOL_BY_KIND[s.kind]?.coordLabel ? 4 : 2;
  };
  const labels = []; // étiquettes dessinées en dernier (au-dessus de tout)

  for (const s of [...syms].sort((a, b) => order(a) - order(b))) {
    const def = SYMBOL_BY_KIND[s.kind];
    if (!def) continue;
    ctx.setLineDash([]);
    shadow(false);

    if (def.mode === 'zone') {
      if (!s.pts || s.pts.length < 3) continue;
      const color = s.color || ZONE_COLORS[0];
      path(s.pts, true);
      ctx.fillStyle = `${color}2e`;
      ctx.fill();
      ctx.setLineDash([7 * k, 5 * k]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5 * k;
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.text) {
        const cc = parcelCenter(s.pts.map(([lat, lng]) => ({ lat, lng }))) || L.polygon(s.pts).getBounds().getCenter();
        const [x, y] = P(cc);
        labels.push(() => tag(s.text, x, y, { size: 12, fg: color, border: color, bg: 'rgba(255,255,255,.92)' }));
      }
      continue;
    }

    if (def.mode === 'line') {
      const pts = s.pts || [];
      if (pts.length < 2) continue;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (def.outline) {
        path(pts);
        ctx.strokeStyle = def.outline;
        ctx.lineWidth = (def.weight + 3) * k;
        ctx.stroke();
      }
      path(pts);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = def.weight * k;
      ctx.stroke();
      const n = pts.length;
      const hs = (def.kind === 'distance' ? 16 : 20) * k;
      if (def.arrowEnd) await head(pts[n - 1], bearingPx(pts[n - 2], pts[n - 1]), def.color, hs);
      if (def.arrowStart) await head(pts[0], bearingPx(pts[1], pts[0]), def.color, hs);
      const [mx, my] = mid(pts);
      if (def.lineLabel) labels.push(() => tag(`⚡ ${def.lineLabel}`, mx, my, { size: 11, bw: 1.5 }));
      if (def.measure) labels.push(() => tag(meters(pts), mx, my, { size: 13, bg: '#ffd34d', bw: 1.5 }));
      continue;
    }

    if (def.mode === 'arrow') {
      const a = [s.lat, s.lng];
      const b = [s.lat2, s.lng2];
      path([a, b]);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2.5 * k;
      ctx.stroke();
      await head(b, bearingPx(a, b), '#111', 16 * k);
      const [x, y] = P(a);
      ctx.beginPath();
      ctx.arc(x, y, 9 * k, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = '#111';
      ctx.stroke();
      continue;
    }

    const [x, y] = P([s.lat, s.lng]);

    if (def.mode === 'wedge') {
      const size = 34 * k;
      const img = await svgImg(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">${WEDGE_SVG}</svg>`);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((s.angle || 0) * Math.PI) / 180);
      shadow(true);
      ctx.drawImage(img, -size / 2, -(size * 37) / 40, size, size);
      ctx.restore();
      continue;
    }

    if (s.kind === 'texte') {
      labels.push(() => tag(s.text || 'Texte', x, y, { size: 13 }));
      continue;
    }

    const h = mapHeight(s.kind) * k;
    const [vw, vh] = symbolArt(s.kind);
    const w = (h * vw) / vh;
    const img = await svgImg(symbolSvg(s.kind, 60));

    if (def.mode === 'orient') {
      const angle = (((s.angle ?? 90) - 90) * Math.PI) / 180;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      shadow(true);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      if (s.text) {
        const ext = Math.abs((w / 2) * Math.cos(angle)) + Math.abs((h / 2) * Math.sin(angle));
        labels.push(() => tag(s.text, x + ext + 3 * k, y, { anchor: 'left', size: 13, bw: 0, bg: 'rgba(255,255,255,.75)' }));
      }
      continue;
    }

    // point
    shadow(true);
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    shadow(false);
    const lx = x + w / 2 + 3 * k;
    if (def.coordLabel) {
      const txt = formatLV95(s.lat, s.lng).replace(', ', ' / ');
      const st = s.kind === 'heli'
        ? { bg: '#111', fg: '#ff3b30', border: '#111', bw: 1.5 }
        : { bg: '#fff', fg: '#1a8fd0', border: '#3fa9e0', bw: 2 };
      labels.push(() => tag(txt, lx, y, { anchor: 'left', size: 13, ...st }));
    } else if (s.text) {
      labels.push(() => tag(s.text, lx, y, { anchor: 'left', size: 12, bw: 1.5 }));
    }
  }
  shadow(false);
  labels.forEach((f) => f());

  // 3. Nord + échelle graphique
  const north = await svgImg('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="40" viewBox="0 0 26 40"><path d="M13 2L22 30L13 25L4 30Z" fill="#333"/><path d="M13 2L13 25L4 30Z" fill="#888"/><text x="13" y="39" font-size="10" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" fill="#111">N</text></svg>');
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(W - 40 * k, 8 * k, 32 * k, 48 * k);
  ctx.drawImage(north, W - 37 * k, 12 * k, 26 * k, 40 * k);

  const yb = H - 12 * k;
  const p1 = map.containerPointToLatLng([10, H / 2]);
  const mPerPx = p1.distanceTo(map.containerPointToLatLng([110, H / 2])) / 100;
  const target = mPerPx * 120 * k;
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].reduce((b, v) => (v <= target ? v : b), 5);
  const len = nice / mPerPx;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(6 * k, yb - 18 * k, len + 40 * k, 26 * k);
  ctx.fillStyle = '#111';
  ctx.fillRect(12 * k, yb - 3 * k, len, 4 * k);
  ctx.fillRect(12 * k, yb - 9 * k, 2 * k, 10 * k);
  ctx.fillRect(12 * k + len - 2 * k, yb - 9 * k, 2 * k, 10 * k);
  ctx.font = font(11);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 18 * k, yb - 7 * k);

  ctx.font = `${Math.round(9 * k)}px Arial, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  const attr = '© swisstopo';
  const aw = ctx.measureText(attr).width;
  ctx.fillRect(W - aw - 8 * k, H - 14 * k, aw + 8 * k, 14 * k);
  ctx.fillStyle = '#333';
  ctx.fillText(attr, W - 4 * k, H - 4 * k);

  return { bytes: await canvasBytes(c), width: W, height: H };
}
