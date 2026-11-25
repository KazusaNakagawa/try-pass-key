#!/usr/bin/env bash
# Records the Zenn book captures (screenshots, videos) with Playwright and the
# virtual authenticator, on a throwaway stack like scripts/e2e.sh: its own
# compose project, volumes and port. The development DB is never touched.
# Then cuts GIFs out of the videos with the host's ffmpeg.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
here=e2e/capture
out=.local-docs/playwright-capture/output

export COMPOSE_PROJECT_NAME=try-pass-key-capture
export WEB_PORT="${CAPTURE_WEB_PORT:-5198}"
export RP_ID=localhost
export RP_ORIGIN="http://localhost:${WEB_PORT}"

cleanup() {
  docker compose --profile e2e down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Start from an empty output, so nothing from an earlier run (recordings,
# clips) can be picked up. The directory is git-ignored and only holds outputs.
rm -rf "$out"
mkdir -p "$out/shots" "$out/videos"

docker compose up -d --wait
docker compose --profile e2e run --rm e2e \
  node ../node_modules/@playwright/test/cli.js test \
  --config "/app/$here/capture.config.ts"

# tests/book.spec.ts writes each clip's video path (inside the container) and
# its start and end in seconds. The end comes before the element screenshot,
# which would otherwise show up as a scroll at the end of the GIF.
clip() { # name start-offset end-offset -> "video start end"
  python3 -I - "$out/marks.json" "$1" "$2" "$3" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))[sys.argv[2]]
start = max(0.0, c["start"] + float(sys.argv[3]))
print(c["video"].removeprefix("/app/"), round(start, 2), round(c["end"] + float(sys.argv[4]), 2))
PY
}
gif() { # name start-offset end-offset
  local video start end
  read -r video start end < <(clip "$1" "$2" "$3")
  cp "$video" "$out/videos/$1.webm"
  ffmpeg -loglevel error -y -ss "$start" -to "$end" -i "$out/videos/$1.webm" \
    -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
    "$out/shots/$1.gif"
}

gif register -0.3 -0.2
gif login -0.2 -0.25
gif transfer -0.3 -0.25

ls -l "$out/shots"
