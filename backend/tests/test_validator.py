import httpx
import pytest

from conftest import FakeLLM

from lsf.agent.validator import ThemeContext, validate_candidate
from lsf.db import make_engine
from lsf.elix import ElixClient
from lsf.media import MediaStore

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def deps(settings, elix_mock):
    engine = make_engine(settings)
    async with httpx.AsyncClient() as http:
        yield ElixClient(http, engine, settings.elix_base), MediaStore(http, settings.media_dir, use_ffmpeg=False)


async def test_picks_the_meaning_matching_the_theme(deps):
    elix, media = deps
    out = await validate_candidate(FakeLLM(), elix, media, ThemeContext("Fruits"), "pomme", "fruit du pommier")
    assert out.accepted
    assert out.meaning.meaning_id == 2
    assert media.video_path(out.media.sha).exists()
    assert media.poster_path(out.media.sha).exists()


async def test_unsigned_word_is_rejected_without_calling_the_llm(deps):
    elix, media = deps
    llm = FakeLLM()
    out = await validate_candidate(llm, elix, media, ThemeContext("Fruits"), "kiwi", "fruit")
    assert not out.accepted
    assert "sans vidéo" in out.reason
    assert llm.tool_calls == 0


async def test_accept_is_refused_without_a_successful_download(deps):
    elix, media = deps
    out = await validate_candidate(FakeLLM(cheat=True), elix, media, ThemeContext("Fruits"), "poire", "fruit")
    assert not out.accepted
    assert "trust me" not in out.reason
    assert not list(media.dir.glob("*.mp4"))


async def test_broken_video_is_rejected(deps):
    elix, media = deps
    out = await validate_candidate(FakeLLM(), elix, media, ThemeContext("Fruits"), "fraise", "fruit")
    assert not out.accepted
    assert "type de contenu" in out.reason


async def test_duplicate_video_in_theme_is_rejected(deps):
    elix, media = deps
    first = await validate_candidate(FakeLLM(), elix, media, ThemeContext("Fruits"), "cerise", "fruit")
    ctx = ThemeContext("Fruits", shas={first.media.sha: "cerise"}, meaning_ids={7})
    out = await validate_candidate(FakeLLM(), elix, media, ctx, "abricot", "fruit")
    assert not out.accepted
    assert "identique" in out.reason
