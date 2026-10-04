import time

import pytest
from fastapi.testclient import TestClient

from conftest import FakeLLM

from lsf.db import make_engine, session
from lsf.main import create_app
from lsf.models import Candidate, Theme

FRUITS = [
    ("pomme", "fruit du pommier"),
    ("poire", "fruit"),
    ("kiwi", "fruit"),
    ("fraise", "fruit"),
    ("banane", "fruit"),
    ("cerise", "fruit"),
    ("abricot", "fruit"),
    ("mangue", "fruit"),  # not in Elix at all
    ("prune", "fruit"),
    ("raisin", "fruit"),
]
AUTH = {"Authorization": "Bearer secret"}


def wait_done(client: TestClient, theme_id: int, timeout: float = 10) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/themes/{theme_id}", headers=AUTH).json()
        if body["status"] in ("ready", "failed"):
            return body
        time.sleep(0.05)
    raise AssertionError(f"theme still {body['status']}")


@pytest.fixture
def client(settings, elix_mock):
    settings.reserve_target = 2
    settings.max_generation_rounds = 1
    app = create_app(settings, llm=FakeLLM(FRUITS))
    with TestClient(app) as c:
        yield c


def test_requires_token(client):
    assert client.get("/themes").status_code == 401
    assert client.get("/themes", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_builds_theme_and_only_exposes_validated_items(client, settings):
    created = client.post("/themes", json={"name": "Fruits", "size": 4}, headers=AUTH)
    assert created.status_code == 201
    body = wait_done(client, created.json()["id"])

    assert body["status"] == "ready"
    assert body["emoji"] == "🍎"
    assert body["active_count"] == 4 and body["reserve_count"] == 2
    words = [i["word"] for i in body["items"]]
    assert "kiwi" not in words and "fraise" not in words and "mangue" not in words
    assert not ({"cerise", "abricot"} <= set(words))  # identical video never twice in a theme
    for item in body["items"]:
        assert (settings.media_dir / f"{item['video_sha']}.mp4").exists()
        assert client.get(item["video_url"]).status_code == 200
    pomme = next(i for i in body["items"] if i["word"] == "pomme")
    assert pomme["meaning_id"] == 2  # the fruit, not the face

    report = {r["word"]: r for r in client.get(f"/themes/{body['id']}/report", headers=AUTH).json()}
    assert report["kiwi"]["status"] == "rejected"


def test_extend_promotes_reserve(client):
    theme_id = client.post("/themes", json={"name": "Fruits", "size": 4}, headers=AUTH).json()["id"]
    wait_done(client, theme_id)
    client.post(f"/themes/{theme_id}/extend", json={"count": 2}, headers=AUTH)
    body = wait_done(client, theme_id)
    assert body["active_count"] == 6
    assert len({i["meaning_id"] for i in body["items"] if i["role"] == "active"}) == 6


def test_suggest(client):
    r = client.post("/themes/suggest", json={"known_themes": [], "acquired_words": ["pomme"]}, headers=AUTH)
    assert r.json()["themes"][0]["name"] == "Légumes"


def test_resumes_interrupted_build(settings, elix_mock):
    engine = make_engine(settings)
    with session(engine) as s:
        theme = Theme(name="Fruits", status="validating", target_active=2, rounds=1)
        s.add(theme)
        s.commit()
        s.refresh(theme)
        s.add(Candidate(theme_id=theme.id, word="poire", hint="fruit", status="processing"))
        s.add(Candidate(theme_id=theme.id, word="banane", hint="fruit"))
        s.commit()
    settings.reserve_target = 0
    with TestClient(create_app(settings, llm=FakeLLM())) as c:
        body = wait_done(c, theme.id)
    assert body["status"] == "ready"
    assert {i["word"] for i in body["items"]} == {"poire", "banane"}


def test_failed_theme_can_be_retried(settings, elix_mock):
    settings.reserve_target = 0
    settings.max_generation_rounds = 1
    llm = FakeLLM([])  # generator proposes nothing -> nothing validated -> failed
    with TestClient(create_app(settings, llm=llm)) as c:
        theme_id = c.post("/themes", json={"name": "Fruits", "size": 4}, headers=AUTH).json()["id"]
        assert wait_done(c, theme_id)["status"] == "failed"
        llm.candidates = FRUITS
        again = c.post("/themes", json={"name": "fruits", "size": 4}, headers=AUTH).json()
        assert again["id"] == theme_id
        assert wait_done(c, theme_id)["status"] == "ready"
