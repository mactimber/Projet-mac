// Symboles du plan de coupe / plan de secours.
// mode 'point' : un toucher sur la carte. mode 'arrow' : deux touchers (départ puis direction).

const tri = (inner) => `<path d="M20 3 L38 35 H2 Z" fill="#ffd600" stroke="#111" stroke-width="2.5" stroke-linejoin="round"/>${inner}`;

const SVG = {
  heli: '<circle cx="20" cy="20" r="17.5" fill="#fff" stroke="#c62828" stroke-width="3"/><path d="M12 10h4.5v7.5h7V10H28v20h-4.5v-8h-7v8H12z" fill="#c62828"/>',
  point_t: '<rect x="2" y="2" width="36" height="36" rx="8" fill="#1565c0"/><path d="M9 9h22v6h-8v17h-6V15H9z" fill="#fff"/>',
  vehicule: '<rect x="2" y="2" width="36" height="36" rx="8" fill="#37474f"/><path d="M8 23l3-7q1-3 4-3h10q3 0 4 3l3 7z" fill="#fff"/><rect x="6" y="22" width="28" height="7" rx="2" fill="#fff"/><path d="M13 21l1.5-5H19v5zM21 21v-5h4.5L27 21z" fill="#37474f"/><circle cx="12.5" cy="30" r="3.3" fill="#fff" stroke="#37474f" stroke-width="1.6"/><circle cx="27.5" cy="30" r="3.3" fill="#fff" stroke="#37474f" stroke-width="1.6"/>',
  pharmacie: '<rect x="2" y="2" width="36" height="36" rx="8" fill="#2e7d32"/><path d="M16 8h8v8h8v8h-8v8h-8v-8H8v-8h8z" fill="#fff"/>',
  danger: tri('<rect x="18.3" y="13" width="3.4" height="12" rx="1" fill="#111"/><circle cx="20" cy="30" r="2.2" fill="#111"/>'),
  electrique: tri('<path d="M22.5 11L14 24h6l-3 9 10-14h-6z" fill="#111"/>'),
  barrage: '<circle cx="20" cy="20" r="17.5" fill="#c62828" stroke="#fff" stroke-width="1.5"/><rect x="8" y="16.5" width="24" height="7" rx="1.5" fill="#fff"/>',
  depot: '<rect x="2" y="2" width="36" height="36" rx="8" fill="#8d6e63"/><g fill="#ffe0b2" stroke="#4e342e" stroke-width="1.6"><circle cx="13" cy="27" r="5"/><circle cx="27" cy="27" r="5"/><circle cx="20" cy="17" r="5"/></g>',
  reseau: '<rect x="2" y="2" width="36" height="36" rx="8" fill="#6a1b9a"/><g fill="#fff"><rect x="8" y="25" width="5" height="6" rx="1"/><rect x="15" y="20" width="5" height="11" rx="1"/><rect x="22" y="14" width="5" height="17" rx="1"/><rect x="29" y="8" width="5" height="23" rx="1" opacity=".45"/></g>',
  texte: '<rect x="3" y="3" width="34" height="34" rx="6" fill="#fff" stroke="#333" stroke-width="2.5"/><path d="M13 30l6-20h2.5l6 20h-3.3l-1.5-5h-5l-1.5 5zm5.6-8h3.5L20.3 15z" fill="#333"/>',
};

const arrowSvg = (color, dash = '', tree = false) =>
  `${tree ? '<circle cx="9" cy="31" r="5.5" fill="#2e7d32" stroke="#fff" stroke-width="1.5"/>' : ''}` +
  `<path d="M${tree ? 12 : 7} ${tree ? 28 : 33}L29 11" stroke="${color}" stroke-width="${tree ? 4 : 5}" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>` +
  `<path d="M35 5L22 9.5l8.5 8.5z" fill="${color}"/>`;

export const SYMBOLS = [
  { kind: 'chute', label: 'Direction de chute', mode: 'arrow', color: '#e65100', weight: 4, tree: true, hint: 'Touchez l\'arbre, puis l\'endroit où il doit tomber.' },
  { kind: 'heli', label: 'Place hélico (H)', mode: 'point', unique: true, hint: 'Touchez l\'endroit de la place d\'atterrissage / treuillage.' },
  { kind: 'point_t', label: 'Point de rencontre', mode: 'point', hint: 'Touchez le point de rencontre avec l\'ambulance.' },
  { kind: 'vehicule', label: 'Véhicule', mode: 'point', hint: 'Touchez l\'emplacement du véhicule.' },
  { kind: 'pharmacie', label: 'Pharmacie', mode: 'point', hint: 'Touchez l\'emplacement de la pharmacie / trousse de secours.' },
  { kind: 'travail', label: 'Sens de travail', mode: 'arrow', color: '#1565c0', weight: 7, opacity: 0.75, hint: 'Touchez le départ, puis la direction d\'avancement.' },
  { kind: 'debardage', label: 'Débardage', mode: 'arrow', color: '#6d4c41', weight: 4, dash: '9 6', hint: 'Touchez le départ, puis la direction du débardage.' },
  { kind: 'danger', label: 'Danger', mode: 'point', hint: 'Touchez l\'endroit du danger.' },
  { kind: 'electrique', label: 'Ligne électrique', mode: 'point', hint: 'Touchez l\'endroit de la ligne électrique.' },
  { kind: 'barrage', label: 'Route barrée', mode: 'point', hint: 'Touchez l\'endroit du barrage / de la sentinelle.' },
  { kind: 'depot', label: 'Dépôt de bois', mode: 'point', hint: 'Touchez la place de dépôt.' },
  { kind: 'reseau', label: 'Réseau mobile', mode: 'point', hint: 'Touchez l\'endroit où le téléphone capte.' },
  { kind: 'texte', label: 'Texte', mode: 'point', hint: 'Touchez la carte pour placer un texte.' },
];

export const SYMBOL_BY_KIND = Object.fromEntries(SYMBOLS.map((s) => [s.kind, s]));

/** Icône SVG (palette, légende, carte). */
export function symbolSvg(kind, size = 36) {
  const s = SYMBOL_BY_KIND[kind];
  const body = s?.mode === 'arrow' ? arrowSvg(s.color, s.dash ? '5 4' : '', s.tree) : SVG[kind] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">${body}</svg>`;
}

/** Tête de flèche pointant vers le haut (rotation appliquée ensuite). */
export function arrowHeadSvg(color, size = 22) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 22 22"><path d="M11 0L21 20L11 15L1 20Z" fill="${color}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}
