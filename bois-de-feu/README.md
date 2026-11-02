# Bois de feu 🪵

Troisième application du Triage forestier du Vallon (Réchy), **indépendante** des deux autres :
gestion du **stock de bois de feu**, des **entrées de bois** et des **livraisons aux clients**.

Adresse : https://mactimber.github.io/Projet-mac/bois-de-feu/

## Catalogue du triage
| Essence | Longueurs | Contenants |
|---|---|---|
| Foyard | 1 m, 50, 33, 25 cm | 1 m en ballot, le reste en big-bag ; 33 et 25 cm aussi en caisse |
| Mélèze | 1 m, 50, 33, 25 cm | 1 m en ballot, le reste en big-bag |
| Épicéa | 1 m, 50, 33, 25 cm | 1 m en ballot, le reste en big-bag |
| Frêne | 1 m, 33 cm | ballot / big-bag |
| Feuillus indigènes | 33 cm | big-bag |
| Bouleau | 50 cm | big-bag |

Équivalences : big-bag = 1 stère, caisse = 0,7 stère, ballot = 1 stère. Tout se modifie dans **Plus → Catalogue**.

## Les 5 onglets
1. **Stock** : un résumé par produit avec le total en stères, ce qui reste après les commandes à livrer,
   la zone **👉 où l'on prend** ce bois, et une alerte de stock bas (toucher une ligne pour régler le seuil).
   Les lots sont rangés par zone, avec photos, état, durée de séchage et humidité.
   Les boutons **− / +** servent à corriger l'inventaire sur place.
2. **Place** : plan de la place (photo aérienne, photo ou croquis), sur lequel on place les zones.
   Couleurs : 🟢 à prendre, 🔵 réserve, 🟠 en séchage / vert, ⚪ vide.
   **Règle anti-picorage** : pour chaque produit, un seul lot est « à prendre ». Les autres restent en réserve.
   Quand le lot en cours est vide, l'application ouvre automatiquement la réserve suivante
   (d'abord celle déjà entamée, puis la plus ancienne en bois sec, puis dans l'ordre des zones).
3. **Entrées** : façonnage par une entreprise externe, livraison de bois prêt / sec acheté,
   ou façonnage par l'équipe. L'entrée crée un nouveau lot (en réserve) ou s'ajoute à un lot existant.
4. **Livraisons** : commandes, planning par jour, **📋 liste de chargement** (quoi prendre dans quelle zone)
   et **🗺 tournée**. À la livraison, le bois est pris automatiquement dans la zone en cours puis dans la réserve suivante.
   Vous pouvez choisir une autre zone si besoin. Photo, signature du client, bon de livraison PDF, facturation.
5. **Plus** : historique, exports CSV (Excel), catalogue (produits vendus, contenants et stères,
   entreprises), coordonnées du triage pour le bon, copie de secours.

## Données
Tout est enregistré **sur l'appareil** (IndexedDB), photos comprises (réduites à ~1600 px).
Rien n'est envoyé sur internet. La **copie de secours** (onglet Plus) contient aussi les photos :
faites-en une régulièrement et utilisez-la pour passer sur un autre appareil.
Si plusieurs appareils doivent un jour partager le même stock, il faudra passer à un stockage
en ligne (Supabase, Firebase…).

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html`, `css/app.css` | Interface |
| `js/app.js` | Onglets, stock, entrées, commandes, livraisons, exports |
| `js/photos.js` | Réduction et stockage des photos |
| `js/db.js` | Stockage local (IndexedDB) |
| `sw.js`, `manifest.webmanifest` | Application installable et hors-ligne |
