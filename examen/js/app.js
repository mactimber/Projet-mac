// Relevé Forestier — version simplifiée en 3 étapes :
// 1. Parcelle  2. Symboles  3. Fiche de secours

import { db, newChantier, uid } from './db.js';
import { SYMBOLS, SYMBOL_BY_KIND, GROUPS, ZONE_COLORS, symbolSvg } from './symbols.js';
import { symbolLayer, esc, bearing, PARCEL_STYLE, PARCEL_STYLE_OUTLINE } from './draw.js';
import { renderFiche, closeFicheMap, getResponsables, setResponsables } from './fiche.js';
import { lookupPlace } from './place.js';
import { readPlan } from './share.js';
import { wgs84ToLV95, formatLV95, parseCoordinates, polygonArea, formatArea, parcelCenter, pathLength, formatLength } from './swiss.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ------------------------------------------------------------------ */
/* Carte et fonds                                                      */
/* ------------------------------------------------------------------ */

const SWISS = L.latLngBounds([45.6, 5.7], [47.95, 10.7]);
const wmts = (id, ext = 'jpeg') => `https://wmts.geo.admin.ch/1.0.0/${id}/default/current/3857/{z}/{x}/{y}.${ext}`;
const ATTR = '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';

const BASES = [
  { id: 'carte', label: 'Carte', url: wmts('ch.swisstopo.pixelkarte-farbe'), maxNativeZoom: 18 },
  { id: 'photo', label: 'Photo aérienne', url: wmts('ch.swisstopo.swissimage'), maxNativeZoom: 20 },
  { id: 'gris', label: 'Carte grise', url: wmts('ch.swisstopo.pixelkarte-grau'), maxNativeZoom: 18 },
];
const OVERLAYS = [
  { id: 'ch.kantone.cadastralwebmap-farbe', label: 'Cadastre (parcelles)', opacity: 0.85 },
  { id: 'ch.swisstopo.hangneigung-ueber_30', label: 'Pentes raides (> 30°)', opacity: 0.55 },
  { id: 'ch.swisstopo.swissalti3d-reliefschattierung', label: 'Relief du terrain', opacity: 0.45 },
  { id: 'ch.bfe.elektrische-anlagen_ueber_36', label: 'Lignes électriques', opacity: 0.9 },
  {
    id: 'zones-s', label: 'Zones de protection des eaux (S1, S2, S3)', opacity: 0.65,
    // Couche cantonale vaudoise, puis service intercantonal ; les noms de couches sont lus dans le GetCapabilities.
    discover: [
      { url: 'https://www.ogc.vd.ch/public/services/OGC/wmsVD/Mapserver/WMSServer', attribution: '© État de Vaud (DGE)' },
      { url: 'https://geodienste.ch/db/planerischer_gewaesserschutz_v1_2_0/fra', attribution: '© geodienste.ch' },
    ],
  },
];

const makeBase = (id) => {
  const b = BASES.find((x) => x.id === id) || BASES[0];
  return L.tileLayer(b.url, { maxNativeZoom: b.maxNativeZoom, maxZoom: 21, attribution: ATTR, crossOrigin: 'anonymous', bounds: SWISS.pad(0.2) });
};
const makeOverlay = (o) => L.tileLayer.wms('https://wms.geo.admin.ch/', {
  layers: o.id, format: 'image/png', transparent: true, version: '1.3.0', tileSize: 512,
  maxZoom: 21, opacity: o.opacity, crossOrigin: 'anonymous', bounds: SWISS.pad(0.1), lang: 'fr',
  attribution: '© geo.admin.ch',
});

const map = L.map('map', { center: [46.8, 8.2], zoom: 8, minZoom: 7, maxZoom: 21, maxBounds: SWISS.pad(0.3), zoomControl: false });
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
map.attributionControl.setPrefix(false);
map.pm.setLang('fr');

const LS_LAYERS = 'e17-layers';
const layerState = Object.assign({ base: 'carte', overlays: [] }, JSON.parse(localStorage.getItem(LS_LAYERS) || '{}'));
layerState.overlays = layerState.overlays.filter((id) => id !== 'ch.bafu.grundwasserschutzzonen');
let baseLayer = null;
const overlayLayers = {};

/* Couches à découvrir (WMS hors geo.admin) -------------------------------- */

const ZONES_FORTES = /zones?\s+(S\s+)?(de\s+)?protection\s+des\s+(eaux|sources)|zones?\s+S\s*1|zones?\s+S\b|grundwasserschutzzone|gwszone|schutzzone/i;
const ZONES_S = /(^|[^a-z])S\s?[123h m]?\b|zone\s+S/i;
const EXCLURE = /p[ée]rim[èe]tre|areal|secteur|bereich|zuström|au\b|non en vigueur|nicht in kraft|projet/i;

/** Lit le GetCapabilities d'un WMS et retourne les noms des couches « zones S ». */
async function discoverWms(url) {
  const r = await fetch(`${url}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`);
  if (!r.ok) throw new Error(r.status);
  const xml = new DOMParser().parseFromString(await r.text(), 'text/xml');
  const kids = (el, tag) => [...el.children].filter((c) => c.localName === tag);
  const text = (el, tag) => kids(el, tag)[0]?.textContent?.trim() || '';
  const legendHref = (layer) => {
    for (const st of kids(layer, 'Style')) {
      const lu = kids(st, 'LegendURL')[0];
      const res = lu && kids(lu, 'OnlineResource')[0];
      const href = res?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || res?.getAttribute('xlink:href');
      if (href) return href;
    }
    return '';
  };
  const graphic = (name) => `${url}?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.3.0&FORMAT=image/png&SLD_VERSION=1.1.0&LAYER=${encodeURIComponent(name)}`;
  /** Légendes d'une couche et de ses sous-couches (titre + image) */
  const legendsOf = (layer) => {
    const subs = kids(layer, 'Layer');
    if (subs.length) return subs.flatMap(legendsOf);
    const name = text(layer, 'Name');
    const href = legendHref(layer) || (name ? graphic(name) : '');
    return href ? [{ title: text(layer, 'Title'), url: href }] : [];
  };
  const found = [];
  const legends = [];
  const walk = (layer, strong) => {
    const name = text(layer, 'Name');
    const title = `${text(layer, 'Title')} ${name}`;
    if (EXCLURE.test(title) && !/zone/i.test(title)) return;
    if (name && ZONES_FORTES.test(title)) {
      found.push(name);
      legends.push(...legendsOf(layer)); // une couche groupe affiche ses sous-couches
      return;
    }
    if (name && ZONES_S.test(title) && strong) {
      found.push(name);
      legends.push(...legendsOf(layer));
    }
    kids(layer, 'Layer').forEach((c) => walk(c, strong || ZONES_FORTES.test(title)));
  };
  const cap = xml.getElementsByTagNameNS('*', 'Capability')[0];
  if (!cap) throw new Error('capabilities');
  kids(cap, 'Layer').forEach((l) => walk(l, false));
  return { names: found, legends };
}

