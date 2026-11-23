# Development image shared by the deps, server and web services.
# Source code is bind-mounted at /app; node_modules lives in a named volume.
FROM node:26.13.1-slim

# sqlite3 CLI: lets you inspect the DB with `docker compose exec server sqlite3 /data/app.db`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 \
  && rm -rf /var/lib/apt/lists/*

# Node 25+ no longer bundles corepack. Install it and pre-fetch the Yarn version
# named in package.json's "packageManager" (the single source of truth), so that
# `docker compose run --rm ...` does not download Yarn on every run.
# After bumping packageManager, run `docker compose build`.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@0.36.0 && corepack enable
COPY package.json /tmp/package-manager/package.json
RUN cd /tmp/package-manager && corepack install && yarn --version

WORKDIR /app
