// Rapport imprimable (fiche de chantier + sécurité + plan de coupe).

import { CHANTIER_FIELDS, SECURITE_FIELDS, COUPE_FIELDS, FEATURE_TYPES } from './config.js';
import { esc } from './forms.js';
import { formatLV95, formatArea, formatLength, bearingLabel } from './swiss.js';

function fieldsTable(fields, data) {
  let html = '';
  let rows = '';
  const flush = () => {
    if (rows) html += `<table class="kv">${rows}</table>`;
    rows = '';
  };
  for (const f of fields) {
    if (f.type === 'heading') {
      flush();
      html += `<h3>${esc(f.label)}</h3>`;
      continue;
    }
    if (f.type === 'photos' || f.type === 'secours') continue;
    let v = data[f.key];
    if (f.type === 'checklist') {
      flush();
      const set = new Set(v || []);
      html += `<ul class="checks">${f.options.map((o) => `<li>${set.has(o) ? '☑' : '☐'} ${esc(o)}</li>`).join('')}</ul>`;
      continue;
    }
    if (Array.isArray(v)) v = v.join(', ');
    if (f.type === 'direction') v = bearingLabel(v);
    rows += `<tr><th>${esc(f.label)}</th><td>${esc(v ?? '').replace(/\n/g, '<br>')}</td></tr>`;
  }
  flush();
  return html;
}

/**
 * @param {object} chantier
 * @param {object} stats { features: [{type, props, layer, measure}], trees: [...], recap: [...], volume }
 * @param {string|null} mapImage dataURL facultative
 */