const LS_DISCOVER = 'e17-discover';
const discovered = JSON.parse(localStorage.getItem(LS_DISCOVER) || '{}');

async function makeDiscoveredOverlay(o) {
  let cfg = discovered[o.id];
  if (!cfg || !cfg.legends) {
    cfg = null;
    for (const src of o.discover) {
      try {
        const { names, legends } = await discoverWms(src.url);
        if (names.length) {
          cfg = { url: src.url, layers: names.join(','), attribution: src.attribution, legends };
          break;
        }
      } catch (e) {
        console.warn('WMS', src.url, e);
      }
    }
    if (!cfg) throw new Error('introuvable');
    discovered[o.id] = cfg;
    localStorage.setItem(LS_DISCOVER, JSON.stringify(discovered));
  }
  return L.tileLayer.wms(cfg.url, {
    layers: cfg.layers, format: 'image/png', transparent: true, version: '1.3.0', tileSize: 512,
    maxZoom: 21, opacity: o.opacity, bounds: SWISS.pad(0.1), attribution: cfg.attribution, // sans crossOrigin : ces serveurs n'autorisent pas forcément le CORS
  });
}

function applyLayers() {
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = makeBase(layerState.base).addTo(map);
  baseLayer.bringToBack();
  for (const o of OVERLAYS) {
    const on = layerState.overlays.includes(o.id);
    if (on && !overlayLayers[o.id] && o.discover) {
      overlayLayers[o.id] = 'pending';
      makeDiscoveredOverlay(o).then((l) => {
        if (!layerState.overlays.includes(o.id)) return delete overlayLayers[o.id];
        overlayLayers[o.id] = l.addTo(map);
        if ($('#dlg-layers').open) renderLayerDialog();
      }).catch(() => {
        delete overlayLayers[o.id];
        layerState.overlays = layerState.overlays.filter((x) => x !== o.id);
        localStorage.setItem(LS_LAYERS, JSON.stringify(layerState));
        toast('Zones S introuvables : pas de réseau, ou le service du canton ne répond pas.');
        if ($('#dlg-layers').open) renderLayerDialog();
      });
      continue;
    }
    if (on && !overlayLayers[o.id]) overlayLayers[o.id] = makeOverlay(o).addTo(map);
    if (!on && overlayLayers[o.id]) {
      if (overlayLayers[o.id] !== 'pending') map.removeLayer(overlayLayers[o.id]);
      delete overlayLayers[o.id];
    }
  }
  localStorage.setItem(LS_LAYERS, JSON.stringify(layerState));
}
applyLayers();

function renderLayerDialog() {
  $('#base-choice').innerHTML = BASES.map((b) => `<button type="button" data-base="${b.id}" class="${layerState.base === b.id ? 'on' : ''}">${esc(b.label)}</button>`).join('');
  $('#overlay-choice').innerHTML = OVERLAYS.map((o) => `<label><input type="checkbox" data-ov="${o.id}" ${layerState.overlays.includes(o.id) ? 'checked' : ''}> <span class="ov-name">${esc(o.label)}</span>${o.discover
    ? (discovered[o.id]?.legends?.length ? `<button type="button" class="ov-legend link" data-legend="${o.id}">légende</button>` : '')
    : `<a class="ov-legend" href="https://api3.geo.admin.ch/rest/services/api/MapServer/${o.id}/legend?lang=fr" target="_blank" rel="noopener" title="Légende">légende</a>`}</label>
    ${o.discover && discovered[o.id]?.legends?.length ? `<div class="ov-legend-box" id="legend-${o.id}" hidden>${discovered[o.id].legends.map((l) => `<div class="lg-row"><img src="${esc(l.url)}" alt="" loading="lazy"><span>${esc(l.title)}</span></div>`).join('')}<p class="hint">Source : ${esc(discovered[o.id].attribution.replace('© ', ''))}</p></div>` : ''}`).join('');
  $$('#overlay-choice [data-legend]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const box = $(`#legend-${b.dataset.legend}`);
    box.hidden = !box.hidden;
  }));
  $$('#base-choice button').forEach((b) => b.addEventListener('click', () => {
    layerState.base = b.dataset.base;
    applyLayers();
    renderLayerDialog();
  }));
  $$('#overlay-choice input').forEach((cb) => cb.addEventListener('change', () => {
    layerState.overlays = cb.checked ? [...layerState.overlays, cb.dataset.ov] : layerState.overlays.filter((x) => x !== cb.dataset.ov);
    applyLayers();
  }));
}
$('#btn-layers').addEventListener('click', () => {
  renderLayerDialog();
  $('#dlg-layers').showModal();
});

/* ------------------------------------------------------------------ */
/* État du chantier                                                    */
/* ------------------------------------------------------------------ */

let chantier = null;
const parcelGroup = L.featureGroup().addTo(map);
const symbolGroup = L.featureGroup().addTo(map);
let parcelLayer = null;

const ACTIVE = 'e17-active-chantier';
let saveTimer = null;
function save(delay = 400) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, delay);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!chantier) return;
  chantier.updated = new Date().toISOString();
  const c = map.getCenter();
  chantier.view = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
  try {
    await db.put(chantier);
  } catch (e) {
    console.error(e);
    toast('⚠ Enregistrement impossible (stockage plein ?)');
  }
}
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveNow());
map.on('moveend', () => chantier && save(1500));

