// Bois de feu — stock, entrées de bois, commandes et livraisons.
// Triage forestier du Vallon. Toutes les données restent sur l'appareil.

import { db, uid, STORE_NAMES } from './db.js';
import { storePhoto, fillImages, cleanPhotos, photoURL, blobToDataURL, dataURLToBlob } from './photos.js';

// ---------------------------------------------------------------- Constantes

const ETATS = { sec: 'Sec – prêt', sechage: 'En séchage', vert: 'Vert' };
const TYPES = {
  initial: 'Stock ajouté',
  propre: 'Notre façonnage',
  facon: 'Façonnage entreprise',
  achat: 'Achat bois prêt / sec',
  inventaire: 'Correction inventaire',
  livraison: 'Livraison client',
};
const ENTREE_TYPES = ['facon', 'achat', 'propre', 'initial'];
const STATUTS = { a_planifier: 'À planifier', planifiee: 'Planifiée', livree: 'Livrée – à facturer', facturee: 'Facturée' };

const SETTINGS_VERSION = 5;
// Dimensions au sol (m) : caisse = palette EUR, big-bag ≈ 1,2 × 1,2, ballot 1 m (bois cerclé) ≈ une caisse.
const DIMS_DEFAUT = { Caisse: [1.2, 0.8], 'Big-bag': [1.2, 1.2], Ballot: [1.2, 0.8] };
const TOUTES_LONGUEURS = ['1 m', '50 cm', '33 cm', '25 cm'];

// Produits vendus : 1 m en ballots, le reste en big-bags, foyard 25 et 33 aussi en caisses.
function defaultProduits() {
  const out = [];
  const add = (essence, longueurs) => longueurs.forEach((longueur) => {
    out.push({ essence, longueur, contenant: longueur === '1 m' ? 'Ballot' : 'Big-bag' });
    if (essence === 'Fayard' && (longueur === '33 cm' || longueur === '25 cm')) out.push({ essence, longueur, contenant: 'Caisse' });
  });
  add('Fayard', TOUTES_LONGUEURS);
  add('Mélèze', TOUTES_LONGUEURS);
  add('Épicéa', TOUTES_LONGUEURS);
  add('Frêne', ['1 m', '33 cm']);
  add('Feuillus indigènes', ['33 cm']);
  add('Bouleau', ['50 cm']);
  return out;
}

const DEFAULT_CATALOGUE = () => ({
  essences: ['Fayard', 'Mélèze', 'Épicéa', 'Frêne', 'Feuillus indigènes', 'Bouleau'],
  longueurs: [...TOUTES_LONGUEURS],
  contenants: [
    { nom: 'Ballot', unite: 'ballot', steres: 1, dims: [1.2, 0.8] },
    { nom: 'Big-bag', unite: 'bb', steres: 1, dims: [1.2, 1.2] },
    { nom: 'Caisse', unite: 'caisse', steres: 0.75, dims: [1.2, 0.8] },
  ],
  produits: defaultProduits(),
});

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  ...DEFAULT_CATALOGUE(),
  lieux: [{ id: 'zA', nom: 'Zone A' }],
  ecartZones: 0.5, // espace habituel entre deux zones (m)
  livraisons: false, // module commandes / livraisons (désactivé pour l'instant)
  entreprises: [],
  seuils: {},
  triage: { nom: 'Triage forestier du Vallon', adresse: 'Réchy', tel: '', email: '' },
  numero: { annee: new Date().getFullYear(), n: 0 },
};

// ---------------------------------------------------------------- État

const S = {
  settings: null,
  lots: [],
  mvts: [],
  cmds: [],
  view: 'stock',
  fLieu: '',
  fEtat: '',
  showEmpty: false,
  fType: '',
  drawing: null, // zone en cours de dessin sur la carte
  editing: null, // zone dont on corrige le contour
  calibrating: false, // réglage de l'échelle de la photo
  placingGrid: null, // zone en rangées à placer (coin + alignement)
  adjusting: null, // zone en rangées à ajuster
  pas: 0.1,
  base: (() => { try { return localStorage.getItem('bf-base') || 'plan'; } catch { return 'plan'; } })(),
  mapView: null,
};

// ---------------------------------------------------------------- Outils

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = (n) => Math.round(n * 1000) / 1000;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? n : 0; };
const fmtQ = (n) => round(n).toLocaleString('fr-CH', { maximumFractionDigits: 2 });
const fmtCHF = (n) => (n || n === 0) && n !== '' ? `CHF ${Number(n).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const nowISO = () => new Date().toISOString();
const fmtDate = (s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-CH', opts) : '');
const fmtDay = (s) => fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long' });

const pkey = (p) => `${p.essence}|${p.longueur}|${p.contenant}`;
const plabel = (p) => `${p.essence} · ${p.longueur} · ${p.contenant}`;
const unite = (contenant) => (S.settings.contenants.find((c) => c.nom === contenant) || {}).unite || contenant;
const qty = (n, contenant) => `${fmtQ(n)} ${unite(contenant)}`;
const lieuNom = (id) => (S.settings.lieux.find((l) => l.id === id) || {}).nom || '—';
const parseKey = (k) => { const [essence, longueur, contenant] = String(k).split('|'); return { essence, longueur, contenant }; };
const stPar = (contenant) => (S.settings.contenants.find((c) => c.nom === contenant) || {}).steres || 0;
const steres = (n, contenant) => n * stPar(contenant);
const fmtSt = (n, contenant) => (stPar(contenant) && stPar(contenant) !== 1 ? ` (≈ ${fmtQ(steres(n, contenant))} st)` : '');
const snap = (l) => ({ essence: l.essence, longueur: l.longueur, contenant: l.contenant, lieu: l.lieu });

function moisDepuis(date) {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00`);
  const n = new Date();
  const m = (n.getFullYear() - d.getFullYear()) * 12 + (n.getMonth() - d.getMonth()) - (n.getDate() < d.getDate() ? 1 : 0);
  if (m < 1) return 'moins d’1 mois';
  if (m < 24) return `${m} mois`;
  return `${Math.floor(m / 12)} ans ${m % 12 ? `${m % 12} mois` : ''}`.trim();
}

function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('on'), ms);
}

function upsert(arr, o) {
  const i = arr.findIndex((x) => x.id === o.id);
  if (i >= 0) arr[i] = o; else arr.push(o);
}

function options(list, value, { empty } = {}) {
  const vals = list.map((x) => (typeof x === 'string' ? { v: x, t: x } : x));
  if (value && !vals.some((x) => x.v === value)) vals.push({ v: value, t: value });
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '')
    + vals.map((x) => `<option value="${esc(x.v)}"${x.v === value ? ' selected' : ''}>${esc(x.t)}</option>`).join('');
}

const lieuOptions = (v, opts) => options(S.settings.lieux.map((l) => ({ v: l.id, t: l.nom })), v, opts);
const zoneIndex = (id) => { const i = S.settings.lieux.findIndex((z) => z.id === id); return i < 0 ? 999 : i; };
const etatOptions = (v, opts) => options(Object.entries(ETATS).map(([k, t]) => ({ v: k, t })), v, opts);

function produitOptions(value) {
  const list = [...S.settings.produits];
  if (value && !list.some((p) => pkey(p) === value)) list.push(parseKey(value));
  const groups = new Map();
  for (const p of list) {
    if (!groups.has(p.essence)) groups.set(p.essence, []);
    groups.get(p.essence).push(p);
  }
  return [...groups].map(([e, ps]) => `<optgroup label="${esc(e)}">${ps.map((p) => `<option value="${esc(pkey(p))}"${pkey(p) === value ? ' selected' : ''}>${esc(p.essence)} ${esc(p.longueur)} · ${esc(p.contenant)}</option>`).join('')}</optgroup>`).join('');
}

function productSelect(p) {
  const value = p && p.essence ? pkey(p) : (S.settings.produits[0] ? pkey(S.settings.produits[0]) : '');
  return `<label>Produit<select name="produit" class="f-produit" required>${produitOptions(value)}</select></label>`;
}

function formData(form) {
  return Object.fromEntries(new FormData(form));
}

// ---------------------------------------------------------------- Enregistrement

async function saveSettings() { await db.put('kv', { key: 'settings', value: S.settings }); }

async function saveLot(l) {
  l.updated = nowISO();
  await db.put('lots', l);
  upsert(S.lots, l);
}

async function delLot(l) {
  await db.del('lots', l.id);
  S.lots = S.lots.filter((x) => x.id !== l.id);
}

async function saveMvt(m) {
  m.id ||= uid();
  m.ts ||= nowISO();
  m.date ||= today();
  await db.put('mouvements', m);
  upsert(S.mvts, m);
  return m;
}

async function delMvt(m) {
  await db.del('mouvements', m.id);
  S.mvts = S.mvts.filter((x) => x.id !== m.id);
}

async function saveCmd(c) {
  c.updated = nowISO();
  await db.put('commandes', c);
  upsert(S.cmds, c);
}

async function delCmd(c) {
  await db.del('commandes', c.id);
  S.cmds = S.cmds.filter((x) => x.id !== c.id);
}

function usedPhotos() {
  const used = new Set();
  for (const o of [...S.lots, ...S.mvts, ...S.cmds]) for (const id of o.photos || []) used.add(id);
  for (const c of S.cmds) for (const id of c.livraison?.photos || []) used.add(id);
  if (S.settings?.plan?.photo) used.add(S.settings.plan.photo);
  return used;
}

function addEntreprise(nom) {
  nom = (nom || '').trim();
  if (nom && !S.settings.entreprises.includes(nom)) {
    S.settings.entreprises.push(nom);
    S.settings.entreprises.sort((a, b) => a.localeCompare(b, 'fr'));
    saveSettings();
  }
}

// ---------------------------------------------------------------- Zone à prendre / réserve
// Pour chaque produit, un seul lot est « à prendre » (zone en cours). Les autres sont en réserve.
// Quand le lot en cours est vide, on ouvre la réserve suivante : déjà entamée, puis sèche, puis la plus ancienne.

function ordreReserve(lots) {
  return [...lots].sort((a, b) => (a.role === 'prendre' ? 0 : 1) - (b.role === 'prendre' ? 0 : 1)
    || (a.entame ? 0 : 1) - (b.entame ? 0 : 1)
    || (a.etat === 'sec' ? 0 : 1) - (b.etat === 'sec' ? 0 : 1)
    || (a.dateMise || '').localeCompare(b.dateMise || '')
    || zoneIndex(a.lieu) - zoneIndex(b.lieu));
}

const lotCourant = (k) => S.lots.find((l) => pkey(l) === k && l.role === 'prendre' && l.quantite > 0);

async function ensureCourant(k, { announce = true } = {}) {
  const ls = S.lots.filter((l) => pkey(l) === k);
  for (const l of ls) {
    if (l.quantite <= 0 && (l.role === 'prendre' || l.entame)) { l.role = 'reserve'; l.entame = false; await saveLot(l); }
  }
  const courants = ls.filter((l) => l.quantite > 0 && l.role === 'prendre');
  if (courants.length > 1) {
    for (const l of ordreReserve(courants).slice(1)) { l.role = 'reserve'; await saveLot(l); }
    return;
  }
  if (courants.length === 1) return;
  const next = ordreReserve(ls.filter((l) => l.quantite > 0 && l.etat === 'sec'))[0];
  if (next) {
    next.role = 'prendre';
    await saveLot(next);
    if (announce) setTimeout(() => toast(`👉 ${plabel(next)} : prendre maintenant en ${lieuNom(next.lieu)}`, 5000), 2500);
  }
}

async function setCourant(lot) {
  for (const l of S.lots) {
    if (l.id !== lot.id && pkey(l) === pkey(lot) && l.role === 'prendre') { l.role = 'reserve'; await saveLot(l); }
  }
  lot.role = 'prendre';
  await saveLot(lot);
}

// Répartit une quantité sur les lots, dans l'ordre (zone en cours puis réserves).
// `used` mémorise ce qui est déjà pris (plusieurs lignes / commandes).
function allocate(k, q, used = new Map(), forcedId = null) {
  const avail = (l) => round(l.quantite - (used.get(l.id) || 0));
  const cands = forcedId
    ? S.lots.filter((l) => l.id === forcedId)
    : ordreReserve(S.lots.filter((l) => pkey(l) === k && l.quantite > 0 && (l.etat === 'sec' || l.role === 'prendre')));
  const parts = [];
  let rest = round(q);
  for (const l of cands) {
    if (rest <= 0) break;
    const a = avail(l);
    if (a <= 0) continue;
    const t = round(Math.min(a, rest));
    parts.push({ lot: l, q: t });
    used.set(l.id, round((used.get(l.id) || 0) + t));
    rest = round(rest - t);
  }
  return { parts, manque: rest > 0 ? rest : 0 };
}

// ---------------------------------------------------------------- Dialogues

const dlg = () => $('#dlg');

function openDlg(title, body, actions, { wide } = {}) {
  const d = dlg();
  d.className = `dialog${wide ? ' wide' : ''}`;
  d.innerHTML = `<form class="dlg-form" novalidate>
    <header><h2>${esc(title)}</h2><button type="button" class="icon-close" data-close aria-label="Fermer">×</button></header>
    <div class="dialog-body">${body}</div>
    <footer class="row">${actions}</footer></form>`;
  $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => d.close()));
  if (!d.open) d.showModal();
  d.querySelector('.dialog-body').scrollTop = 0;
  fillImages(d);
  return d.querySelector('form');
}

function onSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    try {
      await fn(formData(form));
    } catch (err) {
      console.error(err);
      toast(`Erreur : ${err.message}`);
    }
  });
}

function viewPhoto(id) {
  const v = $('#viewer');
  photoURL(id).then((u) => { $('img', v).src = u; v.showModal(); });
}

// Éditeur de photos (miniatures + bouton appareil photo).
function photoEditor(el, initial = []) {
  const ids = [...initial];
  const render = () => {
    el.innerHTML = ids.map((id, i) => `<div class="ph"><img data-photo="${esc(id)}" alt=""><button type="button" class="ph-x" data-i="${i}" aria-label="Retirer la photo">×</button></div>`).join('')
      + '<label class="ph-add"><span class="ph-ico">📷</span><span>Photo</span><input type="file" accept="image/*" multiple hidden></label>';
    fillImages(el);
  };
  el.addEventListener('click', (e) => {
    const x = e.target.closest('.ph-x');
    if (x) { ids.splice(+x.dataset.i, 1); render(); return; }
    const img = e.target.closest('img[data-photo]');
    if (img) viewPhoto(img.dataset.photo);
  });
  el.addEventListener('change', async (e) => {
    if (e.target.type !== 'file') return;
    const files = [...e.target.files];
    if (!files.length) return;
    toast('Enregistrement de la photo…');
    for (const f of files) {
      try { ids.push(await storePhoto(f)); } catch (err) { toast(`Photo non lisible : ${err.message}`); }
    }
    render();
  });
  render();
  return ids;
}

function photoStrip(ids = []) {
  if (!ids.length) return '';
  return `<div class="strip">${ids.map((id) => `<img data-photo="${esc(id)}" alt="" class="tap-photo">`).join('')}</div>`;
}

document.addEventListener('click', (e) => {
  const img = e.target.closest('img.tap-photo[data-photo]');
  if (img) { e.stopPropagation(); viewPhoto(img.dataset.photo); }
}, true);

// ---------------------------------------------------------------- Calculs de stock

