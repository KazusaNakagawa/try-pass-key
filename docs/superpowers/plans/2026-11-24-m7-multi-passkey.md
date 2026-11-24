# M7 複数パスキー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログイン中のユーザーがパスキーを一覧・追加・削除でき、追加と削除はどちらもステップアップの承認がなければ通らない。

**Architecture:** ステップアップで承認する対象を「操作」（`transfer` / `add_credential` / `delete_credential`）の共用体に一般化し、操作ごとのハッシュを challenge の行とセッションに記録する。送金のゲート（S3 → S2）を `OPERATION_GATE_CHECKS` として、送金・追加の verify・削除で共有する。追加は purpose `add_credential` の登録 ceremony で、challenge はセッションに縛り（C5）、鍵は行の `user_id` に保存する。

**Tech Stack:** TypeScript、Express、node:sqlite、zod（`@app/shared`）、vitest、Playwright（仮想認証器、CDP）、`@simplewebauthn/browser`

**Spec:** `docs/superpowers/specs/2026-11-24-m7-multi-passkey-design.md`

## Global Constraints

- コマンドはすべて `docker compose` 経由。各タスクの完了条件は `docker compose run --rm server yarn check` が通ること。E2E は `bash scripts/e2e.sh`（開発スタックに対して e2e サービスを動かさない）
- 既存の検証項目（C1〜L4、S1〜S3）と既存の攻撃テストを消さない・弱めない。テストファイルの改名は `git mv` で行い、シナリオは1つも減らさない。検証を飛ばすフラグや引数を本番コードに入れない（`server/src/webauthn/CLAUDE.md`）
- route は検証項目のリストを渡さない。`runInspected({ ceremony })` と `runOperationGate(ctx)` が凍結した定数を選ぶ
- 操作ハッシュ: `base64url(SHA-256(JSON.stringify(canonical)))`。canonical はキーをこの順で組み立てる: transfer `{ kind, to, amount }`（M6 の値と一致）、add_credential `{ kind }`、delete_credential `{ kind, credentialId }`
- `STEPUP_TTL_MS = 5 * 60 * 1000` は変えない。承認は1つのセッションに1つ（`approved_tx_hash`）で、別の操作のステップアップで上書きされる
- エラーコード: S2・S3 → `step_up_required`（401、既存）。他人の・存在しない credential → `credential_not_found`（404）。最後の1本 → `last_credential`（409）
- `SCHEMA_VERSION` を 4 に上げる（Task 2）。開発 DB は `docker compose down -v` で作り直す
- コミットは英語、ドキュメントは日本語。マスキング（CLAUDE.md）を守る。テストの表示名は `test-user-1` 形式。コミット前に `MASK_PATTERNS="$(cat ~/.config/try-pass-key/mask-patterns)" bash scripts/mask-check.sh`（パターンを出力しない）
- 作業ブランチは `feat/m7-multi-passkey`（main から）
- Rancher Desktop のファイル共有の遅れで、書き込み直後の `yarn check` が古い内容を見ることがある。再実行で確かめる

## Review Focus

1. 認証器でパスキーを作れたのに verify が拒否される（承認の期限切れなど）→ 認証器にだけ鍵が残る。画面は「承認から 4分30秒以内なら再利用、それを過ぎたらステップアップからやり直す」で作成前に防ぎ、残ったものは Signal API で知らせる。web と shared には単体テストの環境がない（vitest は server だけ）。そのため Task 4 の E2E で「4分30秒以内なら再利用する」側だけを固定し、期限の境界はコードレビューで見る
2. 作成ダイアログのキャンセル、`InvalidStateError`（`excludeCredentials` に当たった）→ 承認は残り、やり直しでステップアップを求めない。Task 3 の route テストと Task 4 の E2E で固定する
3. ログインに使ったパスキー自身を削除する → 削除でき、今のセッションは続く（`/api/me` が 200）。Task 3 のテストで固定する
4. 形式違反の credential ID（base64url でない）を削除やステップアップに渡す → 400 `invalid_request` で、承認は消費されない。Task 3 のテストで固定する
5. 2本ある状態で2本とも同時に削除する → 1本は必ず残る。Task 3 の `deleteCredentialUnlessLast` のテストで固定する

---

### Task 1: 操作の共用体、操作ハッシュ、ゲートの一般化

