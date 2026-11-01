// Relevé Forestier — application principale.

import {
  BASE_LAYERS, OVERLAY_LAYERS, WMS_URL, OVERLAY_ATTRIBUTION, legendUrl,
  FEATURE_TYPES, CHANTIER_FIELDS, SECURITE_FIELDS, COUPE_FIELDS,
} from './config.js';
import { db, newChantier, uid } from './db.js';
import { renderForm, applyDefaults, esc } from './forms.js';
import {
  wgs84ToLV95, formatLV95, parseCoordinates, polygonArea, pathLength, flatLatLngs,
  formatArea, formatLength, treeVolume, bearingLabel,
} from './swiss.js';
import { openReport } from './report.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ------------------------------------------------------------------ */
/* Carte                                                               */
/* ------------------------------------------------------------------ */

const SWISS_BOUNDS = L.latLngBounds([45.6, 5.7], [47.95, 10.7]);

const map = L.map('map', {
  center: [46.8, 8.2],
  zoom: 8,
  minZoom: 7,
  maxZoom: 21,
  maxBounds: SWISS_BOUNDS.pad(0.3),
  zoomControl: false,
  attributionControl: true,
});
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

const LAYER_STATE_KEY = 'rf-layers';
const layerState = Object.assign(
  { base: BASE_LAYERS[0].id, overlays: {}, custom: [] },
  JSON.parse(localStorage.getItem(LAYER_STATE_KEY) || '{}'),
);
const saveLayerState = () => localStorage.setItem(LAYER_STATE_KEY, JSON.stringify(layerState));

const baseLayers = {};
for (const b of BASE_LAYERS) {
  baseLayers[b.id] = L.tileLayer(b.url, {
    maxNativeZoom: b.maxNativeZoom,
    maxZoom: 21,
    attribution: b.attribution,
    crossOrigin: 'anonymous',
    bounds: b.id === 'osm' ? undefined : SWISS_BOUNDS.pad(0.2),
  });
}

const overlayLayers = {};
function makeOverlay(id) {
  return L.tileLayer.wms(WMS_URL, {
    layers: id,
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    tileSize: 512,
    maxZoom: 21,
    attribution: OVERLAY_ATTRIBUTION,
    crossOrigin: 'anonymous',
    bounds: SWISS_BOUNDS.pad(0.1),
    lang: 'fr',
  });
}
const allOverlayDefs = () => [...OVERLAY_LAYERS, ...layerState.custom.map((c) => ({ ...c, group: 'Mes couches', custom: true }))];

function setBase(id) {
  if (!baseLayers[id]) id = BASE_LAYERS[0].id;
  for (const [k, l] of Object.entries(baseLayers)) if (k !== id && map.hasLayer(l)) map.removeLayer(l);
  baseLayers[id].addTo(map).bringToBack();
  layerState.base = id;
  saveLayerState();
}

function setOverlay(id, on, opacity) {
  if (on) {
    if (!overlayLayers[id]) overlayLayers[id] = makeOverlay(id);
    overlayLayers[id].setOpacity(opacity).addTo(map);
    layerState.overlays[id] = opacity;
  } else {
    if (overlayLayers[id]) map.removeLayer(overlayLayers[id]);
    delete layerState.overlays[id];
  }
  saveLayerState();
}

function renderLayerPanel() {
  $('#base-layers').innerHTML = BASE_LAYERS.map((b) => `
    <label class="layer-item"><input type="radio" name="base" value="${b.id}" ${layerState.base === b.id ? 'checked' : ''}> ${esc(b.label)}</label>`).join('');
  $$('#base-layers input').forEach((r) => r.addEventListener('change', () => setBase(r.value)));

  const defs = allOverlayDefs();
  const groups = [...new Set(defs.map((d) => d.group))];
  $('#overlay-layers').innerHTML = groups.map((g) => `
    <div class="layer-group"><h4>${esc(g)}</h4>
    ${defs.filter((d) => d.group === g).map((d) => {
      const on = d.id in layerState.overlays;
      const op = on ? layerState.overlays[d.id] : d.opacity ?? 0.7;
      return `<div class="layer-item overlay" data-id="${esc(d.id)}">
        <label><input type="checkbox" ${on ? 'checked' : ''}> ${esc(d.label)}</label>
        <input type="range" min="0.1" max="1" step="0.05" value="${op}" title="Transparence" aria-label="Opacité ${esc(d.label)}">
        <a href="${legendUrl(d.id)}" target="_blank" rel="noopener" title="Légende" class="legend">ⓘ</a>
        ${d.custom ? '<button type="button" class="remove" title="Retirer cette couche">×</button>' : ''}
      </div>`;
    }).join('')}</div>`).join('');

  $$('#overlay-layers .overlay').forEach((row) => {
    const id = row.dataset.id;
    const cb = row.querySelector('input[type=checkbox]');
    const range = row.querySelector('input[type=range]');
    cb.addEventListener('change', () => setOverlay(id, cb.checked, Number(range.value)));
    range.addEventListener('input', () => {
      if (cb.checked) setOverlay(id, true, Number(range.value));
    });
    row.querySelector('.remove')?.addEventListener('click', () => {
      setOverlay(id, false);
      layerState.custom = layerState.custom.filter((c) => c.id !== id);
      saveLayerState();
      renderLayerPanel();
    });
  });
}

$('#custom-layer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#custom-layer-id').value.trim();
  const label = $('#custom-layer-label').value.trim() || id;
  if (!id || allOverlayDefs().some((d) => d.id === id)) return;
  layerState.custom.push({ id, label, opacity: 0.7 });
  setOverlay(id, true, 0.7);
  e.target.reset();
  renderLayerPanel();
  toast(`Couche « ${label} » ajoutée`);
});

setBase(layerState.base);
for (const [id, op] of Object.entries(layerState.overlays)) setOverlay(id, true, op);
renderLayerPanel();