function resume(lieu = '') {
  const map = new Map();
  const get = (p) => {
    const k = pkey(p);
    if (!map.has(k)) map.set(k, { k, p: parseKey(k), total: 0, sec: 0, autre: 0, aLivrer: 0 });
    return map.get(k);
  };
  for (const l of S.lots) {
    if (l.quantite <= 0 || (lieu && l.lieu !== lieu)) continue;
    const r = get(l);
    r.total += l.quantite;
    if (l.etat === 'sec') r.sec += l.quantite; else r.autre += l.quantite;
  }
  if (!lieu) {
    for (const c of S.settings.livraisons ? S.cmds : []) {
      if (c.statut !== 'a_planifier' && c.statut !== 'planifiee') continue;
      for (const li of c.lignes) get(li).aLivrer += num(li.quantite);
    }
    for (const k of Object.keys(S.settings.seuils)) get(parseKey(k));
  }
  const ordre = new Map(S.settings.produits.map((p, i) => [pkey(p), i]));
  return [...map.values()].sort((a, b) => (ordre.get(a.k) ?? 999) - (ordre.get(b.k) ?? 999) || plabel(a.p).localeCompare(plabel(b.p), 'fr'));
}

function alerte(r) {
  const seuil = S.settings.seuils[r.k];
  const reste = r.total - r.aLivrer;
  if (reste < 0) return 'manque';
  if (seuil !== undefined && reste < seuil) return 'bas';
  return '';
}

// ---------------------------------------------------------------- Vue : Stock

function renderStock() {
  const rows = resume(S.fLieu);
  const lots = S.lots
    .filter((l) => (S.showEmpty || l.quantite > 0) && (!S.fLieu || l.lieu === S.fLieu) && (!S.fEtat || l.etat === S.fEtat))
    .sort((a, b) => zoneIndex(a.lieu) - zoneIndex(b.lieu) || plabel(a).localeCompare(plabel(b), 'fr') || (a.dateMise || '').localeCompare(b.dateMise || ''));
  const parLieu = new Map();
  for (const l of lots) {
    if (!parLieu.has(l.lieu)) parLieu.set(l.lieu, []);
    parLieu.get(l.lieu).push(l);
  }
  const nbAlertes = rows.filter(alerte).length;
  const noCmd = S.fLieu || !S.settings.livraisons;
  let totSt = 0;
  let secSt = 0;
  for (const r of rows) { totSt += steres(r.total, r.p.contenant); secSt += steres(r.sec, r.p.contenant); }

  return `
  <div class="filters row">
    <select id="f-lieu" aria-label="Zone">${lieuOptions(S.fLieu, { empty: 'Toutes les zones' })}</select>
    <select id="f-etat" aria-label="État">${etatOptions(S.fEtat, { empty: 'Tous les états' })}</select>
  </div>

  <section class="card">
    <h2>Stock total ${S.fLieu ? `<small>· ${esc(lieuNom(S.fLieu))}</small>` : ''}</h2>
    ${totSt ? `<p class="totst">≈ <b>${fmtQ(totSt)} stères</b>${secSt !== totSt ? ` <span class="muted">dont ${fmtQ(secSt)} st secs</span>` : ''}</p>` : ''}
    ${nbAlertes ? `<p class="alert">⚠ ${nbAlertes} produit${nbAlertes > 1 ? 's' : ''} en stock bas</p>` : ''}
    ${rows.length ? `<table class="sum">
      <thead><tr><th>Produit</th><th>Stock</th>${noCmd ? '' : '<th>À livrer</th><th>Reste</th>'}</tr></thead>
      <tbody>${rows.map((r) => {
        const a = alerte(r);
        const cour = lotCourant(r.k);
        return `<tr data-seuil="${esc(r.k)}" class="${a}">
          <td><b>${esc(r.p.essence)} ${esc(r.p.longueur)}</b> <span class="muted">${esc(r.p.contenant)}</span>
            <div class="tiny">${cour ? `<span class="take">👉 ${esc(lieuNom(cour.lieu))}</span> ` : (r.total ? '<span class="alert-txt">pas de zone à prendre</span> ' : '')}${r.autre ? `<span class="muted">séchage / vert ${fmtQ(r.autre)}</span>` : ''}${S.settings.seuils[r.k] !== undefined ? ` <span class="muted">· alerte sous ${fmtQ(S.settings.seuils[r.k])}</span>` : ''}</div></td>
          <td class="n">${qty(r.total, r.p.contenant)}${noCmd && a ? ' ⚠' : ''}${stPar(r.p.contenant) && stPar(r.p.contenant) !== 1 && r.total ? `<div class="tiny muted">≈ ${fmtQ(steres(r.total, r.p.contenant))} st</div>` : ''}</td>
          ${noCmd ? '' : `<td class="n">${r.aLivrer ? fmtQ(r.aLivrer) : '–'}</td><td class="n"><b>${fmtQ(r.total - r.aLivrer)}</b>${a ? ' ⚠' : ''}</td>`}
        </tr>`;
      }).join('')}</tbody></table>
      <p class="hint">👉 = zone où l’on prend ce bois. Touchez une ligne pour régler un seuil d’alerte.</p>` : '<p class="hint">Aucun bois en stock pour le moment. Ajoutez un lot ci-dessous ou enregistrez une entrée de bois.</p>'}
  </section>

  <div class="row between">
    <h2 class="sec-title">Lots par zone</h2>
    <label class="check"><input type="checkbox" id="f-empty" ${S.showEmpty ? 'checked' : ''}> lots vides</label>
  </div>
  <button class="primary big" id="btn-new-lot">+ Ajouter un lot au stock</button>
  ${[...parLieu.entries()].map(([lieu, ls]) => `
    <h3>📍 ${esc(lieuNom(lieu))}</h3>
    <div class="lots">${ls.map(lotCard).join('')}</div>`).join('') || '<p class="hint">Aucun lot avec ces filtres.</p>'}
  `;
}

function roleBadge(l) {
  if (l.quantite <= 0) return '<span class="badge vide">Vide</span>';
  if (l.role === 'prendre') return '<span class="badge prendre">👉 À prendre</span>';
  return '<span class="badge reserve">Réserve</span>';
}

function lotCard(l) {
  return `<div class="lot ${l.quantite <= 0 ? 'empty' : ''} ${l.role === 'prendre' && l.quantite > 0 ? 'courant' : ''}" data-lot="${esc(l.id)}">
    ${l.photos?.length ? `<img class="thumb" data-photo="${esc(l.photos[0])}" alt="">` : '<div class="thumb ph-none">🪵</div>'}
    <div class="lot-main">
      <b>${esc(l.essence)} ${esc(l.longueur)}</b> <span>${esc(l.contenant)}</span>
      <div class="tiny">${roleBadge(l)}<span class="badge ${l.etat}">${esc(ETATS[l.etat] || l.etat)}</span></div>
      <div class="tiny muted">${l.dateMise ? `depuis ${moisDepuis(l.dateMise)}` : ''}${l.humidite ? ` · ${fmtQ(l.humidite)} % hum.` : ''}${l.photos?.length > 1 ? ` · ${l.photos.length} 📷` : ''}${l.note ? ` · ${esc(l.note)}` : ''}</div>
    </div>
    <div class="qty">
      <button type="button" data-dec aria-label="Moins">−</button>
      <span><b>${fmtQ(l.quantite)}</b><small>${esc(unite(l.contenant))}</small></span>
      <button type="button" data-inc aria-label="Plus">+</button>
    </div>
  </div>`;
}

function bindLots(root) {
  $$('.lot[data-lot]', root).forEach((el) => {
    const lot = S.lots.find((l) => l.id === el.dataset.lot);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-dec]')) quickAdjust(lot, -1);
      else if (e.target.closest('[data-inc]')) quickAdjust(lot, +1);
      else lotDialog(lot);
    });
  });
}

function bindStock(root) {
  $('#f-lieu', root).onchange = (e) => { S.fLieu = e.target.value; render(); };
  $('#f-etat', root).onchange = (e) => { S.fEtat = e.target.value; render(); };
  $('#f-empty', root).onchange = (e) => { S.showEmpty = e.target.checked; render(); };
  $('#btn-new-lot', root).onclick = () => lotDialog(null, { lieu: S.fLieu });
  $$('tr[data-seuil]', root).forEach((tr) => tr.addEventListener('click', () => seuilDialog(tr.dataset.seuil)));
  bindLots(root);
}

// Boutons + / − : correction rapide d'inventaire (regroupée sur 2 minutes).
async function quickAdjust(lot, d) {
  const nq = Math.max(0, round(lot.quantite + d));
  const delta = round(nq - lot.quantite);
  if (!delta) return;
  lot.quantite = nq;
  await saveLot(lot);
  const last = S.mvts.find((m) => m.quick && m.lotId === lot.id && Date.now() - Date.parse(m.ts) < 120000);
  if (last) {
    last.delta = round(last.delta + delta);
    if (!last.delta) await delMvt(last); else await saveMvt(last);
  } else {
    await saveMvt({ type: 'inventaire', lotId: lot.id, delta, quick: true, ...snap(lot) });
  }
  await ensureCourant(pkey(lot));
  render();
}

function seuilDialog(k) {
  const p = parseKey(k);
  const cur = S.settings.seuils[k];
  const form = openDlg('Seuil d’alerte', `
    <p><b>${esc(plabel(p))}</b></p>
    <p class="hint">Une alerte s’affiche quand le stock restant (après les commandes à livrer) passe sous ce seuil.</p>
    <label>Alerte en dessous de (${esc(unite(p.contenant))})<input name="seuil" inputmode="decimal" value="${cur ?? ''}" placeholder="aucune alerte"></label>`,
  '<button type="button" data-close>Annuler</button><span class="spacer"></span><button class="primary">Enregistrer</button>');
  onSubmit(form, async (f) => {
    if (String(f.seuil).trim() === '') delete S.settings.seuils[k];
    else S.settings.seuils[k] = num(f.seuil);
    await saveSettings();
    dlg().close();
    render();
  });
}

function historyList(mvts) {
  if (!mvts.length) return '<p class="hint">Aucun mouvement.</p>';
  return `<ul class="hist">${mvts.sort((a, b) => b.ts.localeCompare(a.ts)).map((m) => `
    <li data-mvt="${esc(m.id)}"><span class="d">${fmtDate(m.date)}</span>
      <span class="t">${esc(TYPES[m.type] || m.type)}${m.entreprise ? ` · ${esc(m.entreprise)}` : ''}${m.client ? ` · ${esc(m.client)}` : ''}${m.note ? `<br><small class="muted">${esc(m.note)}</small>` : ''}</span>
      <span class="q ${m.delta < 0 ? 'neg' : 'pos'}">${m.delta > 0 ? '+' : ''}${qty(m.delta, m.contenant)}</span></li>`).join('')}</ul>`;
}

function lotDialog(lot, defaults = {}) {
  if (!S.settings.lieux.length) { toast('Créez d’abord une zone dans l’onglet Zones', 4000); go('place'); return; }
  const isNew = !lot;
  const s = S.settings;
  const p0 = s.produits[0] || {};
  const l = lot ? { ...lot } : {
    id: uid(), essence: p0.essence, longueur: p0.longueur, contenant: p0.contenant,
    etat: 'sec', lieu: defaults.lieu || s.lieux[0]?.id, quantite: 0, dateMise: today(), photos: [], created: nowISO(), role: 'reserve',
  };
  const roleDefaut = (k, etat) => (lot ? lot.role : (etat === 'sec' && !lotCourant(k) ? 'prendre' : 'reserve'));
  const form = openDlg(isNew ? 'Nouveau lot' : 'Lot de bois', `
    ${productSelect(l)}
    <div class="grid2">
      <label>Zone<select name="lieu">${lieuOptions(l.lieu)}</select></label>
      <label>État<select name="etat">${etatOptions(l.etat)}</select></label>
      <label>Quantité (<span id="u">${esc(unite(l.contenant))}</span>)<input name="quantite" inputmode="decimal" required value="${isNew ? '' : fmtQ(l.quantite).replace(/\s/g, '')}" placeholder="0"></label>
      <label>Mis en tas le<input type="date" name="dateMise" value="${esc(l.dateMise || '')}"></label>
    </div>
    <label>Utilisation<select name="role">
      <option value="prendre">👉 À prendre – c’est ici qu’on se sert</option>
      <option value="reserve">Réserve – ne pas toucher pour l’instant</option></select></label>
    <p class="hint" id="role-hint"></p>
    <div class="grid2">
      <label>Provenance<input name="provenance" value="${esc(l.provenance || '')}" placeholder="coupe, fournisseur…"></label>
      <label>Humidité %<input name="humidite" inputmode="decimal" value="${l.humidite ?? ''}" placeholder="humidimètre"></label>
    </div>
    <label>Remarque<textarea name="note" rows="2">${esc(l.note || '')}</textarea></label>
    <h3>Photos</h3>
    <div class="photos" id="pe"></div>
    ${isNew ? '' : `<h3>Historique du lot</h3>${historyList(S.mvts.filter((m) => m.lotId === l.id))}`}
  `, `${isNew ? '' : '<button type="button" class="danger" id="btn-del">Supprimer</button>'}<span class="spacer"></span>
      <button type="button" data-close>Annuler</button><button class="primary">Enregistrer</button>`);
  const photos = photoEditor($('#pe', form), l.photos);
  const refresh = (first) => {
    const k = form.produit.value;
    $('#u', form).textContent = unite(parseKey(k).contenant);
    if (first) form.role.value = roleDefaut(k, form.etat.value);
    const cour = lotCourant(k);
    $('#role-hint', form).textContent = cour && cour.id !== l.id
      ? `Actuellement on prend ce bois en « ${lieuNom(cour.lieu)} » (${qty(cour.quantite, cour.contenant)}). Choisir « À prendre » mettra l’autre lot en réserve.`
      : '';
  };
  form.produit.addEventListener('change', () => refresh(isNew));
  refresh(true);

  onSubmit(form, async (f) => {
    const oldQ = isNew ? 0 : lot.quantite;
    const oldK = isNew ? null : pkey(lot);
    Object.assign(l, parseKey(f.produit), {
      etat: f.etat, lieu: f.lieu, role: f.role,
      quantite: Math.max(0, round(num(f.quantite))), dateMise: f.dateMise, provenance: f.provenance.trim(),
      humidite: String(f.humidite).trim() ? num(f.humidite) : null, note: f.note.trim(), photos: [...photos],
    });
    if (l.role === 'prendre') await setCourant(l); else await saveLot(l);
    const d = round(l.quantite - oldQ);
    if (d) await saveMvt({ type: isNew ? 'initial' : 'inventaire', lotId: l.id, delta: d, ...snap(l) });
    await ensureCourant(pkey(l), { announce: l.role !== 'prendre' });
    if (oldK && oldK !== pkey(l)) await ensureCourant(oldK);
    dlg().close();
    toast(isNew ? 'Lot ajouté au stock' : 'Lot enregistré');
    render();
  });

  if (!isNew) {
    $('#btn-del', form).onclick = async () => {
      if (!confirm('Supprimer ce lot ? (son historique est conservé)')) return;
      if (lot.quantite > 0) await saveMvt({ type: 'inventaire', lotId: lot.id, delta: -lot.quantite, note: 'Lot supprimé', ...snap(lot) });
      await delLot(lot);
      await ensureCourant(pkey(lot));
      dlg().close();
      cleanPhotos(usedPhotos());
      render();
    };
    $$('li[data-mvt]', form).forEach((li) => li.addEventListener('click', () => openMvt(li.dataset.mvt)));
  }
}

// ---------------------------------------------------------------- Vue : Entrées

