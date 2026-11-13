// Fiche de secours : affichée sur le téléphone et imprimable en A4 (PDF).

import { SYMBOLS, SYMBOL_BY_KIND, symbolSvg } from './symbols.js';
import { symbolLayer, esc, bearing, PARCEL_STYLE, PARCEL_STYLE_OUTLINE } from './draw.js';
import { wgs84ToLV95, formatLV95, polygonArea, formatArea } from './swiss.js';
import { planLink, qrSvg } from './share.js';

/** Contacts par défaut – version vaudoise. */
export const DEFAUT_MEDECIN = 'Médecin de garde VD – 0848 133 133';
const ANCIEN_MEDECIN = null;
export const DEFAUT_HOPITAL = 'CHUV, Lausanne – 021 314 11 11';

/**
 * Responsables (nom, fonction, téléphone) : enregistrés seulement sur cet appareil,
 * jamais dans le code publié. Saisis une fois via « Modifier la liste… ».
 */
const LS_RESP = 'vd-responsables';
export function getResponsables() {
  try {
    const l = JSON.parse(localStorage.getItem(LS_RESP) || '[]');
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}
export function setResponsables(list) {
  localStorage.setItem(LS_RESP, JSON.stringify(list));
}
/** « Nom, Fonction, 079 123 45 67 » (une personne par ligne) -> liste */
function parseResponsables(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/[,;]|\s[–-]\s/).map((x) => x.trim()).filter(Boolean);
    const telIdx = parts.findIndex((x) => /\d{2}/.test(x));
    const tel = telIdx >= 0 ? parts.splice(telIdx, 1)[0] : '';
    return { nom: parts[0] || '', role: parts.slice(1).join(', '), tel };
  }).filter((r) => r.nom);
}

const NUMEROS = [
  ['144', 'Ambulance'],
  ['1414', 'Rega'],
  ['112', 'Urgence'],
  ['118', 'Pompiers'],
  ['117', 'Police'],
  ['145', 'Tox Info'],
];

const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');

function coordBlock(s) {
  const { E, N } = wgs84ToLV95(s.lat, s.lng);
  return `<span class="c-lv95">${fmt(E)} / ${fmt(N)}</span>
    <span class="c-wgs">${s.lat.toFixed(5)}° N, ${s.lng.toFixed(5)}° E${s.alt ? ` · alt. ${Math.round(s.alt)} m` : ''}</span>`;
}

let ficheMap = null;

/* Dictée vocale (reconnaissance de la parole du navigateur, en français) */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const DICTEE = !!SR;
let dictee = null; // { rec, btn }

function stopDictee() {
  if (!dictee) return;
  dictee.rec.stop();
  dictee.btn.classList.remove('on');
  dictee = null;
}

/** Retire un début de phrase répété (« coupe coupe de mise coupe de mise en lumière » → « coupe de mise en lumière »). */
function sansRepetition(t) {
  const mots = t.split(/\s+/);
  for (let n = 1; n <= mots.length / 2; n++) {
    // si le texte se termine par une phrase qui commence par les mêmes mots que le début, ne garder que la fin
    for (let i = 1; i < mots.length; i++) {
      const fin = mots.slice(i);
      const debut = mots.slice(0, i);
      if (fin.length >= debut.length && debut.join(' ').toLowerCase() === fin.slice(0, debut.length).join(' ').toLowerCase()) {
        return sansRepetition(fin.join(' '));
      }
    }
  }
  return t;
}

/** Écoute une phrase et l'ajoute à la fin de la case. */
function startDictee(btn, textarea) {
  const same = dictee?.btn === btn;
  stopDictee();
  if (same) return;
  const rec = new SR();
  rec.lang = 'fr-CH';
  // Une phrase par toucher : le mode continu de Chrome Android renvoie des morceaux en double.
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  const base = textarea.value.trim();
  rec.onresult = (e) => {
    // La DERNIÈRE version reçue contient toute la phrase : on remplace, on n'ajoute pas.
    let dit = sansRepetition(e.results[e.results.length - 1][0].transcript.trim());
    if (!dit) return;
    dit = dit[0].toUpperCase() + dit.slice(1);
    textarea.value = [base, dit].filter(Boolean).join(base && !/[.\n]$/.test(base) ? '. ' : '\n');
    textarea.dispatchEvent(new Event('input'));
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed') alert('Autorisez le micro pour cette application (réglages du navigateur).');
    else if (e.error === 'network') alert('La dictée a besoin du réseau.');
  };
  rec.onend = () => {
    if (dictee?.rec === rec) stopDictee();
  };
  dictee = { rec, btn };
  btn.classList.add('on');
  rec.start();
}


/**
 * @param {HTMLElement} root
 * @param {object} chantier
 * @param {object} opt { onChange(), onClose(), makeBaseLayer(), extraLayers() }
 */
