# LSF Flash — apprendre le vocabulaire LSF avec l'IA

App mobile de flashcards pour accumuler du vocabulaire en langue des signes française.
On choisit un thème, l'IA propose des mots, un agent backend vérifie chacun dans le dictionnaire
[Elix](https://dico.elix-lsf.fr) (bon sens + vidéo téléchargée et contrôlée), puis l'app
déroule un feed continu de cartes jusqu'à ce que les mots soient acquis.

```
backend/   API FastAPI + agents OpenAI (génération, validation) + stockage des vidéos
mobile/    App Expo / React Native : feed, répétition espacée, progression (SQLite local)
elix-api.md  Notes sur l'API Elix (non documentée)
```

## Fonctionnement

**Backend** — `POST /themes` lance un job persistant :
1. le générateur (LLM) propose ~30 mots courants pour le thème ;
2. pré-filtre sans LLM : un mot présent dans Elix mais sans aucun signe est rejeté ;
3. l'agent de validation (tool-calling) choisit le sens qui correspond au thème
   (ex. « pomme » fruit, pas « pomme » visage), essaie une variante si besoin, puis appelle
   `download_sign` ;
4. `download_sign` télécharge la vidéo, vérifie le MP4 (piste vidéo, durée, ffprobe), la
   réencode en 480p muet (~50 Ko au lieu de ~5 Mo) et refuse une vidéo identique à un autre mot du thème.

L'agent ne peut pas valider un mot sans téléchargement réussi : c'est imposé par le code.
**L'API n'expose que des mots entièrement validés.**

**App** — l'app ne présente un mot qu'une fois sa vidéo stockée sur le téléphone (lecture fluide, hors ligne).
Le prochain exercice est choisi localement et instantanément (répétition espacée), sans appel LLM :
- carte **Découverte** (vidéo + mot + définition) avant tout quiz ;
- **QCM vidéo → mot** puis **QCM mot → vidéo** (3 choix au premier essai, 4 ensuite ;
  les distracteurs viennent du même thème) ;
- une erreur revient 3 cartes plus tard ; 3 à 6 mots en apprentissage au maximum ;
- un mot est **acquis** quand il est réussi dans les deux sens, dont une fois après un délai
  (≥ 20 h). Les révisions continuent ensuite (3 j, 7 j, 21 j, 60 j) ;
- cartes spéciales dans le feed : thème maîtrisé (≥ 80 %) → +10 mots ou nouveau thème
  suggéré par l'IA ; bilan toutes les 20 cartes ; « l'IA prépare tes mots » ; « tout est à jour ».

## Lancer le backend

```bash
cp .env.example .env   # renseigner OPENAI_API_KEY et APP_TOKEN
```

```bash
docker compose up -d --build
```

Les données (base SQLite + vidéos) sont dans `./data`. Le port est réglable via `API_PORT`.
Sans Docker, pour développer (ffmpeg optionnel : sans lui, les vidéos sont gardées telles quelles) :

```bash
cd backend && uv run uvicorn lsf.app:app --reload --host 0.0.0.0
```

Tester la construction d'un thème en direct, avec le rapport de l'agent (mots acceptés et leur sens, mots rejetés et la raison) :

```bash
cd backend && OPENAI_API_KEY=sk-... uv run python -m lsf.cli build-theme "Cuisine"
```

## Lancer l'app

```bash
cd mobile && npm install && npx expo start
```

Ouvrir avec **Expo Go** (tous les modules utilisés y sont inclus). Au premier lancement, saisir
l'adresse du serveur (pré-remplie avec l'IP de la machine qui fait tourner Metro, port 8000) et
le `APP_TOKEN`. Le téléphone doit être sur le même réseau que la machine.

En développement, on peut sauter cet écran en fournissant la configuration au lancement de Metro
(utilisée seulement si aucune n'est déjà enregistrée, et ignorée hors `__DEV__`) :

```bash
set -a && . ./.env && set +a && cd mobile && EXPO_PUBLIC_DEV_API_URL=http://localhost:8010 EXPO_PUBLIC_DEV_API_TOKEN="$APP_TOKEN" npx expo start --web
```

Pour un VPS : mettre l'API derrière un reverse proxy HTTPS (ex. Caddy). Les builds Android
de production refusent le HTTP en clair.

## Tests

```bash
cd backend && uv run pytest
```

```bash
cd mobile && npm test && npx tsc --noEmit
```

## Crédits

Vidéos des signes : dictionnaire Elix, association Signes de sens. L'API Elix n'est pas
documentée et peut changer. Les réponses sont mises en cache 30 jours côté backend.