function renderEntrees() {
  const entrees = S.mvts.filter((m) => ENTREE_TYPES.includes(m.type)).sort((a, b) => (b.date + b.ts).localeCompare(a.date + a.ts));
  const annee = String(new Date().getFullYear());
  const tot = {};
  for (const m of entrees) {
    if (!m.date.startsWith(annee) || m.type === 'initial') continue;
    const k = `${TYPES[m.type]}|${m.contenant}`;
    tot[k] = (tot[k] || 0) + m.delta;
  }
  return `
  <section class="card">
    <h2>Nouvelle entrée de bois</h2>
    <div class="big-choices">
      <button class="choice" data-entree="facon"><span>🪓</span><b>Façonnage par une entreprise</b><small>l’entreprise externe coupe et fend notre bois</small></button>
      <button class="choice" data-entree="achat"><span>🚚</span><b>Livraison de bois prêt / sec</b><small>bois acheté, déjà prêt</small></button>
      <button class="choice" data-entree="propre"><span>🌲</span><b>Notre propre façonnage</b><small>bois préparé par l’équipe du triage</small></button>
    </div>
  </section>
  ${Object.keys(tot).length ? `<section class="card"><h2>Entrées ${annee}</h2><ul class="plain">${Object.entries(tot).map(([k, v]) => { const [t, c] = k.split('|'); return `<li>${esc(t)} : <b>${qty(v, c)}</b></li>`; }).join('')}</ul></section>` : ''}
  <h2 class="sec-title">Dernières entrées</h2>
  ${entrees.length ? `<div class="list">${entrees.slice(0, 100).map((m) => `
    <div class="item" data-mvt="${esc(m.id)}">
      <div class="item-top"><b>${esc(TYPES[m.type])}</b><span class="q pos">+${qty(m.delta, m.contenant)}</span></div>
      <div>${esc(plabel(m))} · ${esc(ETATS[m.etat] || '')}</div>
      <div class="tiny muted">${fmtDate(m.date)}${m.entreprise ? ` · ${esc(m.entreprise)}` : ''} · 📍 ${esc(lieuNom(m.lieu))}${m.prix ? ` · ${fmtCHF(m.prix)}` : ''}</div>
      ${photoStrip(m.photos)}
    </div>`).join('')}</div>` : '<p class="hint">Aucune entrée enregistrée.</p>'}`;
}

function bindEntrees(root) {
  $$('[data-entree]', root).forEach((b) => b.addEventListener('click', () => entreeDialog(b.dataset.entree)));
  $$('[data-mvt]', root).forEach((el) => el.addEventListener('click', () => openMvt(el.dataset.mvt)));
}

function openMvt(id) {
  const m = S.mvts.find((x) => x.id === id);
  if (!m) return;
  if (ENTREE_TYPES.includes(m.type)) entreeDialog(m.type, m);
  else if (m.type === 'livraison' && m.commandeId && S.cmds.some((c) => c.id === m.commandeId)) cmdDetail(S.cmds.find((c) => c.id === m.commandeId));
  else {
    const lot = S.lots.find((l) => l.id === m.lotId);
    if (lot) lotDialog(lot); else toast('Ce lot a été supprimé');
  }
}

function lotsCompatibles(p, lieu, includeEmpty = false) {
  return S.lots.filter((l) => pkey(l) === pkey(p) && (!lieu || l.lieu === lieu) && (includeEmpty || l.quantite > 0));
}

function entreeDialog(type, mvt) {
  if (!mvt) {
    if (!S.settings.lieux.length) { toast('Créez d’abord une zone dans l’onglet Zones', 4000); go('place'); return; }
  }
  const isNew = !mvt;
  const s = S.settings;
  const m = mvt ? { ...mvt } : {
    type, date: today(), ...(s.produits[0] || {}),
    etat: type === 'achat' ? 'sec' : 'vert', lieu: s.lieux[0]?.id, photos: [],
  };
  const avecEntreprise = type !== 'propre' && type !== 'initial';
  const lot = !isNew && S.lots.find((l) => l.id === m.lotId);
  const form = openDlg(TYPES[type], `
    <div class="grid2">
      <label>Date<input type="date" name="date" required value="${esc(m.date)}"></label>
      ${avecEntreprise ? `<label>${type === 'achat' ? 'Fournisseur' : 'Entreprise'}<input name="entreprise" list="dl-entreprises" value="${esc(m.entreprise || '')}" placeholder="nom"></label>` : ''}
    </div>
    ${isNew ? `${productSelect(m)}
    <div class="grid2">
      <label>État du bois<select name="etat">${etatOptions(m.etat)}</select></label>
      <label>Zone de stockage<select name="lieu">${lieuOptions(m.lieu)}</select></label>
    </div>
    <label>Ajouter à<select name="cible" id="cible"></select></label>`
    : `<p class="box"><b>${esc(plabel(m))}</b> · ${esc(ETATS[m.etat] || '')}<br>📍 ${esc(lieuNom(m.lieu))}${lot ? '' : ' <span class="muted">(lot supprimé)</span>'}</p>`}
    <div class="grid2">
      <label>Quantité (<span id="u">${esc(unite(m.contenant))}</span>)<input name="quantite" inputmode="decimal" required value="${isNew ? '' : fmtQ(m.delta).replace(/\s/g, '')}" placeholder="0"></label>
      <label>${type === 'facon' ? 'Coût façonnage' : 'Prix'} CHF<input name="prix" inputmode="decimal" value="${m.prix ?? ''}" placeholder="facultatif"></label>
    </div>
    <label>Remarque<textarea name="note" rows="2" placeholder="n° de bon, heures, provenance de la coupe…">${esc(m.note || '')}</textarea></label>
    <h3>Photos <small class="muted">(bon de livraison, tas de bois…)</small></h3>
    <div class="photos" id="pe"></div>
  `, `${isNew ? '' : '<button type="button" class="danger" id="btn-del">Supprimer</button>'}<span class="spacer"></span>
      <button type="button" data-close>Annuler</button><button class="primary">Enregistrer</button>`);
  const photos = photoEditor($('#pe', form), m.photos);

  const refreshCible = () => {
    if (!isNew) return;
    const p = parseKey(form.produit.value);
    const ls = lotsCompatibles(p, form.lieu.value);
    $('#cible', form).innerHTML = '<option value="">Nouveau lot dans cette zone (en réserve)</option>'
      + ls.map((l) => `<option value="${esc(l.id)}">Lot existant : ${l.role === 'prendre' ? '👉 à prendre' : 'réserve'}, ${esc(ETATS[l.etat])}, ${qty(l.quantite, l.contenant)}${l.dateMise ? `, du ${fmtDate(l.dateMise)}` : ''}</option>`).join('');
    $('#u', form).textContent = unite(p.contenant);
  };
  if (isNew) {
    ['produit', 'lieu'].forEach((n) => form[n].addEventListener('change', refreshCible));
    refreshCible();
  }

  onSubmit(form, async (f) => {
    const q = round(num(f.quantite));
    if (q <= 0) { toast('Indiquez une quantité'); return; }
    const common = {
      date: f.date, entreprise: (f.entreprise || '').trim(), prix: String(f.prix ?? '').trim() ? num(f.prix) : null,
      note: f.note.trim(), photos: [...photos],
    };
    if (avecEntreprise) addEntreprise(common.entreprise);
    if (isNew) {
      let target = f.cible && S.lots.find((l) => l.id === f.cible);
      if (target) {
        target.quantite = round(target.quantite + q);
        target.photos = [...new Set([...(target.photos || []), ...photos])];
      } else {
        target = {
          id: uid(), ...parseKey(f.produit), etat: f.etat, lieu: f.lieu, role: 'reserve',
          quantite: q, dateMise: f.date, provenance: [TYPES[type], common.entreprise].filter(Boolean).join(' – '),
          photos: [...photos], note: '', created: nowISO(),
        };
      }
      await saveLot(target);
      await saveMvt({ type, lotId: target.id, delta: q, etat: target.etat, ...snap(target), ...common });
      toast(`+${qty(q, target.contenant)} ajouté au stock (${lieuNom(target.lieu)})`);
      await ensureCourant(pkey(target));
    } else {
      const d = round(q - mvt.delta);
      if (lot && d) { lot.quantite = Math.max(0, round(lot.quantite + d)); await saveLot(lot); await ensureCourant(pkey(lot)); }
      await saveMvt({ ...mvt, ...common, delta: q });
      toast('Entrée modifiée');
    }
    dlg().close();
    cleanPhotos(usedPhotos());
    render();
  });

  if (!isNew) {
    $('#btn-del', form).onclick = async () => {
      if (!confirm(`Supprimer cette entrée ?${lot ? `\nLe stock du lot sera diminué de ${qty(mvt.delta, mvt.contenant)}.` : ''}`)) return;
      if (lot) { lot.quantite = Math.max(0, round(lot.quantite - mvt.delta)); await saveLot(lot); await ensureCourant(pkey(lot)); }
      await delMvt(mvt);
      dlg().close();
      cleanPhotos(usedPhotos());
      render();
    };
  }
}

// ---------------------------------------------------------------- Vue : Livraisons

function clientsConnus() {
  const map = new Map();
  for (const c of [...S.cmds].sort((a, b) => (a.created || '').localeCompare(b.created || ''))) {
    if (c.client?.nom) map.set(c.client.nom.trim().toLowerCase(), c.client);
  }
  return map;
}

function cmdCard(c) {
  const late = (c.statut === 'planifiee' && c.datePrevue && c.datePrevue < today());
  return `<div class="item cmd ${c.statut} ${late ? 'late' : ''}" data-cmd="${esc(c.id)}">
    <div class="item-top"><b>${esc(c.client?.nom || 'Client')}</b><span class="muted">n° ${esc(c.numero)}</span></div>
    <div>${c.lignes.map((li) => `${qty(num(li.quantite), li.contenant)} ${esc(li.essence)} ${esc(li.longueur)}`).join(' + ')}</div>
    <div class="tiny muted">${c.client?.adresse ? `📍 ${esc(c.client.adresse.split('\n').join(', '))}` : ''}${c.datePrevue && c.statut !== 'livree' && c.statut !== 'facturee' ? ` · 📅 ${fmtDate(c.datePrevue)}` : ''}${c.livraison ? ` · livré le ${fmtDate(c.livraison.date)}` : ''}${c.prix ? ` · ${fmtCHF(c.prix)}` : ''}</div>
    ${late ? '<div class="tiny alert-txt">En retard</div>' : ''}
  </div>`;
}

