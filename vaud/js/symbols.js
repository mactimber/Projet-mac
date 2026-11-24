// Symboles du plan de coupe, d'après les plans utilisés sur le terrain.
//
// mode :
//   'point' : un toucher
//   'wedge' : direction d'abattage — toucher l'arbre, puis la direction de chute
//   'arrow' : début du travail — toucher le point de départ, puis la direction
//   'line'  : toucher les points un par un, puis « Terminer » (maxPts = 2 : se termine seul)

const RED = '#e31e24';

/** Couleurs proposées pour les zones (on passe de l'une à l'autre). */
export const ZONE_COLORS = ['#1565c0', '#e65100', '#7b1fa2', '#2e7d32', '#c62828', '#00838f'];

/** Dessins SVG des symboles ponctuels : [largeur, hauteur, contenu] (unités du viewBox). */
const POINT_SVG = {
  heli: [40, 40, `<circle cx="20" cy="20" r="17.5" fill="${RED}" stroke="#111" stroke-width="2.5"/><path d="M12.5 10h4.6v7.6h5.8V10h4.6v20h-4.6v-8.1h-5.8V30h-4.6z" fill="#111"/>`],
  point_t: [40, 40, '<circle cx="20" cy="20" r="17.5" fill="#3fa9e0" stroke="#111" stroke-width="2.5"/><path d="M10.5 10h19v5h-7v15h-5V15h-7z" fill="#111"/>'],
  vehicule: [80, 40, `<rect x="3" y="4" width="32" height="32" rx="4" fill="#1e63c4" stroke="#fff" stroke-width="1.5"/>
    <path fill="#fff" fill-rule="evenodd" d="M9 8h9.5a7.2 7.2 0 0 1 0 14.4H14V29H9zm5 4.2v6h4a3 3 0 0 0 0-6z"/>
    <path fill="#fff" d="M20.5 33l1.3-3.4q.4-1.1 1.6-1.1h5.2q1.2 0 1.6 1.1l1.3 3.4v2.2h-1.8v-.9h-7.4v.9h-1.8z"/>
    <circle cx="60" cy="20" r="17" fill="#2bb24c" stroke="#fff" stroke-width="2"/>
    <path fill="#fff" d="M55.5 8.5h9v7h7v9h-7v7h-9v-7h-7v-9h7z"/>
    <path fill="#2bb24c" d="M57.5 10.5h5v7h7v5h-7v7h-5v-7h-7v-5h7z"/>`],
  helico: [48, 30, `<rect x="1" y="1" width="46" height="28" rx="3" fill="#fff" stroke="${RED}" stroke-width="1.5"/>
    <g fill="${RED}"><rect x="8" y="7" width="28" height="2.2" rx="1"/><rect x="21" y="8" width="2.2" height="5"/>
    <ellipse cx="21" cy="17" rx="8.5" ry="5"/><rect x="28" y="15" width="13" height="2.8" rx="1"/><rect x="40" y="11" width="2.4" height="9" rx="1"/>
    <rect x="13" y="23.5" width="16" height="1.8" rx=".9"/><rect x="16" y="21" width="1.6" height="3"/><rect x="24" y="21" width="1.6" height="3"/></g>`],
  triopan: [40, 38, `<path d="M20 3L37.5 34.5H2.5Z" fill="#fff" stroke="${RED}" stroke-width="4" stroke-linejoin="round"/><rect x="18.3" y="13" width="3.4" height="12" rx="1" fill="#111"/><circle cx="20" cy="29.3" r="2.2" fill="#111"/>`],
  trois_lattes: [22, 52, `<path d="M11 1.5L20 16H2Z" fill="#fff" stroke="${RED}" stroke-width="2" stroke-linejoin="round"/><path d="M9.6 7h2.8v4.5H9.6zM9.6 12.6h2.8v1.8H9.6z" fill="#111"/>
    <g stroke="#555" stroke-width=".6">${[2, 8.5, 15].map((x) => `<rect x="${x}" y="18" width="5" height="33" fill="#fff"/>${[18, 26, 34, 42].map((y) => `<rect x="${x}" y="${y}" width="5" height="4" fill="${RED}"/>`).join('')}`).join('')}</g>
    <circle cx="11" cy="30" r="5.5" fill="#fff" stroke="${RED}" stroke-width="2"/><text x="11" y="32.2" font-size="6" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" fill="#111">60</text>`],
  barriere: [50, 26, '<rect x="2" y="9" width="9" height="15" rx="1.5" fill="#111"/><path d="M11 13L47 4" stroke="#111" stroke-width="5" stroke-linecap="round"/><path d="M11 13L47 4" stroke="#fff" stroke-width="2.6" stroke-dasharray="4 4"/>'],
  bache: [72, 30, `<rect x="1" y="1" width="70" height="28" fill="#fff" stroke="${RED}" stroke-width="1.5"/>
    <path d="M2 3.5H70M2 26.5H70" stroke="${RED}" stroke-width="3" stroke-dasharray="3 3"/>
    ${[16, 36, 56].map((x) => `<circle cx="${x}" cy="15" r="7.5" fill="#fff" stroke="${RED}" stroke-width="3"/>`).join('')}
    <circle cx="16" cy="15" r="2.4" fill="#111"/><path d="M53 13h6v4h-6z" fill="#111"/>`],
  nacelle: [40, 40, `<circle cx="20" cy="20" r="17.5" fill="#f7c600" stroke="#111" stroke-width="2.5"/>
    <g fill="#111"><rect x="9" y="26" width="18" height="3.5" rx="1"/><circle cx="12" cy="31" r="2.2"/><circle cx="24" cy="31" r="2.2"/>
    <path d="M14 26.5L25.5 13.5" stroke="#111" stroke-width="3" stroke-linecap="round"/><rect x="23" y="8" width="9" height="6" rx="1"/></g>`],
  camion_grue: [40, 40, `<circle cx="20" cy="20" r="17.5" fill="#1b5e86" stroke="#111" stroke-width="2.5"/>
    <g fill="#fff"><rect x="7" y="22" width="19" height="5.5" rx="1"/><path d="M26 27.5V18h4.5l3 4.5v5z"/><circle cx="11.5" cy="29.5" r="2.4"/><circle cx="29.5" cy="29.5" r="2.4"/></g>
    <path d="M12 22L28 9.5M28 9.5v6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`],
  // Trois triangles bruns identiques, emboîtés en zigzag (▶ ◀ ▶)
  pile: [60, 32, `<g fill="#4e3418" stroke="#111" stroke-width="1.3" stroke-linejoin="round">
    <path d="M2 1L58 3.5L2 13Z"/><path d="M58 6L58 26L4 16Z"/><path d="M2 19L58 28.5L2 31Z"/></g>`],
  // Arbre à démonter : sapin vert, tronçons marqués en rouge
  arbre_demonter: [40, 40, `<circle cx="20" cy="20" r="18" fill="#fff" stroke="#111" stroke-width="2"/>
    <path d="M20 4.5L29.5 17H24.5L31.5 27.5H8.5L15.5 17H10.5Z" fill="#2e7d32" stroke="#0b4f1a" stroke-width="1" stroke-linejoin="round"/>
    <rect x="18" y="27.5" width="4" height="7" fill="#6d4c2f"/>
    <path d="M7.5 12.5H32.5M6 21.5H34" stroke="${RED}" stroke-width="2.4" stroke-dasharray="3.5 2"/>`],
  // Arbre dangereux : arbre sec, cercle rouge et point d'exclamation
  arbre_dangereux: [40, 40, `<circle cx="20" cy="20" r="17.5" fill="#fff" stroke="${RED}" stroke-width="3"/>
    <path d="M18 34V10M18 21L11 14M18 17L24 11M18 26L25 21M11 14L9 10.5M24 11L26.5 8" stroke="#5d4037" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <circle cx="30.5" cy="30.5" r="7" fill="${RED}" stroke="#fff" stroke-width="1.5"/>
    <rect x="29.4" y="25.8" width="2.2" height="5.6" rx="1" fill="#fff"/><circle cx="30.5" cy="34" r="1.3" fill="#fff"/>`],
  // Arbre à tailler : feuillu, branche latérale coupée (trait rouge)
  arbre_tailler: [40, 40, `<circle cx="20" cy="20" r="18" fill="#fff" stroke="#111" stroke-width="2"/>
    <rect x="14.6" y="20" width="3.8" height="14.5" fill="#6d4c2f"/>
    <path d="M17 25.5L29.5 18.5" stroke="#6d4c2f" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="16.5" cy="14" r="9" fill="#43a047" stroke="#1b5e20" stroke-width="1"/>
    <circle cx="31" cy="17.5" r="3.6" fill="#43a047" stroke="#1b5e20" stroke-width="1"/>
    <path d="M21.2 18.6L25.4 26.8" stroke="${RED}" stroke-width="2.6" stroke-linecap="round"/>`],
  // Roulotte de chantier (vue de dessus, beige)
  roulotte: [56, 26, `<rect x="2" y="2" width="52" height="22" rx="1.5" fill="#f7f1e3" stroke="#6b6b6b" stroke-width="2"/>
    <path d="M2 2L18 13H38L54 2M2 24L18 13M54 24L38 13" fill="none" stroke="#9a9a9a" stroke-width="1.6"/>`],
  // Câble-grue mobile (camion avec mât)
  cable_mobile: [40, 40, `<rect x="4" y="14" width="13" height="13" rx="1.5" fill="#111" stroke="#fff" stroke-width="1.2"/>
    <path d="M17 20.5L33 7M17 20.5H34M17 20.5L33 34" stroke="#111" stroke-width="1.8"/>
    <circle cx="33.5" cy="7" r="3" fill="#111" stroke="#fff" stroke-width="1"/><circle cx="34.5" cy="20.5" r="3" fill="#111" stroke="#fff" stroke-width="1"/><circle cx="33.5" cy="34" r="3" fill="#111" stroke="#fff" stroke-width="1"/>`],
  // Support de câble-grue (chevalet)
  cable_support: [40, 40, `<path d="M20 7L9 34M20 7L31 34M20 7V30" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    <path d="M20 7L9 34M20 7L31 34M20 7V30" stroke="#111" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="7" r="3" fill="#111"/>`],
  // Ancrage de câble-grue
  cable_ancrage: [40, 40, `<circle cx="20" cy="20" r="14" fill="#6d4c2f" stroke="#111" stroke-width="2.5"/><circle cx="20" cy="20" r="5" fill="none" stroke="#fff" stroke-width="2.4"/>`],
  // Arbre-habitat à conserver (feuillu, bande blanche « H »)
  arbre_habitat: [40, 40, `<circle cx="20" cy="20" r="18" fill="#fff" stroke="#2e7d32" stroke-width="2.5"/>
    <rect x="18" y="21" width="4" height="13" fill="#6d4c2f"/><circle cx="20" cy="15" r="10" fill="#43a047" stroke="#1b5e20" stroke-width="1"/>
    <text x="20" y="19.5" font-size="11" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" fill="#fff">H</text>`],
  // Annotation (A dans un rond noir, texte à côté)
  annotation: [40, 40, '<circle cx="20" cy="20" r="15" fill="#111"/><text x="20" y="26" font-size="17" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" fill="#fff">A</text>'],
  // Élément à protéger : losange orange bordé de noir avec « ! » (différent du triopan)
  element_proteger: [40, 40, `<path d="M20 2.5L37.5 20L20 37.5L2.5 20Z" fill="#f39200" stroke="#111" stroke-width="2.6" stroke-linejoin="round"/>
    <rect x="18" y="10" width="4" height="15" rx="1.4" fill="#111"/><circle cx="20" cy="29.5" r="2.5" fill="#111"/>`],
  // Sentinelle (poste de garde) : personnage en gilet orange, bras levé
  sentinelle: [40, 40, `<circle cx="20" cy="20" r="18" fill="#fff" stroke="#e31e24" stroke-width="2.5"/>
    <circle cx="18" cy="9.5" r="3.6" fill="#111"/>
    <path d="M13.5 15.5h9l1.2 10h-11.4z" fill="#f39200" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M14.5 25.5L13 33.5M21.5 25.5L23 33.5" stroke="#111" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M22.5 16.5L28 9.5" stroke="#111" stroke-width="2.4" stroke-linecap="round"/><path d="M13.5 16.5L10 23" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>`],
  depot: [70, 16, `<rect x="1" y="1" width="68" height="14" fill="#4e3418" stroke="#111" stroke-width="1.5"/>${[6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56, 61, 66].map((x) => `<path d="M${x} 2.5V13.5" stroke="#111" stroke-width="1.7"/>`).join('')}`],
};

