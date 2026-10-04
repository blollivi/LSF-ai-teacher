FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
ENV DATA_DIR=/data PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "lsf.app:app", "--host", "0.0.0.0", "--port", "8000"]