function tourneeURL(cmds) {
  const adr = cmds.map((c) => (c.client?.adresse || '').replace(/\n/g, ', ').trim()).filter(Boolean);
  if (!adr.length) return '';
  const dest = adr[adr.length - 1];
  const way = adr.slice(0, -1);
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(dest)}${way.length ? `&waypoints=${encodeURIComponent(way.join('|'))}` : ''}`;
}

function renderLivraisons() {
  const by = (st) => S.cmds.filter((c) => c.statut === st);
  const aPlan = by('a_planifier').sort((a, b) => (a.created || '').localeCompare(b.created || ''));
  const plan = by('planifiee').sort((a, b) => (a.datePrevue || '').localeCompare(b.datePrevue || '') || (a.ordre || 0) - (b.ordre || 0));
  const livrees = by('livree').sort((a, b) => (b.livraison?.date || '').localeCompare(a.livraison?.date || ''));
  const fact = by('facturee').sort((a, b) => (b.livraison?.date || '').localeCompare(a.livraison?.date || ''));
  const jours = new Map();
  for (const c of plan) {
    if (!jours.has(c.datePrevue)) jours.set(c.datePrevue, []);
    jours.get(c.datePrevue).push(c);
  }
  return `
  <button class="primary big" id="btn-new-cmd">+ Nouvelle commande</button>

  <h2 class="sec-title">Planning des livraisons</h2>
  ${jours.size ? [...jours.entries()].map(([d, cs]) => {
    const url = tourneeURL(cs);
    let tot = {};
    for (const c of cs) for (const li of c.lignes) tot[li.contenant] = (tot[li.contenant] || 0) + num(li.quantite);
    return `<div class="day ${d < today() ? 'late' : ''} ${d === today() ? 'today' : ''}">
      <div class="day-head"><b>${d === today() ? 'Aujourd’hui · ' : ''}${esc(fmtDay(d))}</b>
        <span class="tiny muted">${cs.length} livraison${cs.length > 1 ? 's' : ''} · ${Object.entries(tot).map(([c, n]) => qty(n, c)).join(', ')}</span>
        <span class="day-btns"><button type="button" class="small" data-charge="${esc(d)}">📋 Chargement</button>
        ${url ? `<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">🗺 Tournée</a>` : ''}</span></div>
      <div class="list">${cs.map(cmdCard).join('')}</div></div>`;
  }).join('') : '<p class="hint">Aucune livraison planifiée.</p>'}

  ${aPlan.length ? `<h2 class="sec-title">À planifier <small>(${aPlan.length})</small></h2><div class="list">${aPlan.map(cmdCard).join('')}</div>` : ''}
  ${livrees.length ? `<h2 class="sec-title">Livrées – à facturer <small>(${livrees.length})</small></h2><div class="list">${livrees.map(cmdCard).join('')}</div>` : ''}
  ${fact.length ? `<details class="sec-details"><summary>Facturées (${fact.length})</summary><div class="list">${fact.slice(0, 100).map(cmdCard).join('')}</div></details>` : ''}
  `;
}

function bindLivraisons(root) {
  $('#btn-new-cmd', root).onclick = () => cmdDialog();
  $$('[data-charge]', root).forEach((b) => b.addEventListener('click', () => chargementDialog(b.dataset.charge)));
  $$('[data-cmd]', root).forEach((el) => el.addEventListener('click', () => cmdDetail(S.cmds.find((c) => c.id === el.dataset.cmd))));
}

function nextNumero() {
  const y = new Date().getFullYear();
  const n = S.settings.numero || { annee: y, n: 0 };
  if (n.annee !== y) { n.annee = y; n.n = 0; }
  n.n += 1;
  S.settings.numero = n;
  saveSettings();
  return `${y}-${String(n.n).padStart(3, '0')}`;
}

function ligneRow(li = {}) {
  const p = li.essence ? li : (S.settings.produits[0] || {});
  return `<div class="ligne">${productSelect(p)}
    <div class="ligne-q"><label>Quantité<input class="f-q" inputmode="decimal" required value="${li.quantite ?? ''}" placeholder="0"></label>
    <span class="u">${esc(unite(p.contenant))}</span>
    <button type="button" class="danger small" data-rm aria-label="Retirer la ligne">Retirer</button></div></div>`;
}

function cmdDialog(cmd) {
  const isNew = !cmd;
  const c = cmd ? structuredClone(cmd) : { id: uid(), client: {}, lignes: [{}], statut: 'a_planifier', created: nowISO(), photos: [] };
  const clients = clientsConnus();
  const form = openDlg(isNew ? 'Nouvelle commande' : `Commande n° ${c.numero}`, `
    <datalist id="dl-clients">${[...clients.values()].map((cl) => `<option value="${esc(cl.nom)}">`).join('')}</datalist>
    <h3>Client</h3>
    <div class="grid2">
      <label>Nom<input name="nom" list="dl-clients" required value="${esc(c.client.nom || '')}" autocomplete="off"></label>
      <label>Téléphone<input name="tel" type="tel" value="${esc(c.client.tel || '')}"></label>
    </div>
    <label>Adresse de livraison<textarea name="adresse" rows="2" placeholder="Rue, NPA localité">${esc(c.client.adresse || '')}</textarea></label>
    <label>Accès / remarque<input name="acces" value="${esc(c.client.acces || '')}" placeholder="ex. chemin étroit, déposer devant le garage"></label>
    <h3>Bois commandé</h3>
    <div id="lignes">${c.lignes.map(ligneRow).join('')}</div>
    <button type="button" id="add-ligne">+ Ajouter une ligne</button>
    <h3>Livraison</h3>
    <div class="grid2">
      <label>Date prévue<input type="date" name="datePrevue" value="${esc(c.datePrevue || '')}"></label>
      <label>Prix total CHF<input name="prix" inputmode="decimal" value="${c.prix ?? ''}" placeholder="facultatif"></label>
    </div>
    <label>Remarque<textarea name="note" rows="2">${esc(c.note || '')}</textarea></label>
  `, '<span class="spacer"></span><button type="button" data-close>Annuler</button><button class="primary">Enregistrer</button>');

  const box = $('#lignes', form);
  const bindRow = (row) => {
    $('[data-rm]', row).onclick = () => { if ($$('.ligne', box).length > 1) row.remove(); else toast('Il faut au moins une ligne'); };
    $('.f-produit', row).onchange = (e) => { $('.u', row).textContent = unite(parseKey(e.target.value).contenant); };
  };
  $$('.ligne', box).forEach(bindRow);
  $('#add-ligne', form).onclick = () => {
    const prev = $$('.ligne', box).pop();
    box.insertAdjacentHTML('beforeend', ligneRow(prev ? parseKey($('.f-produit', prev).value) : {}));
    bindRow(box.lastElementChild);
  };
  form.nom.addEventListener('change', () => {
    const cl = clients.get(form.nom.value.trim().toLowerCase());
    if (!cl) return;
    if (!form.tel.value) form.tel.value = cl.tel || '';
    if (!form.adresse.value) form.adresse.value = cl.adresse || '';
    if (!form.acces.value) form.acces.value = cl.acces || '';
  });

  onSubmit(form, async (f) => {
    const lignes = $$('.ligne', box).map((row) => ({
      ...parseKey($('.f-produit', row).value), quantite: round(num($('.f-q', row).value)),
    })).filter((li) => li.quantite > 0);
    if (!lignes.length) { toast('Indiquez la quantité commandée'); return; }
    c.client = { nom: f.nom.trim(), tel: f.tel.trim(), adresse: f.adresse.trim(), acces: f.acces.trim() };
    c.lignes = lignes;
    c.datePrevue = f.datePrevue || '';
    c.prix = String(f.prix).trim() ? num(f.prix) : null;
    c.note = f.note.trim();
    if (c.statut === 'a_planifier' || c.statut === 'planifiee') c.statut = c.datePrevue ? 'planifiee' : 'a_planifier';
    if (isNew) c.numero = nextNumero();
    await saveCmd(c);
    toast(isNew ? `Commande n° ${c.numero} enregistrée` : 'Commande modifiée');
    render();
    cmdDetail(c);
  });
}

function cmdDetail(c) {
  if (!c) return;
  const cl = c.client || {};
  const adr = (cl.adresse || '').replace(/\n/g, ', ');
  const enCours = c.statut === 'a_planifier' || c.statut === 'planifiee';
  const form = openDlg(`Commande n° ${c.numero}`, `
    <p><span class="badge st-${c.statut}">${esc(STATUTS[c.statut])}</span>${c.datePrevue && enCours ? ` 📅 <b>${esc(fmtDay(c.datePrevue))}</b>` : ''}</p>
    <div class="box">
      <b>${esc(cl.nom)}</b><br>
      ${cl.adresse ? `${esc(cl.adresse).replace(/\n/g, '<br>')}<br>` : ''}
      ${cl.acces ? `<span class="muted">Accès : ${esc(cl.acces)}</span><br>` : ''}
      <div class="row mt">
        ${cl.tel ? `<a class="btn" href="tel:${esc(cl.tel.replace(/\s/g, ''))}">📞 ${esc(cl.tel)}</a>` : ''}
        ${adr ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adr)}">🗺 Itinéraire</a>` : ''}
      </div>
    </div>
    <table class="sum"><thead><tr><th>Bois</th><th>Quantité</th></tr></thead><tbody>
      ${c.lignes.map((li) => `<tr><td>${esc(plabel(li))}</td><td class="n">${qty(num(li.quantite), li.contenant)}${fmtSt(num(li.quantite), li.contenant)}</td></tr>`).join('')}
    </tbody></table>
    ${enCours ? `<p class="tiny">${c.lignes.map((li) => partsText(allocate(pkey(li), num(li.quantite)), li)).join('<br>')}</p>` : ''}
    ${c.prix ? `<p>Prix : <b>${fmtCHF(c.prix)}</b></p>` : ''}
    ${c.note ? `<p class="muted">${esc(c.note)}</p>` : ''}
    ${c.livraison ? `<h3>Livraison du ${fmtDate(c.livraison.date)}</h3>
      ${c.livraison.signature ? `<p class="tiny muted">Signé par ${esc(c.livraison.signataire || cl.nom)}</p><img class="sig" src="${c.livraison.signature}" alt="Signature">` : ''}
      ${photoStrip(c.livraison.photos)}` : ''}
  `, `<button type="button" class="danger" id="b-del">Supprimer</button><span class="spacer"></span>
      <button type="button" id="b-print">🖨 Bon</button>
      ${enCours ? '<button type="button" id="b-edit">Modifier</button><button type="button" class="primary" id="b-livrer">✓ Livrer</button>' : ''}
      ${c.statut === 'livree' ? '<button type="button" id="b-annul">Annuler la livraison</button><button type="button" class="primary" id="b-fact">Marquer facturée</button>' : ''}
      ${c.statut === 'facturee' ? '<button type="button" id="b-unfact">Remettre à facturer</button>' : ''}`);
  const on = (id, fn) => { const b = $(id, form); if (b) b.onclick = fn; };
  on('#b-print', () => printBon(c));
  on('#b-edit', () => cmdDialog(c));
  on('#b-livrer', () => livrerDialog(c));
  on('#b-fact', async () => { c.statut = 'facturee'; await saveCmd(c); render(); cmdDetail(c); });
  on('#b-unfact', async () => { c.statut = 'livree'; await saveCmd(c); render(); cmdDetail(c); });
  on('#b-annul', async () => {
    if (!confirm('Annuler la livraison ? Le bois est remis dans le stock.')) return;
    await annulerLivraison(c);
    toast('Livraison annulée, bois remis en stock');
    render();
    cmdDetail(c);
  });
  on('#b-del', async () => {
    if (!confirm(`Supprimer la commande n° ${c.numero} ?${c.livraison ? '\nLe bois livré sera remis dans le stock.' : ''}`)) return;
    if (c.livraison) await annulerLivraison(c);
    await delCmd(c);
    dlg().close();
    cleanPhotos(usedPhotos());
    render();
  });
}

async function annulerLivraison(c) {
  for (const id of c.livraison?.mvtIds || []) {
    const m = S.mvts.find((x) => x.id === id);
    if (!m) continue;
    const lot = S.lots.find((l) => l.id === m.lotId);
    if (lot) { lot.quantite = round(lot.quantite - m.delta); await saveLot(lot); await ensureCourant(pkey(lot), { announce: false }); }
    await delMvt(m);
  }
  delete c.livraison;
  c.statut = c.datePrevue ? 'planifiee' : 'a_planifier';
  await saveCmd(c);
}

function partsText({ parts, manque }, li) {
  const u = unite(li.contenant);
  const txt = parts.map((pt, i) => `${i ? 'puis ' : '👉 '}<b>${esc(lieuNom(pt.lot.lieu))}</b> : ${fmtQ(pt.q)} ${esc(u)}${pt.lot.role === 'prendre' ? ' (zone en cours)' : ' <span class="alert-txt">(réserve à entamer)</span>'}`);
  if (manque) txt.push(`<span class="alert-txt">⚠ manque ${fmtQ(manque)} ${esc(u)}</span>`);
  return `${esc(li.essence)} ${esc(li.longueur)} ${esc(li.contenant)} : ${txt.join(', ') || '<span class="alert-txt">aucun stock</span>'}`;
}

// Liste de chargement d'un jour : quoi prendre dans quelle zone.
function chargementDialog(date) {
  const cmds = S.cmds.filter((c) => c.statut === 'planifiee' && c.datePrevue === date).sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  const used = new Map();
  const zones = new Map();
  const manques = [];
  for (const c of cmds) {
    for (const li of c.lignes) {
      const { parts, manque } = allocate(pkey(li), num(li.quantite), used);
      for (const pt of parts) {
        if (!zones.has(pt.lot.lieu)) zones.set(pt.lot.lieu, new Map());
        const z = zones.get(pt.lot.lieu);
        const k = pkey(li);
        if (!z.has(k)) z.set(k, { li, q: 0, clients: [], reserve: pt.lot.role !== 'prendre' });
        const e = z.get(k);
        e.q += pt.q;
        e.clients.push(`${c.client?.nom || '?'} ${fmtQ(pt.q)}`);
      }
      if (manque) manques.push(`${qty(manque, li.contenant)} ${plabel(li)} (${c.client?.nom || ''})`);
    }
  }
  const zs = [...zones.entries()].sort((a, b) => zoneIndex(a[0]) - zoneIndex(b[0]));
  openDlg(`Chargement du ${fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}`, `
    ${zs.map(([z, items]) => `<div class="box"><h3 class="m0">📍 ${esc(lieuNom(z))}</h3>
      <ul class="plain">${[...items.values()].map((e) => `<li><b>${qty(e.q, e.li.contenant)}</b> ${esc(plabel(e.li))}${e.reserve ? ' <span class="alert-txt">(réserve à entamer)</span>' : ''}<br><small class="muted">${esc(e.clients.join(' · '))}</small></li>`).join('')}</ul></div>`).join('') || '<p class="hint">Rien à charger.</p>'}
    ${manques.length ? `<p class="alert">⚠ Stock insuffisant : ${manques.map(esc).join(' ; ')}</p>` : ''}
    <p class="hint">Calculé d’après les zones « à prendre ». Quand une zone est vide, on continue sur la réserve suivante.</p>`,
  '<span class="spacer"></span><button type="button" class="primary" data-close>OK</button>');
}

function livrerDialog(c) {
  const lotOpts = (li) => {
    const ls = ordreReserve(lotsCompatibles(li));
    return '<option value="auto">Automatique – zone en cours</option>'
      + ls.map((l) => `<option value="${esc(l.id)}">${esc(lieuNom(l.lieu))} · ${l.role === 'prendre' ? 'en cours' : 'réserve'} · ${qty(l.quantite, l.contenant)}</option>`).join('')
      + '<option value="">— ne pas retirer du stock —</option>';
  };
  const form = openDlg(`Livraison n° ${c.numero}`, `
    <label>Date de livraison<input type="date" name="date" required value="${today()}"></label>
    <h3>Où prendre le bois</h3>
    ${c.lignes.map((li, i) => `<div class="box">
      <b>${qty(num(li.quantite), li.contenant)}</b> ${esc(plabel(li))}
      <label>Prendre dans<select name="lot${i}" class="f-lot">${lotOpts(li)}</select></label>
      <p class="tiny" id="prev${i}"></p>
    </div>`).join('')}
    <h3>Photo du bois déchargé</h3>
    <div class="photos" id="pe"></div>
    <h3>Signature du client</h3>
    <canvas class="sigpad" id="sig"></canvas>
    <div class="row"><input name="signataire" placeholder="Nom du signataire" value="${esc(c.client?.nom || '')}"><button type="button" id="sig-clear">Effacer</button></div>
  `, '<span class="spacer"></span><button type="button" data-close>Annuler</button><button class="primary">✓ Confirmer la livraison</button>');
  const photos = photoEditor($('#pe', form), []);
  const pad = signaturePad($('#sig', form));
  $('#sig-clear', form).onclick = () => pad.clear();

  const plan = () => {
    const used = new Map();
    return c.lignes.map((li, i) => {
      const choix = form[`lot${i}`].value;
      if (!choix) return { parts: [], manque: 0, aucun: true };
      return allocate(pkey(li), num(li.quantite), used, choix === 'auto' ? null : choix);
    });
  };
  const preview = () => plan().forEach((r, i) => {
    $(`#prev${i}`, form).innerHTML = r.aucun ? '<span class="muted">Le stock ne sera pas modifié.</span>' : partsText(r, c.lignes[i]);
  });
  $$('.f-lot', form).forEach((sel) => sel.addEventListener('change', preview));
  preview();

  onSubmit(form, async (f) => {
    const allocs = plan();
    const manque = allocs.reduce((n, r) => n + r.manque, 0);
    if (manque && !confirm('Le stock enregistré ne suffit pas pour cette livraison.\nEnregistrer quand même ? (on retire ce qui est en stock)')) return;
    const mvtIds = [];
    const keys = new Set();
    for (let i = 0; i < c.lignes.length; i++) {
      for (const pt of allocs[i].parts) {
        const lot = pt.lot;
        lot.quantite = Math.max(0, round(lot.quantite - pt.q));
        if (lot.quantite > 0) lot.entame = true;
        await saveLot(lot);
        keys.add(pkey(lot));
        const m = await saveMvt({ type: 'livraison', date: f.date, lotId: lot.id, delta: -pt.q, commandeId: c.id, client: c.client?.nom, note: `Commande n° ${c.numero}`, ...snap(lot) });
        mvtIds.push(m.id);
      }
    }
    // Une réserve entamée devient la zone en cours.
    for (const k of keys) {
      const ent = S.lots.find((l) => pkey(l) === k && l.entame && l.quantite > 0 && l.role !== 'prendre');
      if (ent && !lotCourant(k)) await setCourant(ent);
      await ensureCourant(k);
    }
    c.livraison = { date: f.date, mvtIds, photos: [...photos], signature: pad.dataURL(), signataire: f.signataire.trim() };
    c.statut = 'livree';
    await saveCmd(c);
    toast('Livraison enregistrée, stock mis à jour');
    render();
    cmdDetail(c);
  });
}