export function renderFiche(root, chantier, opt) {
  const info = chantier.info;
  // Valeurs habituelles du triage (modifiables sur la fiche ; une case vidée reste vide)
  if (info.medecin === undefined || info.medecin === ANCIEN_MEDECIN) info.medecin = DEFAUT_MEDECIN;
  if (info.hopital === undefined) info.hopital = DEFAUT_HOPITAL;
  const RESPONSABLES = getResponsables();
  if (info.responsable === undefined && info.resp_tel === undefined && RESPONSABLES[0]) {
    Object.assign(info, { responsable: RESPONSABLES[0].nom, resp_role: RESPONSABLES[0].role, resp_tel: RESPONSABLES[0].tel });
  }
  const sym = (kind) => chantier.symbols.filter((s) => s.kind === kind);
  const heli = sym('heli')[0];

  const field = (key, label, { multi = false, ph = '', type = 'text' } = {}) => `
    <label class="ff ${multi ? 'ff-multi' : ''}"><span>${esc(label)}${multi && DICTEE ? `<button type="button" class="mic no-print" data-mic="${key}" aria-label="Dicter : ${esc(label)}">🎤</button>` : ''}</span>
      ${multi
        ? `<textarea data-key="${key}" rows="1" placeholder="${esc(ph)}">${esc(info[key] || '')}</textarea>`
        : `<input type="${type}" data-key="${key}" value="${esc(info[key] || '')}" placeholder="${esc(ph)}">`}
    </label>`;

  const coordLine = (kind, title) => {
    const list = sym(kind);
    return `<div class="f-row f-coordrow"><span>${symbolSvg(kind, 20)} ${title}</span><div class="f-val">${list.length
      ? list.map(coordBlock).join('')
      : '<span class="missing">à placer sur la carte (étape 2)</span>'}</div></div>`;
  };

  const kindsUsed = SYMBOLS.filter((d) => chantier.symbols.some((s) => s.kind === d.kind) && !['texte', 'zone'].includes(d.kind));
  const zones = chantier.symbols.filter((s) => s.kind === 'zone' && s.text);
  const legendIcon = (d) => symbolSvg(d.kind, d.mode === 'point' && !['heli', 'point_t'].includes(d.kind) ? 20 : 18);
  const area = chantier.parcel ? formatArea(polygonArea(L.polygon(chantier.parcel))).split(' (')[0] : '';

  const DANGERS = ['Chute de hauteur', 'Chute de pierres', 'Bois mort', 'Ligne électrique', 'Route, trafic', 'Tiers (promeneurs…)', 'Pas de réseau mobile', 'Pente raide', 'Autres'];
  if (info.mesures === undefined && typeof info.dangers === 'string') info.mesures = info.dangers; // ancienne case « Dangers et mesures »
  const coches = new Set(Array.isArray(info.dangers_coches) ? info.dangers_coches : []);
  const T = sym('point_t')[0];
  // Case remplie depuis la carte (lieu-dit, commune, adresse) tant qu'on ne l'a pas modifiée soi-même
  const placeRow = (key, label, point, ph) => `
    <div class="f-row f-row-stack"><span>${label}</span><div class="f-auto">
      <textarea data-key="${key}" rows="1" placeholder="${esc(ph)}">${esc(info[key] ?? point?.place ?? point?.text ?? '')}</textarea>
      ${point?.place ? `<button type="button" class="f-refresh no-print" data-refresh="${key}" data-place="${esc(point.place)}" title="Reprendre depuis la carte" aria-label="Reprendre depuis la carte">↻</button>` : ''}
    </div></div>`;

  const extras = opt.extraLayers ? opt.extraLayers() : [];

  root.innerHTML = `
  <div class="fiche-bar no-print">
    <button type="button" id="fiche-close">← Carte</button>
    <span class="spacer"></span>
    <button type="button" id="fiche-print" class="primary">🖨 Imprimer / PDF</button>
  </div>

  <div class="fiche-calls no-print">
    <a href="tel:144" class="call c144"><b>144</b> Ambulance</a>
    <a href="tel:1414" class="call c1414"><b>1414</b> Rega</a>
    <a href="tel:${esc((info.resp_tel || '').replace(/\s/g, ''))}" class="call c-resp" id="call-resp" ${info.resp_tel ? '' : 'hidden'}>
      <b id="call-resp-nom">${esc(info.responsable || '')}</b><span id="call-resp-role">${esc([info.resp_role, info.resp_tel].filter(Boolean).join(' · '))}</span>
    </a>
  </div>

  <article class="page">
    <header class="f-head">
      <div>
        <div class="f-kicker">ORGANISATION DE CHANTIER · VAUD</div>
        <input class="f-title" data-key="name" value="${esc(info.name || '')}" placeholder="Nom du chantier">
      </div>
      <img src="img/logo-triage.jpg" alt="Triage forestier du Vallon" class="f-logo">
    </header>

    <h2 class="f-sec">Attribution du travail</h2>
    <section class="f-work">
      <div class="f-col">
        ${field('travaux', 'Quoi, où, pourquoi ?', { multi: true, ph: 'Coupe, lieu, but…' })}
        ${field('methode', 'Comment, avec quoi ?', { multi: true, ph: 'Méthode, machines, débardage…' })}
        ${field('volume', 'Combien ? (volume)', { multi: true, ph: 'm³ par essence…' })}
        <div class="f-pair">
          ${field('date', 'Début', { type: 'date' })}
          ${field('date_fin', 'Fin', { type: 'date' })}
        </div>
        ${field('mesures', 'Mesures', { multi: true, ph: 'Bâches, trois lattes, sentinelles…' })}
        ${field('autres_travaux', 'Autres travaux', { multi: true })}
      </div>
      <div class="f-col">
        <div class="f-resp">
          <label class="ff"><span>Responsable</span>
            <select id="resp-select">
              ${RESPONSABLES.map((r, i) => `<option value="${i}" ${r.nom === info.responsable ? 'selected' : ''}>${esc(r.nom)} – ${esc(r.role)}</option>`).join('')}
              <option value="autre" ${RESPONSABLES.some((r) => r.nom === info.responsable) ? '' : 'selected'}>Autre…</option>
              <option value="liste">✎ Modifier la liste…</option>
            </select>
            <input data-key="responsable" id="resp-nom" value="${esc(info.responsable || '')}" placeholder="Nom" ${RESPONSABLES.some((r) => r.nom === info.responsable) ? 'hidden' : ''}>
          </label>
          ${field('resp_tel', 'Téléphone', { type: 'tel' })}
        </div>
        <div class="ff resp-print"><span>Responsable</span><div class="resp-print-txt" id="resp-print">${esc([info.responsable, info.resp_role, info.resp_tel].filter(Boolean).join(' – '))}</div></div>
        ${field('equipe', 'Collaborateurs (nom – téléphone)', { multi: true })}
        ${field('formateur', 'Formateur', { multi: true })}
        ${field('apprentis', 'Apprentis', { multi: true })}
        <div class="ff"><span>Dangers particuliers</span>
          <div class="f-checks">${DANGERS.map((d) => `<label><input type="checkbox" data-danger="${esc(d)}" ${coches.has(d) ? 'checked' : ''}> ${esc(d)}</label>`).join('')}</div>
        </div>
      </div>
    </section>

    <h2 class="f-sec">Organisation en cas d'urgence</h2>
    <section class="f-cols">
    <div class="f-suva">
      <h3>Numéros d'urgence</h3>
      <div class="f-nums">${NUMEROS.map(([n, l]) => `<div><span>${l}</span><b>${n}</b></div>`).join('')}</div>
      <div class="f-contacts">
        <div class="f-row"><span>Médecin</span><div class="f-auto"><textarea data-key="medecin" rows="1" placeholder="Nom – téléphone">${esc(info.medecin || '')}</textarea></div></div>
        <div class="f-row"><span>Hôpital</span><div class="f-auto"><textarea data-key="hopital" rows="1" placeholder="Nom – téléphone">${esc(info.hopital || '')}</textarea></div></div>
      </div>
      <h3>Sauvetage aérien <small>(milieu du lieu d'abattage)</small></h3>
      <div class="f-contacts">
        ${placeRow('lieu_h', 'Lieu-dit', heli, 'ex. Alpage de Tracuit, Chalais')}
        ${coordLine('heli', 'Coordonnées H')}
      </div>
      <h3>Sauvetage terrestre <small>(point T)</small></h3>
      <div class="f-contacts">
        ${placeRow('localite_t', 'Lieu / adresse', T, 'ex. Les Ziettes, Vercorin')}
        ${coordLine('point_t', 'Coordonnées T')}
      </div>
    </div>

    <div class="f-box f-alarme">
      <h3>Annonce d'une urgence</h3>
      <ol>
        <li><b>Qui</b> donne l'alerte ? (nom, n° de téléphone)</li>
        <li><b>Que</b> s'est-il passé ?</li>
        <li><b>Quand</b> a eu lieu l'accident ?</li>
        <li><b>Où</b> sont les blessés ? Lire les <b>coordonnées H ou T</b></li>
        <li><b>Combien</b> de blessés ?</li>
        <li><b>Autres dangers</b> : câbles, lignes électriques, météo, vent</li>
      </ol>
      <p class="f-small">Rester joignable. Ne pas raccrocher le premier. Envoyer quelqu'un au point de rencontre (T).</p>
      <p class="f-small"><b>L'organisation en cas d'urgence doit être connue de tous et vérifiée chaque jour</b> (météo, visibilité, accès).</p>
    </div>
    </section>
  </article>

  <article class="page page-plan">
    <header class="f-head f-head-small">
      <div>
        <div class="f-kicker">ORGANISATION DE CHANTIER · PLAN DE COUPE</div>
        <div class="f-title-small">${esc(info.name || '')}${area ? ` <small>· parcelle ${esc(area)}</small>` : ''}</div>
      </div>
      <img src="img/logo-triage.jpg" alt="" class="f-logo f-logo-small">
    </header>
    <section class="f-plan">
      <div class="f-mapwrap">
        <div id="fiche-map"></div>
        <div class="f-north" aria-label="Nord"><svg width="26" height="40" viewBox="0 0 26 40"><path d="M13 2L22 30L13 25L4 30Z" fill="#333"/><path d="M13 2L13 25L4 30Z" fill="#888"/><text x="13" y="39" font-size="10" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" fill="#111">N</text></svg></div>
        <div class="f-ratio" id="f-ratio"></div>
        <svg class="f-tarrow" id="f-tarrow" aria-hidden="true"></svg>
        <div class="f-inset" id="f-inset" hidden>
          <div id="fiche-inset-map"></div>
          <button type="button" class="f-inset-reset no-print" id="f-inset-reset" title="Remettre à sa place" aria-label="Remettre le cartouche à sa place">↺</button>
          <button type="button" class="f-inset-side no-print" id="f-inset-side" title="Texte à côté / en dessous" aria-label="Mettre le texte à côté ou en dessous">⇆</button>
          <div class="f-inset-handle no-print" id="f-inset-handle" title="Agrandir / réduire" aria-label="Agrandir ou réduire le cartouche"></div>
          <div class="f-inset-cap" id="f-inset-cap"></div>
        </div>
        <button type="button" class="f-recadrer no-print" id="f-recadrer" ${chantier.ficheView ? '' : 'hidden'}>↺ Cadrage automatique</button>
      </div>
      <div class="f-plan-foot">
      <div class="f-legend">
        <b>Légende :</b>
        ${chantier.parcel ? '<span><i class="lg-parcel"></i>Parcelle</span>' : ''}
        ${kindsUsed.map((d) => `<span>${legendIcon(d)}${esc(d.label)}</span>`).join('')}
        ${zones.map((z) => `<span><i class="lg-zone" style="border-color:${z.color};background:${z.color}33"></i>${esc(z.text)}</span>`).join('')}
      </div>
      <div class="f-qr" id="f-qr" hidden><div id="f-qr-img"></div><span>Scannez pour voir<br>votre position sur ce plan</span></div>
      </div>
    </section>
  </article>`;

  const updateCall = () => {
    const a = root.querySelector('#call-resp');
    a.hidden = !info.resp_tel;
    a.href = `tel:${(info.resp_tel || '').replace(/\s/g, '')}`;
    root.querySelector('#call-resp-nom').textContent = info.responsable || 'Responsable';
    root.querySelector('#call-resp-role').textContent = [info.resp_role, info.resp_tel].filter(Boolean).join(' · ');
    root.querySelector('#resp-print').textContent = [info.responsable, info.resp_role, info.resp_tel].filter(Boolean).join(' – ');
  };
  root.querySelector('#resp-select').addEventListener('change', (e) => {
    if (e.target.value === 'liste') {
      const actuel = RESPONSABLES.map((r) => [r.nom, r.role, r.tel].filter(Boolean).join(', ')).join('\n');
      const dlg = document.createElement('dialog');
      dlg.className = 'dialog';
      dlg.innerHTML = `<form method="dialog"><header><h2>Responsables</h2></header>
        <div class="dialog-body"><p class="hint">Une personne par ligne : <b>Nom, Fonction, Téléphone</b>.<br>Cette liste reste sur ce téléphone (elle n'est pas publiée).</p>
        <textarea rows="6" style="width:100%;font-size:15px;padding:8px" placeholder="Prénom Nom, Contremaître, 079 000 00 00">${esc(actuel)}</textarea></div>
        <footer><div class="row"><span class="spacer"></span><button value="cancel">Annuler</button><button value="ok" class="primary">Enregistrer</button></div></footer></form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('close', () => {
        if (dlg.returnValue === 'ok') {
          const list = parseResponsables(dlg.querySelector('textarea').value);
          setResponsables(list);
          if (list[0] && !list.some((r) => r.nom === info.responsable)) Object.assign(info, { responsable: list[0].nom, resp_role: list[0].role, resp_tel: list[0].tel });
          opt.onChange();
        }
        dlg.remove();
        renderFiche(root, chantier, opt);
      });
      dlg.showModal();
      return;
    }
    const r = RESPONSABLES[e.target.value];
    const nom = root.querySelector('#resp-nom');
    const tel = root.querySelector('[data-key="resp_tel"]');
    if (r) {
      Object.assign(info, { responsable: r.nom, resp_role: r.role, resp_tel: r.tel });
      nom.hidden = true;
    } else {
      Object.assign(info, { responsable: '', resp_role: '', resp_tel: '' });
      nom.hidden = false;
      nom.focus();
    }
    nom.value = info.responsable;
    tel.value = info.resp_tel;
    updateCall();
    opt.onChange();
  });
  root.querySelector('#resp-nom').addEventListener('input', updateCall);
  root.querySelector('[data-key="resp_tel"]').addEventListener('input', updateCall);

  // QR code du plan (le plan est contenu dans le lien)
  planLink(chantier).then((url) => {
    if (!url) return;
    try {
      root.querySelector('#f-qr-img').innerHTML = qrSvg(url);
      root.querySelector('#f-qr').hidden = false;
    } catch (e) {
      console.warn('QR', e); // plan trop grand pour un QR code
    }
  });

  root.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', () => {
    const input = root.querySelector(`[data-key="${b.dataset.refresh}"]`);
    input.value = b.dataset.place;
    input.dispatchEvent(new Event('input')); // agrandit la case
    info[b.dataset.refresh] = b.dataset.place;
    opt.onChange();
  }));

  root.querySelectorAll('[data-danger]').forEach((cb) => cb.addEventListener('change', () => {
    info.dangers_coches = [...root.querySelectorAll('[data-danger]:checked')].map((x) => x.dataset.danger);
    opt.onChange();
  }));

  root.querySelectorAll('[data-mic]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    startDictee(b, root.querySelector(`textarea[data-key="${b.dataset.mic}"]`));
  }));

  // Champs : enregistrement automatique
  root.querySelectorAll('[data-key]').forEach((el) => {
    const grow = () => {
      if (el.tagName === 'TEXTAREA') {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight + 2}px`;
      }
    };
    el.addEventListener('input', () => {
      info[el.dataset.key] = el.value;
      grow();
      opt.onChange();
    });
    requestAnimationFrame(grow);
  });
  root.querySelector('#fiche-close').addEventListener('click', opt.onClose);
  root.querySelector('#fiche-print').addEventListener('click', () => printFiche(root, chantier));

  // Carte du plan
  if (ficheMap) ficheMap.remove();
  ficheMap = L.map(root.querySelector('#fiche-map'), {
    zoomControl: false,
    attributionControl: true,
    dragging: true,
    scrollWheelZoom: false,
    doubleClickZoom: true,
    touchZoom: true,
    tap: false,
    zoomSnap: 0.25,
  });
  ficheMap.attributionControl.setPrefix(false);
  opt.makeBaseLayer().addTo(ficheMap);
  extras.forEach((x) => x.layer.addTo(ficheMap));
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(ficheMap);
  if (chantier.parcel) {
    L.polygon(chantier.parcel, PARCEL_STYLE_OUTLINE).addTo(ficheMap);
    L.polygon(chantier.parcel, { ...PARCEL_STYLE, interactive: false }).addTo(ficheMap);
  }
  for (const s of chantier.symbols) symbolLayer(s, { interactive: false })?.addTo(ficheMap);
  if (insetMap) insetMap.remove();
  insetMap = null;
  ficheOpt = opt;
  fitFicheMap(chantier);
  ficheMap.on('zoomend', updateRatio);
  ficheMap.on('moveend zoomend resize', () => updateTInset(chantier));
  setupInsetDrag(root, chantier, opt);
  ficheMap.on('moveend', () => {
    if (recadrageAuto || root.classList.contains('print-layout')) return;
    const b = ficheMap.getBounds();
    chantier.ficheView = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
    root.querySelector('#f-recadrer').hidden = false;
    opt.onChange();
  });
  root.querySelector('#f-recadrer').addEventListener('click', () => {
    delete chantier.ficheView;
    fitFicheMap(chantier, { auto: true });
    root.querySelector('#f-recadrer').hidden = true;
    opt.onChange();
  });
}

