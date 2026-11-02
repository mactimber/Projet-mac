# Bois de feu 🪵

Troisième application du Triage forestier du Vallon (Réchy), **indépendante** des deux autres :
gestion du **stock de bois de feu**, des **entrées de bois** et des **livraisons aux clients**.

Adresse : https://mactimber.github.io/Projet-mac/bois-de-feu/

## Les 4 onglets
1. **Stock** : un résumé par produit (essence · longueur · contenant) avec ce qui reste après les
   commandes à livrer, et une alerte de stock bas (toucher une ligne pour régler le seuil).
   Les lots (tas, palettes, big-bags…) sont rangés par lieu de stockage, avec photos, état
   (vert / en séchage / sec), durée de séchage et humidité. Les boutons **− / +** servent à
   corriger l'inventaire sur place.
2. **Entrées** : façonnage par une entreprise externe, livraison de bois prêt / sec acheté,
   ou façonnage par l'équipe. Date, entreprise, quantité, coût, photos (bon, tas). L'entrée crée
   un nouveau lot ou s'ajoute à un lot existant.
3. **Livraisons** : commandes clients (le client est retrouvé automatiquement à la commande suivante),
   planning par jour avec bouton **Tournée** (itinéraire Google Maps), appel du client,
   livraison avec choix du lot, photo et **signature du client à l'écran**, puis « facturée ».
   La livraison retire le bois du stock. Si on l'annule, le bois revient dans le stock. Le **bon de livraison** s'imprime en PDF A4.
4. **Plus** : historique de tous les mouvements, exports CSV (Excel), catalogue (essences,
   longueurs, contenants et unités, lieux, entreprises), coordonnées du triage pour le bon,
   copie de secours.

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