function signaturePad(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 150;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';
  let drawing = false;
  let has = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; has = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); ctx.lineTo(...pos(e)); ctx.stroke(); });
  canvas.addEventListener('pointermove', (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return {
    clear: () => { ctx.clearRect(0, 0, w, h); has = false; },
    dataURL: () => (has ? canvas.toDataURL('image/png') : null),
  };
}

async function printBon(c) {
  const t = S.settings.triage;
  const cl = c.client || {};
  const p = $('#print');
  p.innerHTML = `<div class="bon">
    <header><img src="img/logo-triage.jpg" alt=""><div><b>${esc(t.nom)}</b><br>${esc(t.adresse).replace(/\n/g, '<br>')}${t.tel ? `<br>Tél. ${esc(t.tel)}` : ''}${t.email ? `<br>${esc(t.email)}` : ''}</div></header>
    <h1>Bon de livraison n° ${esc(c.numero)}</h1>
    <div class="bon-grid">
      <div><small>Client</small><br><b>${esc(cl.nom)}</b><br>${esc(cl.adresse || '').replace(/\n/g, '<br>')}${cl.tel ? `<br>Tél. ${esc(cl.tel)}` : ''}</div>
      <div><small>Date de livraison</small><br><b>${esc(fmtDate(c.livraison?.date || c.datePrevue || today(), { day: 'numeric', month: 'long', year: 'numeric' }))}</b></div>
    </div>
    <table><thead><tr><th>Essence</th><th>Longueur</th><th>Contenant</th><th>Quantité</th></tr></thead><tbody>
      ${c.lignes.map((li) => `<tr><td>${esc(li.essence)}</td><td>${esc(li.longueur)}</td><td>${esc(li.contenant)}</td><td class="n">${qty(num(li.quantite), li.contenant)}</td></tr>`).join('')}
    </tbody></table>
    ${c.prix ? `<p class="total">Total : <b>${fmtCHF(c.prix)}</b></p>` : ''}
    ${c.note ? `<p>${esc(c.note)}</p>` : ''}
    <div class="bon-sign">
      <div><small>Signature du client${c.livraison?.signataire ? ` (${esc(c.livraison.signataire)})` : ''}</small>${c.livraison?.signature ? `<img src="${c.livraison.signature}" alt="">` : '<div class="sign-line"></div>'}</div>
      <div><small>Livré par</small><div class="sign-line"></div></div>
    </div>
  </div>`;
  await Promise.all($$('img', p).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
  window.print();
}

// ---------------------------------------------------------------- Vue : Place (carte swisstopo et zones)

function zoneLots(id) { return S.lots.filter((l) => l.lieu === id && l.quantite > 0); }

function zoneStatus(id) {
  const ls = zoneLots(id);
  if (ls.some((l) => l.role === 'prendre')) return 'prendre';
  if (ls.some((l) => l.etat === 'sec')) return 'reserve';
  if (ls.length) return 'sechage';
  return 'vide';
}

const shortProd = (l) => `${l.essence} ${l.longueur.replace(/\s?cm/, '')} ${({ 'Big-bag': 'BB', Ballot: 'ballot', Caisse: 'caisse' })[l.contenant] || l.contenant}`;

function zoneResume(id) {
  const m = new Map();
  for (const l of zoneLots(id)) {
    const k = `${l.role === 'prendre' ? '👉 ' : ''}${shortProd(l)}`;
    m.set(k, (m.get(k) || 0) + l.quantite);
  }
  return [...m].map(([k, q]) => `${k} : ${fmtQ(q)}`);
}

const ZONE_COLORS = { prendre: '#2e7d32', reserve: '#3b5b8c', sechage: '#d98300', vide: '#8a8a8a' };
const RECHY = [46.2626, 7.4960];
const wmts = (id) => `https://wmts.geo.admin.ch/1.0.0/${id}/default/current/3857/{z}/{x}/{y}.jpeg`;
const ATTR = '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';
const TILE_CACHE = 'bf-tiles-v1';

let map = null;
let zoneLayers = {};

function destroyMap() {
  if (!map) return;
  S.mapView = { c: map.getCenter(), z: map.getZoom() };
  map.remove();
  map = null;
  zoneLayers = {};
}

// Surface approximative d'un polygone (m²).
function surface(ring) {
  if (!ring || ring.length < 3) return 0;
  const R = 6378137;
  const lat0 = (ring.reduce((s, p) => s + p[0], 0) / ring.length) * Math.PI / 180;
  const pts = ring.map(([la, lo]) => [lo * Math.PI / 180 * R * Math.cos(lat0), la * Math.PI / 180 * R]);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

// ---- Zones en rangées de contenants (géométrie en mètres autour d'un coin de départ)
// grid = { contenant, cols (dans la ligne), rows (lignes), etages, gap (m entre contenants),
//          sens ('long' | 'large'), origin [lat, lng], angle (° depuis le nord, sens horaire), side (1 = à droite, -1 = à gauche) }

const M_LAT = 111320;
const offsetLL = ([lat, lng], e, n) => [lat + n / M_LAT, lng + e / (M_LAT * Math.cos(lat * Math.PI / 180))];
const bearing = (a, b) => {
  const e = (b[1] - a[1]) * M_LAT * Math.cos(a[0] * Math.PI / 180);
  const n = (b[0] - a[0]) * M_LAT;
  return Math.atan2(e, n) * 180 / Math.PI;
};
const fmtM = (m) => `${fmtQ(Math.round(m * 100) / 100)} m`;
const contDims = (nom) => (S.settings.contenants.find((c) => c.nom === nom) || {}).dims || [1, 1];

function gridSize(g) {
  const [a, b] = contDims(g.contenant);
  const w = g.sens === 'large' ? Math.min(a, b) : Math.max(a, b);
  const d = g.sens === 'large' ? Math.max(a, b) : Math.min(a, b);
  const gap = g.gap || 0;
  return { w, d, gap, L: g.cols * w + (g.cols - 1) * gap, D: g.rows * d + (g.rows - 1) * gap };
}

function gridPos(g, u, v) {
  const t = g.angle * Math.PI / 180;
  const s = g.side || 1;
  return offsetLL(g.origin, u * Math.sin(t) + v * s * Math.cos(t), u * Math.cos(t) - v * s * Math.sin(t));
}

const fixLL = (p) => [+p[0].toFixed(8), +p[1].toFixed(8)];

function gridRing(g) {
  const { L, D } = gridSize(g);
  return [gridPos(g, 0, 0), gridPos(g, L, 0), gridPos(g, L, D), gridPos(g, 0, D)].map(fixLL);
}

function gridUnits(g) {
  const { w, d, gap } = gridSize(g);
  const out = [];
  for (let i = 0; i < g.cols; i++) {
    for (let j = 0; j < g.rows; j++) {
      const u = i * (w + gap);
      const v = j * (d + gap);
      out.push([gridPos(g, u, v), gridPos(g, u + w, v), gridPos(g, u + w, v + d), gridPos(g, u, v + d)]);
    }
  }
  return out;
}

const pluriel = (contenant) => `${contenant.toLowerCase()}s`;
const capacite = (g) => g.cols * g.rows * (g.etages || 1);

function gridText(g) {
  const { L, D } = gridSize(g);
  const cap = capacite(g);
  return `${g.cols} × ${g.rows} ${pluriel(g.contenant)}${g.etages > 1 ? ` × ${g.etages} étages` : ''} · ${fmtM(L)} × ${fmtM(D)} · capacité ${cap} ${pluriel(g.contenant)}${fmtSt(cap, g.contenant)}`;
}

function occupation(z) {
  if (!z.grid) return '';
  const n = zoneLots(z.id).filter((l) => l.contenant === z.grid.contenant).reduce((s, l) => s + l.quantite, 0);
  const cap = capacite(z.grid);
  return `${fmtQ(n)} / ${cap}`;
}

// Place la nouvelle zone à côté d'une autre, en laissant `ecart` mètres.
function gridApres(g, ref, ou, ecart) {
  const rg = ref.grid;
  const { L, D } = gridSize(rg);
  const n = gridSize(g);
  const pos = {
    derriere: () => gridPos(rg, 0, D + ecart),
    devant: () => gridPos(rg, 0, -ecart - n.D),
    avant: () => gridPos(rg, -ecart - n.L, 0),
    apres: () => gridPos(rg, L + ecart, 0),
  }[ou]();
  return { ...g, origin: fixLL(pos), angle: rg.angle, side: rg.side || 1 };
}

const centreRing = (r) => [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length];
const distM = (a, b) => Math.hypot((b[1] - a[1]) * M_LAT * Math.cos(a[0] * Math.PI / 180), (b[0] - a[0]) * M_LAT);
const gridCentre = (g) => { const { L, D } = gridSize(g); return gridPos(g, L / 2, D / 2); };

// Place une zone en rangées avec son centre au point donné.
function gridAuCentre(g, c) {
  const { L, D } = gridSize(g);
  const tmp = { ...g, origin: c };
  const c0 = gridPos(tmp, L / 2, D / 2);
  return { ...g, origin: fixLL(offsetLL(c, (c[1] - c0[1]) * M_LAT * Math.cos(c[0] * Math.PI / 180), (c[0] - c0[0]) * M_LAT)) };
}

// Aimant : colle la zone à une zone voisine (même alignement, espace habituel) si elle en est proche.
function aimanter(z) {
  const ecart = S.settings.ecartZones ?? 0.5;
  const c = gridCentre(z.grid);
  const { L, D } = gridSize(z.grid);
  const seuil = Math.max(3, Math.max(L, D) / 2);
  let best = null;
  for (const o of S.settings.lieux) {
    if (o.id === z.id || !o.grid?.origin) continue;
    for (const ou of ['apres', 'avant', 'derriere', 'devant']) {
      const cand = gridApres(z.grid, o, ou, ecart);
      const d = distM(c, gridCentre(cand));
      if (d < seuil && (!best || d < best.d)) best = { d, cand, o };
    }
  }
  if (best) z.grid = best.cand;
  return best?.o || null;
}

// Zone voisine la plus proche (pour reprendre son alignement).
function zoneProche(p, exceptId) {
  let best = null;
  for (const o of S.settings.lieux) {
    if (o.id === exceptId || !o.grid?.origin) continue;
    const d = distM(p, gridCentre(o.grid));
    if (!best || d < best.d) best = { d, o };
  }
  return best?.o || null;
}

// ---------------------------------------------------------------- Vue : carte et zones

function renderPlace() {
  const zones = S.settings.lieux;
  const pl = S.settings.plan;
  const drawing = S.drawing && zones.find((z) => z.id === S.drawing);
  const editing = S.editing && zones.find((z) => z.id === S.editing);
  const placing = S.placingGrid && zones.find((z) => z.id === S.placingGrid);
  const adjusting = S.adjusting && zones.find((z) => z.id === S.adjusting);
  const sansContour = zones.filter((z) => !z.ring);
  const pas = S.pas || 0.1;
  return `
  ${pl ? `
  <section class="card map-card">
    <div class="row between"><h2>Secteur du bois de feu</h2>
      <span class="row">${pl ? '' : '<button type="button" class="small" id="btn-gps">◎ Ma position</button>'}<button type="button" class="small" id="btn-fit">⤢ Tout voir</button></span></div>
    ${pl && !pl.echelleOk && !S.calibrating ? '<p class="alert">📏 Réglez l’échelle de la photo pour que les zones aient la bonne taille. <button type="button" class="link" id="btn-cal2">Régler maintenant</button></p>' : ''}
    ${S.calibrating ? `<p class="placing-bar"><span id="cal-txt">📏 Touchez le <b>début</b> d’une longueur que vous connaissez (bord du hangar, une rangée de caisses…).</span><button type="button" class="small" id="cancel-cal">Annuler</button></p>` : ''}
    ${drawing ? `<p class="placing-bar"><span>Dessin de « <b>${esc(drawing.nom)}</b> » : touchez chaque coin, puis le premier point pour fermer.</span><button type="button" class="small" id="cancel-draw">Annuler</button></p>` : ''}
    ${editing ? `<p class="placing-bar"><span>Glissez les points de « <b>${esc(editing.nom)}</b> » pour corriger le contour.</span><button type="button" class="small primary" id="end-edit">Terminer</button></p>` : ''}
    ${placing ? `<p class="placing-bar"><span>« <b>${esc(placing.nom)}</b> » : <b>touchez ${pl ? 'la photo' : 'la carte'}</b> à l’endroit de la zone.</span><button type="button" class="small" id="cancel-place">Annuler</button></p>` : ''}
    ${adjusting ? `<div class="adjust-bar">
        <p class="m0"><b>${esc(adjusting.nom)}</b> : glissez la zone avec le doigt. Près d’une autre zone, elle s’y colle toute seule (${fmtQ(S.settings.ecartZones ?? 0.5)} m d’espace).</p>
        <div class="row mt">
          <button type="button" data-rot="-5">⟲ 5°</button><button type="button" data-rot="-1">⟲ 1°</button>
          <button type="button" data-rot="1">1° ⟳</button><button type="button" data-rot="5">5° ⟳</button>
          <span class="spacer"></span><button type="button" class="primary" id="adj-end">✓ Terminer</button>
        </div>
      </div>` : ''}
    <div id="zmap" class="zmap ${drawing || placing || S.calibrating ? 'placing' : ''}"></div>
    <div class="legend"><span><i class="dot prendre"></i>À prendre</span><span><i class="dot reserve"></i>Réserve</span><span><i class="dot sechage"></i>En séchage / vert</span><span><i class="dot vide"></i>Vide</span></div>
    ${sansContour.length && !drawing && !placing ? `<p class="hint">Pas encore placée${sansContour.length > 1 ? 's' : ''} sur la carte : ${sansContour.map((z) => `<button type="button" class="link" data-zone-edit="${esc(z.id)}">${esc(z.nom)}</button>`).join(', ')}</p>` : ''}
    <div class="row mt">
      <label class="btn small">📷 ${pl ? 'Changer la photo de la place' : 'Choisir la photo de la place'}<input type="file" accept="image/*" id="plan-file" hidden></label>
      ${pl ? '<button type="button" class="small" id="btn-cal">📏 Régler l’échelle</button>' : ''}
    </div>
    ${pl ? (pl.echelleOk ? `<p class="hint">Échelle : 1 m = ${fmtQ(Math.round(1 / pl.mpp))} pixels de la photo.</p>` : '') : '<p class="hint">Mettez une photo vue du dessus de vos places de stockage (par ex. une capture d’écran satellite, nettoyée). Vous zoomerez dessus et y placerez vos zones. En attendant, la carte swisstopo est affichée.</p>'}
    ${pl ? '' : `<details class="backup"><summary>Carte sans réseau</summary>
      <p class="hint">Centrez la carte sur le secteur, puis enregistrez-la : elle restera disponible sans réseau.</p>
      <button type="button" id="btn-offline">⬇ Enregistrer cette partie de la carte</button>
      <progress id="offline-progress" hidden></progress><p class="hint" id="offline-status"></p>
    </details>`}
  </section>
` : `
  <section class="card plan-vide">
    <h2>Photo de la place</h2>
    <p>Vos zones se posent sur <b>votre photo</b> des places de stockage, vue du dessus (par ex. une capture satellite, nettoyée si besoin).</p>
    <label class="btn primary big">📷 Choisir la photo de la place<input type="file" accept="image/*" id="plan-file" hidden></label>
    <p class="hint">Ensuite : réglez l’échelle une fois (une longueur connue), puis posez vos zones d’un toucher sur la photo.</p>
  </section>`}

  <button class="primary big" id="btn-new-zone">+ Nouvelle zone</button>

  ${zones.map((z) => {
    const ls = S.lots.filter((l) => l.lieu === z.id && (l.quantite > 0 || S.showEmpty)).sort((a, b) => plabel(a).localeCompare(plabel(b), 'fr'));
    const m2 = surface(z.ring);
    return `<section class="card zone-card" id="zone-${esc(z.id)}">
      <div class="row between"><h2><i class="dot ${zoneStatus(z.id)}"></i> ${esc(z.nom)}</h2>
        <span class="row">${z.ring ? `<button type="button" class="small" data-show="${esc(z.id)}">🗺 Voir</button>` : ''}
        <button type="button" class="small" data-zone-edit="${esc(z.id)}">Modifier</button></span></div>
      ${z.grid ? `<p class="tiny">${esc(gridText(z.grid))}<br><b>Occupé : ${occupation(z)} ${esc(pluriel(z.grid.contenant))}</b></p>` : ''}
      ${z.note || (m2 && !z.grid) ? `<p class="hint">${esc(z.note || '')}${z.note && m2 && !z.grid ? ' · ' : ''}${m2 && !z.grid ? `≈ ${Math.round(m2)} m²` : ''}</p>` : ''}
      <div class="lots">${ls.map(lotCard).join('') || '<p class="hint">Zone vide.</p>'}</div>
      <button type="button" class="small mt" data-zone-add="${esc(z.id)}">+ Lot dans cette zone</button>
    </section>`;
  }).join('')}`;
}

let unitLayers = {};

function drawZone(z, group, root) {
  if (zoneLayers[z.id]) { group.removeLayer(zoneLayers[z.id]); delete zoneLayers[z.id]; }
  if (unitLayers[z.id]) { group.removeLayer(unitLayers[z.id]); delete unitLayers[z.id]; }
  if (!z.ring) return;
  const st = zoneStatus(z.id);
  const actif = S.adjusting === z.id;
  const poly = L.polygon(z.ring, { color: actif ? '#ffeb3b' : '#fff', weight: actif ? 3 : 2, fillColor: ZONE_COLORS[st], fillOpacity: z.grid ? 0.25 : 0.55 }).addTo(group);
  if (z.grid) {
    unitLayers[z.id] = L.featureGroup(gridUnits(z.grid).map((r) => L.polygon(r, { color: '#fff', weight: 1, opacity: 0.9, fillColor: ZONE_COLORS[st], fillOpacity: 0.45, interactive: false }))).addTo(group);
    poly.bringToFront();
  }
  const occ = z.grid ? `<span class="zl-d"><br>${occupation(z)} ${esc(pluriel(z.grid.contenant))}</span>` : '';
  poly.bindTooltip(`<b>${esc(z.nom)}</b>${occ}<span class="zl-d">${zoneResume(z.id).slice(0, 3).map((t) => `<br>${esc(t)}`).join('')}</span>`, { permanent: true, direction: 'center', className: `zlabel ${st}` });
  poly.on('click', () => {
    if (S.drawing || S.editing || S.placingGrid || S.adjusting) return;
    const card = $(`#zone-${CSS.escape(z.id)}`, root);
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card?.classList.add('flash');
    setTimeout(() => card?.classList.remove('flash'), 1200);
  });
  zoneLayers[z.id] = poly;
}

function bindPlace(root) {
  const zones = S.settings.lieux;
  unitLayers = {};
  const pl = S.settings.plan;
  if (!pl) {
    // Pas encore de photo : seulement la liste des zones.
    $('#plan-file', root).onchange = (e) => choisirPlan(e.target.files[0]);
    $('#btn-new-zone', root).onclick = () => zoneDialog();
    $$('[data-zone-edit]', root).forEach((b) => b.addEventListener('click', () => zoneDialog(zones.find((z) => z.id === b.dataset.zoneEdit))));
    $$('[data-zone-add]', root).forEach((b) => b.addEventListener('click', () => lotDialog(null, { lieu: b.dataset.zoneAdd })));
    bindLots(root);
    return;
  }
  map = L.map($('#zmap', root), { maxZoom: pl ? 25 : 22, minZoom: 8, zoomControl: true, zoomSnap: 0.25 });
  window.bfMap = map; // accès pour le diagnostic
  map.attributionControl.setPrefix(false);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  let planBounds = null;
  if (pl) {
    // Photo de la place : affichée seule, sans carte, à l'échelle réglée.
    planBounds = L.latLngBounds(planCoins(pl));
    const ov = L.imageOverlay('', planBounds, { interactive: false }).addTo(map);
    photoURL(pl.photo).then((u) => ov.setUrl(u));
    map.getContainer().classList.add('fond-blanc');
    map.setMaxBounds(planBounds.pad(0.5));
  } else {
    const photo = L.tileLayer(wmts('ch.swisstopo.swissimage'), { maxNativeZoom: 20, maxZoom: 22, attribution: ATTR, crossOrigin: 'anonymous' });
    const carte = L.tileLayer(wmts('ch.swisstopo.pixelkarte-farbe'), { maxNativeZoom: 18, maxZoom: 22, attribution: ATTR, crossOrigin: 'anonymous' });
    const bases = { photo, carte };
    const setFond = (id) => {
      S.base = id;
      try { localStorage.setItem('bf-base', id); } catch { /* stockage indisponible */ }
    };
    (bases[S.base] || photo).addTo(map);
    setFond(bases[S.base] ? S.base : 'photo');
    L.control.layers({ 'Photo aérienne': photo, Carte: carte }, null, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', (e) => setFond(e.layer === carte ? 'carte' : 'photo'));
  }
  map.pm.setLang('fr');

  const group = L.featureGroup().addTo(map);
  for (const z of zones) drawZone(z, group, root);
  const fitAll = () => {
    if (planBounds) map.fitBounds(planBounds);
    else if (group.getLayers().length) map.fitBounds(group.getBounds().pad(0.25), { maxZoom: 20 });
    else map.setView(RECHY, 16);
  };
  if (planBounds) map.setMinZoom(map.getBoundsZoom(planBounds) - 1);
  if (S.focusRing) { map.fitBounds(L.polygon(S.focusRing).getBounds().pad(0.25), { maxZoom: 22 }); S.focusRing = null; } else if (S.mapView) map.setView(S.mapView.c, S.mapView.z); else fitAll();
  const zoomCls = () => {
    const c = map.getContainer().classList;
    const zm = map.getZoom();
    c.toggle('z-far', zm < 18 && !pl);
    c.toggle('z-mid', zm < 21);
  };
  map.on('zoomend', zoomCls);
  zoomCls();
  setTimeout(() => map && map.invalidateSize(), 50);

  $('#btn-fit', root).onclick = fitAll;
  if ($('#btn-gps', root)) $('#btn-gps', root).onclick = () => {
    toast('Recherche de la position…');
    map.locate({ setView: true, maxZoom: 19, enableHighAccuracy: true });
  };
  map.on('locationfound', (e) => { L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#1976d2', fillOpacity: 1 }).addTo(map); });
  map.on('locationerror', () => toast('Position introuvable (GPS désactivé ?)'));

  // Dessin libre d'une zone
  if (S.drawing) {
    map.pm.enableDraw('Polygon', {
      pathOptions: { color: '#ffeb3b', weight: 3, fillOpacity: 0.3 },
      templineStyle: { color: '#ffeb3b', weight: 3 },
      hintlineStyle: { color: '#ffeb3b', dashArray: '5 5' },
      allowSelfIntersection: false,
      snappable: false,
    });
    map.on('pm:create', async (e) => {
      const z = zones.find((x) => x.id === S.drawing);
      const ring = e.layer.getLatLngs()[0].map((ll) => [+ll.lat.toFixed(7), +ll.lng.toFixed(7)]);
      map.removeLayer(e.layer);
      S.drawing = null;
      if (z) { z.ring = ring; delete z.grid; await saveSettings(); toast(`« ${z.nom} » dessinée`); }
      render();
    });
    $('#cancel-draw', root).onclick = () => { map.pm.disableDraw(); S.drawing = null; render(); };
  }
  // Correction d'un contour libre
  if (S.editing && zoneLayers[S.editing]) {
    const poly = zoneLayers[S.editing];
    poly.closeTooltip();
    poly.pm.enable({ allowSelfIntersection: false, snappable: false });
    $('#end-edit', root).onclick = async () => {
      const z = zones.find((x) => x.id === S.editing);
      z.ring = poly.getLatLngs()[0].map((ll) => [+ll.lat.toFixed(7), +ll.lng.toFixed(7)]);
      poly.pm.disable();
      S.editing = null;
      await saveSettings();
      toast('Contour enregistré');
      render();
    };
  }
  // Placement d'une zone en rangées : un toucher = centre de la zone
  if (S.placingGrid) {
    const z = zones.find((x) => x.id === S.placingGrid);
    map.on('click', async (e) => {
      const p = [e.latlng.lat, e.latlng.lng];
      const voisine = zoneProche(p, z.id);
      z.grid = gridAuCentre({ ...z.grid, angle: voisine ? voisine.grid.angle : (z.grid.angle ?? 90), side: voisine ? (voisine.grid.side || 1) : 1 }, p);
      const collee = aimanter(z);
      z.ring = gridRing(z.grid);
      await saveSettings();
      S.placingGrid = null;
      S.adjusting = z.id;
      S.focusRing = z.ring;
      toast(collee ? `Collée à « ${collee.nom} »` : 'Zone posée : glissez-la si besoin');
      render();
    });
    $('#cancel-place', root).onclick = () => { S.placingGrid = null; render(); };
  }
  // Ajustement : glisser la zone (aimant) et la tourner
  if (S.adjusting) {
    const z = zones.find((x) => x.id === S.adjusting);
    const arm = () => {
      const poly = zoneLayers[z.id];
      if (!poly) return;
      poly.closeTooltip();
      poly.pm.enableLayerDrag();
      poly.on('pm:dragstart', () => { if (unitLayers[z.id]) { group.removeLayer(unitLayers[z.id]); delete unitLayers[z.id]; } });
      poly.on('pm:dragend', () => {
        const r = poly.getLatLngs()[0].map((ll) => [ll.lat, ll.lng]);
        const c = [r.reduce((t, q) => t + q[0], 0) / r.length, r.reduce((t, q) => t + q[1], 0) / r.length];
        z.grid = gridAuCentre(z.grid, c);
        const collee = aimanter(z);
        if (collee) toast(`Collée à « ${collee.nom} »`, 1500);
        z.ring = gridRing(z.grid);
        drawZone(z, group, root);
        arm();
      });
    };
    arm();
    $$('[data-rot]', root).forEach((b) => b.addEventListener('click', () => {
      const c = gridCentre(z.grid);
      z.grid.angle = (z.grid.angle + Number(b.dataset.rot) + 360) % 360;
      z.grid = gridAuCentre(z.grid, c);
      z.ring = gridRing(z.grid);
      drawZone(z, group, root);
      arm();
    }));
    $('#adj-end', root).onclick = async () => {
      S.adjusting = null;
      await saveSettings();
      toast('Position enregistrée');
      render();
    };
  }

  $$('[data-show]', root).forEach((b) => b.addEventListener('click', () => {
    const poly = zoneLayers[b.dataset.show];
    if (!poly) return;
    map.fitBounds(poly.getBounds().pad(0.25), { maxZoom: 22 });
    $('#zmap').scrollIntoView({ behavior: 'smooth' });
  }));
  if ($('#btn-offline', root)) $('#btn-offline', root).onclick = saveOfflineTiles;
  $('#plan-file', root).onchange = (e) => choisirPlan(e.target.files[0]);
  const cal = () => { Object.assign(S, { calibrating: true, drawing: null, editing: null, placingGrid: null, adjusting: null }); render(); $('#zmap')?.scrollIntoView({ behavior: 'smooth' }); };
  $('#btn-cal', root) && ($('#btn-cal', root).onclick = cal);
  $('#btn-cal2', root) && ($('#btn-cal2', root).onclick = cal);
  if (S.calibrating) {
    let a = null;
    let mk = null;
    $('#cancel-cal', root).onclick = () => { S.calibrating = false; render(); };
    map.on('click', (e) => {
      const p = [e.latlng.lat, e.latlng.lng];
      if (!a) {
        a = p;
        mk = L.circleMarker(e.latlng, { radius: 6, color: '#000', weight: 2, fillColor: '#ffeb3b', fillOpacity: 1 }).addTo(map);
        $('#cal-txt', root).innerHTML = '📏 Touchez maintenant la <b>fin</b> de cette longueur.';
        return;
      }
      L.polyline([a, p], { color: '#ffeb3b', weight: 4 }).addTo(map);
      L.circleMarker(e.latlng, { radius: 6, color: '#000', weight: 2, fillColor: '#ffeb3b', fillOpacity: 1 }).addTo(map);
      const mesure = distM(a, p);
      const form = openDlg('Longueur réelle', `
        <p>Quelle est la longueur réelle de la ligne que vous venez de tracer ?</p>
        <label>Longueur (m)<input name="m" inputmode="decimal" required placeholder="ex. 30"></label>
        <p class="hint">Plus la longueur est grande, plus l’échelle est précise. Une caisse mesure 1,2 m de long.</p>`,
      '<button type="button" data-close>Annuler</button><span class="spacer"></span><button class="primary">Valider</button>');
      dlg().addEventListener('close', () => { if (S.calibrating) { S.calibrating = false; render(); } }, { once: true });
      onSubmit(form, async (f) => {
        const reel = num(f.m);
        if (reel <= 0 || !mesure) { toast('Indiquez une longueur'); return; }
        mettreAEchelle(reel / mesure);
        S.calibrating = false;
        await saveSettings();
        dlg().close();
        toast('Échelle enregistrée');
        render();
      });
      void mk;
    });
  }
  $('#btn-new-zone', root).onclick = () => zoneDialog();
  $$('[data-zone-edit]', root).forEach((b) => b.addEventListener('click', () => zoneDialog(zones.find((z) => z.id === b.dataset.zoneEdit))));
  $$('[data-zone-add]', root).forEach((b) => b.addEventListener('click', () => lotDialog(null, { lieu: b.dataset.zoneAdd })));
  bindLots(root);
}

function startDraw(id) {
  Object.assign(S, { drawing: id, editing: null, placingGrid: null, adjusting: null });
  render();
  $('#zmap')?.scrollIntoView({ behavior: 'smooth' });
}

function startMode(mode, id, focusRing) {
  Object.assign(S, { drawing: null, editing: null, placingGrid: null, adjusting: null, [mode]: id });
  if (focusRing) S.focusRing = focusRing;
  render();
  $('#zmap')?.scrollIntoView({ behavior: 'smooth' });
}

// ---- Photo de la place (sans carte) : image placée autour d'un point fixe, à l'échelle mpp (mètres par pixel)

function planCoins(pl) {
  const he = (pl.w * pl.mpp) / 2;
  const hn = (pl.h * pl.mpp) / 2;
  return [offsetLL(pl.center, -he, -hn), offsetLL(pl.center, he, hn)];
}

// Change l'échelle de la photo ; les zones restent au même endroit sur la photo (leur taille réelle ne change pas).
function mettreAEchelle(k) {
  const pl = S.settings.plan;
  const c = pl.center;
  const sc = (p) => fixLL([c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]);
  pl.mpp *= k;
  pl.echelleOk = true;
  for (const z of S.settings.lieux) {
    if (z.grid?.origin) {
      const ctr = sc(gridCentre(z.grid));
      z.grid = gridAuCentre(z.grid, ctr);
      z.ring = gridRing(z.grid);
    } else if (z.ring) {
      z.ring = z.ring.map(sc);
    }
  }
}

async function choisirPlan(file) {
  if (!file) return;
  const ancien = S.settings.plan;
  if (ancien && S.settings.lieux.some((z) => z.ring) && !confirm('Remplacer la photo de la place ?\nLes zones gardent leur position : vérifiez-les ensuite.')) return;
  toast('Enregistrement de la photo…');
  const id = await storePhoto(file, 4096, 0.88);
  const img = await new Promise((r) => { photoURL(id).then((u) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = u; }); });
  if (!img) { toast('Photo illisible'); return; }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  S.settings.plan = ancien
    ? { ...ancien, photo: id, mpp: ancien.mpp * (ancien.w / w), w, h }
    : { photo: id, w, h, mpp: 150 / Math.max(w, h), center: RECHY, echelleOk: false };
  S.mapView = null;
  await saveSettings();
  cleanPhotos(usedPhotos());
  toast(ancien ? 'Photo remplacée' : 'Photo en place : réglez maintenant l’échelle', 4000);
  render();
}

async function saveOfflineTiles() {
  if (!('caches' in window) || !map) { toast('Non pris en charge par ce navigateur'); return; }
  if (map.getZoom() < 14) { toast('Zoomez d’abord sur le secteur'); return; }
  const urls = new Set();
  const b = map.getBounds();
  map.eachLayer((layer) => {
    if (!(layer instanceof L.TileLayer)) return;
    const ts = layer.options.tileSize;
    const maxN = layer.options.maxNativeZoom ?? 20;
    for (let z = map.getZoom(); z <= Math.min(map.getZoom() + 3, 20); z++) {
      const tz = Math.min(z, maxN);
      const nw = map.project(b.getNorthWest(), tz).divideBy(ts).floor();
      const se = map.project(b.getSouthEast(), tz).divideBy(ts).floor();
      for (let x = nw.x; x <= se.x; x++) {
        for (let y = nw.y; y <= se.y; y++) {
          const c = L.point(x, y);
          c.z = tz;
          const saved = layer._tileZoom;
          layer._tileZoom = tz;
          urls.add(layer.getTileUrl(c));
          layer._tileZoom = saved;
        }
      }
    }
  });
  const list = [...urls];
  if (list.length > 4000) { toast('Zone trop grande : zoomez davantage'); return; }
  const cache = await caches.open(TILE_CACHE);
  const prog = $('#offline-progress');
  prog.hidden = false;
  prog.max = list.length;
  prog.value = 0;
  let i = 0;
  let ok = 0;
  const worker = async () => {
    while (i < list.length) {
      const u = list[i++];
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: 'cors' });
          if (r.ok) await cache.put(u, r);
        }
        ok++;
      } catch { /* hors-ligne */ }
      prog.value++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  prog.hidden = true;
  $('#offline-status').textContent = `✔ Carte enregistrée (${ok} images).`;
}

function zoneDialog(zone) {
  const isNew = !zone;
  const zones = S.settings.lieux;
  const z = zone || { id: uid(), nom: `Zone ${String.fromCharCode(65 + (zones.length % 26))}` };
  const i = zones.indexOf(zone);
  const conts = S.settings.contenants.filter((c) => c.dims);
  const last = [...zones].reverse().find((x) => x.grid && x.id !== z.id);
  const g = z.grid || { contenant: last?.grid.contenant || conts[0]?.nom, cols: '', rows: '', etages: 1, gap: 0, sens: 'long' };
  const forme = z.grid || isNew ? 'grille' : (z.ring ? 'libre' : 'grille');
  const form = openDlg(isNew ? 'Nouvelle zone' : `Zone ${z.nom}`, `
    <label>Nom de la zone<input name="nom" required value="${esc(z.nom)}" placeholder="ex. Zone A, Place du hangar…"></label>
    <label>Remarque<input name="note" value="${esc(z.note || '')}" placeholder="ex. derrière le hangar, accès camion"></label>
    <label>Forme de la zone<select name="forme">
      <option value="grille"${forme === 'grille' ? ' selected' : ''}>Rangées de contenants (caisses, big-bags…)</option>
      <option value="libre"${forme === 'libre' ? ' selected' : ''}>Dessin libre sur la carte</option></select></label>
    <div id="f-grille">
      <div class="grid2">
        <label>Contenant<select name="contenant">${options(conts.map((c) => ({ v: c.nom, t: `${c.nom} (${fmtQ(c.dims[0])} × ${fmtQ(c.dims[1])} m)` })), g.contenant)}</select></label>
        <label>Pose dans la ligne<select name="sens">
          <option value="long"${g.sens !== 'large' ? ' selected' : ''}>Côté long dans la ligne</option>
          <option value="large"${g.sens === 'large' ? ' selected' : ''}>Côté court dans la ligne</option></select></label>
        <label>Nombre dans une ligne<input name="cols" inputmode="numeric" value="${g.cols}" placeholder="ex. 8"></label>
        <label>Nombre de lignes<input name="rows" inputmode="numeric" value="${g.rows}" placeholder="ex. 2"></label>
        <label>Étages (empilés)<input name="etages" inputmode="numeric" value="${g.etages || 1}"></label>
        <label>Espace entre contenants (m)<input name="gap" inputmode="decimal" value="${String(g.gap || 0).replace('.', ',')}"></label>
      </div>
      <p class="box tiny" id="g-info"></p>
    </div>
    ${isNew ? '' : `<div class="row mt">
      <button type="button" id="z-adjust" ${z.grid?.origin ? '' : 'hidden'}>✥ Déplacer / tourner</button>
      <button type="button" id="z-draw">✏ ${z.ring && !z.grid ? 'Redessiner' : 'Dessiner librement'}</button>
      ${z.ring && !z.grid ? '<button type="button" id="z-edit">Corriger le contour</button>' : ''}</div>
      <div class="row mt">
      <button type="button" id="z-up" ${i <= 0 ? 'disabled' : ''}>▲ Monter</button>
      <button type="button" id="z-down" ${i >= zones.length - 1 ? 'disabled' : ''}>▼ Descendre</button></div>
      <p class="hint">L’ordre des zones sert aussi à choisir la prochaine réserve à ouvrir (à âge égal).</p>`}
  `, `${isNew ? '' : '<button type="button" class="danger" id="z-del">Supprimer</button>'}<span class="spacer"></span>
      <button type="button" data-close>Annuler</button><button class="primary">Enregistrer</button>`);

  const readGrid = () => ({
    ...(z.grid || {}),
    contenant: form.contenant.value, sens: form.sens.value,
    cols: Math.max(1, Math.round(num(form.cols.value))), rows: Math.max(1, Math.round(num(form.rows.value))),
    etages: Math.max(1, Math.round(num(form.etages.value) || 1)), gap: Math.max(0, num(form.gap.value)),
  });
  const refresh = () => {
    const libre = form.forme.value === 'libre';
    $('#f-grille', form).hidden = libre;
    $('#g-info', form).textContent = num(form.cols.value) && num(form.rows.value) ? gridText(readGrid()) : 'Indiquez le nombre de contenants dans une ligne et le nombre de lignes.';
  };
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  refresh();

  onSubmit(form, async (f) => {
    z.nom = f.nom.trim();
    z.note = f.note.trim();
    if (isNew) zones.push(z);
    if (f.forme === 'libre') {
      const hadGrid = !!z.grid;
      delete z.grid;
      if (hadGrid) delete z.ring;
      await saveSettings();
      dlg().close();
      if (!z.ring) startDraw(z.id); else render();
      return;
    }
    if (!num(f.cols) || !num(f.rows)) { toast('Indiquez le nombre de contenants et de lignes'); return; }
    const ng = readGrid();
    dlg().close();
    if (ng.origin) {
      // Garde le centre actuel ; seules les dimensions changent.
      const c = z.grid?.origin ? gridCentre(z.grid) : ng.origin;
      z.grid = gridAuCentre(ng, c);
      z.ring = gridRing(z.grid);
      await saveSettings();
      render();
    } else {
      z.grid = ng;
      await saveSettings();
      if (S.settings.plan) startMode('placingGrid', z.id);
      else { toast('Zone enregistrée. Ajoutez la photo de la place pour la poser dessus.', 5000); render(); }
    }
  });
  if (isNew) return;
  const move = async (d) => {
    zones.splice(i, 1);
    zones.splice(i + d, 0, z);
    await saveSettings();
    dlg().close();
    render();
  };
  const on = (id, fn) => { const b = $(id, form); if (b) b.onclick = fn; };
  on('#z-up', () => move(-1));
  on('#z-down', () => move(1));
  on('#z-adjust', () => { dlg().close(); startMode('adjusting', z.id, z.ring); });
  on('#z-draw', () => { dlg().close(); startDraw(z.id); });
  on('#z-edit', () => { dlg().close(); startMode('editing', z.id, z.ring); });
  on('#z-del', async () => {
    if (zoneLots(z.id).length) { toast('Cette zone contient encore du bois : videz ou déplacez les lots d’abord.', 4000); return; }
    if (!confirm(`Supprimer la zone « ${z.nom} » ?`)) return;
    zones.splice(zones.indexOf(z), 1);
    for (const l of S.lots.filter((x) => x.lieu === z.id)) await delLot(l);
    await saveSettings();
    dlg().close();
    render();
  });
}

// ---------------------------------------------------------------- Vue : Plus (historique, réglages, sauvegarde)

function renderPlus() {
  const s = S.settings;
  const mv = S.mvts.filter((m) => !S.fType || m.type === S.fType);
  return `
  <section class="card">
    <h2>Historique des mouvements</h2>
    <select id="f-type">${options(Object.entries(TYPES).map(([v, t]) => ({ v, t })), S.fType, { empty: 'Tous les mouvements' })}</select>
    <div class="hist-wrap">${historyList(mv.slice().sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 300).map((m) => ({ ...m, note: [plabel(m), lieuNom(m.lieu), m.note].filter(Boolean).join(' · ') })))}</div>
  </section>

  <section class="card">
    <h2>Modules</h2>
    <label class="check big-check"><input type="checkbox" id="mod-liv" ${s.livraisons ? 'checked' : ''}> Commandes et livraisons aux clients</label>
    <p class="hint">Désactivé : l’application ne gère que le stock et les entrées de bois.</p>
  </section>

  <section class="card">
    <h2>Export pour Excel / comptabilité</h2>
    <div class="row">
      <button id="csv-stock">Stock (lots)</button>
      <button id="csv-mvts">Mouvements</button>
      <button id="csv-cmds">Commandes</button>
    </div>
  </section>

  <section class="card">
    <h2>Catalogue</h2>
    <form id="form-cat">
      <h3>Produits vendus</h3>
      <p class="hint">Seuls ces produits sont proposés dans le stock, les entrées et les commandes.</p>
      <div id="produits"></div>
      <div class="box">
        <div class="grid3">
          <label>Essence<select id="np-e">${options(s.essences, '')}</select></label>
          <label>Longueur<select id="np-l">${options(s.longueurs, '')}</select></label>
          <label>Contenant<select id="np-c">${options(s.contenants.map((c) => c.nom), '')}</select></label>
        </div>
        <button type="button" id="add-prod">+ Ajouter ce produit</button>
      </div>
      <h3>Listes</h3>
      <p class="hint">Un élément par ligne. Enregistrez avant d’ajouter un produit avec une nouvelle essence ou longueur. Renommer ne modifie pas les lots déjà enregistrés.</p>
      <div class="grid2">
        <label>Essences<textarea name="essences" rows="6">${esc(s.essences.join('\n'))}</textarea></label>
        <label>Longueurs<textarea name="longueurs" rows="6">${esc(s.longueurs.join('\n'))}</textarea></label>
      </div>
      <label>Contenants <small class="muted">(nom = unité = stères = dimensions au sol en m, ex. « Caisse = caisse = 0,7 = 1,2 x 0,8 »)</small><textarea name="contenants" rows="4">${esc(s.contenants.map((c) => `${c.nom} = ${c.unite} = ${String(c.steres ?? '').replace('.', ',')}${c.dims ? ` = ${String(c.dims[0]).replace('.', ',')} x ${String(c.dims[1]).replace('.', ',')}` : ''}`).join('\n'))}</textarea></label>
      <label>Espace habituel entre deux zones (m)<input name="ecartZones" inputmode="decimal" value="${String(s.ecartZones ?? 0.5).replace('.', ',')}"></label>
      <p class="hint">Les zones de stockage se placent dans l’onglet <b>Zones</b>.</p>
      <label>Entreprises / fournisseurs<textarea name="entreprises" rows="4">${esc(s.entreprises.join('\n'))}</textarea></label>
      <h3>Coordonnées pour le bon de livraison</h3>
      <div class="grid2">
        <label>Nom<input name="t_nom" value="${esc(s.triage.nom)}"></label>
        <label>Téléphone<input name="t_tel" value="${esc(s.triage.tel)}"></label>
        <label>Adresse<textarea name="t_adresse" rows="2">${esc(s.triage.adresse)}</textarea></label>
        <label>E-mail<input name="t_email" value="${esc(s.triage.email || '')}"></label>
      </div>
      <button class="primary big">Enregistrer le catalogue</button>
    </form>
  </section>

  <section class="card">
    <h2>Importer un inventaire</h2>
    <p class="hint">Fichier CSV (Excel : « Enregistrer sous → CSV ») avec les colonnes <b>Essence ; Longueur ; Contenant ; Quantité</b>, et si besoin <b>État</b> et <b>Zone</b>. C’est le même format que l’export « Stock ».</p>
    <label class="btn">⬆ Choisir le fichier d’inventaire<input type="file" accept=".csv,text/csv,text/plain" id="input-inv" hidden></label>
  </section>

  <section class="card">
    <h2>Recommencer</h2>
    <p class="hint">Le catalogue (produits, contenants, entreprises) est conservé. Faites une copie de secours avant, si vous voulez pouvoir revenir en arrière.</p>
    <div class="row">
      <button type="button" class="danger" id="btn-reset-zones">🗑 Effacer toutes les zones</button>
      <button type="button" class="danger" id="btn-reset-all">🗑 Tout effacer (zones, stock, historique)</button>
    </div>
  </section>

  <section class="card">
    <h2>Copie de secours</h2>
    <p class="hint">Les données et les photos sont enregistrées <b>uniquement sur cet appareil</b>. Créez régulièrement une copie (Drive, e-mail, clé USB…) pour ne rien perdre et pour passer sur un autre appareil.</p>
    <div class="row">
      <button id="btn-backup">⬇ Créer la copie</button>
      <label class="btn">⬆ Récupérer une copie<input type="file" id="input-import" accept=".json,application/json" hidden></label>
    </div>
    <p class="hint" id="storage-info"></p>
  </section>
  <p class="hint center">Bois de feu · ${esc(s.triage.nom)}</p>`;
}

function bindPlus(root) {
  $('#f-type', root).onchange = (e) => { S.fType = e.target.value; render(); };
  $$('li[data-mvt]', root).forEach((li) => li.addEventListener('click', () => openMvt(li.dataset.mvt)));
  $('#mod-liv', root).onchange = async (e) => { S.settings.livraisons = e.target.checked; await saveSettings(); render(); };
  $('#csv-stock', root).onclick = () => exportCSV('stock');
  $('#csv-mvts', root).onclick = () => exportCSV('mouvements');
  $('#csv-cmds', root).onclick = () => exportCSV('commandes');
  $('#btn-backup', root).onclick = backup;
  $('#btn-reset-zones', root).onclick = () => resetData(false);
  $('#input-inv', root).onchange = (e) => importInventaire(e.target.files[0]);
  $('#btn-reset-all', root).onclick = () => resetData(true);
  $('#input-import', root).onchange = (e) => restore(e.target.files[0]);

  const prods = [...S.settings.produits];
  const box = $('#produits', root);
  const drawProds = () => {
    box.innerHTML = prods.map((p, i) => `<div class="prod-row"><span>${esc(p.essence)} ${esc(p.longueur)} · ${esc(p.contenant)}</span><button type="button" class="danger small" data-rm-prod="${i}">Retirer</button></div>`).join('')
      || '<p class="hint">Aucun produit.</p>';
    $$('[data-rm-prod]', box).forEach((bt) => bt.addEventListener('click', () => { prods.splice(+bt.dataset.rmProd, 1); drawProds(); }));
  };
  drawProds();
  $('#add-prod', root).onclick = () => {
    const p = { essence: $('#np-e', root).value, longueur: $('#np-l', root).value, contenant: $('#np-c', root).value };
    if (prods.some((x) => pkey(x) === pkey(p))) { toast('Ce produit existe déjà'); return; }
    prods.push(p);
    drawProds();
    toast('Produit ajouté – pensez à enregistrer');
  };

  $('#form-cat', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const lines = (v) => [...new Set(String(v).split('\n').map((x) => x.trim()).filter(Boolean))];
    const s = S.settings;
    const ess = lines(f.essences); const lon = lines(f.longueurs);
    const con = lines(f.contenants).map((x) => {
      const [nom, u, st, dim] = x.split('=');
      const m = /([\d.,]+)\s*[x×*]\s*([\d.,]+)/i.exec(dim || '');
      return { nom: nom.trim(), unite: (u || nom).trim(), steres: num(st), ...(m ? { dims: [num(m[1]), num(m[2])] } : {}) };
    });
    if (!ess.length || !lon.length || !con.length || !prods.length) { toast('Chaque liste doit contenir au moins un élément'); return; }
    Object.assign(s, { essences: ess, longueurs: lon, contenants: con, produits: prods, entreprises: lines(f.entreprises), ecartZones: Math.max(0, num(f.ecartZones)) });
    for (const z of s.lieux) if (z.grid?.origin) z.ring = gridRing(z.grid);
    s.triage = { nom: f.t_nom.trim(), tel: f.t_tel.trim(), adresse: f.t_adresse.trim(), email: f.t_email.trim() };
    await saveSettings();
    toast('Catalogue enregistré');
    render();
  });

  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      const el = $('#storage-info');
      if (el) el.textContent = `Espace utilisé sur l’appareil : ${(usage / 1e6).toFixed(1)} Mo${quota ? ` sur ${(quota / 1e9).toFixed(1)} Go disponibles` : ''}.`;
    });
  }
}

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportCSV(kind) {
  const cell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const nb = (n) => (n === null || n === undefined || n === '' ? '' : String(round(n)).replace('.', ','));
  let rows;
  if (kind === 'stock') {
    rows = [['Essence', 'Longueur', 'Contenant', 'Quantité', 'Unité', 'Stères', 'État', 'Zone', 'Utilisation', 'Mis en tas le', 'Provenance', 'Humidité %', 'Remarque']];
    for (const l of [...S.lots].sort((a, b) => zoneIndex(a.lieu) - zoneIndex(b.lieu))) {
      rows.push([l.essence, l.longueur, l.contenant, nb(l.quantite), unite(l.contenant), nb(steres(l.quantite, l.contenant)), ETATS[l.etat], lieuNom(l.lieu), l.role === 'prendre' ? 'À prendre' : 'Réserve', l.dateMise, l.provenance, nb(l.humidite), l.note]);
    }
  } else if (kind === 'mouvements') {
    rows = [['Date', 'Type', 'Essence', 'Longueur', 'Contenant', 'Quantité', 'Unité', 'Zone', 'Entreprise / fournisseur', 'Client', 'Prix CHF', 'Remarque']];
    for (const m of [...S.mvts].sort((a, b) => a.date.localeCompare(b.date))) rows.push([m.date, TYPES[m.type], m.essence, m.longueur, m.contenant, nb(m.delta), unite(m.contenant), lieuNom(m.lieu), m.entreprise, m.client, nb(m.prix), m.note]);
  } else {
    rows = [['N°', 'Statut', 'Client', 'Téléphone', 'Adresse', 'Date prévue', 'Date livraison', 'Bois', 'Prix CHF', 'Remarque']];
    for (const c of [...S.cmds].sort((a, b) => (a.numero || '').localeCompare(b.numero || ''))) {
      rows.push([c.numero, STATUTS[c.statut], c.client?.nom, c.client?.tel, (c.client?.adresse || '').replace(/\n/g, ', '), c.datePrevue, c.livraison?.date,
        c.lignes.map((li) => `${fmtQ(num(li.quantite))} ${unite(li.contenant)} ${plabel(li)}`).join(' + '), nb(c.prix), c.note]);
    }
  }
  const csv = `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}`;
  download(`bois-de-feu_${kind}_${today()}.csv`, csv, 'text/csv;charset=utf-8');
}