/* ------------------------------------------------------------------ */
/* Objets relevés                                                      */
/* ------------------------------------------------------------------ */

const featureGroup = L.featureGroup().addTo(map);
let chantier = null;
let currentTool = null;

map.pm.setLang('fr');
map.pm.setGlobalOptions({
  layerGroup: featureGroup,
  snappable: true,
  snapDistance: 15,
  allowSelfIntersection: false,
});

function markerIcon(type, props = {}) {
  switch (type) {
    case 'arbre': {
      const has = props.direction !== '' && props.direction != null && !isNaN(props.direction);
      const arrow = has
        ? `<g transform="rotate(${Number(props.direction)} 18 18)"><line x1="18" y1="18" x2="18" y2="3" stroke="#e65100" stroke-width="3"/><path d="M18 0 L23 8 L13 8 Z" fill="#e65100"/></g>`
        : '';
      const label = props.numero ? `<span class="tree-num">${esc(props.numero)}</span>` : '';
      return L.divIcon({
        className: 'mk mk-arbre',
        html: `<svg width="36" height="36" viewBox="0 0 36 36">${arrow}<circle cx="18" cy="18" r="7" fill="#2e7d32" stroke="#fff" stroke-width="2"/></svg>${label}`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
    }
    case 'secours':
      return L.divIcon({ className: 'mk mk-secours', html: '<span>✚</span>', iconSize: [30, 30], iconAnchor: [15, 15] });
    case 'depot':
      return L.divIcon({ className: 'mk mk-depot', html: '<span>▤</span>', iconSize: [28, 28], iconAnchor: [14, 14] });
    default:
      return L.divIcon({ className: 'mk mk-note', html: '<span>✎</span>', iconSize: [28, 28], iconAnchor: [14, 28] });
  }
}

function styleFor(type) {
  return FEATURE_TYPES[type]?.style || {};
}

function featureLabel(props) {
  return props.nom || props.numero || props.titre || props.categorie || props.danger || '';
}

/** Initialise une couche Leaflet comme objet du chantier. */
function initFeatureLayer(layer, type, props = {}) {
  props = { ...props, id: props.id || uid(), type };
  applyDefaults(FEATURE_TYPES[type].fields, props);
  layer.feature = { type: 'Feature', properties: props };
  if (layer instanceof L.Marker) layer.setIcon(markerIcon(type, props));
  else layer.setStyle(styleFor(type));
  refreshLabel(layer);
  return layer;
}

function refreshLabel(layer) {
  const p = layer.feature.properties;
  layer.unbindTooltip();
  if (layer instanceof L.Marker) {
    if (p.type !== 'arbre') {
      const label = featureLabel(p);
      if (label) layer.bindTooltip(esc(label), { direction: 'top', offset: [0, -14] });
    }
    return;
  }
  if (p.type === 'parcelle' || p.type === 'zone_coupe') {
    const label = featureLabel(p);
    const m = p.type === 'parcelle' ? formatArea(polygonArea(layer)).split(' (')[0] : '';
    const text = [label, m].filter(Boolean).join(' · ');
    if (text) layer.bindTooltip(esc(text), { permanent: true, direction: 'center', className: 'feat-label' });
  }
}

function measureOf(layer) {
  const t = FEATURE_TYPES[layer.feature.properties.type];
  if (t.shape === 'Polygon') {
    const ll = flatLatLngs(layer);
    return `${formatArea(polygonArea(layer))} · périm. ${formatLength(pathLength(ll, true))}`;
  }
  if (t.shape === 'Line') return formatLength(pathLength(flatLatLngs(layer)));
  return '';
}

function layerCoord(layer) {
  const c = layer instanceof L.Marker ? layer.getLatLng() : layer.getBounds().getCenter();
  return formatLV95(c.lat, c.lng);
}

function loadFeatures(fc) {
  featureGroup.clearLayers();
  for (const f of fc?.features || []) addGeoJSONFeature(f);
}

function guessType(geomType) {
  if (/Polygon/.test(geomType)) return 'parcelle';
  if (/LineString/.test(geomType)) return 'piste';
  return 'note';
}

function addGeoJSONFeature(f) {
  if (!f?.geometry) return null;
  const props = { ...(f.properties || {}) };
  let type = FEATURE_TYPES[props.type] ? props.type : guessType(f.geometry.type);
  if (f.geometry.type === 'MultiPoint' || f.geometry.type === 'GeometryCollection') return null;
  const layer = L.GeoJSON.geometryToLayer(f, {
    pointToLayer: (_, latlng) => L.marker(latlng),
  });
  if (!props.id || featureGroup.getLayers().some((l) => l.feature.properties.id === props.id)) props.id = uid();
  // Ne pas écraser le type métier si l'import n'en a pas
  if (FEATURE_TYPES[type].shape === 'Marker' && !(layer instanceof L.Marker)) type = guessType(f.geometry.type);
  initFeatureLayer(layer, type, props);
  featureGroup.addLayer(layer);
  return layer;
}

function exportFeatures() {
  return {
    type: 'FeatureCollection',
    features: featureGroup.getLayers().map((l) => {
      const gj = l.toGeoJSON(7);
      gj.properties = { ...l.feature.properties };
      return gj;
    }),
  };
}

/* Barre d'outils de dessin ------------------------------------------ */

function buildToolbar() {
  const tb = $('#toolbar');
  tb.innerHTML = '';
  for (const [type, t] of Object.entries(FEATURE_TYPES)) {
    const b = document.createElement('button');
    b.dataset.tool = type;
    b.innerHTML = `<span class="ico">${t.icon}</span><span class="lbl">${esc(t.label)}</span>`;
    b.title = `Dessiner : ${t.label}`;
    b.addEventListener('click', () => selectTool(currentTool === type ? null : type));
    tb.appendChild(b);
  }
  const edit = document.createElement('button');
  edit.dataset.tool = '__edit';
  edit.innerHTML = '<span class="ico">✥</span><span class="lbl">Modifier formes</span>';
  edit.title = 'Déplacer / modifier les sommets des objets';
  edit.addEventListener('click', () => selectTool(currentTool === '__edit' ? null : '__edit'));
  tb.appendChild(edit);
}

function selectTool(type) {
  map.pm.disableDraw();
  if (map.pm.globalEditModeEnabled()) map.pm.disableGlobalEditMode();
  infoMode(false);
  currentTool = type;
  $$('#toolbar button').forEach((b) => b.classList.toggle('active', b.dataset.tool === type));
  if (!type) return;
  if (type === '__edit') {
    map.pm.enableGlobalEditMode({ allowSelfIntersection: false });
    toast('Mode modification : déplacez les sommets ou les points. Re-cliquez sur l\'outil pour terminer.');
    return;
  }
  const t = FEATURE_TYPES[type];
  const opts = {
    continueDrawing: type === 'arbre',
    pathOptions: t.style,
    templineStyle: { color: t.style?.color },
    hintlineStyle: { color: t.style?.color, dashArray: '5 5' },
  };
  if (t.shape === 'Marker') opts.markerStyle = { icon: markerIcon(type, {}) };
  map.pm.enableDraw(t.shape, opts);
  const hint = t.shape === 'Marker'
    ? `Touchez la carte pour placer : ${t.label}${type === 'arbre' ? ' (mode continu)' : ''}`
    : `Dessinez : ${t.label}. Touchez le premier point pour fermer${t.shape === 'Line' ? ' / le dernier point pour terminer' : ''}.`;
  toast(hint);
}

map.on('pm:create', (e) => {
  const type = currentTool && FEATURE_TYPES[currentTool] ? currentTool : guessType(e.shape === 'Marker' ? 'Point' : e.shape === 'Line' ? 'LineString' : 'Polygon');
  initFeatureLayer(e.layer, type, {});
  if (!featureGroup.hasLayer(e.layer)) featureGroup.addLayer(e.layer);
  if (type !== 'arbre') selectTool(null);
  scheduleSave();
  openFeatureDialog(e.layer, true);
});

featureGroup.on('pm:edit pm:dragend pm:markerdragend pm:vertexremoved', (e) => {
  if (e.layer?.feature) refreshLabel(e.layer);
  scheduleSave();
});

featureGroup.on('click', (e) => {
  if (map.pm.globalDrawModeEnabled() || map.pm.globalEditModeEnabled() || infoModeOn) return;
  L.DomEvent.stop(e);
  openFeatureDialog(e.layer);
});

/* Dialogue de propriétés -------------------------------------------- */

const dlgFeature = $('#dlg-feature');
let dlgLayer = null;

function openFeatureDialog(layer, isNew = false) {
  dlgLayer = layer;
  const props = layer.feature.properties;
  const t = FEATURE_TYPES[props.type];
  const measure = measureOf(layer);
  $('#dlg-feature-title').innerHTML = `${t.icon} ${esc(t.label)}${isNew ? ' <small>(nouveau)</small>' : ''}
    <div class="sub">${measure ? `${esc(measure)}<br>` : ''}LV95 ${esc(layerCoord(layer))}</div>`;

  const typeSel = document.createElement('div');
  typeSel.className = 'field';
  const compatible = Object.entries(FEATURE_TYPES).filter(([, x]) => x.shape === t.shape);
  if (compatible.length > 1) {
    typeSel.innerHTML = `<label>Type d'objet</label><select>${compatible.map(([k, x]) => `<option value="${k}" ${k === props.type ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`;
    typeSel.querySelector('select').addEventListener('change', (e) => {
      initFeatureLayer(layer, e.target.value, props);
      scheduleSave();
      openFeatureDialog(layer, isNew);
    });
  }
  const body = $('#feature-form');
  const formBox = document.createElement('div');
  renderForm(formBox, t.fields, props, () => {
    if (props.type === 'arbre') layer.setIcon(markerIcon('arbre', props));
    refreshLabel(layer);
    scheduleSave();
  });
  body.innerHTML = '';
  body.append(typeSel, formBox);
  if (!dlgFeature.open) dlgFeature.showModal();
}

dlgFeature.addEventListener('close', () => {
  if (dlgFeature.returnValue === 'delete' && dlgLayer) {
    if (confirm('Supprimer cet objet ?')) {
      featureGroup.removeLayer(dlgLayer);
      scheduleSave();
    }
  }
  dlgFeature.returnValue = '';
  dlgLayer = null;
  renderSide();
});

/* ------------------------------------------------------------------ */
/* Chantiers : chargement / sauvegarde                                 */
/* ------------------------------------------------------------------ */

const ACTIVE_KEY = 'rf-active-chantier';
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
  renderSideDebounced();
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (!chantier) return;
  chantier.features = exportFeatures();
  chantier.updated = new Date().toISOString();
  const c = map.getCenter();
  chantier.view = { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
  try {
    await db.put(chantier);
  } catch (err) {
    console.error(err);
    toast('⚠ Erreur d\'enregistrement : stockage plein ?');
  }
}

async function openChantier(c) {
  if (chantier) await saveNow();
  chantier = c;
  chantier.info ||= {};
  chantier.securite ||= {};
  chantier.coupe ||= {};
  localStorage.setItem(ACTIVE_KEY, c.id);
  loadFeatures(c.features);
  if (c.view) map.setView([c.view.lat, c.view.lng], c.view.zoom);
  else if (featureGroup.getLayers().length) map.fitBounds(featureGroup.getBounds().pad(0.2));
  renderChantierForms();
  renderSide();
}

async function init() {
  buildToolbar();
  const id = localStorage.getItem(ACTIVE_KEY);
  let c = id && (await db.get(id));
  if (!c) {
    const all = await db.list();
    c = all.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0];
  }
  if (!c) {
    c = newChantier('Mon premier chantier');
    await db.put(c);
  }
  await openChantier(c);
}

map.on('moveend', () => {
  if (chantier) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1500);
  }
});
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveNow());

/* Liste des chantiers */
const dlgChantiers = $('#dlg-chantiers');
$('#btn-chantiers').addEventListener('click', async () => {
  await saveNow();
  await renderChantierList();
  dlgChantiers.showModal();
});

async function renderChantierList() {
  const all = (await db.list()).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  const ul = $('#chantier-list');
  ul.innerHTML = all.map((c) => `
    <li class="${c.id === chantier?.id ? 'active' : ''}" data-id="${c.id}">
      <button type="button" class="open"><b>${esc(c.info?.name || 'Sans nom')}</b>
        <small>${esc([c.info?.commune, c.info?.statut].filter(Boolean).join(' · '))} — ${c.features?.features?.length || 0} objets — modifié le ${new Date(c.updated).toLocaleDateString('fr-CH')}</small></button>
      <button type="button" class="dup" title="Dupliquer">⧉</button>
      <button type="button" class="del danger" title="Supprimer">🗑</button>
    </li>`).join('');
  ul.querySelectorAll('li').forEach((li) => {
    const c = all.find((x) => x.id === li.dataset.id);
    li.querySelector('.open').addEventListener('click', async () => {
      dlgChantiers.close();
      await openChantier(await db.get(c.id));
    });
    li.querySelector('.dup').addEventListener('click', async () => {
      const copy = structuredClone(c);
      copy.id = uid();
      copy.info.name = `${c.info?.name || 'Chantier'} (copie)`;
      copy.created = copy.updated = new Date().toISOString();
      await db.put(copy);
      renderChantierList();
    });
    li.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(`Supprimer définitivement le chantier « ${c.info?.name} » et toutes ses données ?`)) return;
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

$('#btn-new-chantier').addEventListener('click', async () => {
  const name = prompt('Nom du nouveau chantier :', '');
  if (name === null) return;
  const c = newChantier(name || 'Nouveau chantier');
  c.view = { ...map.getCenter(), zoom: map.getZoom() };
  await db.put(c);
  dlgChantiers.close();
  await openChantier(c);
  showPanel(true);
  showTab('chantier');
});

/* ------------------------------------------------------------------ */
/* Panneau latéral                                                     */
/* ------------------------------------------------------------------ */

function showPanel(on) {
  document.body.classList.toggle('panel-open', on);
  setTimeout(() => map.invalidateSize(), 250);
}
$('#btn-menu').addEventListener('click', () => showPanel(!document.body.classList.contains('panel-open')));
if (window.matchMedia('(min-width: 900px)').matches) showPanel(true);

function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel-body > section').forEach((s) => s.classList.toggle('active', s.dataset.panel === name));
  if (name === 'securite') renderSecurite();
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

function renderChantierForms() {
  renderForm($('#form-chantier'), CHANTIER_FIELDS, chantier.info, (key) => {
    if (key === 'name') $('#chantier-name').textContent = chantier.info.name || 'Chantier';
    scheduleSave();
  });
  $('#chantier-name').textContent = chantier.info.name || 'Chantier';
  renderSecurite();
  renderForm($('#form-coupe'), COUPE_FIELDS, chantier.coupe, () => {
    scheduleSave();
  });
}

function renderSecurite() {
  if (!chantier) return;
  renderForm($('#form-securite'), SECURITE_FIELDS, chantier.securite, () => scheduleSave(), {
    secoursText: () => {
      const pts = featureGroup.getLayers().filter((l) => l.feature.properties.type === 'secours');
      if (!pts.length) return 'Aucun point défini — utilisez l\'outil « ✚ Point de secours » sur la carte.';
      return pts.map((l) => `${l.feature.properties.categorie || 'Point'} : LV95 ${layerCoord(l)}`).join('\n');
    },
  });
}

function computeStats() {
  const f = Number(chantier.coupe.facteur_forme) || 0.45;
  const hDef = Number(chantier.coupe.hauteur_defaut) || 0;
  const features = [];
  const trees = [];
  let areaParcelles = 0, areaCoupe = 0, lengthPistes = 0, volume = 0;
  for (const l of featureGroup.getLayers()) {
    const p = l.feature.properties;
    const item = { type: p.type, props: p, layer: l, measure: measureOf(l), coord: layerCoord(l) };
    features.push(item);
    if (p.type === 'parcelle') areaParcelles += polygonArea(l);
    if (p.type === 'zone_coupe') areaCoupe += polygonArea(l);
    if (p.type === 'piste') lengthPistes += pathLength(flatLatLngs(l));
    if (p.type === 'arbre') {
      const v = treeVolume(Number(p.dhp), Number(p.hauteur) || hDef, f);
      trees.push({ ...item, volume: v });
      volume += v;
    }
  }
  const byEss = {};
  for (const t of trees) {
    const k = t.props.essence || '(non précisée)';
    byEss[k] ||= { essence: k, count: 0, volume: 0, dhpSum: 0, dhpN: 0 };
    byEss[k].count++;
    byEss[k].volume += t.volume;
    if (t.props.dhp) { byEss[k].dhpSum += Number(t.props.dhp); byEss[k].dhpN++; }
  }
  const recap = Object.values(byEss).map((r) => ({ ...r, dhpMoy: r.dhpN ? r.dhpSum / r.dhpN : 0 })).sort((a, b) => b.volume - a.volume);
  const order = Object.keys(FEATURE_TYPES);
  features.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  trees.sort((a, b) => String(a.props.numero || '').localeCompare(String(b.props.numero || ''), 'fr', { numeric: true }));
  return { features, trees, recap, volume, areaParcelles, areaCoupe, lengthPistes };
}

let sideTimer = null;
function renderSideDebounced() {
  clearTimeout(sideTimer);
  sideTimer = setTimeout(renderSide, 300);
}

function renderSide() {
  if (!chantier) return;
  const s = computeStats();
  const count = (t) => s.features.filter((x) => x.type === t).length;
  $('#chantier-summary').innerHTML = `
    <div><b>${formatArea(s.areaParcelles)}</b><span>Parcelles (${count('parcelle')})</span></div>
    <div><b>${formatArea(s.areaCoupe).split(' (')[0]}</b><span>Surface de coupe</span></div>
    <div><b>${s.trees.length}</b><span>Arbres martelés</span></div>
    <div><b>${s.volume.toFixed(1)} m³</b><span>Volume indicatif</span></div>
    <div><b>${formatLength(s.lengthPistes)}</b><span>Pistes / layons</span></div>
    <div><b>${count('zone_danger') + count('ligne_danger')}</b><span>Dangers signalés</span></div>`;

  const list = $('#feature-list');
  list.innerHTML = s.features.length
    ? s.features.map((x, i) => `<li data-i="${i}"><span class="ico">${FEATURE_TYPES[x.type].icon}</span>
        <span class="t">${esc(FEATURE_TYPES[x.type].label)}${featureLabel(x.props) ? ` – ${esc(featureLabel(x.props))}` : ''}</span>
        <small>${esc(x.measure || (x.type === 'arbre' ? [x.props.essence, x.props.dhp && `${x.props.dhp} cm`].filter(Boolean).join(' · ') : ''))}</small></li>`).join('')
    : '<li class="empty">Aucun objet. Choisissez un outil en bas de la carte pour commencer le relevé.</li>';
  list.querySelectorAll('li[data-i]').forEach((li) => li.addEventListener('click', () => focusLayer(s.features[li.dataset.i].layer)));

  $('#coupe-table').innerHTML = s.trees.length
    ? `<table class="tbl"><thead><tr><th>N°</th><th>Essence</th><th>DHP</th><th>H</th><th>m³</th><th>Chute</th></tr></thead><tbody>
      ${s.trees.map((t, i) => `<tr data-i="${i}"><td>${esc(t.props.numero || '')}</td><td>${esc(t.props.essence || '')}</td><td>${t.props.dhp || ''}</td><td>${t.props.hauteur || '<i>déf.</i>'}</td><td>${t.volume ? t.volume.toFixed(2) : ''}</td><td>${esc(bearingLabel(t.props.direction))}</td></tr>`).join('')}
      </tbody></table>`
    : '<p class="hint">Placez les arbres avec l\'outil 🌲 Arbre (mode continu : un arbre par toucher).</p>';
  $$('#coupe-table tr[data-i]').forEach((tr) => tr.addEventListener('click', () => focusLayer(s.trees[tr.dataset.i].layer)));

  $('#coupe-recap').innerHTML = s.recap.length
    ? `<table class="tbl"><thead><tr><th>Essence</th><th>Tiges</th><th>DHP moy.</th><th>m³</th></tr></thead><tbody>
      ${s.recap.map((r) => `<tr><td>${esc(r.essence)}</td><td>${r.count}</td><td>${r.dhpMoy ? r.dhpMoy.toFixed(0) : ''}</td><td>${r.volume.toFixed(2)}</td></tr>`).join('')}
      </tbody><tfoot><tr><th>Total</th><th>${s.trees.length}</th><th></th><th>${s.volume.toFixed(2)}</th></tr></tfoot></table>
      <p class="hint">Volume indicatif = π/4 · DHP² · H · coefficient de forme.</p>`
    : '';
  return s;
}

function focusLayer(layer) {
  if (layer instanceof L.Marker) map.setView(layer.getLatLng(), Math.max(map.getZoom(), 18));
  else map.fitBounds(layer.getBounds().pad(0.3));
  if (window.matchMedia('(max-width: 899px)').matches) showPanel(false);
  setTimeout(() => openFeatureDialog(layer), 300);
}

/* ------------------------------------------------------------------ */
/* Rapport, export, import                                             */
/* ------------------------------------------------------------------ */

$('#btn-report').addEventListener('click', async () => {
  await saveNow();
  openReport(chantier, computeStats());
});

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
const slug = () => (chantier.info.name || 'chantier').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const stripPhotos = (fc) => ({ ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, photos: f.properties.photos?.length ? `${f.properties.photos.length} photo(s)` : undefined } })) });

$('#btn-export-geojson').addEventListener('click', () => {
  download(`${slug()}.geojson`, JSON.stringify(stripPhotos(exportFeatures()), null, 1), 'application/geo+json');
});

$('#btn-export-lv95').addEventListener('click', () => {
  const fc = stripPhotos(exportFeatures());
  const conv = (c) => (typeof c[0] === 'number' ? (({ E, N }) => [Math.round(E * 100) / 100, Math.round(N * 100) / 100])(wgs84ToLV95(c[1], c[0])) : c.map(conv));
  fc.features = fc.features.map((f) => ({ ...f, geometry: { ...f.geometry, coordinates: conv(f.geometry.coordinates) } }));
  fc.crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2056' } };
  download(`${slug()}_lv95.geojson`, JSON.stringify(fc, null, 1), 'application/geo+json');
});

$('#btn-export-kml').addEventListener('click', () => {
  const fc = exportFeatures();
  const xml = (s) => esc(s);
  const coords = (arr) => arr.map((c) => `${c[0]},${c[1]}`).join(' ');
  const geom = (g) => {
    if (g.type === 'Point') return `<Point><coordinates>${g.coordinates.join(',')}</coordinates></Point>`;
    if (g.type === 'LineString') return `<LineString><coordinates>${coords(g.coordinates)}</coordinates></LineString>`;
    if (g.type === 'Polygon') return `<Polygon>${g.coordinates.map((r, i) => `<${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}><LinearRing><coordinates>${coords(r)}</coordinates></LinearRing></${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}>`).join('')}</Polygon>`;
    if (g.type.startsWith('Multi')) return `<MultiGeometry>${g.coordinates.map((c) => geom({ type: g.type.slice(5), coordinates: c })).join('')}</MultiGeometry>`;
    return '';
  };
  const placemarks = fc.features.map((f) => {
    const p = f.properties;
    const desc = Object.entries(p).filter(([k, v]) => !['id', 'photos'].includes(k) && v !== '' && v != null).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n');
    return `<Placemark><name>${xml(`${FEATURE_TYPES[p.type]?.label || p.type} ${featureLabel(p)}`.trim())}</name><description>${xml(desc)}</description>${geom(f.geometry)}</Placemark>`;
  }).join('\n');
  download(`${slug()}.kml`, `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(chantier.info.name)}</name>\n${placemarks}\n</Document></kml>`, 'application/vnd.google-earth.kml+xml');
});

$('#btn-export-backup').addEventListener('click', async () => {
  await saveNow();
  download(`${slug()}_sauvegarde.json`, JSON.stringify({ format: 'releve-forestier', version: 1, chantier }), 'application/json');
});

$('#input-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format === 'releve-forestier' && data.chantier) {
      const c = data.chantier;
      if (await db.get(c.id)) {
        if (!confirm('Ce chantier existe déjà sur cet appareil. L\'importer comme copie ?')) return;
        c.id = uid();
        c.info.name = `${c.info.name} (importé)`;
      }
      await db.put(c);
      await openChantier(c);
      toast('Chantier importé');
    } else if (data.type === 'FeatureCollection' || data.type === 'Feature') {
      const feats = data.type === 'Feature' ? [data] : data.features;
      const lv95 = /2056|21781/.test(JSON.stringify(data.crs || '')) || (feats[0] && JSON.stringify(feats[0].geometry.coordinates).match(/\d{6,7}\./));
      if (lv95) {
        const { lv95ToWgs84 } = await import('./swiss.js');
        const conv = (c) => (typeof c[0] === 'number' ? (({ lat, lng }) => [lng, lat])(lv95ToWgs84(c[0], c[1])) : c.map(conv));
        feats.forEach((f) => (f.geometry.coordinates = conv(f.geometry.coordinates)));
      }
      const added = feats.map(addGeoJSONFeature).filter(Boolean);
      if (added.length) map.fitBounds(L.featureGroup(added).getBounds().pad(0.2));
      scheduleSave();
      toast(`${added.length} objet(s) importé(s) dans le chantier`);
    } else {
      throw new Error('format inconnu');
    }
  } catch (err) {
    console.error(err);
    alert(`Import impossible : ${err.message}`);
  }
});

/* ------------------------------------------------------------------ */
/* Recherche (geo.admin.ch) et coordonnées                              */
/* ------------------------------------------------------------------ */

const searchInput = $('#search-input');
const searchResults = $('#search-results');
let searchTimer = null;
let searchMarker = null;

function showSearchMarker(lat, lng, label) {
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.circleMarker([lat, lng], { radius: 9, color: '#d500f9', weight: 3, fillOpacity: 0.1 }).addTo(map).bindTooltip(label).openTooltip();
  setTimeout(() => searchMarker && map.removeLayer(searchMarker), 30000);
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) {
    searchResults.hidden = true;
    return;
  }
  searchTimer = setTimeout(() => doSearch(q), 300);
});

async function doSearch(q) {
  const items = [];
  const coord = parseCoordinates(q);
  if (coord) items.push({ label: `Coordonnées : ${formatLV95(coord.lat, coord.lng)} (LV95)`, lat: coord.lat, lng: coord.lng, zoom: 17 });
  try {
    const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&sr=4326&lang=fr&limit=8&searchText=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    const json = await res.json();
    for (const r of json.results || []) {
      const a = r.attrs;
      const tmp = document.createElement('div');
      tmp.innerHTML = a.label;
      const zoom = a.origin === 'address' || a.origin === 'parcel' ? 18 : a.origin === 'gazetteer' ? 15 : 13;
      items.push({ label: tmp.textContent, origin: a.origin, lat: a.lat, lng: a.lon, zoom });
    }
  } catch {
    if (!coord) items.push({ label: 'Recherche indisponible hors-ligne (coordonnées LV95 acceptées)', disabled: true });
  }
  const originLabel = { address: 'Adresse', parcel: 'Parcelle', gazetteer: 'Lieu', gg25: 'Commune', district: 'District', kantone: 'Canton', zipcode: 'NPA' };
  searchResults.innerHTML = items.map((it, i) => `<li data-i="${i}" class="${it.disabled ? 'disabled' : ''}">${esc(it.label)}${it.origin ? ` <small>${originLabel[it.origin] || ''}</small>` : ''}</li>`).join('') || '<li class="disabled">Aucun résultat</li>';
  searchResults.hidden = false;
  searchResults.querySelectorAll('li[data-i]').forEach((li) => li.addEventListener('click', () => {
    const it = items[li.dataset.i];
    if (it.disabled) return;
    map.setView([it.lat, it.lng], it.zoom);
    showSearchMarker(it.lat, it.lng, it.label);
    searchResults.hidden = true;
    searchInput.blur();
    if (window.matchMedia('(max-width: 899px)').matches) showPanel(false);
  }));
}

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  searchResults.querySelector('li[data-i]:not(.disabled)')?.click();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-form')) searchResults.hidden = true;
});

const coordsBox = $('#coords');
let gpsAccuracyText = '';
function showCoords(ll, prefix = '') {
  coordsBox.textContent = `${prefix}LV95 ${formatLV95(ll.lat, ll.lng)}${gpsAccuracyText}`;
}
map.on('mousemove', (e) => showCoords(e.latlng));
map.on('moveend', () => showCoords(map.getCenter(), 'Centre · '));

/* Infos point ------------------------------------------------------- */

let infoModeOn = false;
function infoMode(on) {
  infoModeOn = on;
  $('#btn-info').classList.toggle('active', on);
  map.getContainer().classList.toggle('crosshair', on);
}
$('#btn-info').addEventListener('click', () => {
  if (!infoModeOn) selectTool(null);
  infoMode(!infoModeOn);
  if (infoModeOn) toast('Touchez la carte pour obtenir les coordonnées et l\'altitude.');
});

map.on('click', async (e) => {
  if (!infoModeOn) return;
  infoMode(false);
  const { lat, lng } = e.latlng;
  const { E, N } = wgs84ToLV95(lat, lng);
  const body = $('#info-body');
  body.innerHTML = `
    <table class="tbl kv">
      <tr><th>LV95 (E, N)</th><td class="mono">${formatLV95(lat, lng)}</td></tr>
      <tr><th>WGS84</th><td class="mono">${lat.toFixed(6)}, ${lng.toFixed(6)}</td></tr>
      <tr><th>Altitude</th><td id="info-alt">…</td></tr>
    </table>
    <div class="btn-row">
      <button type="button" id="info-copy">Copier LV95</button>
      <a class="btn" target="_blank" rel="noopener" href="https://map.geo.admin.ch/?lang=fr&E=${E.toFixed(1)}&N=${N.toFixed(1)}&zoom=10&crosshair=marker">Ouvrir dans map.geo.admin.ch</a>
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}">Itinéraire</a>
    </div>`;
  $('#info-copy').addEventListener('click', () => navigator.clipboard?.writeText(`${Math.round(E)}, ${Math.round(N)}`).then(() => toast('Coordonnées copiées')));
  $('#dlg-info').showModal();
  try {
    const r = await fetch(`https://api3.geo.admin.ch/rest/services/height?easting=${E.toFixed(1)}&northing=${N.toFixed(1)}&sr=2056`);
    const j = await r.json();
    $('#info-alt').textContent = j.height ? `${Number(j.height).toFixed(1)} m (swissALTI3D)` : '—';
  } catch {
    $('#info-alt').textContent = 'indisponible hors-ligne';
  }
});

