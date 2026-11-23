# CLAUDE.md

A PoC for understanding authentication by implementing passkeys (WebAuthn) by hand.

Documents under `docs/` are written in Japanese. Respond to the user in Japanese.

## Documents

| File | Content |
|---|---|
| `README.md` | Entry point. Keep it short and link into `docs/` instead of duplicating |
| `docs/00-background.md` | Background and motivation |
| `docs/01-architecture-proposal-poc.md` | Architecture proposal. Architecture content only |
| `docs/02-knowledge-passkey.md` | Research notes. Anything that is not architecture goes here |
| `docs/decisions.md` | Decision log. Add a row whenever a design decision is made |
| `docs/worklog/YYYY-MM-DD.md` | Daily work log (done / insights / issues / next) |

## Leaving a work trace

- At each checkpoint, write the day's log in `docs/worklog/`. Append if the file for that date already exists.
- When a design decision is made, add one row to `docs/decisions.md`. Never delete rows; record reversals as new rows.
- At milestones (e.g. a milestone in `docs/01` §11 is done), draft a Zenn article in `~/work/zenn-docs`:
  - Create a worktree on a `docs/<slug>` branch from `origin/develop`, so the user's in-progress files are left untouched.
  - Add `articles/YYYYMM-<slug>.md` with `published: false`. Put images in `images/<slug>/`.
  - Commits and PR titles/bodies in English; article body in Japanese.
  - Open a PR to `develop`. Merging and publishing are the user's call.

## Masking (everything that goes to Git or Zenn)

This repository is public.

- No personal names, email addresses, home directory paths (`/Users/<name>/`), or GitHub account names. Write paths as `~/`.
- Replace names of organizations and related parties with generic terms (e.g. "a company", "an open-source project").
- Do not reveal which projects this repository was modeled on (no repo URLs, names, or "same as X" remarks). Justify choices on their own merits.
- Product names (1Password, iCloud, Chrome, etc.) are fine.
- In screenshots, hide browser profile names and avatars, real accounts shown in password manager lists, and tunnel URLs (ngrok etc.).
- Use test display names such as `test-user-1` for PoC users.
- Before committing, run `MASK_PATTERNS="$(cat ~/.config/try-pass-key/mask-patterns)" bash scripts/mask-check.sh`. CI runs the same check with the `MASK_PATTERNS` secret.
  - The pattern file lives outside the repository and contains personal information. Never print it (`cat` to the conversation, logs, commits) or pass its values as command arguments.
  - If the file is missing (other machine, cloud session), run the script without `MASK_PATTERNS` and also grep manually for personal names; tell the user the private patterns were not checked.

## Invariants (once implementation starts)

- Do not remove any server-side check in `docs/01` §6. Never delete or skip the corresponding attack-reproduction tests.
- Run every command through `docker compose`. Do not install dependencies on the host.