// ---- Import d'un inventaire (CSV)

function lireCSV(txt) {
  txt = txt.replace(/^﻿/, '');
  const sep = (txt.split('\n')[0].match(/;/g) || []).length >= (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [''];
  let q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) {
      if (ch === '"' && txt[i + 1] === '"') { row[row.length - 1] += '"'; i++; } else if (ch === '"') q = false; else row[row.length - 1] += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) row.push('');
    else if (ch === '\n') { rows.push(row); row = ['']; } else if (ch !== '\r') row[row.length - 1] += ch;
  }
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const sansAccent = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function normLongueur(v) {
  const t = sansAccent(v).replace(/\s/g, '');
  if (/^(1m|100|100cm|1)$/.test(t)) return '1 m';
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? `${n} cm` : String(v).trim();
}

function trouver(list, v, alias = {}) {
  const t = sansAccent(v);
  const a = alias[t] || t;
  return list.find((x) => sansAccent(x) === a) || list.find((x) => sansAccent(x).startsWith(a.slice(0, 5))) || null;
}

async function importInventaire(file) {
  if (!file) return;
  const st = S.settings;
  const rows = lireCSV(await file.text());
  const head = (rows.shift() || []).map(sansAccent);
  const col = (...names) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
  const ci = { e: col('essence'), l: col('longueur'), c: col('contenant'), q: col('quantite', 'nombre'), et: col('etat'), z: col('zone', 'lieu'), n: col('remarque', 'note') };
  if (ci.e < 0 || ci.l < 0 || ci.c < 0 || ci.q < 0) { toast('Colonnes introuvables : il faut Essence, Longueur, Contenant, Quantité', 6000); return; }
  const lignes = [];
  const erreurs = [];
  for (const r of rows) {
    const q = round(num(r[ci.q]));
    if (!(q > 0)) continue;
    const essence = trouver(st.essences, r[ci.e], { foyard: 'fayard', hetre: 'fayard', feuillu: 'feuillus indigenes', 'feuillu indigene': 'feuillus indigenes' }) || String(r[ci.e]).trim();
    const contenant = trouver(st.contenants.map((c) => c.nom), r[ci.c], { bigbag: 'big-bag', 'big bag': 'big-bag', bb: 'big-bag' });
    if (!essence || !contenant) { erreurs.push(r.join(' ; ')); continue; }
    const etatTxt = ci.et >= 0 ? sansAccent(r[ci.et]) : '';
    const etat = /vert|frais/.test(etatTxt) ? 'vert' : /sech/.test(etatTxt) && !/^sec\b/.test(etatTxt) ? 'sechage' : 'sec';
    lignes.push({ essence, longueur: normLongueur(r[ci.l]), contenant, quantite: q, etat, zone: ci.z >= 0 ? String(r[ci.z] || '').trim() : '', note: ci.n >= 0 ? String(r[ci.n] || '').trim() : '' });
  }
  if (!lignes.length) { toast('Aucune quantité trouvée dans le fichier', 5000); return; }
  const totSt = lignes.reduce((t, l) => t + steres(l.quantite, l.contenant), 0);
  const form = openDlg('Importer l’inventaire', `
    <p><b>${lignes.length} produits</b> · ≈ ${fmtQ(totSt)} stères</p>
    <div class="hist-wrap"><table class="sum"><tbody>${lignes.map((l) => `<tr><td>${esc(plabel(l))}${l.zone ? ` <span class="muted">· ${esc(l.zone)}</span>` : ''}</td><td class="n">${qty(l.quantite, l.contenant)}</td></tr>`).join('')}</tbody></table></div>
    ${erreurs.length ? `<p class="alert">${erreurs.length} ligne(s) non reconnue(s) ignorée(s) : ${esc(erreurs.slice(0, 3).join(' | '))}</p>` : ''}
    <label>Que faire du stock actuel ?<select name="mode">
      <option value="remplacer">Remplacer tout le stock actuel par cet inventaire</option>
      <option value="ajouter">Ajouter ces quantités au stock actuel</option></select></label>
    <p class="hint">Les lots sans zone connue vont dans la zone « À répartir » : déplacez-les ensuite dans la bonne zone.</p>`,
  '<button type="button" data-close>Annuler</button><span class="spacer"></span><button class="primary">Importer</button>');
  onSubmit(form, async (f) => {
    const keys = new Set();
    if (f.mode === 'remplacer') {
      for (const l of [...S.lots]) {
        if (l.quantite > 0) await saveMvt({ type: 'inventaire', lotId: l.id, delta: -l.quantite, note: 'Remplacé par l’import d’inventaire', ...snap(l) });
        await delLot(l);
      }
    }
    let aRepartir = null;
    for (const li of lignes) {
      const p = { essence: li.essence, longueur: li.longueur, contenant: li.contenant };
      if (!st.essences.includes(p.essence)) st.essences.push(p.essence);
      if (!st.longueurs.includes(p.longueur)) st.longueurs.push(p.longueur);
      if (!st.produits.some((x) => pkey(x) === pkey(p))) st.produits.push(p);
      let z = li.zone && st.lieux.find((x) => sansAccent(x.nom) === sansAccent(li.zone));
      if (!z && li.zone) { z = { id: uid(), nom: li.zone }; st.lieux.push(z); }
      if (!z) {
        aRepartir ||= st.lieux.find((x) => x.nom === 'À répartir') || (st.lieux.push({ id: uid(), nom: 'À répartir', note: 'Bois importé de l’inventaire, à déplacer dans les bonnes zones' }), st.lieux[st.lieux.length - 1]);
        z = aRepartir;
      }
      const lot = { id: uid(), ...p, etat: li.etat, lieu: z.id, quantite: li.quantite, dateMise: '', provenance: `Inventaire ${file.name}`, photos: [], note: li.note, created: nowISO(), role: 'reserve' };
      await saveLot(lot);
      await saveMvt({ type: 'inventaire', lotId: lot.id, delta: lot.quantite, note: 'Import d’inventaire', ...snap(lot) });
      keys.add(pkey(lot));
    }
    for (const k of keys) await ensureCourant(k, { announce: false });
    await saveSettings();
    dlg().close();
    toast(`Inventaire importé : ${lignes.length} produits`, 4000);
    go('stock');
  });
}