**Files:**
- Create: `shared/src/stepup.ts`（`StepupOperation`。`StepupOptionsResponse` / `StepupVerifyResponse` を `transfer.ts` から移す）
- Modify: `shared/src/transfer.ts`、`shared/src/index.ts`
- Create: `server/src/operations/operation-hash.ts`、`server/src/operations/operation-hash.test.ts`
- Create: `server/src/operations/gate.ts`（`buildOperationGateContext`。`transfer.ts` の `readApproval` / `clearApproval` を移す）
- Delete: `server/src/transfer/tx-hash.ts`、`server/src/transfer/tx-hash.test.ts`
- Modify: `server/src/transfer/transfer.ts`（`buildTransferContext` を削除）、`server/src/routes/transfer.ts`、`server/src/routes/stepup.ts`
- Modify: `server/src/webauthn/checks/types.ts`（`TransferApproval` → `StepupApproval`、`TransferContext` → `OperationGateContext`。フィールド名 `txHash` はそのまま）、`checks/S2.ts`・`checks/S3.ts`（文言を「操作」に。判定は変えない）、`pipeline.ts`（`OPERATION_GATE_CHECKS`、`runOperationGate`）
- Rename: `server/test/transfer-gate-attacks.test.ts` → `server/test/operation-gate-attacks.test.ts`、`server/test/transfer-harness.ts` → `server/test/operation-gate-harness.ts`
- Modify: `server/test/api-helpers.ts`（`stepUp` の第2引数を `StepupOperation` に）、`server/src/routes/stepup.test.ts`・`transfer.test.ts` と、`stepUp` / `transferTxHash` を使う既存テスト、`web/src/transfer.ts`

**Interfaces:**
- Produces（`@app/shared`）: `StepupOperation = z.discriminatedUnion('kind', [TransferRequest.extend({ kind: z.literal('transfer') }), z.object({ kind: z.literal('add_credential') }), z.object({ kind: z.literal('delete_credential'), credentialId: Base64Url.min(1) })])`
- Produces（server）:
  - `operationHash(op: StepupOperation): string`
  - `buildOperationGateContext(deps: { db: DatabaseSync; now: () => Date }, input: { sessionId: string; op: StepupOperation }): OperationGateContext`
  - `OPERATION_GATE_CHECKS: readonly Check<OperationGateContext>[]`（`[S3, S2]`）、`runOperationGate(ctx: OperationGateContext): void`
  - テスト用: `OperationGateHarness`（`approve(op: StepupOperation)`、`context(op: StepupOperation)`。今の `TransferHarness` と同じ作り）
  - `stepUp(user: ApiUser, op: StepupOperation, overrides?, signer?)`

- [ ] **Step 1: 失敗するテストを書く**
  - `operation-hash.test.ts`: transfer の値が `createHash('sha256').update('{"kind":"transfer","to":"test-account-1","amount":1000}').digest('base64url')` と一致（M6 と同じ）、キーの順序が違っても同じ、`add_credential` と `delete_credential` は互いに違い、transfer とも違う、`credentialId` が違うと違う
  - `operation-gate-attacks.test.ts`: 既存の4シナリオを `{ kind: 'transfer', ... }` で残し、次を足す
    - S2「送金の承認でパスキーを削除する」: `approve(transfer)` → `context(delete X)` → 完全なゲートでは S2、S2 を外すと通る
    - S2「鍵 X の削除の承認で鍵 Y を削除する」: 同上の形
    - S3「追加の承認1回で2本追加する」: `approve(add)` → `context(add)` を2回 → 2回目が S3、S3 を外すと通る
    - S3「ステップアップなしで追加する」: `withoutCheckRejectedBy: 'S2'`（既存の送金シナリオと同じ）
    - 正常系「削除の承認で同じ鍵を削除できる」「追加の承認で追加できる」
- [ ] **Step 2: 失敗を確かめる** — `docker compose run --rm server yarn check` → `operation-hash.js` などのインポートエラーで FAIL
- [ ] **Step 3: 実装する**
  - Interfaces どおり。`/api/transfer` は本文を `TransferRequest` で読み、`{ kind: 'transfer', ...tx }` を操作としてゲートに渡す
  - `/api/stepup/options` は本文を `StepupOperation` で読み、challenge の行には `operationHash(op)` を保存する。事前確認は、`transfer` が今の残高確認、`add_credential` はなし。`delete_credential` は Task 3 で足すので、この時点ではなし
  - `web/src/transfer.ts` は `/api/stepup/options` に `{ kind: 'transfer', ...tx }` を送る
