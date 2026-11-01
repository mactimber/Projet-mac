# Organisation de chantier 🌲

Application web (PWA) du Triage forestier du Vallon pour forestiers-bûcherons en Suisse : relevés de parcelles, plans de coupe
et fiches de sécurité, sur les fonds de carte officiels de **swisstopo / geo.admin.ch**.
Elle fonctionne sur smartphone, tablette et ordinateur, **aussi hors-ligne en forêt**.

## Fonctionnement en 3 étapes

1. **Parcelle** : dessinez les limites sur la carte (ou marchez autour avec le GPS).
   La **place hélico (H)** est placée automatiquement au milieu de la parcelle,
   avec ses coordonnées LV95 / GPS et son altitude. Elle peut être déplacée.
2. **Symboles** : direction de chute (toucher l'arbre puis la direction), place hélico,
   point de rencontre (T), véhicule, pharmacie, sens de travail, débardage, danger,
   ligne électrique, route barrée, dépôt de bois, réseau mobile, texte.
3. **Fiche de secours** : numéros d'urgence, coordonnées pour les secours, marche à suivre
   pour donner l'alarme, organisation, plan de coupe avec légende, signatures.
   Elle s'affiche sur le téléphone (boutons d'appel 144 / 1414) et s'imprime sur **une page A4** (PDF).

Fonds de carte swisstopo (carte, photo aérienne, carte grise) et couches : cadastre,
pentes > 30°, relief, lignes électriques. Recherche de lieux, mode hors-ligne,
plusieurs chantiers, sauvegarde / import.

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
| `js/app.js` | Carte, étapes, GPS, chantiers, hors-ligne |
| `js/symbols.js` | Symboles du plan (dessins SVG, à adapter librement) |
| `js/draw.js` | Affichage de la parcelle et des symboles |
| `js/fiche.js` | Fiche de secours imprimable |
| `js/swiss.js` | Conversion WGS84 ↔ LV95, surfaces, milieu de parcelle |
| `js/db.js` | Stockage local (IndexedDB) |
| `sw.js`, `manifest.webmanifest` | Application installable et hors-ligne |
| `vendor/` | Leaflet 1.9.4 et Leaflet-Geoman 2.17 (licences incluses) |

## Remarques

- Les données restent **sur l'appareil** : faites régulièrement une sauvegarde (.json).
- Coordonnées LV95 calculées avec les formules approchées de swisstopo (~1 m), suffisant pour le terrain ;
  la précision réelle dépend du GPS du téléphone (souvent 3–10 m en forêt).
- Données cartographiques © swisstopo / geo.admin.ch (données ouvertes, mention de la source obligatoire).