async function resetData(tout) {
  const nbZ = S.settings.lieux.length;
  const nbL = S.lots.length;
  const msg = tout
    ? `Tout effacer ?\n${nbZ} zone(s), ${nbL} lot(s), tout l’historique et les photos seront supprimés.`
    : `Effacer les ${nbZ} zone(s) ?${nbL ? `\nLes ${nbL} lot(s) de bois qu’elles contiennent seront aussi supprimés (l’historique est conservé).` : ''}`;
  if (!confirm(msg)) return;
  if (!confirm('Confirmez : cette action ne peut pas être annulée.')) return;
  for (const l of [...S.lots]) await delLot(l);
  if (tout) {
    await db.clear('mouvements');
    S.mvts = [];
    if (S.settings.livraisons) { await db.clear('commandes'); S.cmds = []; }
  }
  S.settings.lieux = [];
  S.settings.seuils = tout ? {} : S.settings.seuils;
  S.mapView = null;
  S.fLieu = '';
  Object.assign(S, { drawing: null, editing: null, placingGrid: null, adjusting: null });
  await saveSettings();
  await cleanPhotos(usedPhotos());
  toast(tout ? 'Tout est effacé' : 'Zones effacées', 3000);
  go('place');
}

async function backup() {
  toast('Préparation de la copie…');
  const photos = [];
  for (const p of await db.all('photos')) photos.push({ id: p.id, created: p.created, data: await blobToDataURL(p.blob) });
  const data = { format: 'bois-de-feu', version: 1, date: nowISO(), settings: S.settings, lots: S.lots, mouvements: S.mvts, commandes: S.cmds, photos };
  download(`copie-secours-bois-de-feu_${today()}.json`, JSON.stringify(data), 'application/json');
}