let recadrageAuto = false;
let dernierChantier = null; // vrai pendant un recadrage fait par l'application (pas par l'utilisateur)

function fitFicheMap(chantier, { auto = false } = {}) {
  if (!ficheMap) return;
  dernierChantier = chantier;
  recadrageAuto = true;
  ficheMap.invalidateSize({ animate: false, pan: false });
  // Cadrage choisi à la main (zoom / déplacement) : on le garde, y compris pour l'impression
  const v = chantier.ficheView;
  if (v && !auto) {
    ficheMap.fitBounds([[v.s, v.w], [v.n, v.e]], { animate: false });
    recadrageAuto = false;
    updateRatio();
    updateTInset(chantier);
    return;
  }
  const loin = tLoin(chantier);
  const pts = [...(chantier.parcel || [])];
  for (const s of chantier.symbols) {
    if (loin && s === loin.T) continue; // point T éloigné : montré dans un cartouche
    if (s.lat != null) pts.push([s.lat, s.lng]);
    if (s.lat2 != null) pts.push([s.lat2, s.lng2]);
    if (s.pts) pts.push(...s.pts);
  }
  if (pts.length > 1) ficheMap.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 18, animate: false });
  else if (pts.length === 1) ficheMap.setView(pts[0], 17, { animate: false });
  else ficheMap.setView([46.8, 8.2], 8, { animate: false });
  recadrageAuto = false;
  updateRatio();
  updateTInset(chantier);
}