const debutIcon = (color) => `<path d="M14 26L31 9" stroke="#111" stroke-width="2.6"/><path d="M35 5l-9.5 3 6.5 6.5z" fill="#111"/><circle cx="11" cy="29" r="8" fill="${color}" stroke="#111" stroke-width="1.8"/>`;

export const WEDGE_SVG = '<path d="M20 1.5L27 37H13Z" fill="#1f9a3a" stroke="#0b4f1a" stroke-width="1.5" stroke-linejoin="round"/>';

export const SYMBOLS = [
  // --- Secours
  { kind: 'heli', group: 'Secours', label: 'Sauvetage hélico (H)', mode: 'point', unique: true, coordLabel: true, hint: 'Touchez la place pour le sauvetage hélicoptère.' },
  { kind: 'point_t', group: 'Secours', label: 'Sauvetage terrestre (T)', mode: 'point', unique: true, coordLabel: true, hint: 'Touchez le point de rencontre avec l\'ambulance.' },
  { kind: 'vehicule', group: 'Secours', label: 'Véhicule + pharmacie', mode: 'point', hint: 'Touchez l\'emplacement du véhicule et de la pharmacie.' },
  { kind: 'acces_t', group: 'Secours', label: 'Accès au point T (route)', mode: 'line', color: '#1a8fd0', outline: '#fff', weight: 4, dash: '10 7', arrowEnd: true, midArrows: true, hint: 'Suivez la route du chantier jusqu\'au point T (dézoomez si besoin), puis « Terminer ».' },
  { kind: 'helico', group: 'Secours', label: 'Place hélicoptère', mode: 'point', hint: 'Touchez la place de l\'hélicoptère.' },
  // --- Coupe
  { kind: 'abattage', group: 'Coupe', label: 'Direction d\'abattage', mode: 'wedge', hint: 'Touchez l\'arbre, puis tournez la poignée ⟳ pour la direction de chute.' },
  { kind: 'arbre_demonter', group: 'Coupe', label: 'Arbre à démonter', mode: 'point', askText: '', hint: 'Touchez l\'arbre à démonter.' },
  { kind: 'arbre_dangereux', group: 'Coupe', label: 'Arbre dangereux', mode: 'point', askText: '', hint: 'Touchez l\'arbre dangereux.' },
  { kind: 'element_proteger', group: 'Coupe', label: 'Élément à protéger', mode: 'point', askText: '', hint: 'Touchez l\'élément menacé par l\'abattage, puis écrivez ce que c\'est.' },
  { kind: 'arbre_tailler', group: 'Coupe', label: 'Arbre à tailler', mode: 'point', askText: '', hint: 'Touchez l\'arbre à tailler.' },
  { kind: 'debut_vert', group: 'Coupe', label: 'Début du travail (vert)', mode: 'arrow', color: '#2bb24c', hint: 'Touchez le départ, puis glissez la poignée ⟳ dans la direction du travail.' },
  { kind: 'debut_jaune', group: 'Coupe', label: 'Début du travail (jaune)', mode: 'arrow', color: '#f7d000', hint: 'Touchez le départ, puis glissez la poignée ⟳ dans la direction du travail.' },
  { kind: 'nacelle', group: 'Coupe', label: 'Nacelle', mode: 'point', hint: 'Touchez l\'emplacement de la nacelle.' },
  { kind: 'camion_grue', group: 'Coupe', label: 'Camion-grue', mode: 'point', hint: 'Touchez l\'emplacement du camion-grue.' },
  { kind: 'pile', group: 'Coupe', label: 'Pile de bois de service', mode: 'orient', askText: '', hint: 'Touchez la pile, puis tournez la poignée ⟳ pour son sens.' },
  { kind: 'depot', group: 'Coupe', label: 'Pile de bois énergie', mode: 'orient', askText: '', hint: 'Touchez la pile, puis tournez la poignée ⟳ pour son sens.' },
  // --- Lignes
  { kind: 'zone', group: 'Zones et lignes', label: 'Zone (à nommer)', mode: 'zone', hint: 'Touchez les coins de la zone, puis « Terminer ».' },
  { kind: 'layon', group: 'Zones et lignes', label: 'Layon', mode: 'line', maxPts: 2, color: '#1f5f8b', weight: 6, hint: 'Touchez le début puis la fin du layon.' },
  { kind: 'electrique', group: 'Zones et lignes', label: 'Ligne électrique', mode: 'line', color: '#111', weight: 3, lineLabel: 'Ligne électrique', hint: 'Touchez les pylônes un par un, puis « Terminer ».' },
  { kind: 'circulation', group: 'Zones et lignes', label: 'Flèche (circulation)', mode: 'line', color: RED, weight: 4, arrowEnd: true, hint: 'Touchez les points du trajet, puis « Terminer ».' },
  { kind: 'distance', group: 'Zones et lignes', label: 'Distance (cote)', mode: 'line', maxPts: 2, color: '#f39200', weight: 3, arrowEnd: true, arrowStart: true, measure: true, hint: 'Touchez le début puis la fin de la mesure.' },
  // --- Logistique et accès
  { kind: 'sortie_simple', group: 'Logistique et accès', label: 'Direction de sortie unique', mode: 'line', color: '#111', weight: 3, arrowEnd: true, hint: 'Touchez les points du trajet de sortie, puis « Terminer ».' },
  { kind: 'sortie_double', group: 'Logistique et accès', label: 'Direction de sortie double', mode: 'line', color: '#111', weight: 3, arrowEnd: true, arrowStart: true, hint: 'Touchez les points du trajet, puis « Terminer ».' },
  { kind: 'chemin_utilise', group: 'Logistique et accès', label: 'Chemin / piste utilisé', mode: 'line', color: '#4f6475', weight: 3, hint: 'Touchez les points du chemin, puis « Terminer ».' },
  { kind: 'layon_debardage', group: 'Logistique et accès', label: 'Layon de débardage', mode: 'line', color: '#8d6e63', weight: 3, dash: '3 6', hint: 'Touchez les points du layon, puis « Terminer ».' },
  { kind: 'limite_vidange', group: 'Logistique et accès', label: 'Limite de vidange', mode: 'line', color: '#7b3fa0', weight: 3, dash: '6 5', hint: 'Touchez les points de la limite, puis « Terminer ».' },
  { kind: 'roulotte', group: 'Logistique et accès', label: 'Roulotte de chantier', mode: 'orient', askText: '', hint: 'Touchez l\'emplacement de la roulotte, puis tournez la poignée ⟳.' },
  // --- Câble-grue
  { kind: 'cable_ligne', group: 'Câble-grue', label: 'Ligne de câble-grue', mode: 'line', color: '#e8641e', weight: 3, dash: '10 5', hint: 'Touchez le départ, les supports, puis l\'arrivée ; « Terminer ».' },
  { kind: 'cable_mobile', group: 'Câble-grue', label: 'Câble-grue mobile', mode: 'orient', hint: 'Touchez l\'emplacement du câble-grue mobile, puis tournez la poignée ⟳ vers la ligne.' },
  { kind: 'cable_support', group: 'Câble-grue', label: 'Support', mode: 'point', hint: 'Touchez l\'emplacement du support.' },
  { kind: 'cable_ancrage', group: 'Câble-grue', label: 'Ancrage', mode: 'point', hint: 'Touchez l\'emplacement de l\'ancrage.' },
  // --- Nature et notes
  { kind: 'zone_rajeunissement', group: 'Nature et notes', label: 'Zone de rajeunissement', mode: 'zone', zoneColor: '#2a9d8f', defaultName: 'Rajeunissement', hint: 'Touchez les coins de la zone, puis « Terminer ».' },
  { kind: 'arbre_habitat', group: 'Nature et notes', label: 'Arbre-habitat à conserver', mode: 'point', askText: '', hint: 'Touchez l\'arbre-habitat.' },
  { kind: 'annotation', group: 'Nature et notes', label: 'Annotation', mode: 'point', askText: '', hint: 'Touchez la carte, puis écrivez l\'annotation.' },
  // --- Signalisation
  { kind: 'triopan', group: 'Signalisation', label: 'Triopan', mode: 'point', hint: 'Touchez l\'emplacement du Triopan.' },
  { kind: 'trois_lattes', group: 'Signalisation', label: 'Trois lattes', mode: 'point', hint: 'Touchez l\'emplacement des trois lattes.' },
  { kind: 'sentinelle', group: 'Signalisation', label: 'Sentinelle', mode: 'point', askText: '', hint: 'Touchez le poste de la sentinelle (texte facultatif : nom, radio…).' },
  { kind: 'barriere', group: 'Signalisation', label: 'Barrière', mode: 'point', hint: 'Touchez l\'emplacement de la barrière.' },
  // orientable comme les piles ; une bâche déjà posée sans angle garde son orientation (angle 90 = horizontal)
  { kind: 'bache', group: 'Signalisation', label: 'Route fermée', mode: 'orient', askText: '', hint: 'Touchez l\'endroit de la fermeture (bâche), puis tournez la poignée ⟳.' },
  { kind: 'rubalise', group: 'Signalisation', label: 'Rubalise', mode: 'line', color: '#e31e24', outline: '#fff', weight: 4, dash: '9 7', hint: 'Touchez les points de la rubalise, puis « Terminer ».' },
  { kind: 'texte', group: 'Signalisation', label: 'Texte', mode: 'point', askText: '', hint: 'Touchez la carte pour placer un texte.' },
];

