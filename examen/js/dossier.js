// Dossier de coupe (module E17) au format Word, pré-rempli avec les données du chantier.
// Tout ce que l'application ne connaît pas reste en cases vides à compléter dans Word.

import { SYMBOLS, symbolSvg, symbolArt } from './symbols.js';
import { wgs84ToLV95, polygonArea, formatArea } from './swiss.js';
import { buildDocx, p, h1, h2, table, image } from './docx.js';
import { svgToPng } from './plan-image.js';
import { qrSvg } from './share.js';

const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
const dateCH = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const BOX = '☐';
const lignes = (t) => String(t || '').split(/\n|\s\/\s/).map((l) => l.trim()).filter(Boolean);
const vide = (n, cols) => Array.from({ length: n }, () => Array(cols).fill(''));
const note = (t) => p([[t, { italic: true, color: '7F7F7F', size: 9 }]]);
const coches = (list, done = new Set()) => list.map((t) => p(`${done.has(t) ? '☒' : BOX} ${t}`, { spaceAfter: 20 })).join('');

function coord(s) {
  if (!s) return { lv95: '', wgs: '', alt: '' };
  const { E, N } = wgs84ToLV95(s.lat, s.lng);
  return {
    lv95: `${fmt(E)} / ${fmt(N)}`,
    wgs: `${s.lat.toFixed(5)}° N, ${s.lng.toFixed(5)}° E`,
    alt: s.alt ? `${Math.round(s.alt)} m` : '',
  };
}

/** « Nom – 079… » ou « Nom, fonction, 079… » -> [nom, tel] */
function personne(l) {
  const m = l.match(/^(.*?)[\s,;–-]*((?:\+41|0)[\d\s]{8,})$/);
  if (m) {
    const r = m[1].match(/^(.*?)\s*\((.*)\)\s*$/);
    const avant = personne(r ? r[1] : m[1]);
    return { nom: avant.nom, role: r ? r[2] : avant.role, tel: m[2].trim() };
  }
  const parts = l.split(/[,;]|\s[–-]\s/).map((t) => t.trim()).filter(Boolean);
  const i = parts.findIndex((t) => /\d{2}/.test(t));
  const tel = i >= 0 ? parts.splice(i, 1)[0] : '';
  return { nom: parts[0] || l, role: parts.slice(1).join(', '), tel };
}

/**
 * @param {object} chantier
 * @param {{bytes,width,height}|null} plan image du plan
 * @param {string|null} qrUrl lien du plan (QR code)
 * @returns {Promise<Blob>}
 */