/* ------------------------------------------------------------------ */
/* Point T éloigné : cartouche (carte zoomée du point T) + flèche      */
/* ------------------------------------------------------------------ */
let insetMap = null;
let ficheOpt = null;

/** Tout le chantier sauf le point T. */
function chantierSansT(chantier, T) {
  const pts = [...(chantier.parcel || [])];
  for (const s of chantier.symbols) {
    if (s === T) continue;
    if (s.lat != null) pts.push([s.lat, s.lng]);
    if (s.lat2 != null) pts.push([s.lat2, s.lng2]);
    if (s.pts) pts.push(...s.pts);
  }
  return pts;
}

/**
 * Le point T est « loin » s'il se trouve à plus de 150 m du chantier ET à plus de
 * la moitié de la taille du chantier (sinon il agrandirait trop le plan).
 */
function tLoin(chantier) {
  const T = chantier.symbols.find((s) => s.kind === 'point_t');
  if (!T) return null;
  const pts = chantierSansT(chantier, T);
  if (!pts.length) return null;
  const b = L.latLngBounds(pts);
  const taille = Math.max(b.getSouthWest().distanceTo(b.getNorthEast()), 80);
  const proche = L.latLng(
    Math.min(Math.max(T.lat, b.getSouth()), b.getNorth()),
    Math.min(Math.max(T.lng, b.getWest()), b.getEast()),
  );
  const ecart = proche.distanceTo([T.lat, T.lng]);
  return ecart > Math.max(150, taille * 0.5) ? { T, bounds: b } : null;
}