export const SYMBOL_BY_KIND = Object.fromEntries(SYMBOLS.map((s) => [s.kind, s]));
export const GROUPS = [...new Set(SYMBOLS.map((s) => s.group))];

function lineIcon(def) {
  const d = 'M5 33L35 7';
  let s = '';
  if (def.outline) s += `<path d="${d}" stroke="${def.outline}" stroke-width="${def.weight + 3}" stroke-linecap="round"/>`;
  s += `<path d="${d}" stroke="${def.color}" stroke-width="${def.weight}" stroke-linecap="round"${def.dash ? ' stroke-dasharray="6 4"' : ''}/>`;
  if (def.arrowEnd) s += `<path d="M38 4l-11 3.5 7.5 7.5z" fill="${def.color}"/>`;
  if (def.arrowStart) s += `<path d="M2 36l11-3.5-7.5-7.5z" fill="${def.color}"/>`;
  if (def.kind === 'electrique') s += '<path d="M20 11l-5 9h4l-2 7 7-10h-4.5z" fill="#ffd600" stroke="#111" stroke-width="1"/>';
  return [40, 40, s];
}

/** Dimensions [largeur, hauteur, contenu] du dessin d'un symbole. */
export function symbolArt(kind) {
  const def = SYMBOL_BY_KIND[kind];
  if (!def) return [40, 40, ''];
  if (POINT_SVG[kind]) return POINT_SVG[kind];
  if (def.mode === 'wedge') return [40, 40, WEDGE_SVG];
  if (def.mode === 'arrow') return [40, 40, debutIcon(def.color)];
  if (def.mode === 'line') return lineIcon(def);
  if (def.mode === 'zone') {
    const zc = def.zoneColor || ZONE_COLORS[0];
    return [40, 40, `<path d="M5 12L22 4L36 14L32 34L9 31Z" fill="${zc}" fill-opacity=".22" stroke="${zc}" stroke-width="2.5" stroke-dasharray="5 3" stroke-linejoin="round"/><rect x="10" y="15" width="20" height="9" rx="1.5" fill="#fff" stroke="${zc}" stroke-width="1.5"/>`];
  }
  if (kind === 'texte') return [40, 40, '<rect x="3" y="8" width="34" height="24" fill="#fff" stroke="#111" stroke-width="2.5"/><path d="M9 15h22M9 21h22M9 27h14" stroke="#111" stroke-width="2.4"/>'];
  return [40, 40, ''];
}

/** SVG d'un symbole à une hauteur donnée (largeur proportionnelle). */
export function symbolSvg(kind, height = 36) {
  const [w, h, body] = symbolArt(kind);
  const width = Math.round((height * w) / h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${w} ${h}" fill="none" aria-hidden="true">${body}</svg>`;
}

/** Taille d'affichage sur la carte (hauteur en px). */
export function mapHeight(kind) {
  return { trois_lattes: 44, bache: 26, barriere: 22, helico: 26, vehicule: 30, pile: 28, depot: 14, roulotte: 20, cable_ancrage: 22, cable_mobile: 44, annotation: 24 }[kind] || 30;
}

/** Tête de flèche pointant vers le haut. */
export function arrowHeadSvg(color, size = 20) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 22 22"><path d="M11 1L20 20L11 15.5L2 20Z" fill="${color}"/></svg>`;
}
