#!/usr/bin/env bash
# Masking check for a public repository.
# Fails if tracked files contain home directory paths or email addresses.
#
# Extra patterns (personal names, account names) must not be written in this
# public repository. Pass them via the MASK_PATTERNS environment variable
# (one extended regex per line). In CI it comes from a repository secret.
#
# Only "file:line" is printed for matches, never the matched text, so that
# secret patterns do not leak into public CI logs.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Generic patterns that are safe to publish.
generic_patterns=(
  '/Users/[A-Za-z0-9._-]+/'                                # macOS home directory
  '/home/[A-Za-z0-9._-]+/'                                 # Linux home directory
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'          # email address
)

# Emails allowed to appear (e.g. commit attribution examples).
allowed_emails='noreply@anthropic\.com|noreply@github\.com'

# Works with bash 3.2 (macOS default), so no mapfile.
files=()
while IFS= read -r f; do
  files+=("$f")
done < <(git ls-files -- ':!:scripts/mask-check.sh')

status=0

check() {
  local label="$1" pattern="$2" hits
  hits="$(grep -nIE -- "$pattern" "${files[@]}" 2>/dev/null \
    | grep -vE -- "$allowed_emails" \
    | cut -d: -f1,2 || true)"
  if [[ -n "$hits" ]]; then
    echo "::error::mask-check: ${label} matched at:"
    echo "$hits"
    status=1
  fi
}

for p in "${generic_patterns[@]}"; do
  check "generic pattern" "$p"
done

if [[ -n "${MASK_PATTERNS:-}" ]]; then
  i=0
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    i=$((i + 1))
    check "private pattern #${i}" "$p"
  done <<< "$MASK_PATTERNS"
else
  echo "mask-check: MASK_PATTERNS is not set; checked generic patterns only."
fi

if [[ $status -eq 0 ]]; then
  echo "mask-check: OK (${#files[@]} files)"
fi
exit $status