/** Intersection rayon (p + t·d) / rectangle [x0,y0,x1,y1] : [tEntrée, tSortie] ou null. */
function rayBox(p, d, r) {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [pi, di, a, b] of [[p[0], d[0], r[0], r[2]], [p[1], d[1], r[1], r[3]]]) {
    if (Math.abs(di) < 1e-9) {
      if (pi < a || pi > b) return null;
    } else {
      const u = (a - pi) / di;
      const v = (b - pi) / di;
      t0 = Math.max(t0, Math.min(u, v));
      t1 = Math.min(t1, Math.max(u, v));
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);
const DIRS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];

/** Place et taille choisies à la main : fractions de la zone du plan (valables aussi à l'impression). */
function placeInset(wrap, box, pos) {
  wrap.classList.toggle('inset-free', !!pos);
  if (!pos) {
    box.style.cssText = '';
    return;
  }
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const w = Math.min(Math.max(pos.w * W, 110), W - 8);
  box.style.cssText = `width:${w}px;min-width:0;max-width:none;right:auto;bottom:auto;left:0;top:0;`;
  const h = box.offsetHeight;
  const x = Math.min(Math.max(pos.x * W, 0), W - w);
  const y = Math.min(Math.max(pos.y * H, 0), Math.max(H - h, 0));
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
}