/* ------------------------------------------------------------------ */
/* GPS : position et relevé de périmètre                               */
/* ------------------------------------------------------------------ */

let watchId = null;
let gpsMarker = null;
let gpsCircle = null;
let lastFix = null;
let followGps = false;

function startGps() {
  if (watchId != null) return;
  if (!navigator.geolocation) {
    alert('Géolocalisation non disponible.');
    return;
  }
  followGps = true;
  $('#btn-locate').classList.add('active');
  watchId = navigator.geolocation.watchPosition(onFix, (err) => {
    toast(`GPS : ${err.message}`);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}

function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  followGps = false;
  gpsAccuracyText = '';
  $('#btn-locate').classList.remove('active');
  if (gpsMarker) map.removeLayer(gpsMarker);
  if (gpsCircle) map.removeLayer(gpsCircle);
  gpsMarker = gpsCircle = null;
}

function onFix(pos) {
  const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
  const acc = pos.coords.accuracy;
  const first = !lastFix;
  lastFix = { ll, acc, alt: pos.coords.altitude, t: pos.timestamp };
  if (!gpsMarker) {
    gpsCircle = L.circle(ll, { radius: acc, color: '#1976d2', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
    gpsMarker = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: '#1976d2', fillOpacity: 1, interactive: false }).addTo(map);
  } else {
    gpsMarker.setLatLng(ll);
    gpsCircle.setLatLng(ll).setRadius(acc);
  }
  gpsAccuracyText = ` · GPS ±${Math.round(acc)} m`;
  showCoords(ll, 'GPS · ');
  if (first || followGps) map.setView(ll, first ? Math.max(map.getZoom(), 17) : map.getZoom(), { animate: !first });
  if (recorder.active) recorder.onFix(lastFix);
}

map.on('dragstart', () => (followGps = false));

$('#btn-locate').addEventListener('click', () => {
  if (watchId == null) startGps();
  else if (!followGps && lastFix) {
    followGps = true;
    map.setView(lastFix.ll, Math.max(map.getZoom(), 17));
  } else if (!recorder.active) {
    stopGps();
    lastFix = null;
  }
});

const recorder = {
  active: false,
  points: [],
  line: null,
  wakeLock: null,
  async start() {
    selectTool(null);
    this.active = true;
    this.points = [];
    this.line = L.polyline([], { color: '#d500f9', weight: 3, dashArray: '6 6' }).addTo(map);
    this.vertices = L.layerGroup().addTo(map);
    $('#gps-recorder').hidden = false;
    $('#btn-track').classList.add('active');
    startGps();
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* non supporté */ }
    this.update();
  },
  stop() {
    this.active = false;
    if (this.line) map.removeLayer(this.line);
    if (this.vertices) map.removeLayer(this.vertices);
    this.line = this.vertices = null;
    $('#gps-recorder').hidden = true;
    $('#btn-track').classList.remove('active');
    this.wakeLock?.release?.();
    this.wakeLock = null;
  },
  add(fix) {
    this.points.push(fix.ll);
    this.line.addLatLng(fix.ll);
    L.circleMarker(fix.ll, { radius: 4, color: '#d500f9', fillOpacity: 1 }).addTo(this.vertices);
    this.update();
  },
  onFix(fix) {
    this.update();
    if (!$('#gps-auto').checked) return;
    const minDist = Number($('#gps-auto-dist').value) || 5;
    if (fix.acc > 20) return; // précision insuffisante
    const last = this.points[this.points.length - 1];
    if (!last || last.distanceTo(fix.ll) >= minDist) this.add(fix);
  },
  update() {
    const acc = lastFix ? `±${Math.round(lastFix.acc)} m${lastFix.acc > 20 ? ' ⚠ faible' : ''}` : 'recherche…';
    const len = pathLength(this.points);
    $('#gps-rec-stats').textContent = `${this.points.length} points · ${formatLength(len)} · précision ${acc}`;
  },
  finish(kind) {
    const min = kind === 'polygon' ? 3 : 2;
    if (this.points.length < min) {
      alert(`Il faut au moins ${min} points.`);
      return;
    }
    const pts = [...this.points];
    this.stop();
    const layer = kind === 'polygon' ? L.polygon(pts) : L.polyline(pts);
    initFeatureLayer(layer, kind === 'polygon' ? 'parcelle' : 'piste', { remarques: `Relevé GPS du ${new Date().toLocaleString('fr-CH')}` });
    featureGroup.addLayer(layer);
    scheduleSave();
    map.fitBounds(layer.getBounds().pad(0.2));
    openFeatureDialog(layer, true);
  },
};