async function restore(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'bois-de-feu') throw new Error('fichier non reconnu');
    if (!confirm(`Remplacer toutes les données de cet appareil par la copie du ${fmtDate(data.date)} ?\n(${data.lots.length} lots, ${data.commandes.length} commandes, ${data.photos.length} photos)`)) return;
    for (const s of STORE_NAMES) await db.clear(s);
    for (const p of data.photos) await db.put('photos', { id: p.id, created: p.created, blob: await dataURLToBlob(p.data) });
    for (const l of data.lots) await db.put('lots', l);
    for (const m of data.mouvements) await db.put('mouvements', m);
    for (const c of data.commandes) await db.put('commandes', c);
    await db.put('kv', { key: 'settings', value: data.settings });
    await load();
    toast('Copie récupérée');
    render();
  } catch (err) {
    toast(`Impossible de récupérer la copie : ${err.message}`, 5000);
  }
}

// ---------------------------------------------------------------- Rendu principal

const VIEWS = {
  stock: { title: 'Stock', render: renderStock, bind: bindStock },
  place: { title: 'Zones', render: renderPlace, bind: bindPlace },
  entrees: { title: 'Entrées de bois', render: renderEntrees, bind: bindEntrees },
  livraisons: { title: 'Commandes & livraisons', render: renderLivraisons, bind: bindLivraisons },
  plus: { title: 'Historique & réglages', render: renderPlus, bind: bindPlus },
};

function render() {
  if (!S.settings.livraisons && S.view === 'livraisons') S.view = 'stock';
  const v = VIEWS[S.view];
  const main = $('#view');
  destroyMap();
  const scroll = main.scrollTop;
  main.innerHTML = v.render();
  v.bind(main);
  fillImages(main);
  main.scrollTop = scroll;
  $('#view-title').textContent = v.title;
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  $('#dl-entreprises').innerHTML = S.settings.entreprises.map((e) => `<option value="${esc(e)}">`).join('');
  const nbLiv = S.cmds.filter((c) => c.statut === 'planifiee' && c.datePrevue <= today()).length;
  $('.tabs [data-view=livraisons]').hidden = !S.settings.livraisons;
  const badge = $('.tabs [data-view=livraisons] i');
  badge.textContent = nbLiv || '';
  badge.hidden = !nbLiv;
}

function go(view) {
  S.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  $('#view').scrollTop = 0;
  render();
}

async function load() {
  const kv = await db.get('kv', 'settings');
  S.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(kv?.value || {}) };
  if ((S.settings.version || 1) < 2) {
    // Ancien catalogue : remplacé par les produits du triage. Les lieux deviennent des zones.
    Object.assign(S.settings, DEFAULT_CATALOGUE());
  }
  if ((S.settings.version || 1) < 3) {
    for (const c of S.settings.contenants) if (!c.dims && DIMS_DEFAUT[c.nom]) c.dims = DIMS_DEFAUT[c.nom];
  }
  [S.lots, S.mvts, S.cmds] = await Promise.all([db.all('lots'), db.all('mouvements'), db.all('commandes')]);
  if ((S.settings.version || 1) < 4) {
    // « Foyard » devient « Fayard » (nom utilisé au triage) ; une caisse = 0,75 stère.
    const ren = (o) => { if (o && o.essence === 'Foyard') { o.essence = 'Fayard'; return true; } return false; };
    const st = S.settings;
    st.essences = st.essences.map((e) => (e === 'Foyard' ? 'Fayard' : e));
    st.produits.forEach(ren);
    st.seuils = Object.fromEntries(Object.entries(st.seuils || {}).map(([k, v]) => [k.replace(/^Foyard\|/, 'Fayard|'), v]));
    for (const c of st.contenants) if (c.nom === 'Caisse' && c.steres === 0.7) c.steres = 0.75;
    for (const l of S.lots) if (ren(l)) await db.put('lots', l);
    for (const m of S.mvts) if (ren(m)) await db.put('mouvements', m);
    for (const c of S.cmds) if (c.lignes.map(ren).some(Boolean)) await db.put('commandes', c);
  }
  if ((S.settings.version || 1) < 5) {
    // Ballot de 1 m : bois empilé et cerclé, environ la surface d'une caisse.
    const b = S.settings.contenants.find((c) => c.nom === 'Ballot');
    if (b && (!b.dims || (b.dims[0] === 1 && b.dims[1] === 1))) b.dims = [1.2, 0.8];
    for (const z of S.settings.lieux) {
      if (z.grid?.origin && z.grid.contenant === 'Ballot') { z.grid = gridAuCentre(z.grid, z.ring ? centreRing(z.ring) : z.grid.origin); z.ring = gridRing(z.grid); }
    }
  }
  S.settings.version = SETTINGS_VERSION;
  if (!kv || kv.value.version !== S.settings.version) await saveSettings();
}

async function start() {
  await load();
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  $('#viewer').addEventListener('click', () => $('#viewer').close());
  const h = location.hash.slice(1);
  go(VIEWS[h] ? h : 'stock');
  cleanPhotos(usedPhotos()).catch(() => {});
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<p class="fatal">Erreur au démarrage : ${esc(err.message)}</p>`);
});