- [ ] **Step 4: 通ることを確かめる** — `yarn check` が PASS。`git grep -n "transferTxHash\|TRANSFER_GATE\|TransferContext\|TransferApproval"` がコード上で0件（docs は Task 5）
- [ ] **Step 5: コミット** — `refactor: Generalize step-up approvals to operations with a kind`

### Task 2: 追加の登録 ceremony（スキーマ版 4、C5 の一般化、攻撃再現）

**Files:**
- Modify: `server/src/db.ts`（purpose の CHECK に `'add_credential'`、`CHECK (purpose <> 'add_credential' OR (user_id IS NOT NULL AND session_id IS NOT NULL))`、`SCHEMA_VERSION = 4`、`session_id` のコメントを「stepup / add_credential」に）
- Modify: `server/src/webauthn/checks/types.ts`（`ChallengePurpose` に `'add_credential'`。`sessionUserId` / `sessionId` のコメントを広げる）、`server/src/webauthn/challenges.ts`（`ChallengeInput` に `{ purpose: 'add_credential'; userId: string; sessionId: string }`）
- Modify: `server/src/webauthn/checks/C5.ts`、`checks/C5.test.ts`
- Modify: `server/src/webauthn/registration.ts`（context の組み立てと credential の INSERT を、追加と共有できる内部関数に切り出す。新規登録の挙動は変えない）
- Create: `server/src/webauthn/add-credential.ts`、`server/src/webauthn/add-credential.test.ts`
- Create: `server/test/add-credential-harness.ts`、`server/test/add-credential-attacks.test.ts`
- Modify: `server/src/db.test.ts`（スキーマ版や CHECK 制約を見ているテストがあれば合わせる）

**Interfaces:**
- Consumes: なし（Task 1 とは独立）
- Produces:
  - `SESSION_BOUND_PURPOSES: readonly ChallengePurpose[] = ['stepup', 'add_credential']`（`C5.ts` から export）
  - `createAddCredentialOptions(deps: RegistrationDeps, input: { userId: string; sessionId: string }): RegisterOptionsResponse` — `user.id` = 既存の `user_handle`、`user.name` / `displayName` = 既存の `display_name`、`excludeCredentials` = そのユーザーの credential（`created_at` 順、`{ type: 'public-key', id, transports }`）。ほかは新規登録と同じ
  - `buildAddCredentialContext(deps: RegistrationDeps, input: { response: RegistrationResponse; sessionUserId: string; sessionId: string }): RegistrationContext` — `expected.purpose = 'add_credential'`、`ceremonyId: undefined`
  - `saveAddedCredential(deps: RegistrationDeps, ctx: RegistrationContext, transports: readonly Transport[]): { userId: string; credential: { id: string; backupEligible: boolean; backupState: boolean; transports: Transport[] } }` — 行の `userId` のユーザーに INSERT する。行に `userId` がなければ `Error`（C2 が通っていれば起きない）
  - `AddCredentialHarness`: 被害者（credential 1本、セッション `session-of-victim`）と攻撃者（別ユーザー、credential 1本、セッション `session-of-attacker`）を DB に用意する。`begin(user)`、`respond(begun, authenticator)`、`context(response, { sessionUserId, sessionId })`

- [ ] **Step 1: 失敗するテストを書く**
  - `C5.test.ts`: purpose `add_credential` で、行の `session_id` と送信したセッションが一致すれば通り、違えば `challenge was issued to another session`、セッションがなければ `no session`
  - `add-credential.test.ts`: options の `user.id` が既存の `user_handle`、`excludeCredentials` に既存の鍵が入る、行に `user_id`・`session_id` が保存され purpose が `add_credential`。正当な応答が `REGISTRATION_CHECKS` をすべて通り、`saveAddedCredential` で credential が被害者に2本目として入り、`users` の行数は変わらない。`add_credential` の行を `user_id` なしで INSERT すると CHECK 制約で失敗する
  - `add-credential-attacks.test.ts`（`attacks.test.ts` と同じ「完全なパイプラインでは X、X を外すと通る（または Y）」の形。`withoutCheckRejectedBy` は `server/src/webauthn/CLAUDE.md` の条件に従う）
    - C5: 被害者のセッションに発行された追加の challenge に、攻撃者が自分の `SoftAuthenticator` で答え、`{ sessionUserId: attacker, sessionId: session-of-attacker }` で検証する → C5。C5 を外すと通り、続けて `saveAddedCredential` を呼ぶと、攻撃者の鍵が**被害者**の `user_id` で保存されていることも同じテストで確かめる
    - C2: 新規登録（`createRegistrationOptions`）の challenge に答えた応答を、追加の context で検証する → C2。C2 を外すと C5（行に `session_id` がない）
    - C2: 追加の challenge に答えた応答を、新規登録の context（`buildRegistrationContext`、`ceremonyId` に行の ID）で検証する → C2。C2 を外したときの結果は、テストを走らせて確かめ、`withoutCheckRejectedBy` に書く。通ってしまう場合は止めて報告する
    - R2: 攻撃者の既存 credential ID を、被害者の追加で登録し直す → R2。R2 を外すと通る
