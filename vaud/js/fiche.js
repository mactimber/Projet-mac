// Fiche de secours : affichée sur le téléphone et imprimable en A4 (PDF).

import { SYMBOLS, SYMBOL_BY_KIND, symbolSvg } from './symbols.js';
import { symbolLayer, esc, bearing, PARCEL_STYLE_OUTLINE } from './draw.js';

/** Périmètre de coupe sur les plans de la fiche : rempli de rouge, bien visible (comme le plan CFPF). */
const PARCEL_FICHE = { color: '#d62d20', weight: 2.5, fillColor: '#e8573f', fillOpacity: 0.38 };
import { wgs84ToLV95, formatLV95 } from './swiss.js';
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

/* Numéros d'urgence du plan de secours, avec petits pictogrammes */
const PICTO = (body, fond = '#fff') => `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="${fond}" stroke="#111" stroke-width="1.5"/>${body}</svg>`;
const NUMS_SECOURS = [
  ['144', 'Ambulance', PICTO('<path d="M10 5h4v5h5v4h-5v5h-4v-5H5v-4h5z" fill="#fff"/>', '#e31e24')],
  ['117', 'Police', PICTO('<path d="M12 4.5l6 2.2v4.6c0 4-2.6 6.6-6 7.9-3.4-1.3-6-3.9-6-7.9V6.7z" fill="#fff"/>', '#1e4fa3')],
  ['118', 'Pompiers', PICTO('<path d="M12 4c1 3.2 4.6 5 4.6 9a4.6 4.6 0 0 1-9.2 0c0-2 1-3.3 2-4.4.2 1.4.9 2.3 1.8 2.6-.6-2.4.1-5 .8-7.2z" fill="#fff"/>', '#e85d04')],
  ['1414', 'Rega', PICTO('<path d="M5 8.5h11v1.4H5zM10 9.9h1.4v2.2H10zM7.5 13.5c0-1.4 1.4-2 3.3-2s3.7.5 3.7 2-1.6 2.3-3.5 2.3-3.5-.8-3.5-2.3zM14.4 13h4.6v1.2h-4.6zM18.4 11.5h1.2v4h-1.2zM8 16.8h6.5v1H8z" fill="#fff"/>', '#b71c1c')],
  ['145', 'Tox Info', PICTO('<path d="M10 4.5h4v2.5l2 2.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 18V9.5l2-2.5z" fill="#fff"/><path d="M10.5 12.5h3M12 11v3" stroke="#2e7d32" stroke-width="1.6"/>', '#2e7d32')],
  ['112', 'Urgence', PICTO('<path d="M8.6 5.5l2 3-1.4 1.4a8 8 0 0 0 4.4 4.4l1.4-1.4 3 2-1.2 2.4c-5.2.4-10.7-5.1-10.3-10.3z" fill="#fff"/>', '#444')],
];

/** Plan de secours : groupes « Secours » et « Signalisation », ligne électrique, flèches de circulation. */
function estSecours(kind) {
  const d = SYMBOL_BY_KIND[kind];
  return !!d && (d.group === 'Secours' || d.group === 'Signalisation' || kind === 'electrique' || kind === 'circulation');
}
/** Plan d'organisation : groupes « Coupe » et « Zones et lignes », textes, et un petit repère H. */
function estOrga(kind) {
  const d = SYMBOL_BY_KIND[kind];
  return !!d && (d.group === 'Coupe' || d.group === 'Zones et lignes' || kind === 'texte' || kind === 'heli');
}

