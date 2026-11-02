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

const DEFAULT_SETTINGS = {
  essences: ['Hêtre', 'Chêne', 'Frêne', 'Érable', 'Feuillus mélangés', 'Épicéa', 'Sapin', 'Mélèze', 'Pin'],
  longueurs: ['1 m', '50 cm', '33 cm', '25 cm'],
  contenants: [
    { nom: 'Stère', unite: 'st' },
    { nom: 'Palette', unite: 'pal.' },
    { nom: 'Big-bag', unite: 'big-bag' },
    { nom: 'Sac', unite: 'sac' },
    { nom: 'Vrac (m³ apparent)', unite: 'm³' },
  ],
  lieux: [{ id: 'depot', nom: 'Dépôt principal' }],
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
const etatOptions = (v, opts) => options(Object.entries(ETATS).map(([k, t]) => ({ v: k, t })), v, opts);

function productFields(p = {}, cls = '') {
  const s = S.settings;
  return `<div class="grid3 ${cls}">
    <label>Essence<select name="essence" class="f-essence">${options(s.essences, p.essence || s.essences[0])}</select></label>
    <label>Longueur<select name="longueur" class="f-longueur">${options(s.longueurs, p.longueur || s.longueurs[0])}</select></label>
    <label>Contenant<select name="contenant" class="f-contenant">${options(s.contenants.map((c) => c.nom), p.contenant || s.contenants[0]?.nom)}</select></label>
  </div>`;
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
    if (!map.has(k)) map.set(k, { k, p: { essence: p.essence, longueur: p.longueur, contenant: p.contenant }, total: 0, sec: 0, autre: 0, aLivrer: 0 });
    return map.get(k);
  };
  for (const l of S.lots) {
    if (l.quantite <= 0 || (lieu && l.lieu !== lieu)) continue;
    const r = get(l);
    r.total += l.quantite;
    if (l.etat === 'sec') r.sec += l.quantite; else r.autre += l.quantite;
  }
  if (!lieu) {
    for (const c of S.cmds) {
      if (c.statut !== 'a_planifier' && c.statut !== 'planifiee') continue;
      for (const li of c.lignes) get(li).aLivrer += num(li.quantite);
    }
    for (const k of Object.keys(S.settings.seuils)) {
      const [essence, longueur, contenant] = k.split('|');
      get({ essence, longueur, contenant });
    }
  }
  return [...map.values()].sort((a, b) => plabel(a.p).localeCompare(plabel(b.p), 'fr'));
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
    .sort((a, b) => plabel(a).localeCompare(plabel(b), 'fr') || (a.dateMise || '').localeCompare(b.dateMise || ''));
  const parLieu = new Map();
  for (const l of lots) {
    if (!parLieu.has(l.lieu)) parLieu.set(l.lieu, []);
    parLieu.get(l.lieu).push(l);
  }
  const nbAlertes = rows.filter(alerte).length;

  return `
  <div class="filters row">
    <select id="f-lieu" aria-label="Lieu">${lieuOptions(S.fLieu, { empty: 'Tous les lieux' })}</select>
    <select id="f-etat" aria-label="État">${etatOptions(S.fEtat, { empty: 'Tous les états' })}</select>
  </div>

  <section class="card">
    <h2>Stock total ${S.fLieu ? `<small>· ${esc(lieuNom(S.fLieu))}</small>` : ''}</h2>
    ${nbAlertes ? `<p class="alert">⚠ ${nbAlertes} produit${nbAlertes > 1 ? 's' : ''} en stock bas ou insuffisant pour les commandes</p>` : ''}
    ${rows.length ? `<table class="sum">
      <thead><tr><th>Produit</th><th>Stock</th>${S.fLieu ? '' : '<th>À livrer</th><th>Reste</th>'}</tr></thead>
      <tbody>${rows.map((r) => {
        const a = alerte(r);
        return `<tr data-seuil="${esc(r.k)}" class="${a}">
          <td><b>${esc(r.p.essence)}</b> <span class="muted">${esc(r.p.longueur)} · ${esc(r.p.contenant)}</span>
            <div class="tiny">${r.sec ? `sec ${fmtQ(r.sec)}` : ''}${r.sec && r.autre ? ' · ' : ''}${r.autre ? `en séchage / vert ${fmtQ(r.autre)}` : ''}${S.settings.seuils[r.k] !== undefined ? ` · alerte sous ${fmtQ(S.settings.seuils[r.k])}` : ''}</div></td>
          <td class="n">${qty(r.total, r.p.contenant)}</td>
          ${S.fLieu ? '' : `<td class="n">${r.aLivrer ? fmtQ(r.aLivrer) : '–'}</td><td class="n"><b>${fmtQ(r.total - r.aLivrer)}</b>${a ? ' ⚠' : ''}</td>`}
        </tr>`;
      }).join('')}</tbody></table>
      <p class="hint">Touchez une ligne pour régler un seuil d’alerte.</p>` : '<p class="hint">Aucun bois en stock pour le moment. Ajoutez un lot ci-dessous ou enregistrez une entrée de bois.</p>'}
  </section>

  <div class="row between">
    <h2 class="sec-title">Lots (tas, palettes…)</h2>
    <label class="check"><input type="checkbox" id="f-empty" ${S.showEmpty ? 'checked' : ''}> lots vides</label>
  </div>
  <button class="primary big" id="btn-new-lot">+ Ajouter un lot au stock</button>
  ${[...parLieu.entries()].map(([lieu, ls]) => `
    <h3>📍 ${esc(lieuNom(lieu))}</h3>
    <div class="lots">${ls.map(lotCard).join('')}</div>`).join('') || '<p class="hint">Aucun lot avec ces filtres.</p>'}
  `;
}