/** Anciens symboles -> symboles actuels. */
function migrateSymbols(list) {
  const out = [];
  for (const x of list || []) {
    if (SYMBOL_BY_KIND[x.kind]) { out.push(x); continue; }
    const map2 = { pharmacie: 'vehicule', danger: 'triopan', barrage: 'bache', route_fermee: 'bache', electrique: 'triopan', reseau: 'texte', debut_violet: 'debut_vert' };
    if (x.kind === 'chute' && x.lat2 != null) out.push({ id: x.id, kind: 'abattage', lat: x.lat, lng: x.lng, angle: bearing([x.lat, x.lng], [x.lat2, x.lng2]) });
    else if ((x.kind === 'travail' || x.kind === 'debardage') && x.lat2 != null) out.push({ ...x, kind: 'debut_vert' });
    else if (map2[x.kind]) out.push({ ...x, kind: map2[x.kind], text: x.kind === 'reseau' ? 'Réseau mobile' : x.text });
  }
  return out;
}

/** Convertit un chantier d'une version précédente vers le format actuel. */
function migrate(c) {
  if (c.version === 2) {
    c.symbols = migrateSymbols(c.symbols);
    return c;
  }
  const out = newChantier(c.info?.name || 'Chantier');
  Object.assign(out, { id: c.id, created: c.created, view: c.view });
  out.info = { ...out.info, name: c.info?.name, lieu: [c.info?.commune, c.info?.lieu_dit].filter(Boolean).join(' – '), responsable: c.info?.responsable };
  for (const f of c.features?.features || []) {
    const p = f.properties || {};
    const g = f.geometry;
    if (!out.parcel && p.type === 'parcelle' && g?.type === 'Polygon') out.parcel = g.coordinates[0].slice(0, -1).map(([x, y]) => [y, x]);
    if (p.type === 'secours' && g?.type === 'Point') out.symbols.push({ id: uid(), kind: 'point_t', lat: g.coordinates[1], lng: g.coordinates[0] });
  }
  if (out.parcel) autoHeli(out);
  return out;
}

async function openChantier(c) {
  if (chantier) await saveNow();
  chantier = migrate(c);
  chantier.info ||= {};
  chantier.symbols ||= [];
  localStorage.setItem(ACTIVE, chantier.id);
  $('#chantier-name').textContent = chantier.info.name || 'Chantier';
  drawAll();
  if (chantier.view) map.setView([chantier.view.lat, chantier.view.lng], chantier.view.zoom);
  else if (parcelLayer) map.fitBounds(parcelLayer.getBounds().pad(0.3));
  closeSheet();
}

/* ------------------------------------------------------------------ */
/* Dessin                                                              */
/* ------------------------------------------------------------------ */

function drawAll() {
  drawParcel();
  drawSymbols();
}

function drawParcel() {
  parcelGroup.clearLayers();
  parcelLayer = null;
  if (!chantier.parcel) return;
  L.polygon(chantier.parcel, PARCEL_STYLE_OUTLINE).addTo(parcelGroup);
  parcelLayer = L.polygon(chantier.parcel, { ...PARCEL_STYLE, pmIgnore: false }).addTo(parcelGroup);
  parcelLayer.on('pm:edit', () => {
    chantier.parcel = parcelLayer.getLatLngs()[0].map((ll) => [ll.lat, ll.lng]);
    autoHeli(chantier);
    drawSymbols();
    parcelGroup.getLayers()[0].setLatLngs(chantier.parcel);
    save();
    if (currentStep === 'parcelle') renderParcelSheet();
  });
}

function drawSymbols() {
  symbolGroup.clearLayers();
  for (const s of chantier.symbols) {
    const def = SYMBOL_BY_KIND[s.kind];
    const layer = symbolLayer(s, { interactive: true, draggable: def && ['point', 'wedge', 'orient'].includes(def.mode) });
    if (!layer) continue;
    layer.on('click', (e) => {
      if (placing) return;
      L.DomEvent.stop(e);
      symbolPopup(s, e.latlng);
    });
    if (layer instanceof L.Marker) {
      layer.on('dragend', () => {
        const ll = layer.getLatLng();
        s.lat = ll.lat;
        s.lng = ll.lng;
        if (s.kind === 'heli') {
          s.manual = true;
          s.alt = null;
          fetchAltitude(s);
        }
        if (s.kind === 'heli' || s.kind === 'point_t') fetchPlace(s);
        if (def.coordLabel) layer.setIcon(symbolLayer(s).options.icon);
        save();
      });
    }
    layer.addTo(symbolGroup);
  }
}

function symbolPopup(s, latlng) {
  const def = SYMBOL_BY_KIND[s.kind];
  const movable = ['point', 'wedge', 'orient'].includes(def.mode);
  const div = document.createElement('div');
  div.className = 'sym-popup';
  div.innerHTML = `<div class="sp-head">${symbolSvg(s.kind, 26)} <b>${esc(def.label)}</b></div>
    ${movable ? `<div class="sp-coord">${formatLV95(s.lat, s.lng)}${s.alt ? ` · ${Math.round(s.alt)} m` : ''}</div>` : ''}
    ${s.kind === 'heli' && s.manual && chantier.parcel ? '<button type="button" data-a="center">Remettre au milieu de la parcelle</button>' : ''}
    ${def.mode === 'wedge' || def.mode === 'orient' ? '<button type="button" data-a="rotate">Changer la direction</button>' : ''}
    ${(def.mode === 'point' || def.mode === 'orient') && !def.coordLabel ? `<button type="button" data-a="text">${s.text ? 'Modifier le texte' : 'Ajouter un texte'}</button>` : ''}
    ${def.mode === 'zone' ? `<div class="sp-coord">${esc(s.text || '')} · ${formatArea(polygonArea(L.polygon(s.pts))).split(' (')[0]}</div><button type="button" data-a="text">Renommer</button><button type="button" data-a="color">Changer la couleur</button>` : ''}
    ${movable ? '<p class="sp-hint">Pour déplacer : glissez le symbole.</p>' : ''}
    <button type="button" data-a="del" class="danger">Supprimer</button>`;
  const pop = L.popup({ autoPan: true }).setLatLng(movable ? [s.lat, s.lng] : latlng).setContent(div).openOn(map);
  const act = (name, fn) => div.querySelector(`[data-a=${name}]`)?.addEventListener('click', () => {
    map.closePopup(pop);
    fn();
    drawSymbols();
    save();
  });
  act('del', () => { chantier.symbols = chantier.symbols.filter((x) => x !== s); });
  act('center', () => { s.manual = false; autoHeli(chantier); });
  act('text', () => {
    const t = prompt(def.mode === 'zone' ? 'Nom de la zone :' : 'Texte affiché à côté du symbole :', s.text || '');
    if (t !== null) s.text = t;
  });
  act('color', () => {
    const i = ZONE_COLORS.indexOf(s.color || ZONE_COLORS[0]);
    s.color = ZONE_COLORS[(i + 1) % ZONE_COLORS.length];
  });
  div.querySelector('[data-a=rotate]')?.addEventListener('click', () => {
    map.closePopup(pop);
    rotating = s;
    $('#sheet').hidden = true;
    hint(def.mode === 'wedge' ? 'Touchez la direction de chute.' : 'Touchez la direction de la longueur.', () => { rotating = null; hideHint(); });
  });
}

