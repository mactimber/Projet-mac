// Fiche de secours : affichée sur le téléphone et imprimable en A4 (PDF).

import { SYMBOLS, SYMBOL_BY_KIND, symbolSvg } from './symbols.js';
import { symbolLayer, esc, PARCEL_STYLE, PARCEL_STYLE_OUTLINE } from './draw.js';
import { wgs84ToLV95, polygonArea, formatArea } from './swiss.js';

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
  const sym = (kind) => chantier.symbols.filter((s) => s.kind === kind);
  const heli = sym('heli')[0];

  const field = (key, label, { multi = false, ph = '', type = 'text' } = {}) => `
    <label class="ff ${multi ? 'ff-multi' : ''}"><span>${esc(label)}</span>
      ${multi
        ? `<textarea data-key="${key}" rows="1" placeholder="${esc(ph)}">${esc(info[key] || '')}</textarea>`
        : `<input type="${type}" data-key="${key}" value="${esc(info[key] || '')}" placeholder="${esc(ph)}">`}
    </label>`;

  const coordRow = (kind, title) => {
    const list = sym(kind);
    return `<tr><th>${symbolSvg(kind, 26)} ${esc(title)}</th><td>${list.length
      ? list.map(coordBlock).join('<hr>')
      : '<span class="missing">à placer sur la carte (étape 2)</span>'}</td></tr>`;
  };

  const kindsUsed = SYMBOLS.filter((d) => chantier.symbols.some((s) => s.kind === d.kind) && d.kind !== 'texte');
  const area = chantier.parcel ? formatArea(polygonArea(L.polygon(chantier.parcel))).split(' (')[0] : '';

  root.innerHTML = `
  <div class="fiche-bar no-print">
    <button type="button" id="fiche-close">← Carte</button>
    <span class="spacer"></span>
    <button type="button" id="fiche-print" class="primary">🖨 Imprimer / PDF</button>
  </div>

  <div class="fiche-calls no-print">
    <a href="tel:144" class="call c144"><b>144</b> Ambulance</a>
    <a href="tel:1414" class="call c1414"><b>1414</b> Rega</a>
  </div>

  <article class="page">
    <header class="f-head">
      <div>
        <div class="f-kicker">FICHE DE SECOURS · CHANTIER FORESTIER</div>
        <input class="f-title" data-key="name" value="${esc(info.name || '')}" placeholder="Nom du chantier">
      </div>
      <div class="f-head-right">
        ${field('date', 'Date', { type: 'date' })}
      </div>
    </header>

    <section class="f-urgence">
      <div class="f-urg-title">EN CAS D'URGENCE</div>
      <div class="f-nums">${NUMEROS.map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('')}</div>
    </section>

    <section class="f-cols">
      <div class="f-box f-coords">
        <h3>Coordonnées pour les secours</h3>
        <table>
          ${coordRow('heli', 'Place hélico')}
          ${coordRow('point_t', 'Point de rencontre')}
          ${coordRow('vehicule', 'Véhicule')}
          ${coordRow('pharmacie', 'Pharmacie')}
        </table>
        <p class="f-small">Coordonnées suisses LV95 (E / N) et GPS (WGS84).${heli && !heli.manual ? ' Place hélico : milieu de la parcelle.' : ''}</p>
      </div>
      <div class="f-box f-alarme">
        <h3>Donner l'alarme</h3>
        <ol>
          <li><b>Qui</b> appelle ? (nom, n° de téléphone)</li>
          <li><b>Où</b> ? Lire les <b>coordonnées</b> de la place hélico</li>
          <li><b>Quoi</b> ? Que s'est-il passé ?</li>
          <li><b>Combien</b> de blessés ? Quelles blessures ?</li>
          <li><b>Quand</b> ?</li>
          <li><b>Autres</b> : câbles, lignes électriques, météo, vent</li>
        </ol>
        <p class="f-small">Rester joignable. Ne pas raccrocher le premier. Envoyer quelqu'un au point de rencontre.</p>
      </div>
    </section>

    <section class="f-box f-org">
      <h3>Organisation</h3>
      <div class="f-grid">
        ${field('commune', 'Commune / lieu-dit')}
        ${field('travaux', 'Travaux', { ph: 'Coupe, éclaircie, chablis…' })}
        ${field('responsable', 'Responsable')}
        ${field('resp_tel', 'Tél. responsable', { type: 'tel' })}
        ${field('secouriste', 'Secouriste')}
        ${field('hopital', 'Hôpital le plus proche')}
      </div>
      <div class="f-grid f-grid3">
        ${field('equipe', 'Équipe (nom – téléphone)', { multi: true })}
        ${field('acces', 'Accès pour l\'ambulance', { multi: true, ph: 'Route, barrière, clé…' })}
        ${field('dangers', 'Dangers et mesures', { multi: true, ph: 'Pente, ligne électrique…' })}
      </div>
    </section>

    <section class="f-box f-plan">
      <h3>Plan de coupe${area ? ` <small>· parcelle ${esc(area)}</small>` : ''}</h3>
      <div id="fiche-map"></div>
      <div class="f-legend">
        ${chantier.parcel ? '<span><i class="lg-parcel"></i>Parcelle</span>' : ''}
        ${kindsUsed.map((d) => `<span>${symbolSvg(d.kind, 22)}${esc(d.label)}</span>`).join('')}
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
}

function fitFicheMap(chantier) {
  if (!ficheMap) return;
  ficheMap.invalidateSize();
  const pts = [...(chantier.parcel || [])];
  for (const s of chantier.symbols) {
    pts.push([s.lat, s.lng]);
    if (s.lat2 != null) pts.push([s.lat2, s.lng2]);
  }
  if (pts.length > 1) ficheMap.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 18 });
  else if (pts.length === 1) ficheMap.setView(pts[0], 17);
  else ficheMap.setView([46.8, 8.2], 8);
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

export function closeFicheMap() {
  if (ficheMap) ficheMap.remove();
  ficheMap = null;
}

export { SYMBOL_BY_KIND };