function lotCard(l) {
  return `<div class="lot ${l.quantite <= 0 ? 'empty' : ''}" data-lot="${esc(l.id)}">
    ${l.photos?.length ? `<img class="thumb" data-photo="${esc(l.photos[0])}" alt="">` : '<div class="thumb ph-none">🪵</div>'}
    <div class="lot-main">
      <b>${esc(l.essence)}</b> <span>${esc(l.longueur)} · ${esc(l.contenant)}</span>
      <div class="tiny"><span class="badge ${l.etat}">${esc(ETATS[l.etat] || l.etat)}</span>
        ${l.dateMise ? `depuis ${moisDepuis(l.dateMise)}` : ''}${l.humidite ? ` · ${fmtQ(l.humidite)} % hum.` : ''}${l.photos?.length > 1 ? ` · ${l.photos.length} 📷` : ''}</div>
      ${l.note ? `<div class="tiny muted">${esc(l.note)}</div>` : ''}
    </div>
    <div class="qty">
      <button type="button" data-dec aria-label="Moins">−</button>
      <span><b>${fmtQ(l.quantite)}</b><small>${esc(unite(l.contenant))}</small></span>
      <button type="button" data-inc aria-label="Plus">+</button>
    </div>
  </div>`;
}

function bindStock(root) {
  $('#f-lieu', root).onchange = (e) => { S.fLieu = e.target.value; render(); };
  $('#f-etat', root).onchange = (e) => { S.fEtat = e.target.value; render(); };
  $('#f-empty', root).onchange = (e) => { S.showEmpty = e.target.checked; render(); };
  $('#btn-new-lot', root).onclick = () => lotDialog();
  $$('tr[data-seuil]', root).forEach((tr) => tr.addEventListener('click', () => seuilDialog(tr.dataset.seuil)));
  $$('.lot', root).forEach((el) => {
    const lot = S.lots.find((l) => l.id === el.dataset.lot);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-dec]')) quickAdjust(lot, -1);
      else if (e.target.closest('[data-inc]')) quickAdjust(lot, +1);
      else lotDialog(lot);
    });
  });
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
  render();
}