let rotating = null;

/** Place automatiquement l'hélico au milieu de la parcelle (sauf si déplacé à la main). */
function autoHeli(c) {
  if (!c.parcel || c.parcel.length < 3) return;
  let h = c.symbols.find((s) => s.kind === 'heli');
  if (h?.manual) return;
  const p = parcelCenter(c.parcel.map(([lat, lng]) => ({ lat, lng })));
  if (!p) return;
  if (!h) {
    h = { id: uid(), kind: 'heli' };
    c.symbols.push(h);
  }
  h.lat = p.lat;
  h.lng = p.lng;
  h.manual = false;
  h.alt = null;
  fetchAltitude(h);
  fetchPlace(h);
}

/** Lieu-dit / commune (et adresse pour le point T) d'après la carte. */
async function fetchPlace(s) {
  const pos = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
  s.placeFor = pos;
  try {
    const p = await lookupPlace(s.lat, s.lng, { adresse: s.kind === 'point_t' });
    if (s.placeFor !== pos) return; // le point a bougé entre-temps
    if (p.label) {
      s.place = p.label;
      save();
    }
  } catch { /* hors-ligne */ }
}

async function fetchAltitude(s) {
  try {
    const { E, N } = wgs84ToLV95(s.lat, s.lng);
    const r = await fetch(`https://api3.geo.admin.ch/rest/services/height?easting=${E.toFixed(1)}&northing=${N.toFixed(1)}&sr=2056`);
    const j = await r.json();
    if (j.height) {
      s.alt = Number(j.height);
      save();
      if (currentStep === 'parcelle' && chantier.parcel) renderParcelSheet();
    }
  } catch { /* hors-ligne : sans altitude */ }
}

/* ------------------------------------------------------------------ */
/* Étapes                                                              */
/* ------------------------------------------------------------------ */

let currentStep = null;

function openStep(step) {
  stopPlacing();
  if (step === 'fiche') return openFiche();
  if (currentStep === step) return closeSheet();
  currentStep = step;
  $$('.steps button').forEach((b) => b.classList.toggle('active', b.dataset.step === step));
  $('#sheet').hidden = false;
  if (step === 'parcelle') renderParcelSheet();
  if (step === 'symboles') renderSymbolSheet();
}

function closeSheet() {
  stopPlacing();
  stopParcelEdit();
  currentStep = null;
  $('#sheet').hidden = true;
  $$('.steps button').forEach((b) => b.classList.remove('active'));
}

$$('.steps button').forEach((b) => b.addEventListener('click', () => openStep(b.dataset.step)));

/* Étape 1 : parcelle ------------------------------------------------- */

function renderParcelSheet() {
  const body = $('#sheet-body');
  if (!chantier.parcel) {
    body.innerHTML = `
      <h2>1. Délimiter la parcelle</h2>
      <p class="hint">La place hélico sera placée automatiquement au milieu.</p>
      <div class="big-actions">
        <button type="button" id="p-draw" class="primary">✏️ Dessiner sur la carte</button>
        <button type="button" id="p-gps">👣 Marcher autour (GPS)</button>
      </div>`;
    $('#p-draw').addEventListener('click', startParcelDraw);
    $('#p-gps').addEventListener('click', () => recorder.start());
    return;
  }
  const heli = chantier.symbols.find((s) => s.kind === 'heli');
  const area = formatArea(polygonArea(parcelLayer)).split(' (')[0];
  body.innerHTML = `
    <h2>1. Parcelle <small>${esc(area)}</small></h2>
    ${heli ? `<div class="heli-box">${symbolSvg('heli', 34)}<div><b>Coordonnée hélico</b><br><span class="mono">${formatLV95(heli.lat, heli.lng)}</span>${heli.alt ? ` · ${Math.round(heli.alt)} m` : ''}<br><small>${heli.manual ? 'déplacée à la main' : 'milieu de la parcelle'}</small></div></div>` : ''}
    <div class="big-actions">
      <button type="button" id="p-edit">${editingParcel ? '✔ Terminer la modification' : '✥ Modifier les limites'}</button>
      <button type="button" id="p-next" class="primary">Suivant : symboles →</button>
    </div>
    <button type="button" id="p-del" class="link danger">Effacer la parcelle et recommencer</button>`;
  $('#p-edit').addEventListener('click', () => (editingParcel ? stopParcelEdit() : startParcelEdit()));
  $('#p-next').addEventListener('click', () => openStep('symboles'));
  $('#p-del').addEventListener('click', () => {
    if (!confirm('Effacer la parcelle ?')) return;
    stopParcelEdit();
    chantier.parcel = null;
    chantier.symbols = chantier.symbols.filter((s) => !(s.kind === 'heli' && !s.manual));
    drawAll();
    save();
    renderParcelSheet();
  });
}

let editingParcel = false;
function startParcelEdit() {
  if (!parcelLayer) return;
  editingParcel = true;
  parcelLayer.pm.enable({ allowSelfIntersection: false });
  hint('Glissez les points pour corriger les limites.', stopParcelEdit);
  renderParcelSheet();
}
function stopParcelEdit() {
  if (!editingParcel) return;
  editingParcel = false;
  parcelLayer?.pm.disable();
  hideHint();
  if (currentStep === 'parcelle') renderParcelSheet();
}

