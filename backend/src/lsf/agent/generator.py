from dataclasses import dataclass

from ..llm import LLM

SYSTEM = """Tu aides à construire des listes de vocabulaire pour apprendre la langue des signes française (LSF).
Les mots seront ensuite cherchés dans le dictionnaire vidéo Elix, où seulement un mot sur quatre environ possède un signe :
privilégie donc le vocabulaire courant et concret, celui qu'un débutant apprend en premier.

Règles :
- mots français à la forme du dictionnaire (singulier, masculin, infinitif pour les verbes) ;
- un mot simple de préférence, une locution courte seulement si elle est très usuelle ;
- pas de noms propres, pas de mots rares ou techniques ;
- pour chaque mot, « hint » est une courte définition du sens visé dans ce thème (ex. « avocat » → « fruit à noyau ») : elle sert à choisir le bon sens parmi les homonymes ;
- ordonne du plus utile/fréquent au moins utile ;
- n'inclus aucun mot de la liste d'exclusion ;
- « emoji » : un seul emoji représentant le thème."""

SCHEMA = {
    "type": "object",
    "properties": {
        "emoji": {"type": "string"},
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"word": {"type": "string"}, "hint": {"type": "string"}},
                "required": ["word", "hint"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["emoji", "candidates"],
    "additionalProperties": False,
}


@dataclass
class Generated:
    emoji: str
    candidates: list[tuple[str, str]]


async def generate_candidates(llm: LLM, theme: str, n: int, exclude: list[str]) -> Generated:
    user = f"Thème : {theme}\nNombre de mots : {n}\nListe d'exclusion : {', '.join(sorted(set(exclude))) or '(vide)'}"
    out = await llm.json(SYSTEM, user, "vocabulary", SCHEMA)
    seen = {w.lower() for w in exclude}
    candidates: list[tuple[str, str]] = []
    for c in out.get("candidates", []):
        word = (c.get("word") or "").strip()
        if word and word.lower() not in seen:
            seen.add(word.lower())
            candidates.append((word, (c.get("hint") or "").strip()))
    return Generated(emoji=(out.get("emoji") or "📚").strip()[:8], candidates=candidates[:n])


SUGGEST_SYSTEM = """Tu es un professeur de LSF. À partir des thèmes déjà étudiés et de quelques mots acquis,
propose 3 nouveaux thèmes de vocabulaire du quotidien, voisins ou complémentaires, adaptés à un apprenant qui progresse.
Noms de thèmes courts (1 à 4 mots), un emoji chacun, et une raison d'une phrase."""

SUGGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "themes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "emoji": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["name", "emoji", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["themes"],
    "additionalProperties": False,
}


async def suggest_themes(llm: LLM, known_themes: list[str], acquired_words: list[str]) -> list[dict]:
    user = (
        f"Thèmes déjà étudiés : {', '.join(known_themes) or '(aucun)'}\n"
        f"Exemples de mots acquis : {', '.join(acquired_words[:40]) or '(aucun)'}"
    )
    out = await llm.json(SUGGEST_SYSTEM, user, "theme_suggestions", SUGGEST_SCHEMA)
    return out.get("themes", [])[:3]
