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

mkdir -p "$out/shots" "$out/videos"
rm -f "$out/marks.json"

docker compose up -d --wait
docker compose --profile e2e run --rm e2e \
  node ../node_modules/@playwright/test/cli.js test \
  --config "/app/$here/capture.config.ts"

for t in register-and-login transfer-with-step-up add-a-second-passkey; do
  cp "$out/test-results/book-$t-chromium/video.webm" "$out/videos/$t.webm"
done

# Cut each GIF from its *-start mark to its *-end mark (seconds from the start
# of the test, written by tests/book.spec.ts). The end mark comes before the
# element screenshot, which would otherwise show up as a scroll at the end.
gif() { # video name start end
  ffmpeg -loglevel error -y -ss "$3" -to "$4" -i "$out/videos/$1.webm" \
    -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
    "$out/shots/$2.gif"
}
mark() { python3 -I -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$out/marks.json" "$1"; }
sub() { python3 -I -c "import sys; print(round(float(sys.argv[1]) + float(sys.argv[2]), 2))" "$1" "$2"; }

gif register-and-login register "$(sub "$(mark register-start)" -0.3)" "$(sub "$(mark register-end)" -0.2)"
gif register-and-login login "$(sub "$(mark login-start)" -0.2)" "$(sub "$(mark login-end)" -0.25)"
gif transfer-with-step-up transfer "$(sub "$(mark transfer-start)" -0.3)" "$(sub "$(mark transfer-end)" -0.25)"

ls -l "$out/shots"