/** Glisser le cartouche pour le déplacer ; poignée du coin pour changer sa taille. */
function setupInsetDrag(root, chantier, opt) {
  const box = root.querySelector('#f-inset');
  const wrap = box.closest('.f-mapwrap');
  const handle = root.querySelector('#f-inset-handle');
  let geste = null;
  const debut = (e, mode) => {
    if (e.button > 0 || e.target.closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    geste = { mode, id: e.pointerId, x0: e.clientX, y0: e.clientY, l: box.offsetLeft, t: box.offsetTop, w: box.offsetWidth };
    box.setPointerCapture(e.pointerId);
    box.classList.add('dragging');
  };
  box.addEventListener('pointerdown', (e) => debut(e, 'move'));
  handle.addEventListener('pointerdown', (e) => debut(e, 'size'));
  box.addEventListener('pointermove', (e) => {
    if (!geste || e.pointerId !== geste.id) return;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const dx = e.clientX - geste.x0;
    const dy = e.clientY - geste.y0;
    if (geste.mode === 'move') {
      chantier.tInset = { x: (geste.l + dx) / W, y: (geste.t + dy) / H, w: geste.w / W };
    } else {
      const w = Math.min(Math.max(geste.w + Math.max(dx, dy * 1.2), 110), W - geste.l);
      chantier.tInset = { x: geste.l / W, y: geste.t / H, w: w / W };
    }
    updateTInset(chantier);
  });
  const fin = (e) => {
    if (!geste || e.pointerId !== geste.id) return;
    geste = null;
    box.classList.remove('dragging');
    opt.onChange();
  };
  box.addEventListener('pointerup', fin);
  box.addEventListener('pointercancel', fin);
  root.querySelector('#f-inset-side').addEventListener('click', (e) => {
    e.stopPropagation();
    chantier.tInsetSide = !chantier.tInsetSide;
    updateTInset(chantier);
    opt.onChange();
  });

  // Flèche : glisser le trait pour la déplacer, glisser un bout pour l'allonger / la tourner
  const svg = root.querySelector('#f-tarrow');
  let fg = null;
  svg.addEventListener('pointerdown', (e) => {
    const part = e.target.closest('[data-part]')?.dataset.part;
    if (!part || !svg._ab) return;
    e.preventDefault();
    e.stopPropagation();
    if (part === 'reset') {
      delete chantier.tArrow;
      updateTInset(chantier);
      opt.onChange();
      return;
    }
    fg = { part, id: e.pointerId, x0: e.clientX, y0: e.clientY, a: [...svg._ab.a], b: [...svg._ab.b] };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!fg || e.pointerId !== fg.id) return;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const dx = e.clientX - fg.x0;
    const dy = e.clientY - fg.y0;
    const bouge = (p, on) => (on ? [Math.min(Math.max(p[0] + dx, 0), W), Math.min(Math.max(p[1] + dy, 0), H)] : p);
    const a = bouge(fg.a, fg.part !== 'b');
    const b = bouge(fg.b, fg.part !== 'a');
    chantier.tArrow = { a: [a[0] / W, a[1] / H], b: [b[0] / W, b[1] / H] };
    updateTInset(chantier);
  });
  const finFleche = (e) => {
    if (!fg || e.pointerId !== fg.id) return;
    fg = null;
    opt.onChange();
  };
  svg.addEventListener('pointerup', finFleche);
  svg.addEventListener('pointercancel', finFleche);

  root.querySelector('#f-inset-reset').addEventListener('click', (e) => {
    e.stopPropagation();
    delete chantier.tInset;
    updateTInset(chantier);
    opt.onChange();
  });
}

