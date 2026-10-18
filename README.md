# Foulée 🦊 — plan d'entraînement course à pied

Application web (PWA) 100 % statique : aucune installation, aucun serveur, les données restent sur le téléphone.

## Fonctionnalités
- Import de l'export Strava (`.zip` ou `activities.csv`) → estimation du niveau, des allures et du volume.
- Objectif : course (5 km, 10 km, semi, marathon + date + temps visé) **ou** sans course (habitude, forme, distance, vitesse).
- Plan semaine par semaine : footings, sorties longues, jeux de vitesse, seuil, fractionné, allure course, affûtage, jour J.
- **Adaptation** : après chaque séance (distance, durée, ressenti 😄🙂😮‍💨) le plan restant est recalculé (charge ↑/↓, allures). Réimporter Strava valide automatiquement les séances faites.
- **Deux options chaque jour** : une séance principale et une alternative (même thème ou non : lignes droites, côtes, pyramide, sortie progressive, cross-training…). On touche celle qu'on préfère.
- **Adaptation continue** : le ressenti (pondéré selon le type de séance), les séances manquées et les séances intenses jugées faciles/dures ajustent la charge et les allures. Une courbe montre l'évolution du chrono estimé, comparé à l'objectif (avec proposition de le réajuster si besoin).
- **Performance récente** : un chrono de course ou de test recale tout le niveau (« Moi → Mon niveau »).
- **Pas en forme / malade / blessée** : le plan est allégé puis la reprise est progressive.
- **Jour J** : stratégie de course chronométrée (départ prudent, croisière, finish), bilan, recalibrage du niveau d'après le chrono réel, semaines de récupération automatiques puis nouveau plan avec objectif suggéré.
- **Séance bonus** : un bouton sur l'écran d'accueil propose une séance spontanée, **par durée (20 à 90 min) ou par distance (3 à 15 km, ou valeur libre)**. Une vingtaine de styles (footing au ressenti, découverte, endurance active, « X km à allure », progressif, fartlek libre, 30/30, pyramide, échelle, côtes, lignes droites, seuil en blocs, fractionné, course/marche, récup, cross-training, sortie longue…), adaptés à la fatigue récente et à la séance du lendemain ; relançable (sans répétitions), guidée, et comptée dans les points et badges.
- **Décaler une séance** : à un autre jour (ou au « meilleur jour » selon la météo) ; le choix est conservé quand le plan se réadapte.
- **Météo** (Open-Meteo, sans clé) : conseils chaleur / pluie / vent / gel, ralentissement conseillé et meilleur créneau horaire. Ville ou position à renseigner dans l'onglet Moi.
- **Séance guidée** : minuteur par étapes (échauffement, rapide, récup…), bips et voix, métronome de cadence réglable, écran maintenu allumé.
- **Bilan de course** : après le jour J, chrono réel vs prévu et vs objectif, nouveaux chronos estimés, partage.
- **Sauvegarde** : export / restauration des données en fichier `.json` (onglet Moi).
- Ludique : XP, niveaux, série de semaines, badges, confettis.

## Publier sur GitHub Pages
1. Crée un dépôt GitHub et envoie-y tout le contenu de ce dossier (à la racine).
2. Dépôt → Settings → Pages → Source : `main` / `(root)`.
3. L'URL `https://<utilisateur>.github.io/<depot>/` est prête (HTTPS requis pour l'installation).

## Sur iPhone
Ouvrir l'URL dans **Safari** → Partager → **Sur l'écran d'accueil**.

## Tester en local
Servir le dossier avec n'importe quel serveur statique (les service workers ne marchent pas en `file://`).
