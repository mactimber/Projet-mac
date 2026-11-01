// Configuration : couches cartographiques, types d'objets et formulaires.

const ATTR_SWISSTOPO = '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';
const ATTR_GEOADMIN = '© <a href="https://www.geo.admin.ch" target="_blank" rel="noopener">geo.admin.ch</a>';

const wmts = (layer, ext = 'jpeg') =>
  `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.${ext}`;

/** Fonds de carte (un seul actif à la fois). Tuiles WMTS swisstopo en Web Mercator. */
export const BASE_LAYERS = [
  { id: 'ch.swisstopo.pixelkarte-farbe', label: 'Carte nationale (couleur)', url: wmts('ch.swisstopo.pixelkarte-farbe'), maxNativeZoom: 18, attribution: ATTR_SWISSTOPO },
  { id: 'ch.swisstopo.pixelkarte-grau', label: 'Carte nationale (gris)', url: wmts('ch.swisstopo.pixelkarte-grau'), maxNativeZoom: 18, attribution: ATTR_SWISSTOPO },
  { id: 'ch.swisstopo.swissimage', label: 'Photo aérienne SWISSIMAGE', url: wmts('ch.swisstopo.swissimage'), maxNativeZoom: 20, attribution: ATTR_SWISSTOPO },
  { id: 'osm', label: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxNativeZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
];

/**
 * Couches superposées, servies par le WMS de geo.admin.ch (EPSG:3857).
 * N'importe quelle couche publique de map.geo.admin.ch peut être ajoutée
 * via son identifiant technique (panneau « Couches »).
 */
export const OVERLAY_LAYERS = [
  { id: 'ch.swisstopo.swissalti3d-reliefschattierung', label: 'Ombrage du relief (terrain)', opacity: 0.5, group: 'Terrain' },
  { id: 'ch.swisstopo.hangneigung-ueber_30', label: 'Pentes > 30°', opacity: 0.6, group: 'Terrain' },
  { id: 'ch.kantone.cadastralwebmap-farbe', label: 'Cadastre (mensuration officielle)', opacity: 0.9, group: 'Cadastre' },
  { id: 'ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill', label: 'Limites communales', opacity: 0.6, group: 'Cadastre' },
  { id: 'ch.bafu.landesforstinventar-vegetationshoehenmodell', label: 'Hauteur de la végétation (IFN)', opacity: 0.7, group: 'Forêt' },
  { id: 'ch.bafu.landesforstinventar-waldmischungsgrad', label: 'Degré de mélange feuillus/résineux (IFN)', opacity: 0.6, group: 'Forêt' },
  { id: 'ch.bafu.waldreservate', label: 'Réserves forestières', opacity: 0.7, group: 'Forêt' },
  { id: 'ch.swisstopo.swisstlm3d-strassen', label: 'Routes et chemins', opacity: 0.9, group: 'Accès & sécurité' },
  { id: 'ch.swisstopo.swisstlm3d-wanderwege', label: 'Chemins de randonnée', opacity: 0.9, group: 'Accès & sécurité' },
  { id: 'ch.bfe.elektrische-anlagen_ueber_36', label: 'Lignes électriques > 36 kV', opacity: 0.9, group: 'Accès & sécurité' },
];

export const WMS_URL = 'https://wms.geo.admin.ch/';
export const OVERLAY_ATTRIBUTION = ATTR_GEOADMIN;
export const legendUrl = (id) => `https://api3.geo.admin.ch/rest/services/api/MapServer/${id}/legend?lang=fr`;

export const ESSENCES = [
  'Épicéa', 'Sapin blanc', 'Pin sylvestre', 'Mélèze', 'Douglas', 'Arole', 'Autre résineux',
  'Hêtre', 'Chêne', 'Érable', 'Frêne', 'Châtaignier', 'Bouleau', 'Tilleul', 'Orme', 'Merisier', 'Aulne', 'Autre feuillu',
];

/**
 * Types d'objets dessinables. `shape` = type d'outil Geoman.
 * `fields` = schéma du formulaire (voir forms.js).
 */
export const FEATURE_TYPES = {
  parcelle: {
    label: 'Parcelle', icon: '▱', shape: 'Polygon',
    style: { color: '#1b5e20', weight: 3, fillColor: '#66bb6a', fillOpacity: 0.15 },
    fields: [
      { key: 'nom', label: 'Nom / lieu-dit', type: 'text' },
      { key: 'numero', label: 'N° de parcelle (RF)', type: 'text' },
      { key: 'proprietaire', label: 'Propriétaire', type: 'text' },
      { key: 'peuplement', label: 'Type de peuplement', type: 'select', options: ['', 'Résineux pur', 'Mixte à dominance résineuse', 'Mixte à dominance feuillue', 'Feuillus pur', 'Jeune peuplement / perchis', 'Futaie jardinée', 'Taillis / taillis sous futaie'] },
      { key: 'stade', label: 'Stade de développement', type: 'select', options: ['', 'Recrû / fourré', 'Perchis', 'Jeune futaie', 'Futaie moyenne', 'Vieille futaie', 'Mélangé'] },
      { key: 'essences', label: 'Essences principales', type: 'multi', options: ESSENCES },
      { key: 'fonction', label: 'Fonction', type: 'select', options: ['', 'Production', 'Protection', 'Biodiversité', 'Accueil / loisirs', 'Multifonctionnelle'] },
      { key: 'remarques', label: 'Remarques', type: 'textarea' },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ],
  },
  zone_coupe: {
    label: 'Surface de coupe', icon: '🪓', shape: 'Polygon',
    style: { color: '#e65100', weight: 3, fillColor: '#ffb74d', fillOpacity: 0.25, dashArray: '6 4' },
    fields: [
      { key: 'nom', label: 'Désignation', type: 'text' },
      { key: 'intervention', label: 'Intervention', type: 'select', options: ['', 'Éclaircie', 'Coupe de régénération', 'Coupe jardinatoire', 'Coupe sanitaire / bostryche', 'Coupe de chablis', 'Coupe rase', 'Soins aux jeunes peuplements', 'Entretien de lisière'] },
      { key: 'volume_estime', label: 'Volume estimé (m³)', type: 'number', step: 1 },
      { key: 'remarques', label: 'Remarques', type: 'textarea' },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ],
  },
  zone_danger: {
    label: 'Zone de danger', icon: '⚠', shape: 'Polygon',
    style: { color: '#c62828', weight: 3, fillColor: '#ef5350', fillOpacity: 0.3 },
    fields: [
      { key: 'danger', label: 'Danger', type: 'select', options: ['', 'Zone d\'abattage (2× hauteur de l\'arbre)', 'Pente raide / chute', 'Chute de pierres', 'Arbres secs / bois mort', 'Chablis / bois sous tension', 'Ligne électrique', 'Route / chemin public', 'Voie ferrée', 'Cours d\'eau', 'Autre'] },
      { key: 'mesures', label: 'Mesures de protection', type: 'textarea' },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ],
  },
  arbre: {
    label: 'Arbre', icon: '🌲', shape: 'Marker',
    fields: [
      { key: 'numero', label: 'N° / marque', type: 'text' },
      { key: 'essence', label: 'Essence', type: 'select', options: ['', ...ESSENCES] },
      { key: 'dhp', label: 'Diamètre à 1,3 m – DHP (cm)', type: 'number', step: 1, min: 0 },
      { key: 'hauteur', label: 'Hauteur (m)', type: 'number', step: 0.5, min: 0 },
      { key: 'direction', label: 'Direction d\'abattage (°, 0 = nord)', type: 'direction' },
      { key: 'etat', label: 'État', type: 'select', options: ['', 'Sain', 'Sec', 'Bostryche', 'Pourri / champignon', 'Penché', 'Encroué / sous tension', 'Arbre-habitat (à conserver)'] },
      { key: 'assortiment', label: 'Assortiment prévu', type: 'select', options: ['', 'Bois de service', 'Bois d\'industrie', 'Bois-énergie', 'Laissé sur place'] },
      { key: 'remarques', label: 'Remarques', type: 'textarea' },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ],
  },
  piste: {
    label: 'Piste / layon', icon: '〰', shape: 'Line',
    style: { color: '#6d4c41', weight: 4, dashArray: '10 6' },
    fields: [
      { key: 'categorie', label: 'Type', type: 'select', options: ['', 'Layon de débardage', 'Piste de débardage', 'Route forestière', 'Ligne de câble-grue', 'Chemin d\'accès secours'] },
      { key: 'largeur', label: 'Largeur (m)', type: 'number', step: 0.5 },
      { key: 'remarques', label: 'Remarques', type: 'textarea' },
    ],
  },
  ligne_danger: {
    label: 'Ligne de danger', icon: '⚡', shape: 'Line',
    style: { color: '#d50000', weight: 4, dashArray: '2 8', lineCap: 'round' },
    fields: [
      { key: 'categorie', label: 'Type', type: 'select', options: ['', 'Ligne électrique', 'Ligne téléphonique', 'Route à fermer / signaliser', 'Sentier à fermer', 'Clôture', 'Autre'] },
      { key: 'mesures', label: 'Mesures (barrage, signalisation, coupure…)', type: 'textarea' },
    ],
  },
  secours: {
    label: 'Point de secours', icon: '✚', shape: 'Marker',
    fields: [
      { key: 'categorie', label: 'Type', type: 'select', options: ['Point de rencontre secours', 'Place d\'atterrissage hélicoptère', 'Emplacement trousse de secours', 'Point avec réseau mobile'] },
      { key: 'acces', label: 'Description de l\'accès', type: 'textarea' },
      { key: 'remarques', label: 'Remarques', type: 'textarea' },
    ],
  },
  depot: {
    label: 'Place de dépôt', icon: '▤', shape: 'Marker',
    fields: [
      { key: 'nom', label: 'Désignation', type: 'text' },
      { key: 'capacite', label: 'Capacité (m³)', type: 'number' },
      { key: 'remarques', label: 'Remarques', type: 'textarea' },
    ],
  },
  note: {
    label: 'Note', icon: '✎', shape: 'Marker',
    fields: [
      { key: 'titre', label: 'Titre', type: 'text' },
      { key: 'texte', label: 'Note', type: 'textarea' },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ],
  },
};

/** Informations générales du chantier. */
export const CHANTIER_FIELDS = [
  { key: 'name', label: 'Nom du chantier', type: 'text', required: true },
  { key: 'commune', label: 'Commune', type: 'text' },
  { key: 'lieu_dit', label: 'Lieu-dit', type: 'text' },
  { key: 'proprietaire', label: 'Propriétaire / mandant', type: 'text' },
  { key: 'triage', label: 'Triage / arrondissement', type: 'text' },
  { key: 'responsable', label: 'Responsable du chantier', type: 'text' },
  { key: 'date_releve', label: 'Date du relevé', type: 'date' },
  { key: 'statut', label: 'Statut', type: 'select', options: ['Relevé', 'Martelage', 'Planifié', 'En cours', 'Terminé'] },
  { key: 'remarques', label: 'Remarques générales', type: 'textarea' },
];

/** Fiche de sécurité. */
export const SECURITE_FIELDS = [
  { type: 'heading', label: 'Organisation' },
  { key: 'date_debut', label: 'Début des travaux', type: 'date' },
  { key: 'date_fin', label: 'Fin prévue', type: 'date' },
  { key: 'chef', label: 'Chef d\'équipe', type: 'text' },
  { key: 'chef_tel', label: 'Tél. chef d\'équipe', type: 'tel' },
  { key: 'equipe', label: 'Équipe (nom – téléphone, un par ligne)', type: 'textarea' },
  { key: 'secouriste', label: 'Secouriste désigné', type: 'text' },
  { key: 'travail_isole', label: 'Travail isolé', type: 'select', options: ['Non – toujours au moins 2 personnes', 'Oui – contrôle d\'appel en place', 'Oui – dispositif d\'alarme personne isolée'] },
  { key: 'controle_appel', label: 'Contrôle d\'appel (heures / personne à contacter)', type: 'text' },

  { type: 'heading', label: 'Numéros d\'urgence' },
  { key: 'tel_144', label: 'Ambulance', type: 'tel', default: '144' },
  { key: 'tel_1414', label: 'Rega (hélicoptère)', type: 'tel', default: '1414' },
  { key: 'tel_118', label: 'Pompiers', type: 'tel', default: '118' },
  { key: 'tel_117', label: 'Police', type: 'tel', default: '117' },
  { key: 'tel_145', label: 'Tox Info Suisse', type: 'tel', default: '145' },
  { key: 'tel_electricite', label: 'Gestionnaire du réseau électrique', type: 'tel' },
  { key: 'tel_garde_forestier', label: 'Garde forestier / triage', type: 'tel' },

  { type: 'heading', label: 'Secours' },
  { key: 'point_rencontre', label: 'Point de rencontre secours (voir carte)', type: 'secours' },
  { key: 'acces_secours', label: 'Accès pour les secours (route, barrière, clé…)', type: 'textarea' },
  { key: 'hopital', label: 'Hôpital le plus proche', type: 'text' },
  { key: 'reseau', label: 'Couverture réseau mobile', type: 'select', options: ['', 'Bonne sur tout le chantier', 'Partielle (voir point « réseau mobile »)', 'Aucune – radio / satellite nécessaire'] },
  { key: 'atterrissage', label: 'Place d\'atterrissage hélicoptère possible', type: 'select', options: ['', 'Oui (voir carte)', 'Non – treuillage nécessaire', 'À vérifier'] },

  { type: 'heading', label: 'Dangers identifiés' },
  { key: 'dangers', label: '', type: 'checklist', options: [
    'Pente raide / terrain glissant', 'Chute de pierres', 'Arbres secs / bois mort / branches cassées', 'Chablis, bois sous tension',
    'Arbres encroués', 'Ligne électrique / téléphonique à proximité', 'Route ou chemin public', 'Voie ferrée', 'Cours d\'eau',
    'Câble-grue / héliportage', 'Machines (porteur, abatteuse, tracteur)', 'Conditions météo (vent, neige, gel, orage)', 'Tiques / guêpes / allergies',
  ] },
  { key: 'mesures', label: 'Mesures prises (barrages, signalisation, coupure de ligne, distances…)', type: 'textarea' },
  { key: 'meteo', label: 'Météo / vent prévu', type: 'text' },

  { type: 'heading', label: 'Équipement de protection & matériel' },
  { key: 'epi', label: '', type: 'checklist', options: [
    'Casque avec visière et protection auditive', 'Pantalon / jambières anti-coupure', 'Chaussures de sécurité anti-coupure', 'Gants',
    'Vêtements de signalisation', 'Trousse de premiers secours', 'Pansement compressif sur soi', 'Téléphone / radio chargé',
    'Coins, levier d\'abattage, tire-fort', 'Extincteur (machines)', 'Kit anti-pollution (huile)',
  ] },

  { type: 'heading', label: 'Prise de connaissance' },
  { key: 'signatures', label: 'Personnes ayant pris connaissance de la fiche (nom – date)', type: 'textarea' },
];

/** Plan de coupe. */
export const COUPE_FIELDS = [
  { key: 'objectif', label: 'Objectif sylvicole', type: 'textarea' },
  { key: 'date_martelage', label: 'Date du martelage', type: 'date' },
  { key: 'marteleur', label: 'Martelé par', type: 'text' },
  { key: 'periode', label: 'Période d\'exécution prévue', type: 'text' },
  { key: 'methode_abattage', label: 'Méthode d\'abattage', type: 'select', options: ['', 'Motomanuel (tronçonneuse)', 'Mécanisé (abatteuse)', 'Mixte', 'Avec treuil / tire-fort'] },
  { key: 'debardage', label: 'Débardage', type: 'select', options: ['', 'Tracteur forestier / treuil', 'Porteur (forwarder)', 'Débusqueur (skidder)', 'Câble-grue', 'Hélicoptère', 'Cheval'] },
  { key: 'direction_generale', label: 'Direction générale d\'abattage / débardage', type: 'text' },
  { key: 'facteur_forme', label: 'Coefficient de forme (volume indicatif)', type: 'number', step: 0.01, default: 0.45 },
  { key: 'hauteur_defaut', label: 'Hauteur par défaut si non mesurée (m)', type: 'number', step: 1, default: 28 },
  { key: 'remarques', label: 'Consignes particulières', type: 'textarea' },
];
