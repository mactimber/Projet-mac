// Dossier de coupe (module E17) au format Word, dans le style du dossier D9 :
// un dossier rédigé (page de garde, table des matières, introduction, 10 points de l'examen),
// pré-rempli avec les données du chantier. Le reste est à écrire dans Word.

import { SYMBOLS, symbolSvg, symbolArt } from './symbols.js';
import { wgs84ToLV95 } from './swiss.js';
import { buildDocx, p, h1, h2, table, image, field } from './docx.js';
import { svgToPng } from './plan-image.js';
import { qrSvg } from './share.js';

const VERT = '2B5C1A';
const LARGEUR = 9070; // largeur utile (21 cm - 2 × 2,5 cm), en twips
const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
const dateCH = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const lignes = (t) => String(t || '').split(/\n|\s\/\s/).map((l) => l.trim()).filter(Boolean);
const fmtDist = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(d)} m`);

/* Petits éléments de texte */
const A_ECRIRE = (t) => p([[`À écrire ici : ${t}`, { italic: true, color: '808080', size: 9 }]], { spaceAfter: 160, keepNext: true });
const Q = (t) => p([[t, { bold: true }]], { keepNext: true, spaceBefore: 160, spaceAfter: 60 });
const VIDES = (n = 2) => Array.from({ length: n }, () => p('')).join('');
const PH = (t) => [`[${t}]`, { highlight: 'FFF2CC' }]; // à compléter (surligné)
const T = (...seg) => p(seg.map((x) => (Array.isArray(x) ? x : [x])));
const NOTE = (t) => p([[t, { italic: true, color: '595959', size: 9 }]], { spaceBefore: 60 });

function coord(s) {
  if (!s) return { mn95: '', alt: '' };
  const { E, N } = wgs84ToLV95(s.lat, s.lng);
  return { mn95: `${fmt(E)} / ${fmt(N)}`, alt: s.alt ? `${Math.round(s.alt)} m` : '' };
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

/** Image du dossier (img/…) : octets et dimensions, ou null si elle manque. */
async function chargerImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const out = { bytes: new Uint8Array(await blob.arrayBuffer()), w: bmp.width, h: bmp.height, ext: /\.jpe?g$/i.test(url) ? 'jpg' : 'png' };
    bmp.close?.();
    return out;
  } catch {
    return null;
  }
}

/* Styles du dossier : Arial 11 justifié, titres 20 / 16 pt numérotés */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-CH"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="480" w:after="200"/><w:ind w:left="794" w:hanging="794"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:color w:val="000000"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="320" w:after="160"/><w:ind w:left="709" w:hanging="709"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:color w:val="000000"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TitreTDM"><w:name w:val="Titre table des matières"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="360"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:pPr><w:tabs><w:tab w:val="left" w:pos="567"/><w:tab w:val="right" w:leader="dot" w:pos="9060"/></w:tabs><w:spacing w:before="120" w:after="60"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:pPr><w:tabs><w:tab w:val="left" w:pos="1276"/><w:tab w:val="right" w:leader="dot" w:pos="9060"/></w:tabs><w:spacing w:before="0" w:after="40"/><w:ind w:left="567"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="000000"/></w:rPr></w:style>
</w:styles>`;

/* Numérotation : 1 = titres (1. / 1.1), 2 = puces, 3 et 4 = listes 1. 2. 3. */
const lvl = (i, fmtNum, text, ind, hang, extra = '') => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmtNum}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="${hang}"/></w:pPr>${extra}</w:lvl>`;
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'decimal', '%1.', 794, 794)}${lvl(1, 'decimal', '%1.%2', 709, 709)}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${lvl(0, 'bullet', '–', 425, 283)}</w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/>${lvl(0, 'decimal', '%1.', 425, 425)}</w:abstractNum>
<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="singleLevel"/>${lvl(0, 'decimal', '%1.', 425, 425)}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
<w:num w:numId="4"><w:abstractNumId w:val="3"/></w:num>
</w:numbering>`;
const PUCE = (seg) => p(Array.isArray(seg) ? seg : [seg], { num: [2, 0], spaceAfter: 40, align: 'left' });
const LISTE = (numId, seg) => p(Array.isArray(seg) ? seg : [seg], { num: [numId, 0], spaceAfter: 40, align: 'left' });

