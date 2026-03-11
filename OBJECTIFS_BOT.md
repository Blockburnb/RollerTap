# Objectifs du bot RollerTap

## Objectif principal
Automatiser les actions repetitives du clicker RollerTap pour limiter les actions manuelles.

## Objectifs fonctionnels
- Cliquer en boucle sur la zone de jeu pour vider l'energie disponible.
- Tenter une recharge d'energie automatiquement toutes les 60 minutes.
- Continuer les cycles de clic apres chaque recharge.
- Garder une session Telegram persistante pour eviter de se reconnecter a chaque lancement.
- Ecrire des logs horodates pour suivre le comportement du bot.

## Objectifs techniques
- Script simple a executer sous Windows avec Node.js + Playwright.
- Parametres modifiables via variables d'environnement (intervalle, vitesse, recharge).
- Tolerer les changements d'interface avec des selecteurs/hints configurables.

## Objectifs de maintenance
- Conserver ce fichier comme reference des attentes du bot.
- Mettre a jour le README si le mode d'utilisation evolue.