export async function dossierWord(chantier, plan, qrUrl) {
  const info = chantier.info || {};
  const sym = (k) => (chantier.symbols || []).filter((s) => s.kind === k);
  const H = sym('heli')[0];
  const T = sym('point_t')[0];
  const cH = coord(H);
  const cT = coord(T);
  const surface = chantier.parcel?.length > 2 ? formatArea(polygonArea(L.polygon(chantier.parcel))) : '';
  const nom = info.name || 'Chantier';
  const periode = [dateCH(info.date), dateCH(info.date_fin)].filter(Boolean).join(' au ');
  const dangers = new Set(Array.isArray(info.dangers_coches) ? info.dangers_coches : []);
  const n = (k) => sym(k).length;

  const images = [];
  let imgId = 1;
  const addImage = (bytes) => {
    const rId = `rIdImg${images.length + 1}`;
    images.push({ rId, bytes });
    return rId;
  };

  const B = []; // corps du document

  /* ---------------- Page de garde ---------------- */
  B.push(p([['MODULE E17 · BREVET DE CONTREMAÎTRE FORESTIER', { bold: true, color: 'C62828', size: 11 }]], { spaceBefore: 600 }));
  B.push(p('Dossier de coupe', { style: 'Title' }));
  B.push(p([[nom, { bold: true, size: 18 }]], { spaceAfter: 300 }));
  B.push(table([
    ['Rubrique', 'Données'],
    ['Candidat(e)', ''],
    ['Entreprise / triage', ''],
    ['Propriétaire de la forêt', ''],
    ['Mandant', ''],
    ['Commune / lieu-dit', info.lieu_h || H?.place || ''],
    ['Coordonnées (LV95)', cH.lv95 ? `${cH.lv95}${cH.alt ? ` · alt. ${cH.alt}` : ''}` : ''],
    ['Surface de la parcelle', surface],
    ['Période des travaux', periode],
    ['Responsable du chantier', [info.responsable, info.resp_role, info.resp_tel].filter(Boolean).join(' – ')],
    ['Dossier établi le', new Date().toLocaleDateString('fr-CH')],
  ], { widths: [35, 65], minHeight: 420, firstColFill: 'F6ECE2' }));
  B.push(h2('Sommaire'));
  B.push(['1. Description du chantier', '2. Méthodes de travail', '3. Analyse des risques', '4. Prescriptions et mesures de sécurité',
    '5. Ordre de travail pour l\'équipe', '6. Qualification des collaborateurs et des entrepreneurs', '7. Programme du déroulement des travaux',
    '8. Coordination', '9. Normes de sécurité', '10. Organisation des secours', '11. Estimation des coûts', 'Annexe : plan de coupe']
    .map((t) => p(t, { spaceAfter: 20 })).join(''));
  B.push(note('Les cases grisées et les lignes vides sont à compléter. Le contenu repris de l\'application peut être modifié librement.'));

  /* ---------------- 1. Description ---------------- */
  B.push(h1('1. Description du chantier', { pageBreakBefore: true }));
  B.push(table([
    ['Rubrique', 'Description'],
    ['Situation (lieu-dit, commune)', info.lieu_h || H?.place || ''],
    ['Surface / altitude', [surface, cH.alt && `alt. ${cH.alt}`].filter(Boolean).join(' · ')],
    ['Travaux prévus (quoi, où, pourquoi)', info.travaux || ''],
    ['Objectif sylvicole / fonction de la forêt', ''],
    ['Peuplement (essences, stade, état sanitaire)', ''],
    ['Volume estimé', info.volume || ''],
    ['Terrain (pente, sol, obstacles)', ''],
    ['Desserte et accès (routes, places de dépôt)', ''],
    ['Contraintes (zones S, lignes, routes, tiers, nature)', [
      n('electrique') ? 'Ligne électrique sur le plan' : '',
      n('bache') ? 'Fermeture de route prévue' : '',
      'Zones de protection des eaux : ☐ aucune ☐ S3 ☐ S2 ☐ S1',
    ].filter(Boolean).join('\n')],
    ['Autres travaux', info.autres_travaux || ''],
  ], { widths: [35, 65], minHeight: 560, firstColFill: 'F6ECE2' }));

  /* ---------------- 2. Méthodes ---------------- */
  B.push(h1('2. Méthodes de travail'));
  if (info.methode) B.push(p([['Relevé sur le terrain : ', { bold: true }], info.methode]));
  B.push(table([
    ['Opération', 'Méthode / machines choisies', 'Justification'],
    ['Abattage', '', ''],
    ['Façonnage (ébranchage, tronçonnage)', '', ''],
    ['Débardage', '', ''],
    ['Tri et stockage des bois (piles, dépôts)', [n('pile') && `${n('pile')} pile(s) de bois`, n('depot') && `${n('depot')} pile(s) longue(s)`].filter(Boolean).join(', '), ''],
    ['Rémanents / nettoyage', '', ''],
    ['Transport', '', ''],
  ], { widths: [26, 42, 32], minHeight: 620, firstColFill: 'F6ECE2' }));
  B.push(h2('Variantes étudiées'));
  B.push(table([['Variante', 'Avantages', 'Inconvénients'], ...vide(2, 3)], { widths: [30, 35, 35], minHeight: 620 }));

  /* ---------------- 3. Risques ---------------- */
  B.push(h1('3. Analyse des risques'));
  B.push(note('Gravité et probabilité : 1 = faible, 2 = moyenne, 3 = élevée. Risque = gravité × probabilité.'));
  const DANGERS = [
    ['Arbres dangereux (bois mort, arbres secs, encroués)', 'Bois mort'],
    ['Tensions dans le bois, arbres sous tension', null],
    ['Chute de hauteur', 'Chute de hauteur'],
    ['Chute de pierres, glissement', 'Chute de pierres'],
    ['Pente raide, terrain glissant', 'Pente raide'],
    ['Ligne électrique', 'Ligne électrique'],
    ['Route, trafic', 'Route, trafic'],
    ['Tiers (promeneurs, riverains)', 'Tiers (promeneurs…)'],
    ['Débardage (câble, treuil, machines)', null],
    ['Travail à la tronçonneuse', null],
    ['Météo (vent, neige, gel, orage)', null],
    ['Travail isolé / pas de réseau mobile', 'Pas de réseau mobile'],
    ['Zones de protection des eaux (hydrocarbures)', null],
  ];
  B.push(table([
    ['Danger', 'Où / situation', 'G', 'P', 'R', 'Mesures', 'Qui'],
    ...DANGERS.map(([t, key]) => [key && dangers.has(key) ? { text: `${t} ✔`, bold: true } : t, '', '', '', '', '', '']),
    ...(dangers.has('Autres') ? [[{ text: 'Autres (relevé sur le terrain)', bold: true }, '', '', '', '', '', '']] : []),
    ...vide(2, 7),
  ], { widths: [27, 18, 5, 5, 5, 28, 12], minHeight: 480, size: 9 }));
  if (dangers.size) B.push(note('✔ = danger coché sur la fiche de terrain.'));

  /* ---------------- 4. Sécurité ---------------- */
  B.push(h1('4. Prescriptions et mesures de sécurité'));
  if (info.mesures) B.push(p([['Mesures relevées sur le terrain : ', { bold: true }], info.mesures]));
  B.push(h2('Équipement de protection individuelle (EPI)'));
  B.push(coches(['Casque avec visière et protection de l\'ouïe', 'Pantalon et chaussures de protection anti-coupure', 'Gants', 'Vêtements de signalisation (haute visibilité)', 'Pharmacie de poche', 'Téléphone portable / radio']));
  B.push(h2('Signalisation et barrages'));
  const signal = [
    [n('triopan'), 'Triopan(s)'], [n('trois_lattes'), 'Trois lattes'], [n('barriere'), 'Barrière(s)'], [n('bache'), 'Route(s) fermée(s) (bâche)'],
  ].filter(([k]) => k);
  B.push(table([
    ['Élément', 'Nombre', 'Emplacement / remarque'],
    ...(signal.length ? signal.map(([k, t]) => [t, String(k), 'voir plan']) : []),
    ...vide(2, 3),
  ], { widths: [40, 12, 48], minHeight: 420 }));
  B.push(h2('Mesures organisationnelles'));
  B.push(coches(['Distance de sécurité : 2 longueurs d\'arbre lors de l\'abattage', 'Pas de travail isolé (contact visuel ou vocal)', 'Postes de garde / sentinelles aux accès', 'Information des riverains et des usagers', 'Contrôle quotidien de l\'organisation des secours', 'Ravitaillement et stockage des carburants hors zones S']));
  B.push(p('Autres mesures :'));
  B.push(table([['Mesure', 'Responsable'], ...vide(3, 2)], { widths: [75, 25], minHeight: 420 }));

  /* ---------------- 5. Ordre de travail ---------------- */
  B.push(h1('5. Ordre de travail pour l\'équipe'));
  B.push(table([
    ['', 'Contenu'],
    ['Quoi ? (travaux)', info.travaux || ''],
    ['Où ? (lieu, limites)', info.lieu_h || H?.place || ''],
    ['Comment ? (méthode)', info.methode || ''],
    ['Avec quoi ? (machines, outils)', ''],
    ['Qui ? (équipe)', [info.responsable && `Responsable : ${info.responsable}`, ...lignes(info.equipe)].filter(Boolean).join('\n')],
    ['Quand ? (début – fin, horaire)', periode],
    ['Combien ? (volume)', info.volume || ''],
    ['Dangers particuliers', [...dangers].join(', ')],
    ['Mesures de sécurité', info.mesures || ''],
    ['Organisation des secours', [`144 / Rega 1414`, cH.lv95 && `Point H : ${cH.lv95}`, cT.lv95 && `Point T : ${cT.lv95}`, info.hopital].filter(Boolean).join('\n')],
  ], { widths: [28, 72], minHeight: 520, firstColFill: 'F6ECE2' }));
  B.push(h2('Répartition des tâches'));
  const eq = lignes(info.equipe).map(personne);
  B.push(table([
    ['Collaborateur', 'Tâche', 'Machines / outils', 'Remarques'],
    ...eq.map((x) => [x.nom, '', '', '']),
    ...vide(Math.max(2, 4 - eq.length), 4),
  ], { widths: [25, 35, 22, 18], minHeight: 440 }));

  /* ---------------- 6. Qualification ---------------- */
  B.push(h1('6. Qualification des collaborateurs et des entrepreneurs'));
  B.push(h2('Collaborateurs'));
  const collab = [];
  if (info.responsable) collab.push([info.responsable, info.resp_role || 'Responsable du chantier', '', info.resp_tel || '']);
  eq.forEach((x) => collab.push([x.nom, x.role, '', x.tel]));
  lignes(info.formateur).map(personne).forEach((x) => collab.push([x.nom, 'Formateur', '', x.tel]));
  lignes(info.apprentis).map(personne).forEach((x) => collab.push([x.nom, 'Apprenti(e)', '', x.tel]));
  B.push(table([
    ['Nom', 'Fonction', 'Formation / qualification (CFC, cours…)', 'Téléphone'],
    ...collab,
    ...vide(Math.max(2, 4 - collab.length), 4),
  ], { widths: [25, 22, 33, 20], minHeight: 440 }));
  B.push(h2('Entrepreneurs et sous-traitants'));
  B.push(table([
    ['Entreprise', 'Prestation', 'Qualification / certificat', 'Contact'],
    ...vide(3, 4),
  ], { widths: [25, 25, 28, 22], minHeight: 440 }));

  /* ---------------- 7. Programme ---------------- */
  B.push(h1('7. Programme du déroulement des travaux'));
  B.push(table([
    ['Étape', 'Durée (j)', 'Début', 'Fin', 'Personnes / machines'],
    ['Préparation (martelage, autorisations, information)', '', '', '', ''],
    ['Mise en place de la signalisation et des barrages', '', dateCH(info.date), '', ''],
    ['Abattage et façonnage', '', '', '', ''],
    ['Débardage', '', '', '', ''],
    ['Tri, empilage, cubage', '', '', '', ''],
    ['Évacuation / transport des bois', '', '', '', ''],
    ['Remise en état, nettoyage, enlèvement de la signalisation', '', '', dateCH(info.date_fin), ''],
    ['Contrôle final et réception des travaux', '', '', '', ''],
  ], { widths: [40, 10, 13, 13, 24], minHeight: 440, firstColFill: 'F6ECE2' }));

  /* ---------------- 8. Coordination ---------------- */
  B.push(h1('8. Coordination'));
  B.push(table([
    ['Partenaire', 'Personne de contact / téléphone', 'Objet de la coordination', 'Date'],
    ['Propriétaire', '', '', ''],
    ['Inspection des forêts / garde forestier', '', '', ''],
    ['Commune (voirie, fermeture de route)', '', '', ''],
    ['Police (signalisation routière)', '', '', ''],
    ['Gestionnaire de la ligne électrique', n('electrique') ? 'ligne sur le plan' : '', '', ''],
    ['Entreprise de débardage / transporteur', '', '', ''],
    ['Riverains, usagers, chasse, tourisme', '', '', ''],
    ...vide(1, 4),
  ], { widths: [30, 28, 30, 12], minHeight: 440, firstColFill: 'F6ECE2' }));

  /* ---------------- 9. Normes ---------------- */
  B.push(h1('9. Normes de sécurité'));
  B.push(note('Références principales – à cocher, compléter ou corriger selon le chantier.'));
  B.push(coches([
    'Loi sur l\'assurance-accidents (LAA, RS 832.20)',
    'Ordonnance sur la prévention des accidents et des maladies professionnelles (OPA, RS 832.30)',
    'Directive CFST 2134 « Travaux forestiers »',
    'Règles vitales Suva pour les travaux forestiers',
    'Loi fédérale sur les forêts (LFo, RS 921.0) et loi forestière vaudoise (LVLFo)',
    'Ordonnance sur la protection des eaux (OEaux, RS 814.201) – zones S',
    'Ordonnance sur la signalisation routière (OSR, RS 741.21) et norme VSS sur la signalisation des chantiers',
    'Prescriptions de l\'exploitant pour les travaux à proximité de lignes électriques',
  ]));
  B.push(table([['Autre norme / prescription', 'Application sur ce chantier'], ...vide(2, 2)], { widths: [45, 55], minHeight: 440 }));

  /* ---------------- 10. Secours ---------------- */
  B.push(h1('10. Organisation des secours'));
  B.push(table([
    ['Numéros d\'urgence', ''],
    ['Ambulance', '144'], ['Rega (hélicoptère)', '1414'], ['Urgence (international)', '112'], ['Police', '117'], ['Pompiers', '118'], ['Tox Info', '145'],
    ['Médecin', info.medecin || ''],
    ['Hôpital', info.hopital || ''],
    ['Responsable du chantier', [info.responsable, info.resp_tel].filter(Boolean).join(' – ')],
  ], { widths: [35, 65], firstColFill: 'F6ECE2' }));
  B.push(table([
    ['Point de sauvetage', 'Lieu', 'Coordonnées LV95', 'WGS84 / altitude'],
    ['H – sauvetage aérien', info.lieu_h || H?.place || '', cH.lv95, [cH.wgs, cH.alt].filter(Boolean).join('\n')],
    ['T – sauvetage terrestre (rencontre ambulance)', info.localite_t || T?.place || '', cT.lv95, [cT.wgs, cT.alt].filter(Boolean).join('\n')],
    ['Véhicule et pharmacie', n('vehicule') ? 'voir plan' : '', '', ''],
  ], { widths: [26, 26, 22, 26], minHeight: 480, firstColFill: 'F6ECE2' }));
  B.push(h2('Annonce d\'une urgence'));
  B.push(['Qui donne l\'alerte ? (nom, n° de téléphone)', 'Que s\'est-il passé ?', 'Quand a eu lieu l\'accident ?', 'Où sont les blessés ? (lire les coordonnées H ou T)', 'Combien de blessés ?', 'Autres dangers : câbles, lignes électriques, météo, vent']
    .map((t, i) => p(`${i + 1}. ${t}`, { spaceAfter: 20 })).join(''));
  B.push(h2('Contrôles'));
  B.push(coches(['Réseau mobile vérifié sur le chantier', 'Pharmacie et couverture de survie dans le véhicule', 'Accès pour l\'ambulance vérifié jusqu\'au point T', 'Place d\'atterrissage hélicoptère libre (câbles, arbres)', 'Organisation des secours expliquée à toute l\'équipe']));

  /* ---------------- 11. Coûts ---------------- */
  B.push(h1('11. Estimation des coûts'));
  if (info.volume) B.push(p([['Volume relevé : ', { bold: true }], info.volume]));
  const cout = (rows) => rows.map((t) => [t, '', '', '', '']);
  B.push(h2('Dépenses'));
  B.push(table([
    ['Poste', 'Quantité', 'Unité', 'Prix unit. (CHF)', 'Total (CHF)'],
    ...cout(['Main-d\'œuvre : abattage et façonnage', 'Tronçonneuses, outillage, carburant', 'Débardage (tracteur, porteur, câble)', 'Signalisation et sécurité', 'Transport des bois', 'Préparation, martelage, administration', 'Divers et imprévus']),
    [{ text: 'Total des dépenses', bold: true }, '', '', '', ''],
  ], { widths: [40, 13, 12, 17, 18], minHeight: 420 }));
  B.push(h2('Recettes'));
  B.push(table([
    ['Assortiment', 'Volume (m³)', 'Unité', 'Prix unit. (CHF)', 'Total (CHF)'],
    ...cout(['Bois de service (grumes)', 'Bois d\'industrie', 'Bois-énergie (plaquettes, bûches)', 'Subventions / contributions']),
    [{ text: 'Total des recettes', bold: true }, '', '', '', ''],
  ], { widths: [40, 13, 12, 17, 18], minHeight: 420 }));
  B.push(table([
    ['Résultat', 'CHF'],
    ['Recettes – dépenses', ''],
    ['Résultat par m³', ''],
  ], { widths: [70, 30], minHeight: 420 }));

  /* ---------------- Signature ---------------- */
  B.push(table([
    ['Établi par', 'Lieu et date', 'Signature'],
    [info.responsable || '', '', ''],
  ], { widths: [35, 35, 30], minHeight: 700 }));

  /* ---------------- Annexe : plan ---------------- */
  B.push(h1('Annexe : plan de coupe', { pageBreakBefore: true }));
  B.push(p([[nom, { bold: true }], surface ? ` · parcelle ${surface}` : '']));
  if (qrUrl) {
    try {
      const svg = qrSvg(qrUrl).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      const bytes = await svgToPng(svg, 400, 400);
      B.push(table([[
        { text: [`<w:p>${image(addImage(bytes), imgId++, 2.2, 2.2, 'QR code du plan')}</w:p>`] },
        'Plan sur le téléphone : scannez ce code pour voir le plan et votre position par rapport au chantier.',
      ]], { widths: [15, 85], header: false }));
    } catch (e) {
      console.warn('QR', e);
    }
  }

  if (plan) {
    const wCm = 17;
    const hCm = Math.min(12.5, (wCm * plan.height) / plan.width);
    const w2 = (hCm * plan.width) / plan.height;
    B.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${image(addImage(plan.bytes), imgId++, w2, hCm, 'Plan de coupe')}</w:p>`);
  } else {
    B.push(note('Plan non disponible : coller ici une capture du plan.'));
  }

  // Légende (dessins des symboles utilisés)
  const used = SYMBOLS.filter((d) => (chantier.symbols || []).some((s) => s.kind === d.kind) && d.kind !== 'texte');
  const leg = [];
  if (chantier.parcel) leg.push([null, 'Parcelle']);
  for (const d of used) {
    try {
      const [vw, vh] = symbolArt(d.kind);
      const hpx = 48;
      const wpx = Math.round((hpx * vw) / vh);
      const bytes = await svgToPng(symbolSvg(d.kind, hpx), wpx, hpx);
      const hc = 0.55;
      leg.push([`<w:p>${image(addImage(bytes), imgId++, (hc * wpx) / hpx, hc, d.label)}</w:p>`, d.label]);
    } catch {
      leg.push([null, d.label]);
    }
  }
  (chantier.symbols || []).filter((s) => s.kind === 'zone' && s.text).forEach((z) => leg.push([null, `Zone : ${z.text}`]));
  if (leg.length) {
    B.push(h2('Légende'));
    const rows = [];
    for (let i = 0; i < leg.length; i += 3) {
      const row = [];
      for (let j = 0; j < 3; j++) {
        const it = leg[i + j] || [null, ''];
        row.push({ text: [it[0] || ''] }, it[1]);
      }
      rows.push(row);
    }
    B.push(table(rows, { widths: [8, 25.3, 8, 25.3, 8, 25.4], header: false, size: 9 }));
  }

  return buildDocx({ body: B.join(''), images, footer: `Dossier de coupe · ${nom}`, title: `Dossier de coupe – ${nom}` });
}

