# M4 Ceremony Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In development, the register/login verify responses (success and 400) carry an `inspection` of the ceremony, and the page shows it.

**Architecture:** `runChecks` reports each check's result through an optional callback. After the checks (and the save) run or throw, `inspect.ts` builds a `CeremonyInspection` from the context. Routes add it to the success body, or put it on `res.locals.inspection` for the error handler. The web page renders it in a new section.

**Tech Stack:** Express 5, zod (shared schemas), vitest, Playwright, plain TS DOM.

**Spec:** `docs/superpowers/specs/2026-11-24-m4-inspection-design.md`

## Global Constraints

- Do not change any check in `server/src/webauthn/checks/`, nor the order or contents of `REGISTRATION_CHECKS` / `AUTHENTICATION_CHECKS`. Existing attack tests must pass unchanged.
- Build the inspection only after the checks have run (C4 must consume the challenge before the lazy decode can throw).
- No `inspection` when `config.nodeEnv === 'production'`.
- Failures before the context exists (zod `invalid_request`, unreadable clientDataJSON) carry no `inspection`.
- All commands via `docker compose run --rm server yarn check`; E2E via `bash scripts/e2e.sh`.
- Docs in Japanese; code comments, commits in English.

## Review Focus

- A response whose attestation object is malformed after C4 passed: the 400 body must still carry `inspection` with `authenticatorData: { error }`, and the inspection builder itself must not throw. Test in Task 2.
- Login where the credential ID is unknown (L1 fails): `storedCredential` absent, L1 `fail`, later checks `not_run`. Test in Task 2.
- A4 thrown from `saveAuthentication` (concurrent login): the 400 body carries `inspection` with every check `pass` and `failure.check === 'A4'`. Covered by asserting the route wraps the save; a unit test of the builder with a `failure` passed in is enough (Task 2).
- Rejected login in the browser: the inspector section shows the rejection, not the previous success. Test in Task 3 (render function test is not available in the web package; E2E covers success only, so keep the render path shared for both outcomes).
- `production` config: no `inspection` key at all in either body. Test in Task 2.

---

### Task 1: Shared schema and `runChecks` callback

**Files:**
- Create: `shared/src/inspection.ts`; Modify: `shared/src/index.ts`, `shared/src/error.ts`, `shared/src/registration.ts` (`RegisterVerifyResponse`), `shared/src/login.ts` (`LoginVerifyResponse`)
- Modify: `server/src/webauthn/pipeline.ts`; Test: `server/test/pipeline.test.ts`

**Interfaces:**
- Produces: `CeremonyInspection` (zod schema + type) exactly as in the spec's 「応答の形」; `CheckResult = 'pass' | 'fail' | 'not_run'`. `inspection: CeremonyInspection.optional()` on `ApiError`, `RegisterVerifyResponse`, `LoginVerifyResponse`. `check.id` typed as `z.string()` in shared (CheckId lives in server).
- Produces: `runChecks<Ctx>(ctx, checks, onResult?: (id: CheckId, result: 'pass' | 'fail') => void): void` — calls `onResult(id, 'pass')` after each check returns, `onResult(id, 'fail')` before rethrowing whatever the check threw (CheckError or ParseError).

- [ ] Step 1: test in `pipeline.test.ts` — `runChecks reports pass for each check and fail for the one that throws`: three fake checks, the second throws; expect calls `[['X1','pass'],['X2','fail']]` and the error rethrown unchanged.
- [ ] Step 2: run `yarn check`, expect the new test to fail.
- [ ] Step 3: implement the callback and the shared schema.
- [ ] Step 4: `yarn check` passes.
- [ ] Step 5: commit `feat: Add inspection schema and check result callback`.

### Task 2: Build the inspection and return it from the routes

**Files:**
- Create: `server/src/webauthn/inspect.ts`; Test: `server/src/routes/inspection.test.ts`
- Modify: `server/src/routes/register.ts`, `server/src/routes/login.ts`, `server/src/http/errors.ts`, `server/test/test-server.ts` (optional `config` parameter, default `TEST_CONFIG`)

**Interfaces:**
- Consumes: `runChecks` callback, `CeremonyInspection` (Task 1).
- Produces:
  - `inspectCeremony(input: { ceremony: 'register' | 'login'; ctx: RegistrationContext | AuthenticationContext; checks: readonly Check<unknown>[]; results: Map<CheckId, 'pass' | 'fail'>; config: Config; failure?: unknown }): CeremonyInspection` — never throws; reads lazy `authData` / `attestedCredentialData` / `credential` inside try and maps a throw to `authenticatorData: { error: message }`. `failure` from a `CheckError` gives `{ check, message }`, from a `ParseError` `{ message }` plus `check` of the check marked `fail`.
  - `runInspected<Ctx>(...)` helper (name free) used by both routes: runs `runChecks` with a results map, then the save; on throw, if `config.nodeEnv !== 'production'` sets `res.locals.inspection = inspectCeremony(...)` and rethrows. On success returns the inspection (or `undefined` in production) to spread into the body.
  - `errorHandler`: for `CheckError` and `ParseError`, adds `inspection: res.locals.inspection` when present.