- [ ] **Step 2: 失敗を確かめる** — `yarn check` → `add-credential.js` のインポートエラーと C5 のテストで FAIL
- [ ] **Step 3: 実装する** — Interfaces どおり。C5 は `SESSION_BOUND_PURPOSES.includes(ctx.expected.purpose)` で分岐し、文言を「ログイン中の ceremony はセッションで縛る」に直す
- [ ] **Step 4: 通ることを確かめる** — `yarn check` が PASS
- [ ] **Step 5: コミット** — `feat: Add the add-credential registration ceremony bound to the session`

### Task 3: パスキーの API（一覧・追加・削除）と「直近の ceremony」

**Files:**
- Create: `shared/src/credentials.ts`、Modify: `shared/src/index.ts`、`shared/src/inspection.ts`（`ceremony` に `'add_credential'`）
- Create: `server/src/credentials/credentials.ts`、`server/src/credentials/credentials.test.ts`
- Create: `server/src/routes/credentials.ts`、`server/src/routes/credentials.test.ts`
- Modify: `server/src/app.ts`（`credentialRoutes` を登録）、`server/src/routes/stepup.ts`（削除の事前確認）、`server/src/routes/inspected.ts`（`{ ceremony: 'add_credential'; ctx: RegistrationContext }`、`CHECKS.add_credential = REGISTRATION_CHECKS`）、`server/src/webauthn/inspect.ts`（`ceremony === 'register'` の分岐を、`add_credential` も含む判定にする）
- Modify: `server/test/api-helpers.ts`（`addCredential`、`deleteCredential` のヘルパー）

**Interfaces:**
- Consumes: Task 1 の `StepupOperation`、`buildOperationGateContext`、`runOperationGate`、`stepUp`。Task 2 の `createAddCredentialOptions`、`buildAddCredentialContext`、`saveAddedCredential`
- Produces（`@app/shared`）:
  - `CredentialSummary = z.object({ id: Base64Url, createdAt: z.string(), lastUsedAt: z.string().nullable(), backupEligible: z.boolean(), backupState: z.boolean(), aaguid: z.string(), transports: z.array(Transport) })`
  - `CredentialsResponse = z.object({ rpId: z.string(), userHandle: Base64Url, credentials: z.array(CredentialSummary) })`（`GET /api/credentials` と `DELETE` の応答。`rpId` と `userHandle` は Signal API 用）
  - `AddCredentialVerifyResponse = z.object({ credential: CredentialSummary, inspection: OptionalInspection })`
- Produces（server）:
  - `listCredentials(db, userId): CredentialSummary[]`（`created_at` 順）
  - `isCredentialOwnedBy(db, userId, credentialId: Buffer): boolean`、`countCredentials(db, userId): number`
  - `deleteCredentialUnlessLast(db, userId, credentialId: Buffer): boolean` — 1文: `DELETE FROM credentials WHERE id = ? AND user_id = ? AND (SELECT COUNT(*) FROM credentials WHERE user_id = ?) > 1`。消せたら true
- Routes（すべて `requireSession`）:
  - `GET /api/credentials` → `CredentialsResponse`
  - `POST /api/credentials/options` → `createAddCredentialOptions`（ゲートなし、Cookie なし）
  - `POST /api/credentials/verify` → `runInspected({ ceremony: 'add_credential', ctx, save })`。`save` の中で、先に `runOperationGate(buildOperationGateContext(deps, { sessionId, op: { kind: 'add_credential' } }))`、続けて `saveAddedCredential`。S2・S3 の CheckError は既存のエラー処理で 401 になる。拒否されたら鍵は保存しない。セッションは作り直さない
  - `DELETE /api/credentials/:id` → id を `Base64Url.min(1)` で検証（失敗は 400）→ `isCredentialOwnedBy` でなければ 404 `credential_not_found` → `countCredentials <= 1` なら 409 `last_credential` → `runOperationGate`（`delete_credential`）→ `deleteCredentialUnlessLast` が false なら 409 `last_credential` → `CredentialsResponse`
  - `/api/stepup/options` の `delete_credential`: 所有していなければ 404、最後の1本なら 409（ゲートより前、challenge を発行しない）