export function openReport(chantier, stats) {
  const info = chantier.info || {};
  const secours = stats.features.filter((f) => f.type === 'secours');
  const featureRows = stats.features
    .map((f, i) => {
      const t = FEATURE_TYPES[f.type];
      const name = f.props.nom || f.props.numero || f.props.titre || f.props.categorie || f.props.danger || '';
      return `<tr><td>${i + 1}</td><td>${esc(t?.label || f.type)}</td><td>${esc(name)}</td><td>${esc(f.measure || '')}</td><td class="mono">${esc(f.coord)}</td></tr>`;
    })
    .join('');
  const treeRows = stats.trees
    .map((t) => `<tr><td>${esc(t.props.numero || '')}</td><td>${esc(t.props.essence || '')}</td><td>${t.props.dhp || ''}</td><td>${t.props.hauteur || ''}</td><td>${t.volume ? t.volume.toFixed(2) : ''}</td><td>${esc(bearingLabel(t.props.direction))}</td><td>${esc(t.props.etat || '')}</td><td>${esc(t.props.assortiment || '')}</td><td class="mono">${esc(t.coord)}</td></tr>`)
    .join('');
  const recapRows = stats.recap
    .map((r) => `<tr><td>${esc(r.essence)}</td><td>${r.count}</td><td>${r.dhpMoy ? r.dhpMoy.toFixed(0) : ''}</td><td>${r.volume.toFixed(2)}</td></tr>`)
    .join('');

  const html = `<!doctype html><html lang="fr-CH"><head><meta charset="utf-8">
<title>${esc(info.name || 'Chantier')} – rapport</title>
<style>
  body{font:12px/1.4 system-ui,sans-serif;color:#111;margin:24px;max-width:1000px}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;border-bottom:2px solid #1f4d2b;padding-bottom:2px;margin-top:22px;break-after:avoid}
  h3{font-size:13px;margin:12px 0 4px;color:#1f4d2b}
  table{border-collapse:collapse;width:100%;margin:4px 0}
  th,td{border:1px solid #bbb;padding:3px 6px;text-align:left;vertical-align:top}
  table.kv th{width:38%;background:#f3f6f3;font-weight:600}
  thead th{background:#1f4d2b;color:#fff}
  .mono{font-family:ui-monospace,monospace;white-space:nowrap}
  ul.checks{columns:2;list-style:none;padding:0;margin:4px 0} ul.checks li{break-inside:avoid}
  .urgence{border:3px solid #c62828;padding:8px 12px;margin:10px 0;font-size:14px}
  .urgence b{color:#c62828}
  .sig td{height:36px}
  .toolbar{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid #ddd;margin-bottom:12px}
  .toolbar button{font-size:14px;padding:6px 14px}
  section{break-inside:auto} .pb{break-before:page}
  @media print{.toolbar{display:none} body{margin:10mm}}
</style></head><body>
<div class="toolbar"><button onclick="print()">🖨 Imprimer / PDF</button></div>
<h1>${esc(info.name || 'Chantier')}</h1>
<div>${esc([info.commune, info.lieu_dit, `édité le ${new Date().toLocaleDateString('fr-CH')}`].filter(Boolean).join(' · '))}</div>

<div class="urgence">
  <b>URGENCE :</b> Ambulance <b>${esc(chantier.securite?.tel_144 || '144')}</b> · Rega <b>${esc(chantier.securite?.tel_1414 || '1414')}</b> · Pompiers <b>${esc(chantier.securite?.tel_118 || '118')}</b> · Police <b>${esc(chantier.securite?.tel_117 || '117')}</b><br>
  ${secours.length ? secours.map((s) => `${esc(s.props.categorie || 'Point de secours')} : <b class="mono">LV95 ${esc(s.coord)}</b>${s.props.acces ? ` – ${esc(s.props.acces)}` : ''}`).join('<br>') : '<i>Aucun point de rencontre secours défini sur la carte.</i>'}
</div>

<h2>1. Informations générales</h2>
${fieldsTable(CHANTIER_FIELDS, info)}
<h3>Synthèse</h3>
<table class="kv">
  <tr><th>Surface des parcelles</th><td>${esc(formatArea(stats.areaParcelles))}</td></tr>
  <tr><th>Surface de coupe</th><td>${esc(formatArea(stats.areaCoupe))}</td></tr>
  <tr><th>Arbres martelés</th><td>${stats.trees.length}</td></tr>
  <tr><th>Volume indicatif (sylve)</th><td>${stats.volume.toFixed(1)} m³</td></tr>
  <tr><th>Pistes / layons</th><td>${esc(formatLength(stats.lengthPistes))}</td></tr>
</table>

<h2>2. Objets relevés</h2>
<table><thead><tr><th>#</th><th>Type</th><th>Désignation</th><th>Mesure</th><th>Coord. LV95</th></tr></thead><tbody>${featureRows || '<tr><td colspan="5">—</td></tr>'}</tbody></table>

<section class="pb">
<h2>3. Fiche de sécurité</h2>
${fieldsTable(SECURITE_FIELDS, chantier.securite || {})}
<h3>Signatures</h3>
<table class="sig"><thead><tr><th>Nom</th><th>Fonction</th><th>Date</th><th>Signature</th></tr></thead><tbody>${'<tr><td></td><td></td><td></td><td></td></tr>'.repeat(5)}</tbody></table>
</section>

<section class="pb">
<h2>4. Plan de coupe</h2>
${fieldsTable(COUPE_FIELDS, chantier.coupe || {})}
<h3>Récapitulatif par essence</h3>
<table><thead><tr><th>Essence</th><th>Nb tiges</th><th>DHP moyen (cm)</th><th>Volume (m³)</th></tr></thead><tbody>${recapRows || '<tr><td colspan="4">—</td></tr>'}</tbody>
<tfoot><tr><th>Total</th><th>${stats.trees.length}</th><th></th><th>${stats.volume.toFixed(2)}</th></tr></tfoot></table>
<h3>Liste des arbres</h3>
<table><thead><tr><th>N°</th><th>Essence</th><th>DHP</th><th>H (m)</th><th>m³</th><th>Abattage</th><th>État</th><th>Assortiment</th><th>LV95</th></tr></thead><tbody>${treeRows || '<tr><td colspan="9">—</td></tr>'}</tbody></table>
<p><small>Volumes indicatifs : π/4 · DHP² · H · coefficient de forme (${esc(chantier.coupe?.facteur_forme ?? 0.45)}). Coordonnées LV95 calculées par formules approchées swisstopo (précision ~1 m), précision GPS non comprise.</small></p>
</section>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Autorisez les fenêtres pop-up pour afficher le rapport.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export { formatLV95 };
