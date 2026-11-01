# Relevé Forestier 🌲

Application web (PWA) pour forestiers-bûcherons en Suisse : relevés de parcelles, plans de coupe
et fiches de sécurité, sur les fonds de carte officiels de **swisstopo / geo.admin.ch**.
Elle fonctionne sur smartphone, tablette et ordinateur, **aussi hors-ligne en forêt**.

## Fonctions

**Carte et couches (comme map.geo.admin.ch)**
- Fonds : Carte nationale couleur / gris, photo aérienne SWISSIMAGE, OpenStreetMap.
- Couches superposables avec réglage de transparence et légende : ombrage du relief, pentes > 30°,
  cadastre (mensuration officielle), limites communales, hauteur de végétation et degré de mélange (IFN),
  réserves forestières, routes, chemins de randonnée, lignes électriques > 36 kV.
- Ajout de **n'importe quelle couche geo.admin** par son identifiant (ex. `ch.bafu.waldreservate`).
- Recherche de lieux, adresses, parcelles et coordonnées (LV95, LV03 ou WGS84).
- Affichage permanent des coordonnées **LV95** ; outil ⓘ : coordonnées, altitude swissALTI3D,
  lien vers map.geo.admin.ch et itinéraire.

**Relevé sur le terrain**
- Outils de dessin : parcelle, surface de coupe, zone de danger, arbre, piste / layon,
  ligne de danger (électrique, route…), point de secours, place de dépôt, note.
- Surfaces (ha), périmètres et longueurs calculés automatiquement.
- **Relevé GPS du périmètre** 👣 : marchez le long de la limite, les points sont ajoutés
  automatiquement (tous les X m si la précision est < 20 m) ou à la main ; l'écran reste allumé.
- **Martelage** : placez les arbres en continu, saisissez essence, DHP, hauteur, état, assortiment
  et **direction d'abattage** (saisie ou boussole du téléphone) — une flèche l'indique sur la carte.
- Photos jointes aux objets (compressées, stockées sur l'appareil).

**Fiches**
- **Fiche de sécurité** : organisation, travail isolé, numéros d'urgence suisses (144, 1414, 118, 117, 145)
  avec appel direct, point de rencontre secours (coordonnées LV95 depuis la carte), accès, couverture réseau,
  liste des dangers, mesures, EPI, prise de connaissance.
- **Plan de coupe** : objectif, martelage, méthode d'abattage et de débardage, liste des arbres,
  récapitulatif par essence et **volume indicatif** (π/4 · DHP² · H · coefficient de forme, réglable).
- **Rapport imprimable / PDF** 🖨 avec encadré d'urgence, synthèse, objets, fiche de sécurité
  avec cases de signature, plan de coupe.

**Données**
- Plusieurs chantiers, enregistrés automatiquement sur l'appareil (IndexedDB) ; dupliquer, supprimer.
- Export GeoJSON (WGS84 ou **LV95 / EPSG:2056** pour QGIS), KML (Google Earth), sauvegarde complète.
- Import d'une sauvegarde ou d'un GeoJSON (WGS84 ou LV95).

**Hors-ligne**
- L'application s'installe sur l'écran d'accueil (« Ajouter à l'écran d'accueil »).
- Onglet *Couches → Hors-ligne* : téléchargez les cartes de la zone du chantier avant de partir
  (couches actives, jusqu'à 3 niveaux de zoom supplémentaires). Les cartes consultées sont aussi mises en cache.

## Utilisation

Aucune installation ni compilation : ce sont des fichiers statiques.

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

Pour l'utiliser sur le téléphone, publiez le dossier sur un hébergement **HTTPS** (requis pour le GPS
et le mode hors-ligne), par ex. GitHub Pages : *Settings → Pages → Deploy from branch*.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html`, `css/app.css` | Interface |
| `js/config.js` | Couches, types d'objets et contenu des formulaires (à adapter librement) |
| `js/app.js` | Carte, dessin, GPS, chantiers, export/import, hors-ligne |
| `js/forms.js` | Génération des formulaires, photos, boussole |
| `js/swiss.js` | Conversion WGS84 ↔ LV95, surfaces, volumes |
| `js/report.js` | Rapport imprimable |
| `js/db.js` | Stockage local (IndexedDB) |
| `sw.js`, `manifest.webmanifest` | Application installable et hors-ligne |
| `vendor/` | Leaflet 1.9.4 et Leaflet-Geoman 2.17 (licences incluses) |

## Remarques

- Les données restent **sur l'appareil** : faites régulièrement une sauvegarde (.json).
- Coordonnées LV95 calculées avec les formules approchées de swisstopo (~1 m), suffisant pour le terrain ;
  la précision réelle dépend du GPS du téléphone (souvent 3–10 m en forêt).
- Les volumes sont indicatifs ; utilisez le tarif de votre canton pour le cubage officiel.
- Données cartographiques © swisstopo / geo.admin.ch (données ouvertes, mention de la source obligatoire).
