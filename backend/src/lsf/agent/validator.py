"""Validation agent: for one candidate word, checks Elix availability, matches the meaning
that fits the theme and downloads + verifies its sign video.

The LLM drives the decision, but the guarantees are enforced in code:
- only meanings returned by an Elix lookup can be downloaded;
- `accept` is refused unless `download_sign` succeeded for that exact meaning.
"""

import json
import logging
from dataclasses import dataclass, field

from ..elix import ElixClient, Meaning
from ..llm import LLM, function_tool
from ..media import MediaResult, MediaStore

log = logging.getLogger(__name__)

MAX_STEPS = 8

SYSTEM = """Tu es l'agent de validation d'une application d'apprentissage de la LSF.
On te donne un mot candidat, le sens visé et le thème. Ton travail :
1. Examiner les sens que le dictionnaire Elix propose pour ce mot (fournis, ou via lookup_word).
2. Choisir LE sens dont la définition correspond au thème et au sens visé, parmi ceux qui ont au moins une vidéo (signs > 0).
3. Si le mot n'existe pas sous cette forme, tu peux chercher une variante (search_similar puis lookup_word) :
   singulier, masculin, infinitif, orthographe proche. La variante doit garder exactement le même sens.
4. Appeler download_sign(meaning_id) pour récupérer et vérifier la vidéo. En cas d'échec, essayer un autre sens
   valable s'il y en a un, sinon rejeter.
5. Terminer par accept(meaning_id, justification) ou reject(reason).

Sois exigeant : un sens qui ne correspond pas au thème doit être rejeté (ex. « pomme » au sens de « visage »
dans un thème sur les fruits). Mieux vaut rejeter qu'enseigner un mauvais signe. Réponds en français."""

TOOLS = [
    function_tool(
        "lookup_word",
        "Liste les sens d'un mot exact dans Elix, avec définition et nombre de vidéos de signe.",
        {"word": {"type": "string"}},
    ),
    function_tool(
        "search_similar",
        "Cherche des entrées Elix commençant par un préfixe (fuzzy=true pour une recherche approximative).",
        {"prefix": {"type": "string"}, "fuzzy": {"type": "boolean"}},
    ),
    function_tool(
        "download_sign",
        "Télécharge et vérifie la vidéo du signe d'un sens (meaning_id issu d'un lookup).",
        {"meaning_id": {"type": "integer"}},
    ),
    function_tool(
        "accept",
        "Valide le sens choisi. Exige un download_sign réussi pour ce meaning_id.",
        {"meaning_id": {"type": "integer"}, "justification": {"type": "string"}},
    ),
    function_tool("reject", "Rejette le candidat.", {"reason": {"type": "string"}}),
]


@dataclass
class ThemeContext:
    name: str
    # sha -> word, for videos already used in this theme (identical videos make a QCM ambiguous)
    shas: dict[str, str] = field(default_factory=dict)
    meaning_ids: set[int] = field(default_factory=set)


@dataclass
class Outcome:
    accepted: bool
    reason: str = ""
    meaning: Meaning | None = None
    media: MediaResult | None = None
    justification: str = ""
    trace: list[str] = field(default_factory=list)


class _Run:
    def __init__(self, elix: ElixClient, media: MediaStore, theme: ThemeContext, known_videos: dict[int, MediaResult]):
        self.elix = elix
        self.media = media
        self.theme = theme
        self.known_videos = known_videos  # meaning_id -> already stored video (catalog reuse)
        self.meanings: dict[int, Meaning] = {}
        self.downloaded: dict[int, MediaResult] = {}
        self.outcome: Outcome | None = None
        self.trace: list[str] = []

    def remember(self, meanings: list[Meaning]) -> list[dict]:
        for m in meanings:
            self.meanings[m.meaning_id] = m
        return [
            {
                "meaning_id": m.meaning_id,
                "word": m.word,
                "typology": m.typology,
                "definition": m.definition[:300],
                "signs": len(m.signs),
                "already_in_theme": m.meaning_id in self.theme.meaning_ids,
            }
            for m in meanings
        ]

    async def call(self, name: str, args: dict) -> dict:
        self.trace.append(f"{name}({json.dumps(args, ensure_ascii=False)})")
        if name == "lookup_word":
            return {"meanings": self.remember(await self.elix.lookup(args["word"]))}
        if name == "search_similar":
            return {"entries": await self.elix.suggest(args["prefix"], bool(args.get("fuzzy")))}
        if name == "download_sign":
            return await self.download(int(args["meaning_id"]))
        if name == "accept":
            mid = int(args["meaning_id"])
            if mid not in self.downloaded:
                return {"error": "refusé : download_sign doit réussir pour ce meaning_id avant accept"}
            self.outcome = Outcome(
                True,
                meaning=self.meanings[mid],
                media=self.downloaded[mid],
                justification=args.get("justification", ""),
            )
            return {"ok": True}
        if name == "reject":
            self.outcome = Outcome(False, reason=args.get("reason", "rejeté"))
            return {"ok": True}
        return {"error": f"outil inconnu : {name}"}

    async def download(self, mid: int) -> dict:
        m = self.meanings.get(mid)
        if m is None:
            return {"error": "meaning_id inconnu : fais d'abord lookup_word"}
        if mid in self.theme.meaning_ids:
            return {"error": "ce sens est déjà dans le thème"}
        if not m.signs:
            return {"error": "ce sens n'a aucune vidéo de signe"}
        result = self.known_videos.get(mid)
        if result is None:
            failures = []
            for sign in m.signs:
                r = await self.media.fetch_sign(sign)
                if r.ok:
                    result = r
                    break
                failures.append(r.reason)
            if result is None:
                return {"ok": False, "error": "; ".join(failures)}
        if result.sha in self.theme.shas:
            return {"ok": False, "error": f"vidéo identique à celle de « {self.theme.shas[result.sha]} » dans ce thème"}
        self.downloaded[mid] = result
        return {"ok": True, "duration_s": round(result.duration_s, 2)}


async def validate_candidate(
    llm: LLM,
    elix: ElixClient,
    media: MediaStore,
    theme: ThemeContext,
    word: str,
    hint: str,
    known_videos: dict[int, MediaResult] | None = None,
) -> Outcome:
    run = _Run(elix, media, theme, known_videos or {})
    meanings = await elix.lookup(word)
    # Deterministic pre-filter: the word exists but no meaning is signed -> no need to ask the LLM.
    if meanings and not any(m.signed for m in meanings):
        return Outcome(False, reason="présent dans Elix mais sans vidéo de signe")

    listing = run.remember(meanings)
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": (
                f"Thème : {theme.name}\nMot candidat : {word}\nSens visé : {hint or '(non précisé)'}\n"
                f"Résultat de lookup_word({word!r}) :\n{json.dumps(listing, ensure_ascii=False)}"
            ),
        },
    ]
    for _ in range(MAX_STEPS):
        turn = await llm.tools(messages, TOOLS)
        messages.append(turn.as_message())
        if not turn.tool_calls:
            messages.append({"role": "user", "content": "Utilise un outil : termine par accept ou reject."})
            continue
        for call in turn.tool_calls:
            try:
                result = await run.call(call.name, call.arguments)
            except Exception as e:  # network errors etc. are reported to the agent, not fatal
                log.exception("tool %s failed", call.name)
                result = {"error": f"{e.__class__.__name__}: {e}"}
            messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result, ensure_ascii=False)})
        if run.outcome is not None:
            run.outcome.trace = run.trace
            return run.outcome
    return Outcome(False, reason="l'agent n'a pas conclu", trace=run.trace)
