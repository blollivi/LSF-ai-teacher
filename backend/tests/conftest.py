import json
import re

import httpx
import pytest
import respx

from lsf.config import Settings
from lsf.llm import AssistantTurn, ToolCall

ELIX = "https://api.elix-lsf.fr"


def _box(kind: bytes, body: bytes) -> bytes:
    return (8 + len(body)).to_bytes(4, "big") + kind + body


def fake_mp4(tag: str, duration_ms: int = 2000) -> bytes:
    mvhd = bytes(4) + bytes(8) + (1000).to_bytes(4, "big") + duration_ms.to_bytes(4, "big") + bytes(80)
    hdlr = bytes(4) + bytes(4) + b"vide" + bytes(12) + b"\x00"
    moov = _box(b"moov", _box(b"mvhd", mvhd) + _box(b"trak", _box(b"mdia", _box(b"hdlr", hdlr))))
    padding = (tag.encode() * 2000)[:20_000]
    return _box(b"ftyp", b"isom" + bytes(4) + b"isom") + moov + _box(b"mdat", padding)


def meaning(mid: int, definition: str, videos: list[str]) -> dict:
    return {
        "id": mid,
        "definition": definition,
        "wordSigns": [{"uri": f"https://s3.test/{v}.mp4", "image": f"https://s3.test/{v}.jpg", "author": "Signes de sens"} for v in videos],
    }


# word -> list of meanings (all under one typology for simplicity)
DICTIONARY: dict[str, list[dict]] = {
    "pomme": [meaning(1, "partie de la tête humaine, visage", ["pomme_visage"]), meaning(2, "fruit du pommier", ["pomme_fruit"])],
    "poire": [meaning(3, "fruit du poirier", ["poire"])],
    "banane": [meaning(4, "fruit allongé à peau jaune", ["banane"])],
    "kiwi": [meaning(5, "fruit à peau velue", []), {"id": None, "definition": "sans id", "wordSigns": []}],
    "fraise": [meaning(6, "fruit rouge du fraisier", ["broken"])],
    "cerise": [meaning(7, "fruit rouge à noyau", ["cerise"])],
    "abricot": [meaning(8, "fruit orange à noyau", ["cerise"])],  # same video as cerise
    "prune": [meaning(9, "fruit du prunier", ["prune"])],
    "raisin": [meaning(10, "fruit de la vigne", ["raisin"])],
}


def elix_routes(router: respx.MockRouter) -> None:
    def words(request: httpx.Request):
        q = request.url.params["q"]
        entries = [{"name": q, "typology": "n.", "meanings": DICTIONARY[q]}] if q in DICTIONARY else []
        return httpx.Response(200, json={"data": entries})

    def suggests(request: httpx.Request):
        q = request.url.params["q"]
        return httpx.Response(200, json={"total": 0, "data": [w for w in DICTIONARY if w.startswith(q)]})

    def video(request: httpx.Request):
        name = request.url.path.strip("/").removesuffix(".mp4")
        if name == "broken":
            return httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>oops</html>")
        return httpx.Response(200, headers={"content-type": "video/mp4"}, content=fake_mp4(name))

    router.get(f"{ELIX}/words").mock(side_effect=words)
    router.get(f"{ELIX}/suggests").mock(side_effect=suggests)
    router.get(url__regex=r"https://s3\.test/.*\.mp4").mock(side_effect=video)
    router.get(url__regex=r"https://s3\.test/.*\.jpg").mock(
        return_value=httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"\xff\xd8jpeg")
    )


class FakeLLM:
    """Deterministic stand-in for the OpenAI agent: picks the meaning whose definition contains
    the hint, downloads it, then accepts (or rejects on failure)."""

    def __init__(self, candidates: list[tuple[str, str]] | None = None, cheat: bool = False):
        self.candidates = candidates or []
        self.cheat = cheat
        self.tool_calls = 0
        self._n = 0

    async def json(self, system, user, schema_name, schema):
        if schema_name == "vocabulary":
            excluded = set(re.search(r"Liste d'exclusion : (.*)", user).group(1).split(", "))
            return {"emoji": "🍎", "candidates": [{"word": w, "hint": h} for w, h in self.candidates if w not in excluded]}
        return {"themes": [{"name": "Légumes", "emoji": "🥕", "reason": "voisin"}]}

    def _call(self, name: str, **args) -> AssistantTurn:
        self._n += 1
        self.tool_calls += 1
        return AssistantTurn(None, [ToolCall(f"c{self._n}", name, args)])

    async def tools(self, messages, tools):
        user = messages[1]["content"]
        hint = re.search(r"Sens visé : (.*)", user).group(1)
        listing = json.loads(user.split(":\n", 1)[1])
        if self.cheat:
            return self._call("accept", meaning_id=listing[0]["meaning_id"], justification="trust me")
        last = messages[-1]
        if last["role"] == "tool":
            result = json.loads(last["content"])
            prev = messages[-2]["tool_calls"][0]["function"]
            if prev["name"] == "download_sign":
                if result.get("ok"):
                    return self._call("accept", meaning_id=json.loads(prev["arguments"])["meaning_id"], justification=f"sens : {hint}")
                return self._call("reject", reason=result.get("error", "échec"))
        match = [m for m in listing if m["signs"] and hint in m["definition"]]
        if not match:
            return self._call("reject", reason="aucun sens adapté")
        return self._call("download_sign", meaning_id=match[0]["meaning_id"])


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(openai_api_key="test", app_token="secret", data_dir=tmp_path / "data")


@pytest.fixture
def elix_mock():
    with respx.mock(assert_all_called=False) as router:
        elix_routes(router)
        yield router