/**
 * @param {object} chantier
 * @param {{bytes,width,height}|null} plan image du plan (avec le cartouche du point T s'il est loin)
 * @param {string|null} qrUrl lien du plan (QR code)
 * @returns {Promise<Blob>}
 */
export async function dossierWord(chantier, plan, qrUrl) {
  const info = chantier.info || {};
  const symboles = chantier.symbols || [];
  const sym = (k) => symboles.filter((s) => s.kind === k);
  const n = (k) => sym(k).length;
  const H = sym('heli')[0];
  const Tp = sym('point_t')[0];
  const cH = coord(H);
  const cT = coord(Tp);
  const nom = info.name || 'Chantier';
  const date = dateCH(info.date) || new Date().toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const periode = info.date && info.date_fin ? `du ${dateCH(info.date)} au ${dateCH(info.date_fin)}` : info.date ? `dès le ${dateCH(info.date)}` : '';
  const dangers = Array.isArray(info.dangers_coches) ? info.dangers_coches : [];
  const lieu = info.lieu_h || H?.place || '';
  const virgule = lieu.lastIndexOf(', ');
  const lieuDit = virgule > 0 ? lieu.slice(0, virgule) : lieu;
  const commune = virgule > 0 ? lieu.slice(virgule + 2).split(' – ')[0] : '';
  const lieuT = (info.localite_t || Tp?.place || '').split(' – ')[0];
  const acces = sym('acces_t').find((s) => s.pts?.length > 1);
  let accesTxt = '';
  if (acces) {
    let d = 0;
    for (let i = 1; i < acces.pts.length; i++) d += L.latLng(acces.pts[i - 1]).distanceTo(acces.pts[i]);
    accesTxt = `${fmtDist(d)} par la route depuis le chantier (voir plan)`;
  }
  const route = n('bache') + n('barriere') + n('triopan') + n('trois_lattes') > 0 || dangers.includes('Route, trafic');
  const ligneElec = n('electrique') > 0 || dangers.includes('Ligne électrique');
  const equipe = lignes(info.equipe).map(personne);

  /* Images */
  const images = [];
  let imgId = 1;
  const addImage = (bytes, ext = 'png') => {
    const rId = `rIdImg${images.length + 1}`;
    images.push({ rId, bytes, ext });
    return rId;
  };
  const [logo, entete, pied] = await Promise.all(['img/logo-kmacheret.png', 'img/entete-racines.jpg', 'img/pied-arbres.jpg'].map(chargerImage));
  const imgPart = (im, rId, wCm, id, name) => (im ? { run: image(rId, id, wCm, (wCm * im.h) / im.w, name), images: [{ rId, bytes: im.bytes, ext: im.ext }] } : { run: '', images: [] });

  /* En-têtes et pieds de page */
  const logoP = imgPart(logo, 'rIdLogo', 3.5, 9001, 'Logo');
  const firstHeader = {
    xml: table([[
      { text: [p([['Test compétence E17', { bold: true, size: 16, color: VERT }]], { align: 'left', spaceAfter: 0 })] },
      { text: [`<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr>${logoP.run}</w:p>`] },
    ]], { widths: [60, 40], header: false, borders: false, after: false, vAlign: 'top' }) + '<w:p/>',
    images: logoP.images,
  };
  const firstFooter = {
    xml: table([[
      { text: ['Module E17', 'Centre de formation professionnelle forestière', 'Le Mont-sur-Lausanne'] },
      { text: date, align: 'center' },
      { text: info.responsable || '', align: 'right' },
    ]], { widths: [46, 20, 34], header: false, borders: false, after: false, size: 10, vAlign: 'bottom' }) + '<w:p/>',
  };
  const enteteP = imgPart(entete, 'rIdEntete', 7, 9002, 'En-tête');
  const header = { xml: `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>${enteteP.run}</w:p>`, images: enteteP.images };
  const piedP = imgPart(pied, 'rIdPied', 7, 9003, 'Pied de page');
  const pageNo = `<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">Page | </w:t></w:r>${field('PAGE', '1', '<w:rPr><w:sz w:val="18"/></w:rPr>')}</w:p>`;
  const footer = {
    xml: (piedP.run ? `<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr>${piedP.run}</w:p>` : '')
      + table([[
        { text: ['Test de compétence', 'Module E17'] },
        { text: date, align: 'center' },
        { text: [pageNo] },
      ]], { widths: [40, 20, 40], header: false, borders: false, after: false, size: 9, vAlign: 'center' }) + '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>',
    images: piedP.images,
  };

  /* Corps */
  const B = [];
  const titres = []; // pour pré-remplir la table des matières
  let n1 = 0;
  let n2 = 0;
  const T1 = (t, o = {}) => {
    if (o.noNum) titres.push([1, '', t]);
    else {
      n1 += 1;
      n2 = 0;
      titres.push([1, `${n1}.`, t]);
    }
    B.push(h1(t, o));
  };
  const T2 = (t) => {
    n2 += 1;
    titres.push([2, `${n1}.${n2}`, t]);
    B.push(h2(t));
  };

  /* Page de garde */
  B.push(p([['Dossier de coupe', { bold: true, size: 36, color: VERT }]], { align: 'center', spaceBefore: 3400, spaceAfter: 120 }));
  B.push(p([[nom, { bold: true, size: 36, color: VERT }]], { align: 'center', spaceAfter: 1400 }));
  B.push(p([[info.citation || '« Citation à choisir »', { italic: true, size: 12 }]], { align: 'center', spaceAfter: 60 }));
  B.push(p([[info.citation_auteur || 'Auteur', { size: 10, color: '595959' }]], { align: 'center' }));

  /* Table des matières (champ Word, pré-rempli) : construite à la fin */
  const TDM = '@@TDM@@';
  B.push(p('Table des matières', { style: 'TitreTDM', pageBreakBefore: true }));
  B.push(TDM);
  B.push(NOTE('Pour mettre à jour les numéros de page : clic droit sur la table des matières → « Mettre à jour les champs » (ou touche F9).'));

  /* Introduction */
  T1('Introduction', { noNum: true, pageBreakBefore: true });
  const contraintes = [
    route && 'la route et le trafic (fermeture et signalisation)',
    ligneElec && 'une ligne électrique',
    dangers.includes('Tiers (promeneurs…)') && 'les promeneurs et autres usagers',
    dangers.includes('Chute de pierres') && 'les chutes de pierres',
    dangers.includes('Pente raide') && 'la pente raide',
  ].filter(Boolean);
  B.push(T(
    `Le chantier « ${nom} » se situe sur la commune de `, commune ? commune : PH('commune'),
    ', au lieu-dit ', lieuDit ? lieuDit : PH('lieu-dit'), '. ',
    'Les travaux prévus sont : ', info.travaux ? info.travaux.replace(/\.$/, '') : PH('travaux prévus'), '. ',
    'Le volume estimé est de ', info.volume ? info.volume.replace(/\.$/, '') : PH('volume'), '. ',
    'Le mandant est ', PH('mandant'), '. ',
    'Les contraintes principales sont ', contraintes.length ? contraintes.join(', ') : '', contraintes.length ? ', ' : '', PH('habitations, route, autres contraintes'), '. ',
    'Zone de protection des eaux : ', PH('aucune / S1 / S2 / S3'), '. ',
    'En tant que contremaître, je suis responsable de la planification et de l\'organisation de ce chantier, de la sécurité de l\'équipe et des tiers, ainsi que de la coordination avec le mandant, les entreprises et les autorités.',
  ));

  /* 1. Méthodes de travail */
  T1('Méthodes de travail');
  B.push(A_ECRIRE('méthode choisie (abattage, façonnage, débardage, évacuation), justification, variante écartée et pourquoi.'));
  if (info.methode) B.push(T('Selon le relevé de terrain : ', info.methode.replace(/\.$/, ''), '.'));
  B.push(Q('Abattage'), VIDES(1), Q('Façonnage'), VIDES(1), Q('Débardage'), VIDES(1), Q('Évacuation des bois'));
  B.push(n('pile') + n('depot') ? T(`Les bois sont stockés sur ${n('pile') + n('depot')} place(s) de dépôt indiquée(s) sur le plan (point 9).`) : VIDES(1));
  B.push(Q('Justification du choix'), VIDES(1), Q('Variante écartée et pourquoi'), VIDES(1));

  /* 2. Analyse des risques */
  T1('Analyse des risques');
  B.push(A_ECRIRE('pour chaque activité, les dangers, leur évaluation et les mesures, selon la méthode du cours.'));
  B.push(table([
    ['Activité', 'Danger', 'Probabilité (++ / + / - / --)', 'Gravité (I à V)', 'Groupe (1-2-3)', 'Mesure (S-T-O-P)', 'Qui / Quand'],
    ...dangers.map((d) => ['', d, '', '', '', '', '']),
    ...Array.from({ length: Math.max(3, 6 - dangers.length) }, () => ['', '', '', '', '', '', '']),
  ], { widths: [15, 18, 13, 10, 10, 20, 14], minHeight: 480, size: 9, headFill: 'DCE8D2' }));
  B.push(NOTE('Groupe 1 = mesures immédiates. Mesures S-T-O-P : Substitution, Technique, Organisation, Personnel.'));
  if (dangers.length) B.push(NOTE('Les premières lignes reprennent les dangers cochés sur le terrain.'));

  /* 3. Prescriptions et mesures de sécurité */
  T1('Prescriptions et mesures de sécurité');
  B.push(A_ECRIRE('EPI, distances, sentinelles, signalisation et barrages, zones de protection des eaux.'));
  B.push(Q('Équipement de protection individuelle (EPI)'));
  B.push(T('Chaque collaborateur porte l\'EPI complet : casque avec visière et protection de l\'ouïe, pantalon et chaussures de protection anti-coupure, gants et vêtements de signalisation. La pharmacie de poche est portée sur soi.'));
  B.push(Q('Distances de sécurité'));
  B.push(T('Lors de l\'abattage, la zone de danger correspond à deux longueurs d\'arbre autour de l\'arbre abattu. Personne d\'autre que l\'abatteur ne s\'y trouve. Le contact visuel ou vocal entre les collaborateurs est assuré en permanence.'));
  B.push(Q('Sentinelles'));
  B.push(T(PH('nombre'), ' sentinelle(s) surveillent les accès ', PH('emplacements'), ' et sont en liaison avec l\'abatteur ', PH('radio / signes convenus'), '.'));
  B.push(Q('Signalisation et barrages'));
  const sig = [
    [n('triopan'), 'triopan', 'triopans'], [n('trois_lattes'), 'panneau trois lattes', 'panneaux trois lattes'],
    [n('barriere'), 'barrière', 'barrières'], [n('bache'), 'route fermée (bâche)', 'routes fermées (bâches)'],
  ].filter(([k]) => k).map(([k, s1, s2]) => `${k} ${k > 1 ? s2 : s1}`);
  B.push(sig.length
    ? T(`Selon le plan de coupe (point 9) : ${sig.join(', ').replace(/, ([^,]*)$/, ' et $1')}. La signalisation est posée avant le début des travaux et contrôlée chaque jour.`)
    : T(PH('signalisation et barrages prévus'), '.'));
  B.push(Q('Zones de protection des eaux'));
  B.push(T('Le chantier ', PH('se trouve / ne se trouve pas'), ' en zone de protection des eaux ', PH('S1 / S2 / S3'), '. Le ravitaillement des machines et le stockage des carburants se font hors des zones S ; un kit absorbant est disponible sur le chantier.'));

  /* 4. Ordre de travail pour l'équipe */
  T1('Ordre de travail pour l\'équipe');
  B.push(A_ECRIRE('l\'ordre de travail tel que vous le donnez à l\'équipe au début du chantier.'));
  B.push(Q('Objectif'));
  B.push(T('Vous devez réaliser ', info.travaux ? info.travaux.replace(/\.$/, '') : PH('travaux'), ' au lieu-dit ', lieuDit || PH('lieu-dit'), periode ? `, ${periode}` : ', ', periode ? '' : PH('période'), ', soit environ ', info.volume ? info.volume.replace(/\.$/, '') : PH('volume'), '. Le travail se fait sans accident : la sécurité passe avant le rendement.'));
  B.push(Q('Méthode'));
  B.push(T('Vous travaillez selon la méthode suivante : ', info.methode ? info.methode.replace(/\.$/, '') : PH('méthode'), '.'));
  B.push(Q('Qui fait quoi'));
  const qui = [
    info.responsable && [info.responsable, 'responsable du chantier'],
    ...equipe.map((x) => [x.nom, '']),
    ...lignes(info.formateur).map(personne).map((x) => [x.nom, 'formateur']),
    ...lignes(info.apprentis).map(personne).map((x) => [x.nom, 'apprenti(e)']),
  ].filter(Boolean);
  if (qui.length) qui.forEach(([nm, role]) => B.push(PUCE([`${nm}${role ? ` (${role})` : ''} : `, PH('tâche')])));
  else B.push(VIDES(1));
  B.push(Q('Dangers et obstacles'));
  const obst = [...dangers, ligneElec && !dangers.includes('Ligne électrique') && 'ligne électrique'].filter(Boolean);
  B.push(obst.length ? T(`Faites particulièrement attention à : ${obst.join(', ').toLowerCase()}. Les zones de danger sont indiquées sur le plan (point 9).`) : VIDES(1));
  B.push(Q('Assortiments'));
  B.push(T(PH('assortiments, longueurs, qualités, places de dépôt'), '.'));
  B.push(Q('Particularités'));
  B.push(VIDES(1));
  B.push(Q('Urgence'));
  B.push(T('En cas d\'accident, appliquez l\'organisation des secours du point 9 : appel au 144 (Rega 1414)',
    cH.mn95 ? `, point H ${cH.mn95}` : '', lieuT ? `, point T ${lieuT}` : cT.mn95 ? `, point T ${cT.mn95}` : '',
    '. Une personne va au point T pour guider l\'ambulance.'));
  B.push(Q('Questions de contrôle'));
  ['Où se trouve le point T ?', 'Quel numéro appelez-vous en cas d\'accident ?', 'Qui donne l\'alerte et qui va au point T ?', 'Où sont les zones de danger aujourd\'hui ?', 'Que faites-vous si un arbre reste encroué ?']
    .forEach((t) => B.push(LISTE(4, t)));

  /* 5. Qualification */
  T1('Qualification des collaborateurs et des entrepreneurs');
  B.push(A_ECRIRE('formation et qualification de chaque personne et de chaque entreprise, et pourquoi elles conviennent pour ce chantier.'));
  const pers = [
    info.responsable && [info.responsable, info.resp_role || 'Responsable du chantier'],
    ...equipe.map((x) => [x.nom, x.role]),
    ...lignes(info.formateur).map(personne).map((x) => [x.nom, 'Formateur']),
    ...lignes(info.apprentis).map(personne).map((x) => [x.nom, 'Apprenti(e)']),
  ].filter(Boolean);
  B.push(table([
    ['Nom / entreprise', 'Fonction', 'Qualification (CFC, cours, permis)', 'Tâche'],
    ...pers.map(([nm, f]) => [nm, f || '', '', '']),
    ...Array.from({ length: 2 }, () => ['', '', '', '']),
  ], { widths: [28, 20, 28, 24], minHeight: 440, size: 10, headFill: 'DCE8D2' }));
  B.push(VIDES(1));

  /* 6. Programme */
  T1('Programme du déroulement des travaux');
  B.push(A_ECRIRE('les étapes de la préparation à la fin du chantier.'));
  B.push(table([
    ['Quand', 'Quoi', 'Qui'],
    ['J-6 mois', 'Martelage, contact avec le mandant et les propriétaires, autorisations', ''],
    ['J-3 mois', 'Choix de la méthode, offres et choix des entreprises, calcul des coûts', ''],
    ['J-30', 'Coordination avec la commune, la police, le gestionnaire de la ligne électrique ; information des riverains', ''],
    ['J-5', 'Confirmation de l\'équipe et des machines, reconnaissance des accès et des points H et T', ''],
    [`J-0${info.date ? ` (${dateCH(info.date)})` : ''}`, 'Ordre de travail à l\'équipe, mise en place de la signalisation, début des travaux', info.responsable || ''],
    [`Fin de chantier${info.date_fin ? ` (${dateCH(info.date_fin)})` : ''}`, 'Enlèvement de la signalisation, nettoyage, contrôle et réception des travaux, décompte', info.responsable || ''],
  ], { widths: [20, 58, 22], size: 10, headFill: 'DCE8D2' }));
  B.push(VIDES(1));

  /* 7. Coordination */
  T1('Coordination');
  B.push(A_ECRIRE('avec qui vous vous coordonnez, sur quoi et quand.'));
  B.push(Q('Mandant'), VIDES(1), Q('Propriétaires'), VIDES(1));
  B.push(Q('Commune et police'));
  B.push(route ? T('Une fermeture ou une restriction de la route est prévue (voir plan) : autorisation de la commune et de la police, signalisation selon l\'OSR et les normes VSS.') : VIDES(1));
  B.push(Q('Entreprises tierces (qui fait quoi)'), VIDES(1));
  B.push(Q('Riverains et usagers'));
  B.push(dangers.includes('Tiers (promeneurs…)') ? T('Les riverains et les promeneurs sont informés à l\'avance (affiches aux accès) ; les chemins sont fermés pendant l\'abattage.') : VIDES(1));
  B.push(Q('Ligne électrique'));
  B.push(ligneElec
    ? T('Une ligne électrique se trouve dans le périmètre (voir plan) : contact avec le gestionnaire du réseau, mise hors tension si nécessaire et respect des distances de sécurité.')
    : T(PH('pas de ligne électrique dans le périmètre / à vérifier'), '.'));

  /* 8. Normes de sécurité */
  T1('Normes de sécurité');
  B.push(A_ECRIRE('garder les normes qui s\'appliquent à ce chantier, supprimer les autres.'));
  [
    'LAA – Loi fédérale sur l\'assurance-accidents',
    'OPA – Ordonnance sur la prévention des accidents et des maladies professionnelles',
    'OTConst – Ordonnance sur les travaux de construction',
    'LFo et OFo – Loi et ordonnance fédérales sur les forêts',
    'Directive CFST 2134 « Travaux forestiers » (état 27.06.2025)',
    'Suva 44069 « Travaux en forêt » (2025)',
    'Suva 66092 « Collaboration avec des entreprises tierces »',
    'Suva 33072 « Travaux sur arbres avec échelle »',
    'Suva 33070 « Assurage par cordes en terrain escarpé »',
    'Publications Suva pour le travail avec l\'hélicoptère et le câble-grue',
    'OEaux – Ordonnance sur la protection des eaux (zones S)',
    'OSR – Ordonnance sur la signalisation routière et normes VSS (signalisation)',
  ].forEach((t) => B.push(PUCE(t)));

  /* 9. Organisation des secours */
  T1('Organisation des secours');
  B.push(A_ECRIRE('compléter et vérifier sur place (réseau mobile, accès de l\'ambulance, place d\'atterrissage).'));
  T2('Plan de coupe');
  if (plan) {
    let wCm = 16;
    let hCm = (wCm * plan.height) / plan.width;
    if (hCm > 15) {
      hCm = 15;
      wCm = (hCm * plan.width) / plan.height;
    }
    B.push(`<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:after="60"/></w:pPr>${image(addImage(plan.bytes), imgId++, wCm, hCm, 'Plan de coupe')}</w:p>`);
  } else {
    B.push(T(PH('coller ici le plan de coupe')));
  }
  // Légende (dessins des symboles utilisés)
  const used = SYMBOLS.filter((d) => symboles.some((s) => s.kind === d.kind) && d.kind !== 'texte');
  const leg = [];
  if (chantier.parcel) leg.push([null, 'Parcelle']);
  for (const d of used) {
    try {
      const [vw, vh] = symbolArt(d.kind);
      const hpx = 48;
      const wpx = Math.round((hpx * vw) / vh);
      const bytes = await svgToPng(symbolSvg(d.kind, hpx), wpx, hpx);
      const hc = 0.5;
      leg.push([`<w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>${image(addImage(bytes), imgId++, (hc * wpx) / hpx, hc, d.label)}</w:p>`, d.label]);
    } catch {
      leg.push([null, d.label]);
    }
  }
  sym('zone').filter((z) => z.text).forEach((z) => leg.push([null, `Zone : ${z.text}`]));
  if (leg.length) {
    const rows = [];
    for (let i = 0; i < leg.length; i += 3) {
      const row = [];
      for (let j = 0; j < 3; j++) {
        const it = leg[i + j] || [null, ''];
        row.push({ text: [it[0] || ''] }, it[1]);
      }
      rows.push(row);
    }
    B.push(p([['Légende', { bold: true }]], { keepNext: true, spaceBefore: 60, spaceAfter: 60 }));
    B.push(table(rows, { widths: [8, 25.3, 8, 25.3, 8, 25.4], header: false, size: 9, vAlign: 'center' }));
  }
  if (qrUrl) {
    try {
      const svg = qrSvg(qrUrl).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      const bytes = await svgToPng(svg, 400, 400);
      B.push(table([[
        { text: [`<w:p>${image(addImage(bytes), imgId++, 2.4, 2.4, 'QR code du plan')}</w:p>`] },
        { text: 'Scannez ce code avec le téléphone pour voir le plan de coupe et votre position par rapport au chantier.' },
      ]], { widths: [18, 82], header: false, borders: false, size: 10, vAlign: 'center' }));
    } catch (e) {
      console.warn('QR', e);
    }
  }

  T2('Urgences et coordonnées');
  B.push(table([
    ['Service', 'Numéro / contact'],
    ['Ambulance', '144'], ['Rega (hélicoptère)', '1414'], ['Police', '117'], ['Pompiers', '118'],
    ['Urgence (international)', '112'], ['Tox Info Suisse', '145'],
    ['Médecin de garde VD', info.medecin || 'Médecin de garde VD – 0848 133 133'],
    ['Hôpital', info.hopital || 'CHUV, Lausanne – 021 314 11 11'],
  ], { widths: [35, 65], size: 10, headFill: 'DCE8D2', keep: true }));

  T2('Points de sauvetage H et T');
  B.push(table([
    ['Point', 'Lieu', 'Coordonnées MN95', 'Accès'],
    ['H – sauvetage aérien', lieu, [cH.mn95, cH.alt && `alt. ${cH.alt}`].filter(Boolean).join('\n'), 'Hélicoptère (Rega 1414)'],
    ['T – sauvetage terrestre', lieuT, [cT.mn95, cT.alt && `alt. ${cT.alt}`].filter(Boolean).join('\n'), accesTxt || ''],
  ], { widths: [22, 28, 22, 28], size: 10, headFill: 'DCE8D2', minHeight: 480, keep: true }));

  T2('Annonce d\'une urgence');
  [
    [['Qui ', { bold: true }], 'appelle ? Nom et numéro de téléphone.'],
    [['Quoi ', { bold: true }], ': que s\'est-il passé ?'],
    [['Quand ', { bold: true }], 'l\'accident a-t-il eu lieu ?'],
    [['Où ', { bold: true }], 'sont les blessés ? Lieu-dit et coordonnées du point H ou T.'],
    [['Combien ', { bold: true }], 'de blessés, et dans quel état ?'],
    [['Autres dangers ', { bold: true }], ': câbles, ligne électrique, météo, vent.'],
  ].forEach((seg) => B.push(LISTE(3, seg)));

  /* 10. Estimation des coûts */
  T1('Estimation des coûts');
  B.push(A_ECRIRE('coller la feuille de précalculation, puis commenter le résultat.'));
  B.push(T('Pré-calculation sur la feuille officielle CFPF, tarifs 2026.'));
  B.push(table([[{ text: 'Coller ici la feuille de précalculation', color: '808080', italic: true, align: 'center' }]], { widths: [100], header: false, rowHeight: 5600, size: 10, vAlign: 'center' }));
  B.push(Q('Résultat'), VIDES(2), Q('Comparaison avec les chiffres du cours'), VIDES(2), Q('Variante moins chère et mon choix'), VIDES(2));

  /* Table des matières : champ TOC, pré-rempli avec les titres (numéros de page à mettre à jour dans Word) */
  const entree = ([niv, num, t], i, all) => {
    const debut = i === 0 ? `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` : '';
    const fin = i === all.length - 1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : '';
    return `<w:p><w:pPr><w:pStyle w:val="TOC${niv}"/></w:pPr>${debut}${num ? `<w:r><w:t xml:space="preserve">${num}</w:t></w:r><w:r><w:tab/></w:r>` : ''}<w:r><w:t xml:space="preserve">${t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</w:t></w:r>${fin}</w:p>`;
  };
  const body = B.join('').replace(TDM, titres.map(entree).join(''));

  return buildDocx({
    body, images, styles: STYLES, numbering: NUMBERING,
    header, footer, firstHeader, firstFooter,
    margins: { top: 1418, right: 1418, bottom: 1134, left: 1418, header: 567, footer: 340 },
    title: `Dossier de coupe – ${nom}`,
  });
}