- [ ] **Step 1: 失敗するテストを書く**
  - `credentials.test.ts`: `deleteCredentialUnlessLast` は、2本のうち1本目で true、続けて2本目で false（1本残る）。他人の credential では false。`listCredentials` が `created_at` 順
  - `credentials.test.ts`（route）:
    - 一覧: 登録直後は1本で、`userHandle` が登録時の `user.id`
    - ステップアップなしで追加 verify → 401 `step_up_required`（`check: 'S3'`）、一覧は1本のまま
    - 追加の承認 → options → verify → 200、一覧が2本、追加した鍵でログインでき、ログインの `userId` が同じユーザー
    - 1回の承認で options を2回取り、2回目の options への応答で verify → 200。続けて同じ承認で、別の options への応答を verify → 401（`check: 'S3'`）
    - options の `excludeCredentials` に既存の鍵の ID が入る
    - 送金の承認で追加 verify → 401（`check: 'S2'`）
    - C5（route 経由）: 攻撃者が自分のアカウントで追加を承認し、被害者のセッションで取った options の challenge に自分の鍵で答え、自分のセッションから verify → 400（`check: 'C5'`）。被害者の一覧は1本のまま
    - 削除: 2本ある状態で削除を承認 → DELETE → 200、一覧が1本。ログインに使った鍵自身を消しても `/api/me` は 200
    - 他人の credential の DELETE → 404、自分の承認は残る（直後に自分の鍵の DELETE がステップアップなしで通る）
    - 最後の1本: `/api/stepup/options` が 409 `last_credential`、DELETE も 409
    - 鍵 X の削除の承認で鍵 Y を DELETE → 401（`check: 'S2'`）
    - 形式違反の id（`not*base64`）で DELETE → 400 `invalid_request`、承認は残る。`/api/stepup/options` に `{ kind: 'delete_credential', credentialId: '' }` → 400
    - 追加 verify の応答に `inspection.ceremony === 'add_credential'` が入り、`checks` が `REGISTRATION_CHECKS` の ID と一致する
- [ ] **Step 2: 失敗を確かめる** — `yarn check` → 404（ルートがない）と型エラーで FAIL
- [ ] **Step 3: 実装する** — Interfaces どおり
- [ ] **Step 4: 通ることを確かめる** — `yarn check` が PASS
- [ ] **Step 5: コミット** — `feat: Add passkey list, add and delete API behind step-up`

### Task 4: 画面（パスキー一覧・追加・削除、Signal API）と E2E

**Files:**
- Create: `web/src/stepup.ts`（`transfer.ts` のステップアップ部分を一般化）、`web/src/credentials.ts`、`web/src/aaguid-names.ts`、`web/src/signal.ts`
- Modify: `web/src/transfer.ts`、`web/src/api.ts`（`deleteJson`）、`web/src/main.ts`（パスキーのセクション）、`web/src/login.ts`（L1 で拒否されたら `signalUnknownCredential`）、`web/src/style.css`
- Modify: `e2e/tests/passkey.spec.ts`

**Interfaces:**
- Consumes: Task 3 の API と `CredentialsResponse` / `AddCredentialVerifyResponse`、Task 1 の `StepupOperation`
- Produces（web 内部）:
  - `stepUpFor(op: StepupOperation): Promise<StepupVerifyResponse>`（options → `startAuthentication` → verify）
  - `canReuseAddApproval(approvedAt: Date | undefined, now: Date): boolean` — 承認から 4分30秒（`STEPUP_TTL_MS - 30_000`）未満なら true
  - `addPasskey(hooks)`: 再利用できる追加の承認がなければ `stepUpFor({ kind: 'add_credential' })` し、承認時刻を覚える → `/api/credentials/options` → `startRegistration` → `/api/credentials/verify`。作成が失敗したら承認時刻は残し、エラーを表示する（再試行ボタンで同じ関数を呼ぶ）。verify が成功したら承認時刻を消す
  - `deletePasskey(id, hooks)`: `DELETE` → `step_up_required` なら `stepUpFor({ kind: 'delete_credential', credentialId: id })` → `DELETE` を1回だけ再送
  - `signalAccepted(list: CredentialsResponse)` / `signalUnknown(rpId, credentialId)`: `PublicKeyCredential` に関数があるときだけ呼び、例外は握りつぶして console に出す。型は最小限を自前で宣言する
  - `aaguidName(aaguid: string): string | undefined` — 1Password、iCloud キーチェーン、Google パスワードマネージャー、Chrome（Mac）など。値は公開されている AAGUID 一覧で確かめてから入れる