$('#btn-track').addEventListener('click', () => {
  if (recorder.active) return;
  recorder.start();
  toast('Marchez le long de la limite. Les points sont ajoutés automatiquement.');
});
$('#gps-add-point').addEventListener('click', () => {
  if (!lastFix) return toast('Pas encore de position GPS…');
  recorder.add(lastFix);
});
$('#gps-undo').addEventListener('click', () => {
  if (!recorder.points.length) return;
  recorder.points.pop();
  recorder.line.setLatLngs(recorder.points);
  const vs = recorder.vertices.getLayers();
  recorder.vertices.removeLayer(vs[vs.length - 1]);
  recorder.update();
});
$('#gps-finish-polygon').addEventListener('click', () => recorder.finish('polygon'));
$('#gps-finish-line').addEventListener('click', () => recorder.finish('line'));
$('#gps-cancel').addEventListener('click', () => {
  if (recorder.points.length && !confirm('Abandonner le relevé GPS en cours ?')) return;
  recorder.stop();
});

/* ------------------------------------------------------------------ */
/* Hors-ligne                                                          */
/* ------------------------------------------------------------------ */

const TILE_CACHE = 'rf-tiles-v1';
const MAX_TILES = 4000;

function tileUrlsForView() {
  const bounds = map.getBounds();
  const z0 = map.getZoom();
  const urls = new Set();
  const active = [baseLayers[layerState.base], ...Object.keys(layerState.overlays).map((id) => overlayLayers[id]).filter(Boolean)];
  for (const layer of active) {
    const o = layer.options;
    const tileSize = o.tileSize;
    const maxNative = o.maxNativeZoom ?? 20;
    for (let mapZoom = Math.max(z0, 10); mapZoom <= Math.min(z0 + 3, 19); mapZoom++) {
      // Le niveau de tuile réellement demandé par Leaflet
      const tz = Math.min(mapZoom, maxNative);
      const nw = map.project(bounds.getNorthWest(), tz).divideBy(tileSize).floor();
      const se = map.project(bounds.getSouthEast(), tz).divideBy(tileSize).floor();
      for (let x = nw.x; x <= se.x; x++) {
        for (let y = nw.y; y <= se.y; y++) {
          const coords = L.point(x, y);
          coords.z = tz;
          const saved = layer._tileZoom;
          layer._tileZoom = tz;
          try {
            urls.add(layer.getTileUrl(coords));
          } finally {
            layer._tileZoom = saved;
          }
        }
      }
    }
  }
  return [...urls];
}

