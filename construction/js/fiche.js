// Fiche chantier (construction) : affichée sur le téléphone et imprimable en A4 (PDF).

import { SYMBOLS, SYMBOL_BY_KIND, symbolSvg } from './symbols.js';
import { symbolLayer, esc, lengthOf, fmtLen, PARCEL_STYLE, PARCEL_STYLE_OUTLINE } from './draw.js';
import { wgs84ToLV95, polygonArea, formatArea } from './swiss.js';
import { planLink, qrSvg } from './share.js';

/** Contacts habituels du Triage forestier du Vallon. */
export const DEFAUT_MEDECIN = 'Dr P. Candelier – 027 458 31 81';
const ANCIEN_MEDECIN = 'Dr Philippe Candelier, Chalais – 027 458 31 81';
export const DEFAUT_HOPITAL = 'Hôpital de Sion – 027 603 40 00';

/**
 * Responsables (nom, fonction, téléphone) : enregistrés seulement sur cet appareil,
 * jamais dans le code publié. Saisis une fois via « Modifier la liste… ».
 */
const LS_RESP = 'cc-responsables';
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
      : '<span class="missing">placé automatiquement avec la zone (étape 1)</span>'}</div></div>`;
  };

  const kindsUsed = SYMBOLS.filter((d) => chantier.symbols.some((s) => s.kind === d.kind) && !['texte', 'zone'].includes(d.kind));
  const zones = chantier.symbols.filter((s) => s.kind === 'zone' && s.text);
  const legendIcon = (d) => symbolSvg(d.kind, d.mode === 'point' && !['heli', 'point_t'].includes(d.kind) ? 20 : 18);
  const area = chantier.parcel ? formatArea(polygonArea(L.polygon(chantier.parcel))).split(' (')[0] : '';

  const T = sym('point_t')[0];
  // Case remplie depuis la carte (lieu-dit, commune, adresse) tant qu'on ne l'a pas modifiée soi-même
  const placeRow = (key, label, point, ph) => `
    <div class="f-row f-row-stack"><span>${label}</span><div class="f-auto">
      <textarea data-key="${key}" rows="1" placeholder="${esc(ph)}">${esc(info[key] ?? point?.place ?? point?.text ?? '')}</textarea>
      ${point?.place ? `<button type="button" class="f-refresh no-print" data-refresh="${key}" data-place="${esc(point.place)}" title="Reprendre depuis la carte" aria-label="Reprendre depuis la carte">↻</button>` : ''}
    </div></div>`;

  // Ouvrages à réaliser (numérotés dans l'ordre de pose)
  const ouvrages = chantier.symbols.filter((x) => SYMBOL_BY_KIND[x.kind]?.ouvrage);
  const photos = ouvrages.flatMap((o, i) => (o.photos || []).map((src) => ({ src, n: i + 1, o })));
  const avecSecours = info.secours !== false;
  const extras = opt.extraLayers ? opt.extraLayers() : [];

  root.innerHTML = `
  <div class="fiche-bar no-print">
    <button type="button" id="fiche-close">← Carte</button>
    <span class="spacer"></span>
    <button type="button" id="fiche-print" class="primary">🖨 Imprimer / PDF</button>
  </div>

  <div class="fiche-calls no-print">
    <a href="tel:144" class="call c144"><b>144</b> Ambulance</a>
    <a href="tel:${esc((info.resp_tel || '').replace(/\s/g, ''))}" class="call c-resp" id="call-resp" ${info.resp_tel ? '' : 'hidden'}>
      <b id="call-resp-nom">${esc(info.responsable || '')}</b><span id="call-resp-role">${esc([info.resp_role, info.resp_tel].filter(Boolean).join(' · '))}</span>
    </a>
    <a href="tel:${esc((info.client_tel || '').replace(/\s/g, ''))}" class="call c-client" id="call-client" ${info.client_tel ? '' : 'hidden'}>
      <b id="call-client-nom">${esc(info.client || 'Client')}</b><span>Client · <span id="call-client-tel">${esc(info.client_tel || '')}</span></span>
    </a>
  </div>

  <article class="page">
    <header class="f-head">
      <div>
        <div class="f-kicker">CHANTIER CONSTRUCTION</div>
        <input class="f-title" data-key="name" value="${esc(info.name || '')}" placeholder="Nom du chantier">
      </div>
      <img src="img/logo-triage.jpg" alt="Triage forestier du Vallon" class="f-logo">
    </header>

    <h2 class="f-sec">Chantier</h2>
    <section class="f-work">
      <div class="f-col">
        <div class="ff"><span>Adresse / lieu du chantier</span>
          <div class="f-auto f-auto-plain">
            <textarea data-key="adresse" rows="1" placeholder="Rue, lieu-dit, commune">${esc(info.adresse ?? heli?.place ?? '')}</textarea>
            ${heli?.place ? `<button type="button" class="f-refresh no-print" data-refresh="adresse" data-place="${esc(heli.place)}" title="Reprendre depuis la carte" aria-label="Reprendre depuis la carte">↻</button>` : ''}
          </div>
        </div>
        ${field('client', 'Client (nom / entreprise)', { multi: true })}
        ${field('client_tel', 'Téléphone du client', { type: 'tel' })}
        <div class="f-pair">
          ${field('date', 'Début', { type: 'date' })}
          ${field('date_fin', 'Fin', { type: 'date' })}
        </div>
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
        ${field('equipe', 'Équipe (nom – téléphone)', { multi: true })}
      </div>
    </section>

    <h2 class="f-sec">Mission</h2>
    <section class="f-work">
      <div class="f-col">${field('travaux', 'Travaux à réaliser', { multi: true, ph: 'But, travaux, déroulement…' })}</div>
      <div class="f-col">${field('acces', 'Accès, consignes, remarques', { multi: true, ph: 'Accès véhicules, horaires, contraintes…' })}</div>
    </section>

    <h2 class="f-sec">Ouvrages à réaliser</h2>
    ${ouvrages.length ? `<table class="f-table">
      <thead><tr><th>N°</th><th>Ouvrage</th><th>Description</th><th>Longueur</th><th>Photos</th></tr></thead>
      <tbody>${ouvrages.map((o, i) => `<tr>
        <td>${i + 1}</td>
        <td class="f-tw">${symbolSvg(o.kind, 18)} ${esc(SYMBOL_BY_KIND[o.kind].label)}</td>
        <td>${esc(o.text || '')}</td>
        <td>${o.pts ? fmtLen(lengthOf(o.pts)) : ''}</td>
        <td>${(o.photos || []).length || ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="missing">Aucun ouvrage placé sur la carte (étape 2).</p>'}

    <div class="f-secours-bloc">
    <h2 class="f-sec f-sec-secours">Organisation en cas d'urgence
      <label class="no-print f-toggle"><input type="checkbox" id="secours-toggle" ${avecSecours ? 'checked' : ''}> inclure dans la fiche</label></h2>
    <section class="f-cols f-secours" ${avecSecours ? '' : 'hidden'}>
    <div class="f-suva">
      <h3>Numéros d'urgence</h3>
      <div class="f-nums">${NUMEROS.map(([n, l]) => `<div><span>${l}</span><b>${n}</b></div>`).join('')}</div>
      <div class="f-contacts">
        <div class="f-row"><span>Médecin</span><div class="f-auto"><textarea data-key="medecin" rows="1" placeholder="Nom – téléphone">${esc(info.medecin || '')}</textarea></div></div>
        <div class="f-row"><span>Hôpital</span><div class="f-auto"><textarea data-key="hopital" rows="1" placeholder="Nom – téléphone">${esc(info.hopital || '')}</textarea></div></div>
      </div>
      <h3>Sauvetage aérien <small>(milieu du chantier)</small></h3>
      <div class="f-contacts">
        ${placeRow('lieu_h', 'Lieu-dit', heli, 'Lieu-dit, commune')}
        ${coordLine('heli', 'Coordonnées H')}
      </div>
      <h3>Sauvetage terrestre <small>(point T)</small></h3>
      <div class="f-contacts">
        ${placeRow('localite_t', 'Lieu / adresse', T, 'Adresse du point de rencontre')}
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
        <li><b>Autres dangers</b> : machines, lignes électriques, météo</li>
      </ol>
      <p class="f-small">Rester joignable. Ne pas raccrocher le premier. Envoyer quelqu'un au point de rencontre (T).</p>
    </div>
    </section>
    </div>
  </article>

  <article class="page page-plan">
    <header class="f-head f-head-small">
      <div>
        <div class="f-kicker">CHANTIER CONSTRUCTION · PLAN</div>
        <div class="f-title-small">${esc(info.name || '')}${area ? ` <small>· zone ${esc(area)}</small>` : ''}</div>
      </div>
      <img src="img/logo-triage.jpg" alt="" class="f-logo f-logo-small">
    </header>
    <section class="f-plan">
      <div class="f-mapwrap">
        <div id="fiche-map"></div>
        <div class="f-north" aria-label="Nord"><svg width="26" height="40" viewBox="0 0 26 40"><path d="M13 2L22 30L13 25L4 30Z" fill="#333"/><path d="M13 2L13 25L4 30Z" fill="#888"/><text x="13" y="39" font-size="10" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" fill="#111">N</text></svg></div>
        <div class="f-ratio" id="f-ratio"></div>
        <button type="button" class="f-recadrer no-print" id="f-recadrer" ${chantier.ficheView ? '' : 'hidden'}>↺ Cadrage automatique</button>
      </div>
      <div class="f-plan-foot">
      <div class="f-legend">
        <b>Légende :</b>
        ${chantier.parcel ? '<span><i class="lg-parcel"></i>Zone du chantier</span>' : ''}
        ${kindsUsed.map((d) => `<span>${legendIcon(d)}${esc(d.label)}</span>`).join('')}
        ${zones.map((z) => `<span><i class="lg-zone" style="border-color:${z.color};background:${z.color}33"></i>${esc(z.text)}</span>`).join('')}
      </div>
      <div class="f-qr" id="f-qr" hidden><div id="f-qr-img"></div><span>Scannez pour voir<br>votre position sur ce plan</span></div>
      </div>
    </section>
  </article>

  ${photos.length ? `<article class="page page-photos">
    <header class="f-head f-head-small">
      <div>
        <div class="f-kicker">CHANTIER CONSTRUCTION · PHOTOS</div>
        <div class="f-title-small">${esc(info.name || '')}</div>
      </div>
      <img src="img/logo-triage.jpg" alt="" class="f-logo f-logo-small">
    </header>
    <div class="f-photos">${photos.map((p) => `<figure><img src="${p.src}" alt=""><figcaption><b>${p.n}.</b> ${esc(SYMBOL_BY_KIND[p.o.kind].label)}${p.o.text ? ` – ${esc(p.o.text)}` : ''}</figcaption></figure>`).join('')}</div>
  </article>` : ''}`;

  const updateClient = () => {
    info.client = root.querySelector('[data-key="client"]').value;
    info.client_tel = root.querySelector('[data-key="client_tel"]').value;
    const a = root.querySelector('#call-client');
    a.hidden = !info.client_tel;
    a.href = `tel:${(info.client_tel || '').replace(/\s/g, '')}`;
    root.querySelector('#call-client-nom').textContent = (info.client || 'Client').split('\n')[0];
    root.querySelector('#call-client-tel').textContent = info.client_tel || '';
  };
  root.querySelector('[data-key="client"]').addEventListener('input', updateClient);
  root.querySelector('[data-key="client_tel"]').addEventListener('input', updateClient);
  root.querySelector('#secours-toggle').addEventListener('change', (e) => {
    info.secours = e.target.checked;
    root.querySelector('.f-secours').hidden = !e.target.checked;
    root.querySelector('.f-sec-secours').classList.toggle('no-print', !e.target.checked);
    opt.onChange();
  });
  if (!avecSecours) root.querySelector('.f-sec-secours').classList.add('no-print');

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
  fitFicheMap(chantier);
  ficheMap.on('zoomend', updateRatio);
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
    return;
  }
  const pts = [...(chantier.parcel || [])];
  for (const s of chantier.symbols) {
    if (s.lat != null) pts.push([s.lat, s.lng]);
    if (s.lat2 != null) pts.push([s.lat2, s.lng2]);
    if (s.pts) pts.push(...s.pts);
  }
  if (pts.length > 1) ficheMap.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 18, animate: false });
  else if (pts.length === 1) ficheMap.setView(pts[0], 17, { animate: false });
  else ficheMap.setView([46.8, 8.2], 8, { animate: false });
  recadrageAuto = false;
  updateRatio();
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
  if (ficheMap) ficheMap.remove();
  ficheMap = null;
}

export { SYMBOL_BY_KIND };
