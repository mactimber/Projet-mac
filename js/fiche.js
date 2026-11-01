// Fiche de secours : affichée sur le téléphone et imprimable en A4 (PDF).

import { SYMBOLS, SYMBOL_BY_KIND, symbolSvg } from './symbols.js';
import { symbolLayer, esc, PARCEL_STYLE, PARCEL_STYLE_OUTLINE } from './draw.js';
import { wgs84ToLV95, polygonArea, formatArea } from './swiss.js';

/** Contacts habituels du Triage forestier du Vallon. */
export const DEFAUT_MEDECIN = 'Dr Philippe Candelier, Chalais – 027 458 31 81';
export const DEFAUT_HOPITAL = 'Hôpital de Sion – 027 603 40 00';

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

/**
 * @param {HTMLElement} root
 * @param {object} chantier
 * @param {object} opt { onChange(), onClose(), makeBaseLayer() }
 */
export function renderFiche(root, chantier, opt) {
  const info = chantier.info;
  // Valeurs habituelles du triage (modifiables sur la fiche ; une case vidée reste vide)
  if (info.medecin === undefined) info.medecin = DEFAUT_MEDECIN;
  if (info.hopital === undefined) info.hopital = DEFAUT_HOPITAL;
  const sym = (kind) => chantier.symbols.filter((s) => s.kind === kind);
  const heli = sym('heli')[0];

  const field = (key, label, { multi = false, ph = '', type = 'text' } = {}) => `
    <label class="ff ${multi ? 'ff-multi' : ''}"><span>${esc(label)}</span>
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

  root.innerHTML = `
  <div class="fiche-bar no-print">
    <button type="button" id="fiche-close">← Carte</button>
    <span class="spacer"></span>
    <button type="button" id="fiche-print" class="primary">🖨 Imprimer / PDF</button>
  </div>

  <div class="fiche-calls no-print">
    <a href="tel:144" class="call c144"><b>144</b> Ambulance</a>
  </div>

  <article class="page">
    <header class="f-head">
      <div>
        <div class="f-kicker">ORGANISATION DE CHANTIER · FICHE DE SECOURS</div>
        <input class="f-title" data-key="name" value="${esc(info.name || '')}" placeholder="Nom du chantier">
      </div>
      <div class="f-head-right">
        ${field('date', 'Date', { type: 'date' })}
      </div>
      <img src="img/logo-triage.jpg" alt="Triage forestier du Vallon" class="f-logo">
    </header>

    <section class="f-cols">
    <div class="f-suva">
      <h3>Numéros d'urgence</h3>
      <div class="f-nums">${NUMEROS.map(([n, l]) => `<div><span>${l}</span><b>${n}</b></div>`).join('')}</div>
      <div class="f-contacts">
        <div class="f-row"><span>Médecin</span><input data-key="medecin" value="${esc(info.medecin || '')}" placeholder="Nom – téléphone"></div>
        <div class="f-row"><span>Hôpital</span><input data-key="hopital" value="${esc(info.hopital || '')}" placeholder="Nom – téléphone"></div>
        <div class="f-row"><span>Lieu-dit</span><input data-key="lieu" value="${esc(info.lieu || info.commune || '')}" placeholder="Lieu-dit, commune"></div>
      </div>
      <h3>Coordonnées ou adresse</h3>
      <div class="f-contacts">
        ${coordLine('heli', 'Pour sauvetage aérien')}
        ${coordLine('point_t', 'Pour sauvetage terrestre <small>(point de rencontre)</small>')}
      </div>
    </div>

    <div class="f-box f-alarme">
      <h3>Donner l'alarme</h3>
      <ol>
        <li><b>Qui</b> appelle ? (nom, n° de téléphone)</li>
        <li><b>Où</b> ? Lire les <b>coordonnées</b> (aérien / terrestre)</li>
        <li><b>Quoi</b> ? Que s'est-il passé ?</li>
        <li><b>Combien</b> de blessés ? Quelles blessures ?</li>
        <li><b>Quand</b> ?</li>
        <li><b>Autres</b> : câbles, lignes électriques, météo, vent</li>
      </ol>
      <p class="f-small">Rester joignable. Ne pas raccrocher le premier. Envoyer quelqu'un au point de rencontre (T).</p>
    </div>
    </section>

    <section class="f-box f-org">
      <h3>Organisation</h3>
      <div class="f-grid">
        ${field('travaux', 'Travaux', { ph: 'Coupe, éclaircie, chablis…' })}
        ${field('responsable', 'Responsable')}
        ${field('resp_tel', 'Tél. responsable', { type: 'tel' })}
        ${field('secouriste', 'Secouriste')}
      </div>
      <div class="f-grid f-grid3">
        ${field('equipe', 'Équipe (nom – téléphone)', { multi: true })}
        ${field('acces', 'Accès pour l\'ambulance', { multi: true, ph: 'Route, barrière, clé…' })}
        ${field('dangers', 'Dangers et mesures', { multi: true, ph: 'Pente, ligne électrique…' })}
      </div>
    </section>

    <section class="f-box f-plan">
      <h3>Plan de coupe${area ? ` <small>· parcelle ${esc(area)}</small>` : ''}</h3>
      <div class="f-mapwrap">
        <div id="fiche-map"></div>
        <div class="f-north" aria-label="Nord"><svg width="26" height="40" viewBox="0 0 26 40"><path d="M13 2L22 30L13 25L4 30Z" fill="#333"/><path d="M13 2L13 25L4 30Z" fill="#888"/><text x="13" y="39" font-size="10" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" fill="#111">N</text></svg></div>
        <div class="f-ratio" id="f-ratio"></div>
      </div>
      <div class="f-legend">
        ${chantier.parcel ? '<span><i class="lg-parcel"></i>Parcelle</span>' : ''}
        ${kindsUsed.map((d) => `<span>${legendIcon(d)}${esc(d.label)}</span>`).join('')}
        ${zones.map((z) => `<span><i class="lg-zone" style="border-color:${z.color};background:${z.color}33"></i>${esc(z.text)}</span>`).join('')}
      </div>
    </section>

    <section class="f-box f-sign">
      <h3>Lu et compris</h3>
      <table><tr><th>Nom</th><th>Date</th><th>Signature</th></tr>${'<tr><td></td><td></td><td></td></tr>'.repeat(2)}</table>
    </section>
  </article>`;

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
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(ficheMap);
  if (chantier.parcel) {
    L.polygon(chantier.parcel, PARCEL_STYLE_OUTLINE).addTo(ficheMap);
    L.polygon(chantier.parcel, { ...PARCEL_STYLE, interactive: false }).addTo(ficheMap);
  }
  for (const s of chantier.symbols) symbolLayer(s, { interactive: false })?.addTo(ficheMap);
  fitFicheMap(chantier);
  ficheMap.on('zoomend', updateRatio);
}

function fitFicheMap(chantier) {
  if (!ficheMap) return;
  ficheMap.invalidateSize({ animate: false, pan: false });
  const pts = [...(chantier.parcel || [])];
  for (const s of chantier.symbols) {
    if (s.lat != null) pts.push([s.lat, s.lng]);
    if (s.lat2 != null) pts.push([s.lat2, s.lng2]);
    if (s.pts) pts.push(...s.pts);
  }
  if (pts.length > 1) ficheMap.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 18, animate: false });
  else if (pts.length === 1) ficheMap.setView(pts[0], 17, { animate: false });
  else ficheMap.setView([46.8, 8.2], 8, { animate: false });
  updateRatio();
}

/** Passe en mise en page A4, recadre la carte, attend les fonds de carte puis imprime. */
export function printFiche(root, chantier) {
  root.classList.add('print-layout');
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
  ficheMap?.invalidateSize();
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
  if (ficheMap) ficheMap.remove();
  ficheMap = null;
}

export { SYMBOL_BY_KIND };
