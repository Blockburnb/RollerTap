# RollerTap

Script d'automatisation pour le mini-jeu Telegram RollerTap:
- clic en boucle pour vider l'energie
- tentative de recharge automatique 1 fois par heure
- se connecte via **Telegram Web** (`web.telegram.org`) pour eviter d'ouvrir l'app desktop

## Prerequis

- Windows (PowerShell)
- Node.js 18+
- Un compte Telegram avec acces au bot RollerTap

## Installation

Depuis le dossier du projet:

```powershell
npm init -y
npm install playwright
npx playwright install chromium
```

## Lancer le bot

```powershell
node .\rollertap-bot.js
```

Au premier lancement:
- une fenetre Chromium s'ouvre sur `web.telegram.org`
- connecte ton compte Telegram (QR code ou numero de telephone)
- le script clique automatiquement le bouton **Launch** pour demarrer la mini-app
- si le bouton n'est pas trouve, clique manuellement sur Play dans le bot
- laisse ensuite le script tourner

La session est sauvegardee dans `.pw-user-data`, donc la reconnexion n'est normalement pas necessaire aux lancements suivants.

## Configuration rapide (PowerShell)

Tu peux ajuster le comportement via variables d'environnement:

```powershell
$env:VERBOSE_LOGS="1"
$env:CLICK_PROGRESS_EVERY="250"
$env:LOG_TAP_COORDS="0"
$env:LAUNCH_RETRY_WINDOW_MS="90000"
$env:LAUNCH_POLL_MS="1200"
$env:CLICK_INTERVAL_MS="35"
$env:MAX_CLICKS_PER_BURST="3000"
$env:RECHARGE_EVERY_MS="3600000"
node .\rollertap-bot.js
```

Variables utiles:
- `GAME_URL`: URL du jeu (par defaut: URL RollerTap)
- `VIEWPORT_WIDTH`: largeur de la fenetre, minimum `405`
- `VIEWPORT_HEIGHT`: hauteur de la fenetre, minimum `985`
- `VERBOSE_LOGS`: `1` (defaut) pour logs detailles, `0` pour reduire les logs
- `CLICK_PROGRESS_EVERY`: log de progression tous les N clics (defaut `250`)
- `LOG_TAP_COORDS`: `1` pour afficher les coordonnees des clics de progression
- `LAUNCH_RETRY_WINDOW_MS`: duree max pour tenter Launch + popup `LANCER` (defaut `90000`)
- `LAUNCH_POLL_MS`: delai entre tentatives de lancement (defaut `1200`)
- `CLICK_INTERVAL_MS`: delai entre 2 clics
- `MAX_CLICKS_PER_BURST`: nombre max de clics par cycle
- `RECHARGE_EVERY_MS`: intervalle de recharge (par defaut 1h)
- `TAP_SELECTORS`: selecteurs CSS de la zone de clic (CSV)
- `RECHARGE_HINTS`: mots-clefs pour trouver le bouton de recharge (CSV)
- `RECHARGE_SELECTORS`: selecteurs CSS fallback pour recharge (CSV)
- `HEADLESS`: `1` pour lancer sans fenetre visible

## Fichiers

- `rollertap-bot.js`: script principal
- `OBJECTIFS_BOT.md`: objectifs a conserver

## Notes

- **Telegram desktop installe ?** Pas de probleme: le script ouvre Chromium et passe par `web.telegram.org`, jamais par l'app desktop.
- La fenetre est ouverte par defaut en `405x985` minimum pour afficher l'interface complete du jeu.
- Les actions du bot sont loguees dans le terminal: debut/fin de cycle, checks energie, progression des clics, tentatives de recharge.
- Les interfaces de mini-app Telegram peuvent changer: adapte les variables de selecteurs si necessaire.
- Ce script automatise des actions; verifie les regles du jeu et de la plateforme avant usage.