$('#btn-offline-download').addEventListener('click', async () => {
  if (!('caches' in window)) return alert('Le cache hors-ligne n\'est pas pris en charge par ce navigateur.');
  if (map.getZoom() < 12) return alert('Zoomez d\'abord sur la zone du chantier (niveau de zoom ≥ 12).');
  const urls = tileUrlsForView();
  if (urls.length > MAX_TILES) return alert(`Zone trop grande (${urls.length} tuiles, max ${MAX_TILES}). Zoomez davantage ou désactivez des couches.`);
  if (!confirm(`Télécharger ${urls.length} tuiles (~${Math.round(urls.length * 0.03)} Mo) pour l'utilisation hors-ligne ?`)) return;
  navigator.storage?.persist?.();
  const cache = await caches.open(TILE_CACHE);
  const prog = $('#offline-progress');
  prog.hidden = false;
  prog.max = urls.length;
  prog.value = 0;
  let ok = 0, fail = 0, i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) throw new Error(res.status);
          await cache.put(url, res);
        }
        ok++;
      } catch {
        fail++;
      }
      prog.value = ok + fail;
      $('#offline-status').textContent = `${ok + fail} / ${urls.length}${fail ? ` (${fail} échecs)` : ''}`;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  prog.hidden = true;
  const est = await navigator.storage?.estimate?.();
  $('#offline-status').textContent = `✔ ${ok} tuiles disponibles hors-ligne${fail ? `, ${fail} échecs` : ''}.${est ? ` Stockage utilisé : ${(est.usage / 1e6).toFixed(0)} Mo.` : ''}`;
});

$('#btn-offline-clear').addEventListener('click', async () => {
  if (!confirm('Supprimer toutes les cartes enregistrées pour le hors-ligne ?')) return;
  await caches.delete(TILE_CACHE);
  $('#offline-status').textContent = 'Cache des cartes vidé.';
});

/* ------------------------------------------------------------------ */
/* Divers                                                              */
/* ------------------------------------------------------------------ */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentTool) selectTool(null);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW', err));
}

init().catch((err) => {
  console.error(err);
  alert(`Erreur au démarrage : ${err.message}`);
});
