# API Elix — guide d'utilisation

> Rétro-ingénierie du 2026-10-02 à partir du front `dico.elix-lsf.fr` (`/js/app.bundle.js`).
> **API non documentée** : elle peut changer sans préavis.

## Vue d'ensemble

| | |
|---|---|
| Base URL | `https://api.elix-lsf.fr` |
| Format | JSON, `GET` uniquement |
| Authentification | Aucune |
| CORS / client | Utilisée directement par le site public (Redux + `redux-api-middleware`) |

Les vidéos sont hébergées sur un bucket S3 OVH : `https://elix-lsf.s3.rbx.io.cloud.ovh.net/spip_videos/*.mp4`.

## Endpoints

| Endpoint | Rôle |
|---|---|
| `GET /suggests?q=<préfixe>&limit=<n>&offset=<n>&fuzzy=<0\|1>&thematic=<slug>` | Liste de mots (autocomplétion et index alphabétique) |
| `GET /words?q=<mot>` | Toutes les entrées d'un mot (catégories et sens) avec vidéos |
| `GET /words/<mot>/meanings/<id>` | Un sens précis |
| `GET /thematics?limit=<n>&sort=<champ>` | Liste des lexiques thématiques |
| `GET /thematics/<slug>` | Détail d'un lexique thématique |

Notes :
- `/suggests` : `q` vide → `400 Bad Request`. `limit` n'est pas plafonné (testé jusqu'à 20 000) : **une requête par lettre suffit**.
- `fuzzy=1` active la recherche approximative (utilisée pour les suggestions « Vouliez-vous dire… »).
- Les paramètres doivent être URL-encodés (`encodeURIComponent`).

## Réponses

### `/suggests`

```json
{ "total": 6243, "data": ["M", "m", "m'", "m'as-tu-vu", "M."] }
```

### `/words?q=mouton`

```json
{
  "data": [
    {
      "name": "mouton",
      "typology": "n.m.",
      "meanings": [
        {
          "id": 205527,
          "word_id": 190779,
          "definition": "mammifère domestique ruminant qui porte une toison…",
          "wordSigns": [
            {
              "uri": "https://elix-lsf.s3.rbx.io.cloud.ovh.net/spip_videos/mouton_nm_1_1.mp4",
              "author": "Signes de sens",
              "image": "https://elix-lsf.s3.rbx.io.cloud.ovh.net/spip_images/….jpg"
            }
          ],
          "definitionSigns": [{ "uri": "….mp4", "image": "….jpg" }],
          "source": "http://dictionnaire.sensagent.com/MOUTON/fr-fr/",
          "example": null,
          "illustrationImage": null,
          "illustrationVideo": null,
          "illustrationLegend": null,
          "thematics": null
        }
      ]
    }
  ]
}
```

| Champ | Sens |
|---|---|
| `data[]` | Une entrée par catégorie grammaticale (`n.`, `n.m.`, `v.`…) |
| `typology` | Catégorie grammaticale |
| `meanings[].id` | Identifiant du sens (celui des URL `/dictionnaire/<mot>/<typo>-<id>`) |
| `meanings[].definition` | Définition textuelle en français |
| `meanings[].wordSigns[]` | **Vidéos du signe** (plusieurs variantes possibles). Vide si le sens n'a pas de signe |
| `meanings[].definitionSigns[]` | Vidéo de la définition signée en LSF |
| `meanings[].thematics` | Lexiques thématiques associés |

Un mot ambigu (ex. « mouton » animal / viande) a plusieurs `meanings`, chacun avec ses propres `wordSigns` → c'est là qu'intervient la désambiguïsation par Gemini.

## Recettes

### Récupérer toute la liste des mots

```python
import httpx, string, time

API = "https://api.elix-lsf.fr"
words: set[str] = set()
with httpx.Client(timeout=30) as client:
    for letter in string.ascii_lowercase:
        r = client.get(f"{API}/suggests", params={
            "q": letter, "limit": 20000, "offset": 0, "fuzzy": 0, "thematic": "",
        })
        words.update(r.json()["data"])
        time.sleep(0.3)
```

### Récupérer les vidéos d'un mot

```python
r = httpx.get(f"{API}/words", params={"q": "mouton"})
for entry in r.json()["data"]:
    for meaning in entry["meanings"]:
        videos = [s["uri"] for s in meaning["wordSigns"]]
        print(entry["typology"], meaning["definition"], videos)
```

### Ne garder que les mots signés

Un mot est « signé » si au moins un de ses sens a un `wordSigns` non vide. Il faut appeler `/words` pour chaque mot (pas de filtre côté API).

## Volumétrie (mesurée le 2026-10-02)

| Indicateur | Valeur |
|---|---|
| Entrées via `/suggests` (26 lettres) | ~98 400 |
| Mots dans les sitemaps | 60 863 |
| Sens dans les sitemaps | 85 753 |
| Mots du sitemap ayant ≥ 1 signe | ~26 % (≈ 16 000) |
| Entrées « API seule » ayant ≥ 1 signe | ~9 % (≈ 3 000) |
| **Estimation mots signés** | **≈ 19 000 – 20 000** |

Les ~37 000 entrées présentes dans l'API mais absentes des sitemaps sont surtout des noms propres et des locutions (« Berthe Morisot », « maillot de corps »).

Alternative sans API : les sitemaps `https://dico.elix-lsf.fr/sitemap-lettre-<a-z>.xml` listent mots et sens (`robots.txt` autorise tout).