/** Affiche le cartouche et la flèche quand le point T est en dehors du plan affiché. */
function updateTInset(chantier) {
  const wrap = ficheMap?.getContainer().closest('.f-mapwrap');
  if (!wrap) return;
  const box = wrap.querySelector('#f-inset');
  const svg = wrap.querySelector('#f-tarrow');
  const T = chantier.symbols.find((s) => s.kind === 'point_t');
  const pts = T ? chantierSansT(chantier, T) : [];
  const vue = ficheMap.getBounds();
  const marge = vue.pad(-0.03);
  if (!T || !pts.length || marge.contains([T.lat, T.lng])) {
    box.hidden = true;
    svg.innerHTML = '';
    wrap.classList.remove('inset-tl', 'inset-tr', 'inset-bl', 'inset-br');
    return;
  }

  const el = ficheMap.getContainer();
  const ox = el.offsetLeft;
  const oy = el.offsetTop;
  const W = el.clientWidth;
  const H = el.clientHeight;
  const px = (ll) => {
    const q = ficheMap.latLngToContainerPoint(L.latLng(ll));
    return [q.x + ox, q.y + oy];
  };
  const cb = L.latLngBounds(pts);
  const heli = chantier.symbols.find((s) => s.kind === 'heli');
  const depart = heli ? L.latLng(heli.lat, heli.lng) : cb.getCenter();
  const c = px(depart);
  const t = px([T.lat, T.lng]);
  const d = [t[0] - c[0], t[1] - c[1]];

  // Coin du cartouche : du côté du point T (ou la place choisie à la main)
  const coin = `${d[1] < 0 ? 't' : 'b'}${d[0] < 0 ? 'l' : 'r'}`;
  wrap.classList.remove('inset-tl', 'inset-tr', 'inset-bl', 'inset-br');
  wrap.classList.add(`inset-${coin}`);
  box.hidden = false;
  box.classList.toggle('side', !!chantier.tInsetSide);
  placeInset(wrap, box, chantier.tInset);

  const dist = depart.distanceTo([T.lat, T.lng]);
  const cap = bearing(depart, [T.lat, T.lng]);
  const dir = DIRS[Math.round(cap / 45) % 8];
  const lieu = chantier.info.localite_t || T.place || '';
  wrap.querySelector('#f-inset-cap').innerHTML = `<strong>Point T à ${fmtDist(dist)} au ${dir}</strong><br>${lieu ? `${esc(lieu.split(' – ')[0])}<br>` : ''}<span>${formatLV95(T.lat, T.lng).replace(', ', ' / ')}</span>`;

  // Petite carte zoomée sur le point T
  const im = wrap.querySelector('#fiche-inset-map');
  if (!insetMap) {
    insetMap = L.map(im, {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, tap: false,
    });
    ficheOpt.makeBaseLayer().addTo(insetMap);
    if (chantier.parcel) L.polygon(chantier.parcel, { ...PARCEL_STYLE, interactive: false }).addTo(insetMap);
  }
  insetMap.eachLayer((l) => { if (l.options?.tMarker) l.remove(); });
  L.marker([T.lat, T.lng], {
    icon: L.divIcon({ className: 'sym', html: symbolSvg('point_t', 26), iconSize: [26, 26], iconAnchor: [13, 13] }),
    interactive: false, tMarker: true,
  }).addTo(insetMap);
  insetMap.invalidateSize({ animate: false, pan: false });
  insetMap.setView([T.lat, T.lng], 16, { animate: false });

  // Flèche : du bord du chantier vers le cartouche
  const len = Math.hypot(d[0], d[1]) || 1;
  const u = [d[0] / len, d[1] / len];
  const zb = chantier.parcel?.length > 2 ? L.latLngBounds(chantier.parcel) : cb; // la flèche part du bord de la parcelle
  const pb = [px([zb.getNorth(), zb.getWest()]), px([zb.getSouth(), zb.getEast()])];
  const rc = [pb[0][0], pb[0][1], pb[1][0], pb[1][1]];
  const m = 12;
  const rMap = [ox + m, oy + m, ox + W - m, oy + H - m];
  const ib = [box.offsetLeft - 6, box.offsetTop - 6, box.offsetLeft + box.offsetWidth + 6, box.offsetTop + box.offsetHeight + 6];
  const tSortie = rayBox(c, u, rc)?.[1] ?? 0;
  let tFin = rayBox(c, u, rMap)?.[1] ?? 0;
  const vInset = rayBox(c, u, ib);
  if (vInset && vInset[0] > 0) tFin = Math.min(tFin, vInset[0]);
  let tDebut = Math.max(tSortie + 8, 0);
  if (tFin - tDebut < 40) tDebut = Math.max(0, tFin - 40);
  let a = [c[0] + u[0] * tDebut, c[1] + u[1] * tDebut];
  let b = [c[0] + u[0] * tFin, c[1] + u[1] * tFin];
  const WW = wrap.clientWidth;
  const HH = wrap.clientHeight;
  const fl = chantier.tArrow; // flèche placée à la main (fractions de la zone du plan)
  if (fl) {
    a = [fl.a[0] * WW, fl.a[1] * HH];
    b = [fl.b[0] * WW, fl.b[1] * HH];
  }
  svg._ab = { a, b };
  const lg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const v = [(b[0] - a[0]) / lg, (b[1] - a[1]) / lg];
  const ang = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  svg.setAttribute('viewBox', `0 0 ${wrap.clientWidth} ${wrap.clientHeight}`);
  svg.innerHTML = `
    <line x1="${a[0]}" y1="${a[1]}" x2="${b[0] - v[0] * 10}" y2="${b[1] - v[1] * 10}" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
    <line x1="${a[0]}" y1="${a[1]}" x2="${b[0] - v[0] * 10}" y2="${b[1] - v[1] * 10}" stroke="#1a8fd0" stroke-width="4" stroke-dasharray="10 6" stroke-linecap="round"/>
    <g transform="translate(${b[0]} ${b[1]}) rotate(${ang})"><path d="M2 0L-16 -10L-12 0L-16 10Z" fill="#1a8fd0" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></g>
    <line class="ta-grip" data-part="body" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="transparent" stroke-width="26"/>
    <circle class="ta-grip ta-end" data-part="a" cx="${a[0]}" cy="${a[1]}" r="9"/>
    <circle class="ta-grip ta-end" data-part="b" cx="${b[0] - v[0] * 6}" cy="${b[1] - v[1] * 6}" r="9"/>
    ${fl ? `<g class="ta-grip ta-reset" data-part="reset" transform="translate(${a[0] - v[0] * 24} ${a[1] - v[1] * 24})"><circle r="12"/><text y="5" text-anchor="middle">↺</text></g>` : ''}`;
}