- [ ] Step 1: tests in `inspection.test.ts` (use `startTestServer`, `Browser`, `SoftAuthenticator` like `login.test.ts`):
  - `successful registration returns every check as pass` — `inspection.ceremony === 'register'`, all 13 `REGISTRATION_CHECKS` ids `pass` in order, `clientData.origin === TEST_CONFIG.rpOrigin`, `authenticatorData.flags.uv === true`, `expected.rpId === TEST_CONFIG.rpId`.
  - `successful login includes the stored credential` — `storedCredential.signCount === 0`, all 13 `AUTHENTICATION_CHECKS` `pass`.
  - `tampered origin fails C3 and stops the pipeline` — login with `{ origin: 'https://evil.example' }`: status 400, `check === 'C3'`, `inspection.clientData.origin === 'https://evil.example'`, `inspection.expected.origin === TEST_CONFIG.rpOrigin`, C3 `fail`, A1…A4 `not_run`, `failure.check === 'C3'`.
  - `unknown credential fails L1 without stored credential` — login with `{ credentialId: randomBytes(32) }`: L1 `fail`, `storedCredential` undefined.
  - `production omits inspection` — `startTestServer(loadConfig({ NODE_ENV: 'production' }))`: success body and a C3 failure body have no `inspection` key.
  - unit test of `inspectCeremony` with a context whose `authData` getter throws `ParseError`: returns `authenticatorData.error`, does not throw; and with `failure: new CheckError('A4', ...)` after all pass: `failure.check === 'A4'`.
- [ ] Step 2: `yarn check`, expect failures.
- [ ] Step 3: implement `inspect.ts`, the route wrapping (save included), the error handler change, the test-server parameter. Hex for hashes, base64url for challenge/credential ID, `clientData.json` = `ctx.clientData.raw.toString('utf8')`.
- [ ] Step 4: `yarn check` passes, including all existing attack tests untouched.
- [ ] Step 5: commit `feat: Return ceremony inspection from verify endpoints`.

### Task 3: Inspector section on the page

**Files:**
- Create: `web/src/inspector.ts`; Modify: `web/index.html`, `web/src/main.ts`, `web/src/style.css`, `web/src/api.ts` (`ApiRequestError.body` already carries `inspection` via the schema)
- Test: `e2e/tests/passkey.spec.ts`

**Interfaces:**
- Consumes: `CeremonyInspection` from `@app/shared`.
- Produces: `showInspection(target: HTMLElement, inspection: CeremonyInspection | undefined): void` — called from every register/login success and failure path in `main.ts` (failure: `err instanceof ApiRequestError ? err.body?.inspection : undefined`; leave the section unchanged when undefined, e.g. user cancelled).

- [ ] Step 1: E2E: in `register()` and after the button login, expect `#inspector` to contain `登録` / `ログイン` and `C4 ✓`, and `UV=1`.
- [ ] Step 2: implement: `<section id="inspector-section"><h2>直近の ceremony</h2><div id="inspector">まだありません</div></section>`; heading line `登録（受理）` / `ログイン（拒否: C3）`; check row `C4 ✓ C2 ✓ … C3 ✗ A1 - …`; a table 期待値/実際 for type, origin, rpIdHash; flags `UP=1 UV=1 BE=1 BS=1 AT=0 ED=0`; `signCount` with `（保存値 N）` on login; raw clientDataJSON in a `<pre>`. Mismatched cells get a class for red. Build DOM with `textContent` only (no innerHTML: values come from the authenticator/browser).
- [ ] Step 3: `yarn check` and `bash scripts/e2e.sh` pass.
- [ ] Step 4: commit `feat: Show the last ceremony inspection on the page`.

### Task 4: Docs and work trace

**Files:** `docs/01-architecture-proposal-poc.md` (API table line for `/api/debug/last-ceremony` → verify responses carry `inspection` in development; §10 tree unchanged), `docs/decisions.md` (D33: option A and why, rejected B/C), `docs/03-hands-on-verification.md` (how to read the section), `docs/worklog/2026-11-24.md`.

- [ ] Step 1: edit docs; run mask check `MASK_PATTERNS="$(cat ~/.config/try-pass-key/mask-patterns)" bash scripts/mask-check.sh`.
- [ ] Step 2: commit `docs: Document ceremony inspection (M4)`; push, open PR to `main` with the clone footer line.
- [ ] Step 3: Zenn draft per CLAUDE.md (worktree on `docs/<slug>` from `origin/develop` in `~/work/zenn-docs`, `published: false`, PR to `develop`). Screenshot of the inspector section if one can be taken with the masking rules.
