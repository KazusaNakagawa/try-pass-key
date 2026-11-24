# M5 Differential Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A test feeds the valid responses and every §6 attack response to both our pipeline and `@simplewebauthn/server`, and pins each verdict, with a reason wherever they differ.

**Architecture:** One test file, `server/test/differential.test.ts`, holds one table of cases. Each case builds a response JSON with the existing harnesses (the same tampering as the attack scenarios), runs our full pipeline on it, calls the library's verify function with the values a normal app would pass, and compares both verdicts with the expected ones. A coverage test makes every check ID appear in the table.

**Tech Stack:** vitest, `@simplewebauthn/server@14.1.0` (devDependency of `@app/server`), existing `RegistrationHarness` / `LoginHarness` / `SoftAuthenticator`.

**Spec:** `docs/superpowers/specs/2026-11-24-m5-differential-design.md`

## Global Constraints

- Do not change any file in `server/src/webauthn/checks/`, the pipeline constants, `server/test/attacks.test.ts` or `server/test/login-attacks.test.ts`.
- `@simplewebauthn/server` only in tests; exact version `14.1.0`, added with `docker compose run --rm server yarn workspace @app/server add -D @simplewebauthn/server@14.1.0`.
- Library inputs: `expectedChallenge` = the challenge in the options issued to that browser; `expectedOrigin` = `config.rpOrigin`; `expectedRPID` = `config.rpId`; `requireUserVerification: true`; registration `supportedAlgorithmIDs` = the `alg` values in the options' `pubKeyCredParams`; login `credential` = `{ id, publicKey, counter }` from `ctx.credential` (the DB row the response's credential ID finds). When `ctx.credential` is undefined the library is not called (`not_called`).
- Library verdict: `verified: true` → `accept`; `verified: false` or a throw → `reject`.
- The expected-category column in the spec is a forecast. Where a run disagrees, set the case to the observed verdict and ledger a ruling; never change a check to make a case agree.
- Commands via `docker compose run --rm server yarn check`. Docs in Japanese; code and commits in English.

## Review Focus

- A case whose library call throws for an unrelated reason (wrong input shape, e.g. passing a Buffer where base64url is expected) would read as `reject` and fake a match. Each `reject` case must be one where the library's error message names the same concern; assert a message fragment for every library `reject` (Task 1, Task 2).
- The valid cases must be `accept` on both sides; otherwise every `reject` match is meaningless. Valid registration and valid login are the first rows (Task 1, Task 2).
- Multi-step cases (C4 replay, R2 re-registration) must compare the second attempt, after the first went through the real pipeline and save (Task 1, Task 2).
- L1: the library is never handed a made-up credential (Task 2).

---

### Task 1: Dependency, case table, registration cases

**Files:**
- Modify: `server/package.json`, `yarn.lock` (via `yarn workspace add`)
- Create: `server/test/differential.test.ts`

**Interfaces:**
- Produces, inside the test file:
  ```ts
  type Verdict = 'accept' | CheckId;                       // ours: accepted, or the check that rejected
  type LibraryVerdict = 'accept' | 'reject' | 'not_called';
  type Category = 'match' | 'app' | 'library_skips' | 'not_compared';
  interface Case {
    ceremony: 'register' | 'login';
    check: CheckId | null;                 // null for a valid response
    name: string;
    ours: Verdict;
    library: LibraryVerdict;
    /** Fragment of the library's error message, required when library === 'reject'. */
    libraryError?: string;
    category: Category;
    /** One line, required unless category === 'match'. */
    reason?: string;
    run(): Promise<{ ours: Verdict; library: LibraryVerdict; libraryError?: string }>;
  }
  ```
  `ours` runs the full constant pipeline with `runChecks` and maps a `CheckError` to its `check`.