function startParcelDraw() {
  map.pm.enableDraw('Polygon', {
    pathOptions: PARCEL_STYLE,
    templineStyle: { color: '#ffeb3b', weight: 3 },
    hintlineStyle: { color: '#ffeb3b', dashArray: '5 5' },
    allowSelfIntersection: false,
    snappable: false,
  });
  $('#sheet').hidden = true;
  hint('Touchez chaque coin de la parcelle, puis le premier point pour fermer.', () => {
    map.pm.disableDraw();
    hideHint();
    $('#sheet').hidden = false;
  });
}

map.on('pm:create', (e) => {
  if (e.shape !== 'Polygon') return;
  const ring = e.layer.getLatLngs()[0].map((ll) => [ll.lat, ll.lng]);
  map.removeLayer(e.layer);
  hideHint();
  setParcel(ring);
});

function setParcel(ring) {
  chantier.parcel = ring;
  autoHeli(chantier);
  drawAll();
  save();
  map.fitBounds(parcelLayer.getBounds().pad(0.3));
  $('#sheet').hidden = false;
  currentStep = 'parcelle';
  renderParcelSheet();
  toast('Parcelle enregistrée. Place hélico placée au milieu.');
}

/* Étape 2 : symboles ------------------------------------------------- */

let placing = null; // { kind, first?, pts? }
const tempGroup = L.layerGroup().addTo(map);

function renderSymbolSheet() {
  $('#sheet-body').innerHTML = `
    <h2>2. Placer les symboles</h2>
    ${GROUPS.map((g) => `<h3 class="pal-title">${esc(g)}</h3><div class="palette">
      ${SYMBOLS.filter((s) => s.group === g).map((s) => `<button type="button" data-kind="${s.kind}">${symbolSvg(s.kind, 34)}<span>${esc(s.label)}</span></button>`).join('')}
    </div>`).join('')}
    <div class="big-actions"><button type="button" id="s-next" class="primary">Suivant : fiche et dossier →</button></div>`;
  $$('.palette button').forEach((b) => b.addEventListener('click', () => startPlacing(b.dataset.kind)));
  $('#s-next').addEventListener('click', () => openFiche());
}

function backToPalette() {
  stopPlacing();
  $('#sheet').hidden = false;
  currentStep = 'symboles';
  renderSymbolSheet();
}

function startPlacing(kind) {
  stopPlacing();
  const def = SYMBOL_BY_KIND[kind];
  placing = { kind, pts: [] };
  map.getContainer().classList.add('placing');
  $('#sheet').hidden = true;
  hint(def.hint, () => {
    if (def.mode === 'line' && placing?.pts.length >= 2) finishLine();
    if (def.mode === 'zone' && placing?.pts.length >= 3) finishZone();
    backToPalette();
  });
}

function stopPlacing() {
  placing = null;
  tempGroup.clearLayers();
  map.getContainer().classList.remove('placing');
  hideHint();
}

function finishLine() {
  const def = SYMBOL_BY_KIND[placing.kind];
  chantier.symbols.push({ id: uid(), kind: def.kind, pts: placing.pts.map((p) => [p.lat, p.lng]) });
  placing.pts = [];
  tempGroup.clearLayers();
  drawSymbols();
  save();
}

function finishZone() {
  const name = prompt('Nom de la zone (ex. Zone marécage, Arbres au tracteur, Hélico) :', '');
  const used = chantier.symbols.filter((x) => x.kind === 'zone').length;
  chantier.symbols.push({ id: uid(), kind: 'zone', pts: placing.pts.map((p) => [p.lat, p.lng]), text: name || '', color: ZONE_COLORS[used % ZONE_COLORS.length] });
  placing.pts = [];
  tempGroup.clearLayers();
  drawSymbols();
  save();
}