/** Passe en mise en page A4, recadre la carte, attend les fonds de carte puis imprime. */
export function printFiche(root, chantier) {
  root.classList.add('print-layout');
  root.querySelectorAll('input[type=date]').forEach((d) => d.classList.toggle('is-empty', !d.value));
  root.querySelectorAll('textarea').forEach((t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; });
  fitFicheMap(chantier);
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    window.print();
  };
  ficheMap?.eachLayer((l) => l.once?.('load', () => setTimeout(go, 300)));
  setTimeout(go, 2500);
}

window.addEventListener('afterprint', () => {
  const root = document.querySelector('#fiche.print-layout');
  if (!root) return;
  root.classList.remove('print-layout');
  if (ficheMap && dernierChantier) fitFicheMap(dernierChantier); // revient au cadrage enregistré (sans l'écraser)
});

/** Échelle approximative du plan (1 : N) d'après le zoom et la taille à l'écran / sur papier. */
function updateRatio() {
  const el = document.getElementById('f-ratio');
  if (!el || !ficheMap) return;
  const lat = ficheMap.getCenter().lat;
  const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** ficheMap.getZoom());
  const ratio = mPerPx / (0.0254 / 96);
  const nice = [250, 500, 700, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 100000];
  const r = nice.reduce((best, x) => (Math.abs(Math.log(x / ratio)) < Math.abs(Math.log(best / ratio)) ? x : best), nice[0]);
  el.textContent = `Échelle ≈ 1 : ${r.toLocaleString('fr-CH')}`;
}

export function closeFicheMap() {
  stopDictee();
  if (insetMap) insetMap.remove();
  insetMap = null;
  if (ficheMap) ficheMap.remove();
  ficheMap = null;
}

export { SYMBOL_BY_KIND };