- [ ] Step 1: add the dependency; `yarn check` still passes.
- [ ] Step 2: write the table with the registration rows and the tests `describe.each(cases)('$ceremony $name')`: `ours` equals the expected `ours`; `library` equals the expected `library`; for `reject`, the error contains `libraryError`. Registration rows (forecast):

  | check | attack (same as attacks.test.ts) | ours | library | category |
  |---|---|---|---|---|
  | null | valid response | accept | accept | match |
  | C1 | `type: 'webauthn.get'` | C1 | reject | match |
  | C2 | clock +10 min | C2 | accept | app |
  | C3 | `origin: 'https://evil.example'` | C3 | reject | match |
  | C3 | `crossOrigin: true` | C3 | accept | library_skips |
  | C4 | second response to the same challenge | C2 | accept | app |
  | C5 | victim's response with attacker's ceremony ID | C5 | accept | app |
  | A1 | `rpId: 'evil.example'` | A1 | reject | match |
  | A2 | `flags.up = false` | A2 | reject | match |
  | A3 | `flags.uv = false` | A3 | reject | match |
  | R1 | `SoftAuthenticator({ alg: -8 })` | R1 | reject | match |
  | R2 | same authenticator registers twice | R2 | accept | app |
  | R3 | `flags: { be: false, bs: true }` | R3 | reject | match |
  | R4 | `credentialIdLength: 1024` | R4 | accept | library_skips |
  | R5 | RSA 1024-bit, e = 3 | R5 | accept | library_skips |

- [ ] Step 3: run `yarn check`; the new rows run (they are the test). Any row whose observed verdict differs from the forecast: fix the row to the observation, add `reason`, ledger `Ruling:`.
- [ ] Step 4: add `it('has a row for every registration check')`: the set of non-null `check` values of register rows equals `REGISTRATION_CHECKS` ids.
- [ ] Step 5: `yarn check` passes; commit `test: Compare registration verdicts with @simplewebauthn/server`.

### Task 2: Login cases

**Files:** Modify `server/test/differential.test.ts`.

**Interfaces:** Consumes `Case` from Task 1.

- [ ] Step 1: login rows (forecast), same tampering as `login-attacks.test.ts`:

  | check | attack | ours | library | category |
  |---|---|---|---|---|
  | null | valid response | accept | accept | match |
  | C1 | `type: 'webauthn.create'` | C1 | reject | match |
  | C2 | clock +10 min | C2 | accept | app |
  | C3 | phishing origin | C3 | reject | match |
  | C3 | `crossOrigin: true` without `topOrigin` | C3 | accept | library_skips |
  | C4 | replayed response | C2 | accept | app |
  | C5 | attacker's ceremony ID | C5 | accept | app |
  | A1 | `rpId: 'evil.example'` | A1 | reject | match |
  | A2 | `flags.up = false` | A2 | reject | match |
  | A3 | `flags.uv = false` | A3 | reject | match |
  | L1 | unknown credential ID | L1 | not_called | not_compared |
  | L2 | attacker's key, victim's userHandle | L2 | accept | app |
  | L3 | signed with another key | L3 | reject | match |
  | L4 | registered BE=0, asserts BE=1 BS=1 | L4 | accept | library_skips |
  | A4 | stored 5, asserted 5 | A4 | reject | match |

- [ ] Step 2: `yarn check`; reconcile any row as in Task 1 Step 3.
- [ ] Step 3: coverage test for `AUTHENTICATION_CHECKS`.
- [ ] Step 4: `yarn check` passes; commit `test: Compare login verdicts with @simplewebauthn/server`.

### Task 3: Docs and work trace

**Files:** `docs/01-architecture-proposal-poc.md` (§6: a subsection "ライブラリとの比較" with the observed table grouped by category, and §11 M5 unchanged), `docs/decisions.md` (D35: approach A and the library-input rule), `docs/worklog/2026-11-24.md`, `server/src/webauthn/CLAUDE.md` (mention `test/differential.test.ts` next to the `@simplewebauthn/server` line).

- [ ] Step 1: edit docs; mask check `MASK_PATTERNS="$(cat ~/.config/try-pass-key/mask-patterns)" bash scripts/mask-check.sh`.
- [ ] Step 2: commit `docs: Document the differential test (M5)`; push; PR to `main` ending with the clone footer line.
- [ ] Step 3: Zenn draft per CLAUDE.md (worktree from `origin/develop`, `published: false`, PR to `develop`).