map.on('click', (e) => {
  const ll = e.latlng;
  if (rotating) {
    rotating.angle = bearing([rotating.lat, rotating.lng], ll);
    rotating = null;
    hideHint();
    drawSymbols();
    save();
    return;
  }
  if (!placing) return;
  const def = SYMBOL_BY_KIND[placing.kind];

  if (def.mode === 'wedge' || def.mode === 'arrow' || def.mode === 'orient') {
    if (!placing.first) {
      placing.first = ll;
      L.circleMarker(ll, { radius: 7, color: '#111', fillColor: def.color || '#1f9a3a', fillOpacity: 0.8 }).addTo(tempGroup);
      $('#hint-text').textContent = { wedge: 'Touchez maintenant la direction de chute.', arrow: 'Touchez maintenant la direction du travail.', orient: 'Touchez maintenant dans quel sens la pile est allongée.' }[def.mode];
      return;
    }
    const a = placing.first;
    if (def.mode === 'orient') {
      const t = prompt('Texte à côté de la pile (facultatif, ex. BS ME, Déchi) :', '');
      chantier.symbols.push({ id: uid(), kind: def.kind, lat: a.lat, lng: a.lng, angle: bearing(a, ll), text: t || '' });
      placing.first = null;
      tempGroup.clearLayers();
      drawSymbols();
      save();
      $('#hint-text').textContent = 'Pile suivante : touchez la pile, puis le sens.';
      return;
    }
    if (def.mode === 'wedge') chantier.symbols.push({ id: uid(), kind: def.kind, lat: a.lat, lng: a.lng, angle: bearing(a, ll) });
    else chantier.symbols.push({ id: uid(), kind: def.kind, lat: a.lat, lng: a.lng, lat2: ll.lat, lng2: ll.lng });
    placing.first = null;
    tempGroup.clearLayers();
    drawSymbols();
    save();
    if (def.mode === 'arrow') return backToPalette();
    $('#hint-text').textContent = 'Arbre suivant : touchez l\'arbre, puis la direction.';
    return;
  }

  if (def.mode === 'zone') {
    placing.pts.push(ll);
    tempGroup.clearLayers();
    const color = ZONE_COLORS[chantier.symbols.filter((x) => x.kind === 'zone').length % ZONE_COLORS.length];
    (placing.pts.length > 2 ? L.polygon : L.polyline)(placing.pts, { color, weight: 3, dashArray: '6 6', fillOpacity: 0.15 }).addTo(tempGroup);
    placing.pts.forEach((p) => L.circleMarker(p, { radius: 6, color: '#111', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(tempGroup));
    $('#hint-text').textContent = placing.pts.length < 3 ? 'Touchez le coin suivant.' : `${placing.pts.length} coins. Touchez le suivant, ou « Terminer » pour nommer la zone.`;
    return;
  }

  if (def.mode === 'line') {
    placing.pts.push(ll);
    tempGroup.clearLayers();
    L.polyline(placing.pts, { color: def.color, weight: def.weight, dashArray: '6 6' }).addTo(tempGroup);
    placing.pts.forEach((p) => L.circleMarker(p, { radius: 6, color: '#111', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(tempGroup));
    if (def.maxPts && placing.pts.length >= def.maxPts) {
      finishLine();
      $('#hint-text').textContent = def.kind === 'layon' ? 'Layon suivant : touchez le début, puis la fin.' : def.hint;
      if (def.kind === 'distance') backToPalette();
      return;
    }
    $('#hint-text').textContent = placing.pts.length < 2 ? 'Touchez le point suivant.' : `${placing.pts.length} points. Touchez le suivant, ou « Terminer ».`;
    return;
  }

  // Symbole ponctuel
  const s = { id: uid(), kind: def.kind, lat: ll.lat, lng: ll.lng };
  if (def.askText !== undefined) {
    const t = prompt(def.kind === 'texte' ? 'Texte à afficher :' : 'Texte à afficher (facultatif) :', def.askText);
    if (t === null || (def.kind === 'texte' && !t)) return;
    s.text = t;
  }
  if (def.unique) {
    chantier.symbols = chantier.symbols.filter((x) => x.kind !== def.kind);
    if (def.kind === 'heli') {
      s.manual = true;
      fetchAltitude(s);
    }
    if (def.kind === 'heli' || def.kind === 'point_t') fetchPlace(s);
  }
  chantier.symbols.push(s);
  drawSymbols();
  save();
  if (def.unique || def.kind === 'vehicule') backToPalette();
});

/* Étape 3 : fiche de secours ---------------------------------------- */

async function openFiche() {
  closeSheet();
  // Compléter les noms de lieu manquants (chantiers créés avant cette fonction), sans attendre plus de 3 s
  const missing = chantier.symbols.filter((x) => (x.kind === 'heli' || x.kind === 'point_t') && !x.place);
  if (missing.length && navigator.onLine !== false) {
    await Promise.race([Promise.all(missing.map(fetchPlace)), new Promise((r) => setTimeout(r, 3000))]);
  }
  saveNow();
  const root = $('#fiche');
  root.hidden = false;
  $('#app').hidden = true;
  renderFiche(root, chantier, {
    onChange: () => {
      $('#chantier-name').textContent = chantier.info.name || 'Chantier';
      save();
    },
    onClose: closeFiche,
    makeBaseLayer: () => makeBase(layerState.base),
    // Couches « découvertes » cochées (zones S…) : reprises sur le plan de la fiche, avec leur légende
    extraLayers: () => OVERLAYS.filter((o) => o.discover && layerState.overlays.includes(o.id) && discovered[o.id]).map((o) => {
      const cfg = discovered[o.id];
      return {
        label: o.label,
        legends: cfg.legends || [],
        layer: L.tileLayer.wms(cfg.url, {
          layers: cfg.layers, format: 'image/png', transparent: true, version: '1.3.0', tileSize: 512,
          maxZoom: 21, opacity: o.opacity, attribution: cfg.attribution,
        }),
      };
    }),
  });
  window.scrollTo(0, 0);
}

function closeFiche() {
  saveNow();
  closeFicheMap();
  $('#fiche').hidden = true;
  $('#fiche').innerHTML = '';
  $('#app').hidden = false;
  map.invalidateSize();
  drawSymbols();
}

/* ------------------------------------------------------------------ */
/* Bandeau d'aide                                                       */
/* ------------------------------------------------------------------ */

let hintCancel = null;
function hint(text, onCancel) {
  $('#hint-text').textContent = text;
  $('#hint-bar').hidden = false;
  hintCancel = onCancel;
}
function hideHint() {
  $('#hint-bar').hidden = true;
  hintCancel = null;
}
$('#hint-cancel').addEventListener('click', () => (hintCancel ? hintCancel() : hideHint()));

/* ------------------------------------------------------------------ */
/* GPS                                                                 */
/* ------------------------------------------------------------------ */

let watchId = null;
let gpsDot = null;
let gpsCircle = null;
let lastFix = null;
let follow = false;

function startGps() {
  if (watchId != null) return;
  if (!navigator.geolocation) return alert('Géolocalisation non disponible.');
  follow = true;
  $('#btn-locate').classList.add('on');
  watchId = navigator.geolocation.watchPosition(onFix, (err) => toast(`GPS : ${err.message}`), { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  lastFix = null;
  $('#btn-locate').classList.remove('on');
  if (gpsDot) map.removeLayer(gpsDot);
  if (gpsCircle) map.removeLayer(gpsCircle);
  gpsDot = gpsCircle = null;
}
function onFix(pos) {
  const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
  const acc = pos.coords.accuracy;
  const first = !lastFix;
  lastFix = { ll, acc };
  if (!gpsDot) {
    gpsCircle = L.circle(ll, { radius: acc, color: '#1976d2', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
    gpsDot = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1976d2', fillOpacity: 1, interactive: false }).addTo(map);
  } else {
    gpsDot.setLatLng(ll);
    gpsCircle.setLatLng(ll).setRadius(acc);
  }
  if (viewer) return viewer.onFix(ll, acc, first);
  if (first || follow) map.setView(ll, first ? Math.max(map.getZoom(), 17) : map.getZoom(), { animate: !first });
  if (recorder.active) recorder.onFix(lastFix);
}
map.on('dragstart', () => (follow = false));
$('#btn-locate').addEventListener('click', () => {
  if (watchId == null) startGps();
  else if (!follow && lastFix) {
    follow = true;
    map.setView(lastFix.ll, Math.max(map.getZoom(), 17));
  } else if (!recorder.active) stopGps();
});

const recorder = {
  active: false,
  points: [],
  line: null,
  wake: null,
  async start() {
    this.active = true;
    this.points = [];
    this.line = L.polyline([], { color: '#ffeb3b', weight: 4, dashArray: '6 6' }).addTo(map);
    $('#sheet').hidden = true;
    this.showBar();
    startGps();
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch { /* */ }
  },
  showBar() {
    $('#hint-text').innerHTML = `👣 Marchez le long de la limite… <b id="rec-n">${this.points.length}</b> points <span id="rec-acc"></span>`;
    $('#hint-bar').hidden = false;
    $('#hint-cancel').textContent = 'Terminer';
    hintCancel = () => this.finish();
  },
  onFix(fix) {
    const acc = $('#rec-acc');
    if (acc) acc.textContent = `· ±${Math.round(fix.acc)} m`;
    if (fix.acc > 20) return;
    const last = this.points[this.points.length - 1];
    if (!last || last.distanceTo(fix.ll) >= 5) {
      this.points.push(fix.ll);
      this.line.addLatLng(fix.ll);
      const n = $('#rec-n');
      if (n) n.textContent = this.points.length;
    }
  },
  finish() {
    const pts = this.points;
    this.active = false;
    if (this.line) map.removeLayer(this.line);
    this.wake?.release?.();
    hideHint();
    if (pts.length < 3) {
      toast(`Relevé annulé (${pts.length} point(s), il en faut au moins 3).`);
      $('#sheet').hidden = false;
      return;
    }
    toast(`Périmètre : ${formatLength(pathLength(pts))}`);
    setParcel(pts.map((p) => [p.lat, p.lng]));
  },
};

/* ------------------------------------------------------------------ */
/* Recherche                                                           */
/* ------------------------------------------------------------------ */

const sInput = $('#search-input');
const sResults = $('#search-results');
let sTimer = null;
sInput.addEventListener('input', () => {
  clearTimeout(sTimer);
  const q = sInput.value.trim();
  if (q.length < 2) return (sResults.hidden = true);
  sTimer = setTimeout(() => search(q), 300);
});
async function search(q) {
  const items = [];
  const c = parseCoordinates(q);
  if (c) items.push({ label: `Coordonnées ${formatLV95(c.lat, c.lng)}`, lat: c.lat, lng: c.lng, zoom: 17 });
  try {
    const r = await fetch(`https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&sr=4326&lang=fr&limit=8&searchText=${encodeURIComponent(q)}`);
    const j = await r.json();
    for (const x of j.results || []) {
      const d = document.createElement('div');
      d.innerHTML = x.attrs.label;
      items.push({ label: d.textContent, lat: x.attrs.lat, lng: x.attrs.lon, zoom: ['address', 'parcel'].includes(x.attrs.origin) ? 18 : 15 });
    }
  } catch {
    if (!c) items.push({ label: 'Recherche impossible sans réseau', off: true });
  }
  sResults.innerHTML = items.map((it, i) => `<li data-i="${i}" class="${it.off ? 'off' : ''}">${esc(it.label)}</li>`).join('') || '<li class="off">Aucun résultat</li>';
  sResults.hidden = false;
  sResults.querySelectorAll('li[data-i]').forEach((li) => li.addEventListener('click', () => {
    const it = items[li.dataset.i];
    if (it.off) return;
    map.setView([it.lat, it.lng], it.zoom);
    sResults.hidden = true;
    sInput.value = '';
    sInput.blur();
  }));
}
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  sResults.querySelector('li[data-i]:not(.off)')?.click();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-form')) sResults.hidden = true;
});

/* ------------------------------------------------------------------ */
/* Chantiers, sauvegarde                                                */
/* ------------------------------------------------------------------ */

async function renderChantierList() {
  const all = (await db.list()).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  $('#chantier-list').innerHTML = all.map((c) => `
    <li data-id="${c.id}" class="${c.id === chantier?.id ? 'on' : ''}">
      <button type="button" class="open"><b>${esc(c.info?.name || 'Sans nom')}</b><small>${new Date(c.updated).toLocaleDateString('fr-CH')}</small></button>
      <button type="button" class="del" aria-label="Supprimer">🗑</button>
    </li>`).join('');
  $$('#chantier-list li').forEach((li) => {
    li.querySelector('.open').addEventListener('click', async () => {
      $('#dlg-chantiers').close();
      await openChantier(await db.get(li.dataset.id));
    });
    li.querySelector('.del').addEventListener('click', async () => {
      const c = all.find((x) => x.id === li.dataset.id);
      if (!confirm(`Supprimer définitivement « ${c.info?.name || 'Sans nom'} » ?`)) return;
      await db.remove(c.id);
      if (c.id === chantier.id) {
        chantier = null;
        const rest = await db.list();
        const next = rest[0] || newChantier();
        if (!rest[0]) await db.put(next);
        await openChantier(next);
      }
      renderChantierList();
    });
  });
}
$('#btn-chantiers').addEventListener('click', async () => {
  await saveNow();
  await renderChantierList();
  $('#dlg-chantiers').showModal();
});
$('#btn-new-chantier').addEventListener('click', async () => {
  const name = prompt('Nom du chantier :', '');
  if (name === null) return;
  const c = newChantier(name || 'Nouveau chantier');
  const ctr = map.getCenter();
  c.view = { lat: ctr.lat, lng: ctr.lng, zoom: map.getZoom() };
  await db.put(c);
  $('#dlg-chantiers').close();
  await openChantier(c);
  openStep('parcelle');
});

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$('#btn-backup').addEventListener('click', async () => {
  await saveNow();
  const all = await db.list();
  download(`copie-secours-e17_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'releve-forestier-e17', version: 2, chantiers: all, responsables: getResponsables() }));
});
$('#input-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = data.chantiers || (data.chantier ? [data.chantier] : null);
    if (!/^releve-forestier/.test(data.format || '') || !list) throw new Error('fichier non reconnu');
    for (const c of list) await db.put(migrate(c));
    if (Array.isArray(data.responsables) && data.responsables.length) setResponsables(data.responsables);
    toast(`${list.length} chantier(s) importé(s)`);
    renderChantierList();
  } catch (err) {
    alert(`Import impossible : ${err.message}`);
  }
});

/* ------------------------------------------------------------------ */
/* Hors-ligne                                                          */
/* ------------------------------------------------------------------ */

const TILE_CACHE = 'e17-tiles-v1';
$('#btn-offline').addEventListener('click', async () => {
  if (!('caches' in window)) return alert('Non pris en charge par ce navigateur.');
  if (map.getZoom() < 13) return alert('Zoomez d\'abord sur le chantier.');
  const layers = [baseLayer, ...Object.values(overlayLayers).filter((l) => l !== 'pending')];
  const urls = new Set();
  const b = map.getBounds();
  for (const layer of layers) {
    const ts = layer.options.tileSize;
    const maxN = layer.options.maxNativeZoom ?? 20;
    for (let z = map.getZoom(); z <= Math.min(map.getZoom() + 3, 19); z++) {
      const tz = Math.min(z, maxN);
      const nw = map.project(b.getNorthWest(), tz).divideBy(ts).floor();
      const se = map.project(b.getSouthEast(), tz).divideBy(ts).floor();
      for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) {
        const c = L.point(x, y);
        c.z = tz;
        const saved = layer._tileZoom;
        layer._tileZoom = tz;
        urls.add(layer.getTileUrl(c));
        layer._tileZoom = saved;
      }
    }
  }
  const list = [...urls];
  if (list.length > 4000) return alert('Zone trop grande : zoomez davantage.');
  navigator.storage?.persist?.();
  const cache = await caches.open(TILE_CACHE);
  const prog = $('#offline-progress');
  prog.hidden = false;
  prog.max = list.length;
  prog.value = 0;
  let i = 0, ok = 0;
  const worker = async () => {
    while (i < list.length) {
      const u = list[i++];
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: 'cors' });
          if (r.ok) await cache.put(u, r);
        }
        ok++;
      } catch { /* */ }
      prog.value++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  prog.hidden = true;
  $('#offline-status').textContent = `✔ Zone enregistrée (${ok} images de carte).`;
});

/* ------------------------------------------------------------------ */

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3500);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Mise à jour automatique : dès qu'une nouvelle version est publiée, on recharge une fois.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!hadController || reloading) return;
    reloading = true;
    await saveNow();
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Plan partagé par QR code (lecture seule, avec position GPS)          */
/* ------------------------------------------------------------------ */

let viewer = null;

const CAPS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
/** Où est la personne par rapport à la parcelle (calcul en LV95). */
function situation(ll, ring) {
  const P = wgs84ToLV95(ll.lat, ll.lng);
  const pts = ring.map(([lat, lng]) => wgs84ToLV95(lat, lng));
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.N > P.N) !== (b.N > P.N) && P.E < ((b.E - a.E) * (P.N - a.N)) / (b.N - a.N) + a.E) inside = !inside;
  }
  if (inside) return { inside: true };
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.E - a.E, dy = b.N - a.N;
    const t = Math.max(0, Math.min(1, ((P.E - a.E) * dx + (P.N - a.N) * dy) / (dx * dx + dy * dy || 1)));
    const q = { E: a.E + t * dx, N: a.N + t * dy };
    const d = Math.hypot(q.E - P.E, q.N - P.N);
    if (!best || d < best.d) best = { d, q };
  }
  const cap = ((Math.atan2(best.q.E - P.E, best.q.N - P.N) * 180) / Math.PI + 360) % 360;
  return { inside: false, d: best.d, dir: CAPS[Math.round(cap / 45) % 8] };
}

async function openViewer(plan) {
  document.body.classList.add('viewer');
  $('#chantier-name').textContent = plan.info.name || 'Plan de coupe';
  const g = L.featureGroup().addTo(map);
  if (plan.parcel) {
    L.polygon(plan.parcel, PARCEL_STYLE_OUTLINE).addTo(g);
    L.polygon(plan.parcel, { ...PARCEL_STYLE, interactive: false }).addTo(g);
  }
  for (const s of plan.symbols) symbolLayer(s, { interactive: false })?.addTo(g);
  if (g.getLayers().length) map.fitBounds(g.getBounds().pad(0.15));
  const bar = document.createElement('div');
  bar.className = 'viewer-bar';
  bar.innerHTML = `<div><b>Plan de coupe</b> · lecture seule<div id="viewer-pos">Recherche de votre position GPS…</div></div>
    <button type="button" id="viewer-exit">Quitter</button>`;
  document.body.appendChild(bar);
  $('#viewer-exit').addEventListener('click', () => {
    location.hash = '';
    location.reload();
  });
  viewer = {
    onFix(ll, acc, first) {
      if (first) map.fitBounds(g.getBounds().extend(ll).pad(0.15));
      else if (follow) map.panTo(ll);
      let txt = `Précision ±${Math.round(acc)} m`;
      if (plan.parcel) {
        const r = situation(ll, plan.parcel);
        txt = r.inside
          ? `<b class="ok">Vous êtes dans la parcelle</b> · ${txt}`
          : `Parcelle à <b>${r.d >= 1000 ? `${(r.d / 1000).toFixed(1)} km` : `${Math.round(r.d)} m`}</b> direction <b>${r.dir}</b> · ${txt}`;
      }
      $('#viewer-pos').innerHTML = txt;
    },
  };
  follow = false;
  startGps();
  follow = false;
}

(async () => {
  if (/plan=/.test(location.hash)) {
    try {
      const plan = await readPlan(location.hash);
      if (plan) return openViewer(plan);
    } catch (e) {
      console.error(e);
      alert('Ce QR code ne contient pas un plan lisible.');
    }
  }
  const id = localStorage.getItem(ACTIVE);
  let c = id && (await db.get(id));
  if (!c) c = (await db.list()).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0];
  if (!c) {
    c = newChantier('Mon chantier');
    await db.put(c);
  }
  await openChantier(c);
  if (!chantier.parcel) openStep('parcelle');
})().catch((e) => {
  console.error(e);
  alert(`Erreur au démarrage : ${e.message}`);
});