function seuilDialog(k) {
  const [essence, longueur, contenant] = k.split('|');
  const cur = S.settings.seuils[k];
  const form = openDlg('Seuil d’alerte', `
    <p><b>${esc(plabel({ essence, longueur, contenant }))}</b></p>
    <p class="hint">Une alerte s’affiche quand le stock restant (après les commandes à livrer) passe sous ce seuil.</p>
    <label>Alerte en dessous de (${esc(unite(contenant))})<input name="seuil" inputmode="decimal" value="${cur ?? ''}" placeholder="aucune alerte"></label>`,
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

function lotDialog(lot) {
  const isNew = !lot;
  const s = S.settings;
  const l = lot ? { ...lot } : {
    id: uid(), essence: s.essences[0], longueur: s.longueurs[0], contenant: s.contenants[0]?.nom,
    etat: 'sec', lieu: S.fLieu || s.lieux[0]?.id, quantite: 0, dateMise: today(), photos: [], created: nowISO(),
  };
  const form = openDlg(isNew ? 'Nouveau lot' : 'Lot de bois', `
    ${productFields(l)}
    <div class="grid2">
      <label>État<select name="etat">${etatOptions(l.etat)}</select></label>
      <label>Lieu<select name="lieu">${lieuOptions(l.lieu)}</select></label>
      <label>Quantité (${esc(unite(l.contenant))})<input name="quantite" inputmode="decimal" required value="${isNew ? '' : fmtQ(l.quantite).replace(/\s/g, '')}" placeholder="0"></label>
      <label>Mis en tas le<input type="date" name="dateMise" value="${esc(l.dateMise || '')}"></label>
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
  const unitLabel = () => { $('[name=quantite]', form).previousSibling.textContent = `Quantité (${unite($('[name=contenant]', form).value)})`; };
  $('[name=contenant]', form).addEventListener('change', unitLabel);

  onSubmit(form, async (f) => {
    const oldQ = isNew ? 0 : lot.quantite;
    Object.assign(l, {
      essence: f.essence, longueur: f.longueur, contenant: f.contenant, etat: f.etat, lieu: f.lieu,
      quantite: Math.max(0, round(num(f.quantite))), dateMise: f.dateMise, provenance: f.provenance.trim(),
      humidite: String(f.humidite).trim() ? num(f.humidite) : null, note: f.note.trim(), photos: [...photos],
    });
    await saveLot(l);
    const d = round(l.quantite - oldQ);
    if (d) await saveMvt({ type: isNew ? 'initial' : 'inventaire', lotId: l.id, delta: d, ...snap(l) });
    dlg().close();
    toast(isNew ? 'Lot ajouté au stock' : 'Lot enregistré');
    render();
  });

  if (!isNew) {
    $('#btn-del', form).onclick = async () => {
      if (!confirm('Supprimer ce lot ? (son historique est conservé)')) return;
      if (lot.quantite > 0) await saveMvt({ type: 'inventaire', lotId: lot.id, delta: -lot.quantite, note: 'Lot supprimé', ...snap(lot) });
      await delLot(lot);
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
  const isNew = !mvt;
  const s = S.settings;
  const m = mvt ? { ...mvt } : {
    type, date: today(), essence: s.essences[0], longueur: s.longueurs[0], contenant: s.contenants[0]?.nom,
    etat: type === 'achat' ? 'sec' : 'vert', lieu: s.lieux[0]?.id, photos: [],
  };
  const avecEntreprise = type !== 'propre' && type !== 'initial';
  const lot = !isNew && S.lots.find((l) => l.id === m.lotId);
  const form = openDlg(TYPES[type], `
    <div class="grid2">
      <label>Date<input type="date" name="date" required value="${esc(m.date)}"></label>
      ${avecEntreprise ? `<label>${type === 'achat' ? 'Fournisseur' : 'Entreprise'}<input name="entreprise" list="dl-entreprises" value="${esc(m.entreprise || '')}" placeholder="nom"></label>` : ''}
    </div>
    ${isNew ? `${productFields(m)}
    <div class="grid2">
      <label>État du bois<select name="etat">${etatOptions(m.etat)}</select></label>
      <label>Lieu de stockage<select name="lieu">${lieuOptions(m.lieu)}</select></label>
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
    const p = { essence: form.essence.value, longueur: form.longueur.value, contenant: form.contenant.value };
    const ls = lotsCompatibles(p, form.lieu.value);
    $('#cible', form).innerHTML = '<option value="">Nouveau lot (nouveau tas / nouvelles palettes)</option>'
      + ls.map((l) => `<option value="${esc(l.id)}">Lot existant : ${esc(ETATS[l.etat])}, ${qty(l.quantite, l.contenant)}${l.dateMise ? `, du ${fmtDate(l.dateMise)}` : ''}</option>`).join('');
    $('#u', form).textContent = unite(p.contenant);
  };
  if (isNew) {
    ['essence', 'longueur', 'contenant', 'lieu'].forEach((n) => form[n].addEventListener('change', refreshCible));
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
          id: uid(), essence: f.essence, longueur: f.longueur, contenant: f.contenant, etat: f.etat, lieu: f.lieu,
          quantite: q, dateMise: f.date, provenance: [TYPES[type], common.entreprise].filter(Boolean).join(' – '),
          photos: [...photos], note: '', created: nowISO(),
        };
      }
      await saveLot(target);
      await saveMvt({ type, lotId: target.id, delta: q, etat: target.etat, ...snap(target), ...common });
      toast(`+${qty(q, f.contenant)} ajouté au stock`);
    } else {
      const d = round(q - mvt.delta);
      if (lot && d) { lot.quantite = Math.max(0, round(lot.quantite + d)); await saveLot(lot); }
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
      if (lot) { lot.quantite = Math.max(0, round(lot.quantite - mvt.delta)); await saveLot(lot); }
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
        ${url ? `<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">🗺 Tournée</a>` : ''}</div>
      <div class="list">${cs.map(cmdCard).join('')}</div></div>`;
  }).join('') : '<p class="hint">Aucune livraison planifiée.</p>'}

  ${aPlan.length ? `<h2 class="sec-title">À planifier <small>(${aPlan.length})</small></h2><div class="list">${aPlan.map(cmdCard).join('')}</div>` : ''}
  ${livrees.length ? `<h2 class="sec-title">Livrées – à facturer <small>(${livrees.length})</small></h2><div class="list">${livrees.map(cmdCard).join('')}</div>` : ''}
  ${fact.length ? `<details class="sec-details"><summary>Facturées (${fact.length})</summary><div class="list">${fact.slice(0, 100).map(cmdCard).join('')}</div></details>` : ''}
  `;
}

function bindLivraisons(root) {
  $('#btn-new-cmd', root).onclick = () => cmdDialog();
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
  return `<div class="ligne">${productFields(li)}
    <div class="ligne-q"><label>Quantité<input class="f-q" inputmode="decimal" required value="${li.quantite ?? ''}" placeholder="0"></label>
    <span class="u">${esc(unite(li.contenant || S.settings.contenants[0]?.nom))}</span>
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
    $('.f-contenant', row).onchange = (e) => { $('.u', row).textContent = unite(e.target.value); };
  };
  $$('.ligne', box).forEach(bindRow);
  $('#add-ligne', form).onclick = () => {
    const prev = $$('.ligne', box).pop();
    const p = prev ? { essence: $('.f-essence', prev).value, longueur: $('.f-longueur', prev).value, contenant: $('.f-contenant', prev).value } : {};
    box.insertAdjacentHTML('beforeend', ligneRow(p));
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
      essence: $('.f-essence', row).value, longueur: $('.f-longueur', row).value, contenant: $('.f-contenant', row).value,
      quantite: round(num($('.f-q', row).value)),
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
      ${c.lignes.map((li) => `<tr><td>${esc(plabel(li))}</td><td class="n">${qty(num(li.quantite), li.contenant)}</td></tr>`).join('')}
    </tbody></table>
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
    if (lot) { lot.quantite = round(lot.quantite - m.delta); await saveLot(lot); }
    await delMvt(m);
  }
  delete c.livraison;
  c.statut = c.datePrevue ? 'planifiee' : 'a_planifier';
  await saveCmd(c);
}

function livrerDialog(c) {
  const lotOpts = (li) => {
    const ok = lotsCompatibles(li).sort((a, b) => (a.etat === 'sec' ? 0 : 1) - (b.etat === 'sec' ? 0 : 1) || (a.dateMise || '').localeCompare(b.dateMise || ''));
    return ok.map((l) => `<option value="${esc(l.id)}">${esc(lieuNom(l.lieu))} · ${esc(ETATS[l.etat])} · ${qty(l.quantite, l.contenant)}</option>`).join('')
      + '<option value="">— ne pas retirer du stock —</option>';
  };
  const form = openDlg(`Livraison n° ${c.numero}`, `
    <label>Date de livraison<input type="date" name="date" required value="${today()}"></label>
    <h3>Prendre le bois dans quel lot ?</h3>
    ${c.lignes.map((li, i) => `<div class="box">
      <b>${qty(num(li.quantite), li.contenant)}</b> ${esc(plabel(li))}
      <label>Lot<select name="lot${i}">${lotOpts(li)}</select></label>
      ${lotsCompatibles(li).length ? '' : '<p class="alert">Aucun lot en stock pour ce produit.</p>'}
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

  onSubmit(form, async (f) => {
    // Vérifie que chaque lot contient assez de bois.
    const besoin = new Map();
    c.lignes.forEach((li, i) => { const id = f[`lot${i}`]; if (id) besoin.set(id, (besoin.get(id) || 0) + num(li.quantite)); });
    for (const [id, q] of besoin) {
      const lot = S.lots.find((l) => l.id === id);
      if (!lot || lot.quantite + 1e-9 < q) {
        toast(`Stock insuffisant dans le lot choisi (${lot ? qty(lot.quantite, lot.contenant) : '0'}). Corrigez le stock ou choisissez « ne pas retirer ».`, 5000);
        return;
      }
    }
    const mvtIds = [];
    for (let i = 0; i < c.lignes.length; i++) {
      const id = f[`lot${i}`];
      if (!id) continue;
      const li = c.lignes[i];
      const lot = S.lots.find((l) => l.id === id);
      lot.quantite = Math.max(0, round(lot.quantite - num(li.quantite)));
      await saveLot(lot);
      const m = await saveMvt({ type: 'livraison', date: f.date, lotId: lot.id, delta: -num(li.quantite), commandeId: c.id, client: c.client?.nom, note: `Commande n° ${c.numero}`, ...snap(lot) });
      mvtIds.push(m.id);
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
    <h2>Export pour Excel / comptabilité</h2>
    <div class="row">
      <button id="csv-stock">Stock (lots)</button>
      <button id="csv-mvts">Mouvements</button>
      <button id="csv-cmds">Commandes</button>
    </div>
  </section>

  <section class="card">
    <h2>Catalogue</h2>
    <p class="hint">Un élément par ligne. Renommer un élément ne modifie pas les lots déjà enregistrés.</p>
    <form id="form-cat">
      <div class="grid2">
        <label>Essences<textarea name="essences" rows="7">${esc(s.essences.join('\n'))}</textarea></label>
        <label>Longueurs<textarea name="longueurs" rows="7">${esc(s.longueurs.join('\n'))}</textarea></label>
      </div>
      <label>Contenants <small class="muted">(nom = unité, ex. « Stère = st »)</small><textarea name="contenants" rows="5">${esc(s.contenants.map((c) => `${c.nom} = ${c.unite}`).join('\n'))}</textarea></label>
      <h3>Lieux de stockage</h3>
      <div id="lieux">${s.lieux.map((l) => `<div class="row lieu"><input data-id="${esc(l.id)}" value="${esc(l.nom)}"><button type="button" class="danger small" data-rm-lieu>Retirer</button></div>`).join('')}</div>
      <button type="button" id="add-lieu">+ Ajouter un lieu</button>
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
  $('#csv-stock', root).onclick = () => exportCSV('stock');
  $('#csv-mvts', root).onclick = () => exportCSV('mouvements');
  $('#csv-cmds', root).onclick = () => exportCSV('commandes');
  $('#btn-backup', root).onclick = backup;
  $('#input-import', root).onchange = (e) => restore(e.target.files[0]);

  const lieux = $('#lieux', root);
  const bindLieu = (row) => {
    $('[data-rm-lieu]', row).onclick = () => {
      const id = $('input', row).dataset.id;
      if (S.lots.some((l) => l.lieu === id && l.quantite > 0)) { toast('Ce lieu contient encore du bois : déplacez ou videz les lots d’abord.', 4000); return; }
      if ($$('.lieu', lieux).length <= 1) { toast('Il faut au moins un lieu'); return; }
      row.remove();
    };
  };
  $$('.lieu', lieux).forEach(bindLieu);
  $('#add-lieu', root).onclick = () => {
    lieux.insertAdjacentHTML('beforeend', `<div class="row lieu"><input data-id="${uid()}" placeholder="ex. Hangar, couvert de …"><button type="button" class="danger small" data-rm-lieu>Retirer</button></div>`);
    bindLieu(lieux.lastElementChild);
    $('input', lieux.lastElementChild).focus();
  };

  $('#form-cat', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const lines = (v) => [...new Set(String(v).split('\n').map((x) => x.trim()).filter(Boolean))];
    const s = S.settings;
    const ess = lines(f.essences); const lon = lines(f.longueurs);
    const con = lines(f.contenants).map((x) => { const [nom, u] = x.split('='); return { nom: nom.trim(), unite: (u || nom).trim() }; });
    const li = $$('input', lieux).map((i) => ({ id: i.dataset.id, nom: i.value.trim() })).filter((l) => l.nom);
    if (!ess.length || !lon.length || !con.length || !li.length) { toast('Chaque liste doit contenir au moins un élément'); return; }
    Object.assign(s, { essences: ess, longueurs: lon, contenants: con, lieux: li, entreprises: lines(f.entreprises) });
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
    rows = [['Essence', 'Longueur', 'Contenant', 'Quantité', 'Unité', 'État', 'Lieu', 'Mis en tas le', 'Provenance', 'Humidité %', 'Remarque']];
    for (const l of S.lots) rows.push([l.essence, l.longueur, l.contenant, nb(l.quantite), unite(l.contenant), ETATS[l.etat], lieuNom(l.lieu), l.dateMise, l.provenance, nb(l.humidite), l.note]);
  } else if (kind === 'mouvements') {
    rows = [['Date', 'Type', 'Essence', 'Longueur', 'Contenant', 'Quantité', 'Unité', 'Lieu', 'Entreprise / fournisseur', 'Client', 'Prix CHF', 'Remarque']];
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
    await db.put('kv', { key: 'settings', value: { ...structuredClone(DEFAULT_SETTINGS), ...data.settings } });
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
  entrees: { title: 'Entrées de bois', render: renderEntrees, bind: bindEntrees },
  livraisons: { title: 'Commandes & livraisons', render: renderLivraisons, bind: bindLivraisons },
  plus: { title: 'Historique & réglages', render: renderPlus, bind: bindPlus },
};

function render() {
  const v = VIEWS[S.view];
  const main = $('#view');
  const scroll = main.scrollTop;
  main.innerHTML = v.render();
  v.bind(main);
  fillImages(main);
  main.scrollTop = scroll;
  $('#view-title').textContent = v.title;
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  $('#dl-entreprises').innerHTML = S.settings.entreprises.map((e) => `<option value="${esc(e)}">`).join('');
  const nbLiv = S.cmds.filter((c) => c.statut === 'planifiee' && c.datePrevue <= today()).length;
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
  if (!kv) await saveSettings();
  [S.lots, S.mvts, S.cmds] = await Promise.all([db.all('lots'), db.all('mouvements'), db.all('commandes')]);
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