const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');

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


  const zones = chantier.symbols.filter((s) => s.kind === 'zone' && s.text);
  const legendIcon = (d) => symbolSvg(d.kind, d.mode === 'point' && !['heli', 'point_t'].includes(d.kind) ? 20 : 18);

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

  // Symboles affichés sur chaque plan (selon le groupe de symbols.js)
  const kindsSec = SYMBOLS.filter((d) => estSecours(d.kind) && chantier.symbols.some((s) => s.kind === d.kind) && d.kind !== 'texte');
  const kindsOrg = SYMBOLS.filter((d) => estOrga(d.kind) && chantier.symbols.some((s) => s.kind === d.kind) && !['texte', 'zone'].includes(d.kind));
  const zonesSansNom = chantier.symbols.some((s) => s.kind === 'zone' && !s.text);
  const legende = (list, extra = '') => `${chantier.parcel ? '<span><i class="lg-parcel"></i>Périmètre de coupe</span>' : ''}
    ${list.map((d) => `<span>${legendIcon(d)}${esc(d.label)}</span>`).join('')}${extra}`;
  const coordsGrand = (s) => {
    if (!s) return '<span class="missing">à placer sur la carte (étape 2)</span>';
    const { E, N } = wgs84ToLV95(s.lat, s.lng);
    return `<span class="cf-big">${fmt(E)} / ${fmt(N)}</span>`;
  };
  const NORD = '<div class="f-north" aria-label="Nord"><svg width="26" height="40" viewBox="0 0 26 40"><path d="M13 2L22 30L13 25L4 30Z" fill="#333"/><path d="M13 2L13 25L4 30Z" fill="#888"/><text x="13" y="39" font-size="10" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" fill="#111">N</text></svg></div>';
  const etabli = new Date().toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const champ = (key, label, ph = '') => `<div class="cf-field"><span>${esc(label)}</span><input data-key="${key}" value="${esc(info[key] || '')}" placeholder="${esc(ph)}"></div>`;

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

  <!-- Page 1 : plan de secours -->
  <article class="page cf-page cf-secours">
    <header class="cf-head">
      <div class="cf-head-txt">
        <div class="cf-titre">Chantier forestier</div>
        ${placeRow('lieu_h', 'Commune / lieu-dit', heli, 'ex. Le Mont-sur-Lausanne, Bois de la Chenaille')}
      </div>
      <img src="img/logo-triage.jpg" alt="Triage forestier du Vallon" class="f-logo f-logo-small">
    </header>
    <section class="cf-coords">
      <div class="cf-box cf-h">
        <div class="cf-sym">${symbolSvg('heli', 46)}</div>
        <div class="cf-box-c">
          <div class="cf-box-t">COORDONNÉES H</div>
          ${coordsGrand(heli)}
        </div>
      </div>
      <div class="cf-box cf-t">
        <div class="cf-sym">${symbolSvg('point_t', 46)}</div>
        <div class="cf-box-c">
          <div class="cf-box-t">COORDONNÉES T</div>
          ${coordsGrand(T)}
          ${placeRow('localite_t', 'Lieu / adresse', T, 'ex. Parking du Chalet-à-Gobet')}
        </div>
      </div>
    </section>
    <section class="cf-nums">
      <div class="cf-num-list">${NUMS_SECOURS.map(([n, l, ico]) => `<div class="cf-num">${ico}<b>${n}</b><span>${l}</span></div>`).join('')}</div>
      <div class="cf-contacts">
        <div class="f-row"><span>Hôpital le plus proche</span><div class="f-auto"><textarea data-key="hopital" rows="1" placeholder="Nom – téléphone">${esc(info.hopital || '')}</textarea></div></div>
        <div class="f-row"><span>Médecin de garde</span><div class="f-auto"><textarea data-key="medecin" rows="1" placeholder="Nom – téléphone">${esc(info.medecin || '')}</textarea></div></div>
      </div>
    </section>
    <section class="cf-mapsec">
      <div class="f-mapwrap">
        <div id="fiche-map"></div>
        <div class="cf-label">Plan de secours</div>
        ${NORD}
        <div class="f-inset" id="f-inset" hidden>
          <div id="fiche-inset-map"></div>
          <button type="button" class="f-inset-reset no-print" id="f-inset-reset" title="Remettre à sa place" aria-label="Remettre le cartouche à sa place">↺</button>
          <button type="button" class="f-inset-side no-print" id="f-inset-side" title="Texte à côté / en dessous" aria-label="Mettre le texte à côté ou en dessous">⇆</button>
          <div class="f-inset-handle no-print" id="f-inset-handle" title="Agrandir / réduire" aria-label="Agrandir ou réduire le cartouche"></div>
          <div class="f-inset-cap" id="f-inset-cap"></div>
        </div>
        <button type="button" class="f-recadrer no-print" id="f-recadrer" ${chantier.ficheView ? '' : 'hidden'}>↺ Cadrage automatique</button>
      </div>
      <div class="cf-under">
        <div class="cf-under-txt">
          <b id="f-ratio">Plan de secours</b>
          <div class="f-legend">${legende(kindsSec)}</div>
        </div>
        <div class="f-qr" id="f-qr" hidden><div id="f-qr-img"></div><span>Scannez pour voir<br>votre position sur ce plan</span></div>
      </div>
    </section>
    <footer class="cf-foot"><span>Vérifier l'accès et le réseau sur place avant le début des travaux.</span><span>Établi le ${etabli} · Page 1/3</span></footer>
  </article>

  <!-- Page 2 : plan d'organisation du chantier -->
  <article class="page cf-page cf-org">
    <header class="cf-head">
      <div class="cf-head-txt">
        <div class="cf-titre">Plan d'organisation du chantier</div>
        <div class="cf-sous" data-mirror="name">${esc(info.name || '')}</div>
      </div>
      <img src="img/logo-triage.jpg" alt="" class="f-logo f-logo-small">
    </header>
    <section class="cf-info">
      <div class="cf-info-col">
        ${champ('proprietaire', 'Propriétaire', 'ex. Commune de …')}
        ${champ('entreprise', 'Entreprise', 'ex. Entreprise forestière …')}
        ${champ('communication', 'Communication', 'ex. radio canal 3, téléphone')}
        ${champ('volume', 'Volume de bois prévu', 'm³')}
      </div>
      <div class="cf-info-col">
        ${champ('triage', 'Triage forestier', 'ex. Triage de …')}
        <div class="cf-field"><span>Responsable</span><div class="cf-val" id="resp-org">${esc(info.responsable || '')}</div></div>
        <div class="cf-field"><span>Période de coupe</span><div class="cf-period"><input type="date" data-key="date" value="${esc(info.date || '')}"><span>–</span><input type="date" data-key="date_fin" value="${esc(info.date_fin || '')}"></div></div>
        ${champ('no_chantier', 'N° de chantier')}
      </div>
    </section>
    <section class="cf-orgmap">
      <div class="f-mapwrap">
        <div id="org-map"></div>
        <div class="cf-label">Plan d'organisation du chantier</div>
        ${NORD}
        <button type="button" class="f-recadrer no-print" id="org-recadrer" ${chantier.ficheViewOrg ? '' : 'hidden'}>↺ Cadrage automatique</button>
      </div>
      <aside class="cf-legend-col">
        <b>Légende</b>
        <div class="f-legend">${legende(kindsOrg, `${zones.map((z) => `<span><i class="lg-zone" style="border-color:${z.color};background:${z.color}33"></i>${esc(z.text)}</span>`).join('')}${zonesSansNom ? `<span>${symbolSvg('zone', 18)}Zone</span>` : ''}`)}</div>
      </aside>
    </section>
    <footer class="cf-foot"><span id="org-ratio">Échelle ≈ 1:… (A4, impression à 100 %)</span><span>Établi le ${etabli} · Page 2/3</span></footer>
  </article>

  <!-- Page 3 : attribution du travail -->
  <article class="page cf-page cf-attr">
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
    <footer class="cf-foot"><span></span><span>Établi le ${etabli} · Page 3/3</span></footer>
  </article>`;

  const updateCall = () => {
    const a = root.querySelector('#call-resp');
    a.hidden = !info.resp_tel;
    a.href = `tel:${(info.resp_tel || '').replace(/\s/g, '')}`;
    root.querySelector('#call-resp-nom').textContent = info.responsable || 'Responsable';
    root.querySelector('#call-resp-role').textContent = [info.resp_role, info.resp_tel].filter(Boolean).join(' · ');
    root.querySelector('#resp-print').textContent = [info.responsable, info.resp_role, info.resp_tel].filter(Boolean).join(' – ');
    root.querySelector('#resp-org').textContent = info.responsable || '';
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
      // même donnée sur plusieurs pages (volume, dates, nom) : les autres cases suivent
      root.querySelectorAll(`[data-key="${el.dataset.key}"]`).forEach((o) => { if (o !== el) o.value = el.value; });
      root.querySelectorAll(`[data-mirror="${el.dataset.key}"]`).forEach((o) => { o.textContent = el.value; });
      if (el.dataset.key === 'localite_t') updateTInset(chantier); // le cartouche suit la case « Lieu / adresse »
      grow();
      opt.onChange();
    });
    requestAnimationFrame(grow);
  });
  root.querySelector('#fiche-close').addEventListener('click', opt.onClose);
  root.querySelector('#fiche-print').addEventListener('click', () => printFiche(root, chantier));

  // Cartes des deux plans
  const nouvelleCarte = (el) => {
    const m = L.map(el, {
      zoomControl: false, attributionControl: true, dragging: true, scrollWheelZoom: false,
      doubleClickZoom: true, touchZoom: true, tap: false, zoomSnap: 0.25,
    });
    m.attributionControl.setPrefix(false);
    opt.makeBaseLayer().addTo(m);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m);
    if (chantier.parcel) {
      L.polygon(chantier.parcel, PARCEL_STYLE_OUTLINE).addTo(m);
      L.polygon(chantier.parcel, { ...PARCEL_FICHE, interactive: false }).addTo(m);
    }
    return m;
  };
  if (ficheMap) ficheMap.remove();
  if (orgMap) orgMap.remove();
  if (insetMap) insetMap.remove();
  insetMap = null;
  ficheOpt = opt;

  // Plan de secours
  ficheMap = nouvelleCarte(root.querySelector('#fiche-map'));
  extras.forEach((x) => x.layer.addTo(ficheMap));
  for (const s of chantier.symbols) if (estSecours(s.kind)) symbolLayer(s, { interactive: false })?.addTo(ficheMap);
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

  // Plan d'organisation du chantier (sans point T)
  orgMap = nouvelleCarte(root.querySelector('#org-map'));
  for (const s of chantier.symbols) {
    if (!estOrga(s.kind)) continue;
    if (s.kind === 'heli') {
      // petit repère H, sans les coordonnées
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'sym', html: symbolSvg('heli', 20), iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, keyboard: false }).addTo(orgMap);
    } else symbolLayer(s, { interactive: false })?.addTo(orgMap);
  }
  fitOrgMap(chantier);
  orgMap.on('zoomend', updateRatio);
  orgMap.on('moveend', () => {
    if (recadrageOrg || root.classList.contains('print-layout')) return;
    const b = orgMap.getBounds();
    chantier.ficheViewOrg = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
    root.querySelector('#org-recadrer').hidden = false;
    opt.onChange();
  });
  root.querySelector('#org-recadrer').addEventListener('click', () => {
    delete chantier.ficheViewOrg;
    fitOrgMap(chantier, { auto: true });
    root.querySelector('#org-recadrer').hidden = true;
    opt.onChange();
  });
}

let orgMap = null;
let recadrageOrg = false;

/** Plan d'organisation : cadrage choisi à la main, sinon serré sur la parcelle et les symboles de la coupe. */
function fitOrgMap(chantier, { auto = false } = {}) {
  if (!orgMap) return;
  recadrageOrg = true;
  orgMap.invalidateSize({ animate: false, pan: false });
  const v = chantier.ficheViewOrg;
  if (v && !auto) {
    orgMap.fitBounds([[v.s, v.w], [v.n, v.e]], { animate: false });
  } else {
    const pts = [...(chantier.parcel || [])];
    for (const s of chantier.symbols) {
      const d = SYMBOL_BY_KIND[s.kind];
      if (!d || !(d.group === 'Coupe' || ['zone', 'layon'].includes(s.kind))) continue;
      if (s.lat != null) pts.push([s.lat, s.lng]);
      if (s.lat2 != null) pts.push([s.lat2, s.lng2]);
      if (s.pts) pts.push(...s.pts);
    }
    if (pts.length > 1) orgMap.fitBounds(L.latLngBounds(pts).pad(0.06), { maxZoom: 19, animate: false });
    else if (pts.length === 1) orgMap.setView(pts[0], 18, { animate: false });
    else orgMap.setView([46.6, 6.6], 9, { animate: false });
  }
  recadrageOrg = false;
  updateRatio();
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
  // Plan de secours : parcelle + H + T (un point T éloigné est montré dans le cartouche)
  const loin = tLoin(chantier);
  const pts = [...(chantier.parcel || [])];
  for (const s of chantier.symbols) {
    if (s.kind === 'heli' || (s.kind === 'point_t' && !loin)) pts.push([s.lat, s.lng]);
  }
  if (!pts.length) {
    for (const s of chantier.symbols) {
      if (!estSecours(s.kind)) continue;
      if (s.lat != null) pts.push([s.lat, s.lng]);
      if (s.pts) pts.push(...s.pts);
    }
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
    if (s === T || s.kind === 'acces_t') continue; // le chemin d'accès va jusqu'au point T
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

  root.querySelector('#f-inset-reset').addEventListener('click', (e) => {
    e.stopPropagation();
    delete chantier.tInset;
    updateTInset(chantier);
    opt.onChange();
  });
}

/** Lieu du point T pour le cartouche : le texte écrit sur la fiche tel quel, sinon le lieu trouvé sur la carte (raccourci). */
function lieuT(info, T) {
  const ecrit = (info.localite_t || '').trim();
  return ecrit || (T.place || '').split(' – ')[0];
}

/** Affiche le cartouche quand le point T est en dehors du plan affiché. */
function updateTInset(chantier) {
  const wrap = ficheMap?.getContainer().closest('.f-mapwrap');
  if (!wrap) return;
  const box = wrap.querySelector('#f-inset');
  const T = chantier.symbols.find((s) => s.kind === 'point_t');
  const pts = T ? chantierSansT(chantier, T) : [];
  const vue = ficheMap.getBounds();
  const marge = vue.pad(-0.03);
  if (!T || !pts.length || marge.contains([T.lat, T.lng])) {
    box.hidden = true;
    wrap.classList.remove('inset-tl', 'inset-tr', 'inset-bl', 'inset-br');
    return;
  }

  const el = ficheMap.getContainer();
  const ox = el.offsetLeft;
  const oy = el.offsetTop;
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

  const acces = chantier.symbols.find((s) => s.kind === 'acces_t' && s.pts?.length > 1);
  let dist = depart.distanceTo([T.lat, T.lng]);
  if (acces) {
    dist = 0;
    for (let i = 1; i < acces.pts.length; i++) dist += L.latLng(acces.pts[i - 1]).distanceTo(acces.pts[i]);
  }
  const cap = bearing(depart, [T.lat, T.lng]);
  const dir = DIRS[Math.round(cap / 45) % 8];
  const lieu = lieuT(chantier.info, T);
  wrap.querySelector('#f-inset-cap').innerHTML = `<strong>Point T à ${fmtDist(dist)} ${acces ? 'par la route' : `au ${dir}`}</strong><br>${lieu ? `${esc(lieu).replace(/\n/g, '<br>')}<br>` : ''}<span>${formatLV95(T.lat, T.lng).replace(', ', ' / ')}</span>`;

  // Petite carte zoomée sur le point T
  const im = wrap.querySelector('#fiche-inset-map');
  if (!insetMap) {
    insetMap = L.map(im, {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, tap: false,
    });
    ficheOpt.makeBaseLayer().addTo(insetMap);
    if (chantier.parcel) L.polygon(chantier.parcel, { ...PARCEL_FICHE, interactive: false }).addTo(insetMap);
  }
  if (insetMap._acces) insetMap._acces.remove();
  insetMap._acces = acces ? symbolLayer(acces, { interactive: false })?.addTo(insetMap) : null;
  insetMap.eachLayer((l) => { if (l.options?.tMarker) l.remove(); });
  L.marker([T.lat, T.lng], {
    icon: L.divIcon({ className: 'sym', html: symbolSvg('point_t', 26), iconSize: [26, 26], iconAnchor: [13, 13] }),
    interactive: false, tMarker: true,
  }).addTo(insetMap);
  insetMap.invalidateSize({ animate: false, pan: false });
  insetMap.setView([T.lat, T.lng], 16, { animate: false });

}

/** Passe en mise en page A4, recadre la carte, attend les fonds de carte puis imprime. */
export function printFiche(root, chantier) {
  root.classList.add('print-layout');
  root.querySelectorAll('input[type=date]').forEach((d) => d.classList.toggle('is-empty', !d.value));
  root.querySelectorAll('textarea').forEach((t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; });
  fitFicheMap(chantier);
  fitOrgMap(chantier);
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    window.print();
  };
  // attendre les fonds de carte des deux plans (au plus 3 s)
  const t0 = Date.now();
  const attendre = () => {
    let charge = false;
    [ficheMap, orgMap].forEach((m) => m?.eachLayer((l) => { if (l.isLoading?.()) charge = true; }));
    if (!charge || Date.now() - t0 > 3000) setTimeout(go, 300);
    else setTimeout(attendre, 200);
  };
  setTimeout(attendre, 300);
}

window.addEventListener('afterprint', () => {
  const root = document.querySelector('#fiche.print-layout');
  if (!root) return;
  root.classList.remove('print-layout');
  if (ficheMap && dernierChantier) fitFicheMap(dernierChantier); // revient au cadrage enregistré (sans l'écraser)
  if (orgMap && dernierChantier) fitOrgMap(dernierChantier);
});

/** Échelle approximative d'un plan (1 : N) d'après le zoom et la taille à l'écran / sur papier. */
function echelle(map) {
  const lat = map.getCenter().lat;
  const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** map.getZoom());
  const ratio = mPerPx / (0.0254 / 96);
  const nice = [250, 500, 700, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 25000, 50000, 100000];
  const r = nice.reduce((best, x) => (Math.abs(Math.log(x / ratio)) < Math.abs(Math.log(best / ratio)) ? x : best), nice[0]);
  return r.toLocaleString('fr-CH');
}
function updateRatio() {
  const sec = document.getElementById('f-ratio');
  if (sec && ficheMap) sec.textContent = `Plan de secours · échelle ≈ 1:${echelle(ficheMap)}`;
  const org = document.getElementById('org-ratio');
  if (org && orgMap) org.textContent = `Échelle ≈ 1:${echelle(orgMap)} (A4, impression à 100 %)`;
}

export function closeFicheMap() {
  stopDictee();
  if (insetMap) insetMap.remove();
  insetMap = null;
  if (ficheMap) ficheMap.remove();
  ficheMap = null;
  if (orgMap) orgMap.remove();
  orgMap = null;
}

export { SYMBOL_BY_KIND };
