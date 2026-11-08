# Agenda DCG

Agenda des évaluations de la classe, façon Calendrier d'Apple : chaque éval a sa date, sa matière et ses PDF de cours consultables en ligne. Tout le monde partage le même mot de passe, et chaque modification affiche le prénom de son auteur.

**Site :** https://agenda-evals-0885.netlify.app

## Télécharger l'app

Les installateurs sont dans les [Releases](https://github.com/Tauwni/AgendaDCG/releases/latest). L'app affiche le site dans sa propre fenêtre, donc tout est synchronisé automatiquement.

- **Mac** : `Agenda-DCG-Mac.dmg`. Ouvre-le, glisse l'app dans Applications. Au premier lancement, macOS dit qu'il ne peut pas vérifier le développeur : va dans **Réglages Système → Confidentialité et sécurité**, puis clique sur **Ouvrir quand même**.
- **Windows** : `Agenda-DCG-Windows-Setup.exe`. Si SmartScreen s'affiche, clique sur **Informations complémentaires → Exécuter quand même**.

Ces avertissements viennent du fait que l'app n'est pas signée avec un certificat payant.

## Structure

- `public/index.html` : l'interface (calendrier, fiches d'éval, envoi de PDF)
- `netlify/functions/api.mjs` : l'API (connexion, évals, PDF), stockage dans Netlify Blobs
- `desktop/` : l'app Electron pour Mac et Windows

Le mot de passe de la classe est la variable d'environnement `AGENDA_PASSWORD` sur Netlify. Il n'est pas dans ce repo.

## Développement

```bash
npm install
netlify dev
```

Il faut un fichier `.env` local contenant `AGENDA_PASSWORD=...`.

## Publier une nouvelle version des apps

Augmente `version` dans `desktop/package.json`, puis :

```bash
git tag v1.0.1 && git push --tags
```

GitHub Actions construit le `.dmg` et le `.exe` et les publie dans une Release.
