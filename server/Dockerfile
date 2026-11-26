# Spiti link server: yt-dlp + FFmpeg behind a small HTTP API for the web app.
#   docker build -t spiti-link-server server
#   docker run -d -p 8787:8787 -e ACCESS_TOKEN=change-me -e ALLOWED_ORIGINS=https://your-app.pages.dev spiti-link-server
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# yt-dlp's official standalone build; the server updates it daily (yt-dlp -U).
RUN mkdir -p /app/bin /data \
 && curl -fsSL -o /app/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
 && chmod +x /app/bin/yt-dlp \
 && chown -R node:node /app /data

COPY --chown=node:node server.mjs ./
USER node

ENV PORT=8787 \
    YTDLP=/app/bin/yt-dlp \
    FFMPEG=ffmpeg \
    DATA_DIR=/data
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s CMD curl -fs http://localhost:8787/health || exit 1
CMD ["node", "server.mjs"]
