"""Minimal ISO-BMFF reader: enough to tell a real, playable-looking MP4 from garbage
without depending on ffprobe (which is used on top of it when available)."""

from dataclasses import dataclass

_CONTAINERS = {b"moov", b"trak", b"mdia"}


@dataclass
class Mp4Info:
    duration_s: float
    has_video_track: bool


def _boxes(data: bytes, start: int, end: int):
    i = start
    while i + 8 <= end:
        size = int.from_bytes(data[i : i + 4], "big")
        kind = data[i + 4 : i + 8]
        header = 8
        if size == 1:
            if i + 16 > end:
                return
            size = int.from_bytes(data[i + 8 : i + 16], "big")
            header = 16
        elif size == 0:
            size = end - i
        if size < header or i + size > end:
            return
        yield kind, i + header, i + size
        i += size


def parse_mp4(data: bytes) -> Mp4Info | None:
    top = list(_boxes(data, 0, len(data)))
    if not top or top[0][0] != b"ftyp":
        return None
    duration: float | None = None
    has_video = False

    def walk(start: int, end: int):
        nonlocal duration, has_video
        for kind, body, box_end in _boxes(data, start, end):
            if kind in _CONTAINERS:
                walk(body, box_end)
            elif kind == b"mvhd" and box_end - body >= 20:
                version = data[body]
                if version == 1 and box_end - body >= 32:
                    timescale = int.from_bytes(data[body + 20 : body + 24], "big")
                    dur = int.from_bytes(data[body + 24 : body + 32], "big")
                else:
                    timescale = int.from_bytes(data[body + 12 : body + 16], "big")
                    dur = int.from_bytes(data[body + 16 : body + 20], "big")
                if timescale:
                    duration = dur / timescale
            elif kind == b"hdlr" and box_end - body >= 12:
                if data[body + 8 : body + 12] == b"vide":
                    has_video = True

    for kind, body, box_end in top:
        if kind == b"moov":
            walk(body, box_end)
    if duration is None:
        return None
    return Mp4Info(duration_s=duration, has_video_track=has_video)
