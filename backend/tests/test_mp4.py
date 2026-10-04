from conftest import fake_mp4

from lsf.mp4 import parse_mp4


def test_parses_duration_and_video_track():
    info = parse_mp4(fake_mp4("x", duration_ms=4320))
    assert info is not None
    assert info.duration_s == 4.32
    assert info.has_video_track


def test_rejects_non_mp4():
    assert parse_mp4(b"<html>Not Found</html>") is None
    assert parse_mp4(b"") is None