- [ ] **Step 1: 失敗する E2E を書く** — `passkey.spec.ts` に1本追加（仮想認証器は常に1つだけ付ける。決定的に動かすため）
  1. 認証器 A を付けて `test-user-1` を登録 → 「パスキー」に1行、削除ボタンは無効
  2. 「パスキーを追加」→ ステップアップは A で通る → 作成は A が `excludeCredentials` に当たって失敗し、エラーと再試行が出る
  3. A を外して認証器 B を付け、再試行 → ステップアップを経ずに作成と verify が通り、一覧が2行
  4. ログアウトし、B だけでログインできる
  5. A の行の「削除」→ ステップアップは B で通る → 一覧が1行、削除ボタンが無効
  6. 「直近の ceremony」に追加の ceremony（`add_credential`）が出たことを、手順3の後に確かめる
- [ ] **Step 2: 失敗を確かめる** — `bash scripts/e2e.sh` → 「パスキー」セクションがなく FAIL
- [ ] **Step 3: 実装する** — Interfaces どおり。送金は `stepUpFor({ kind: 'transfer', ...tx })` を使うように書き換え、挙動は変えない。一覧を読み込んだときと削除が成功したときに `signalAccepted` を呼ぶ。処理中はボタンを無効にする
- [ ] **Step 4: 通ることを確かめる** — `bash scripts/e2e.sh` が PASS、`yarn check` が PASS
- [ ] **Step 5: コミット** — `feat: Add the passkey management UI with step-up and Signal API`

### Task 5: ドキュメント、実機確認、作業記録

**Files:**
- Modify: `docs/01-architecture-proposal-poc.md`（§5.3 の「取引ハッシュ」を「操作ハッシュ」に、§5.4「パスキーの追加と削除」を新設してシーケンス図、§6.1 の C5 と §6.5 を3操作に、§9 に「攻撃者が追加した鍵を消しても既存セッションは残る」、§11 の M7、K2 に Signal API の結果）
- Modify: `docs/decisions.md`（D42〜: 操作単位への一般化、追加にもステップアップ、追加の承認は verify で消費・options はゲートなし、追加の鍵は行の `user_id` に保存、削除は所有と最後の1本の確認をゲートの前、スキーマ版 4）
- Modify: `docs/03-hands-on-verification.md`（2本目の追加と削除、Signal API の確認手順）、`docs/02-knowledge-passkey.md`（Signal API の効き方。確かめていないことは（推測））
- Modify: `server/src/webauthn/CLAUDE.md`（ゲートの名前、C5 のセッション縛りの対象）、`README.md`（必要なら）
- Create/Modify: `docs/worklog/2026-11-24.md`（日付が変わっていればその日のファイル）

- [ ] **Step 1: 書く** — 上記。`git grep -n "TRANSFER_GATE\|transferTxHash\|tx-hash.ts"` が docs でも0件
- [ ] **Step 2: 確かめる** — `yarn check` が PASS、`bash scripts/e2e.sh` が PASS、マスクチェックが PASS
- [ ] **Step 3: 実機確認をユーザーに依頼する** — `docker compose down -v` → `up` → Chrome + 1Password で登録し、2本目（iCloud キーチェーンなど）を追加、片方を削除、Signal API で 1Password 側の表示が変わるかを見てもらう。結果を docs/03・docs/02・worklog に書く
- [ ] **Step 4: コミット** — `docs: Record M7 multi-passkey design, decisions and checks`

### Task 6: PR と Zenn の下書き

- [ ] **Step 1:** `feat/m7-multi-passkey` を push し、main への PR を作る（英語。本文の最後に `work in try-pass-key` の行）
- [ ] **Step 2:** M7 はマイルストーンなので、CLAUDE.md の手順で `~/work/zenn-docs` に下書き PR（`docs/<slug>` の worktree、`published: false`）を作る
