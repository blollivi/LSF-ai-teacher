import asyncio
import hashlib
import json
import logging
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

import httpx

from .elix import Sign
from .mp4 import parse_mp4

log = logging.getLogger(__name__)

MIN_BYTES = 10_000
MAX_BYTES = 30_000_000
MIN_DURATION_S = 0.3
MAX_DURATION_S = 15.0


@dataclass
class MediaResult:
    ok: bool
    reason: str = ""
    sha: str = ""
    has_poster: bool = False
    duration_s: float = 0.0


async def _run(*cmd: str) -> tuple[int, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await proc.communicate()
    return proc.returncode or 0, out if proc.returncode == 0 else err


class MediaStore:
    """Downloads Elix sign videos, verifies them and stores them content-addressed (sha256)."""

    def __init__(self, http: httpx.AsyncClient, media_dir: Path, use_ffmpeg: bool | None = None):
        self.http = http
        self.dir = media_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        if use_ffmpeg is None:
            use_ffmpeg = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
        self.use_ffmpeg = use_ffmpeg

    def video_path(self, sha: str) -> Path:
        return self.dir / f"{sha}.mp4"

    def poster_path(self, sha: str) -> Path:
        return self.dir / f"{sha}.jpg"

    async def fetch_sign(self, sign: Sign) -> MediaResult:
        try:
            r = await self.http.get(sign.uri, timeout=60, follow_redirects=True)
        except httpx.HTTPError as e:
            return MediaResult(False, f"téléchargement impossible : {e.__class__.__name__}")
        if r.status_code != 200:
            return MediaResult(False, f"HTTP {r.status_code} sur la vidéo")
        ctype = r.headers.get("content-type", "")
        if not (ctype.startswith("video/") or ctype.startswith("application/octet-stream")):
            return MediaResult(False, f"type de contenu inattendu : {ctype or 'absent'}")
        data = r.content
        if not MIN_BYTES <= len(data) <= MAX_BYTES:
            return MediaResult(False, f"taille de vidéo suspecte : {len(data)} octets")
        info = parse_mp4(data)
        if info is None:
            return MediaResult(False, "fichier MP4 invalide")
        if not info.has_video_track:
            return MediaResult(False, "aucune piste vidéo")
        if not MIN_DURATION_S <= info.duration_s <= MAX_DURATION_S:
            return MediaResult(False, f"durée anormale : {info.duration_s:.1f}s")

        sha = hashlib.sha256(data).hexdigest()[:32]
        dest = self.video_path(sha)
        if not dest.exists():
            reason = await self._store(data, dest)
            if reason:
                return MediaResult(False, reason)
        has_poster = self.poster_path(sha).exists() or await self._fetch_poster(sign, sha)
        return MediaResult(True, sha=sha, has_poster=has_poster, duration_s=info.duration_s)

    async def _store(self, data: bytes, dest: Path) -> str:
        if not self.use_ffmpeg:
            dest.write_bytes(data)
            return ""
        with tempfile.TemporaryDirectory(dir=self.dir) as tmp:
            src = Path(tmp) / "src.mp4"
            out = Path(tmp) / "out.mp4"
            src.write_bytes(data)
            code, probe = await _run(
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=codec_name,width,height", "-of", "json", str(src),
            )
            if code != 0 or not json.loads(probe or b"{}").get("streams"):
                return "ffprobe : flux vidéo illisible"
            # Elix videos are ~5 MB of 1080p; a muted 480p H.264 keeps the hands readable at a fraction of the size.
            code, err = await _run(
                "ffmpeg", "-y", "-v", "error", "-i", str(src), "-an",
                "-vf", "scale=-2:'min(480,ih)'", "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out),
            )
            if code != 0 or parse_mp4(out.read_bytes() if out.exists() else b"") is None:
                log.warning("transcode failed, keeping original: %s", err[-300:])
                shutil.move(src, dest)
            else:
                shutil.move(out, dest)
        return ""

    async def _fetch_poster(self, sign: Sign, sha: str) -> bool:
        if not sign.image:
            return False
        try:
            r = await self.http.get(sign.image, timeout=30, follow_redirects=True)
        except httpx.HTTPError:
            return False
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
            return False
        self.poster_path(sha).write_bytes(r.content)
        return True
