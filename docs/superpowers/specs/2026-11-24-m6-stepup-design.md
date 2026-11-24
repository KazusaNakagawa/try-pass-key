# M6 ステップアップ 設計

- 作成日: 2026-11-24
- 対象: docs/01 §11 の M6「送金前の再認証が動き、期限切れ・取引改ざん・他人の鍵が拒否される」
- 関係する受け入れ基準（docs/01 §12）: 「ログイン済みでもステップアップなしの送金が `step_up_required` で拒否される」「ステップアップ後に金額を変えた送金が拒否される」

## 目的

ログイン済みのセッションを盗まれても、送金にはその場でのパスキー署名が要る状態を作る（D2、docs/01 §5.3）。PoC の主眼は M2〜M5 と同じで、検証を1項目ずつ外し、「外すと何が通るか」をテストで再現することにある。そのため、ステップアップ固有の検証にも 6章の ID（S1〜S3）を振る（ユーザーが案 A を選択）。

## 現状

- DB は M1 で用意済み。`challenges.purpose = 'stepup'` と `user_id`・`tx_hash`（stepup では NOT NULL を CHECK 制約で強制）、`sessions.stepup_at`・`approved_tx_hash`、`transfers`、`users.balance`（`CHECK (balance >= 0)`）がある
- `users.balance` の既定値は 0 で、登録時に何も入れていない。このままでは送金できない
- `checks/C5.ts` は一時 Cookie `ceremony` との照合だけを実装している。docs/01 §6.1 の C5 には「ステップアップでは行の `user_id` がセッションのユーザーと一致」と書いてあるが未実装
- `/api/me` と `MeResponse` には `stepupAt` がすでにある（常に null）
- `runInspected` は `ceremony: 'register' | 'login'` だけを受け付ける

## ゴール / 非ゴール / やってはいけないこと

- ゴール
  - `POST /api/transfer` は、5分以内に同じ送金内容で承認され、まだ使われていない承認がなければ `401 step_up_required` で拒否する
  - `POST /api/stepup/options` / `verify` で、ログイン中のユーザー自身のパスキーによる再認証を行い、その送金内容の承認をセッションに記録する
  - S1〜S3 を 6章に足す。それぞれに正常系テストと、外すと攻撃が通る異常系テストを付ける
  - 画面で、残高の表示、送金、自動のステップアップ、送金履歴を見られる。ステップアップの ceremony も「直近の ceremony」に表示する
  - E2E で、登録 → 送金（ステップアップ付き）→ 残高の減少を通す
- 非ゴール
  - パスキー削除へのステップアップ適用（M7）。ただし取引ハッシュは種類を含めて作り、M7 で流用できる形にする
  - 取引内容を認証器に表示させること（WebAuthn にはその仕組みがない。改ざんされた画面に騙されるリスクは docs/01 §9 に記載済みで、残リスクのまま）
  - 差分テスト（M5）へのステップアップの追加
  - 本物の口座や送金先の存在確認
- やってはいけないこと
  - 既存の検証項目（C1〜L4）の削除・弱体化。ログインの L2 はそのまま残す
  - 検証を飛ばすフラグや引数を本番コードに入れること（`server/src/webauthn/CLAUDE.md`）
  - 承認を、送金内容と無関係に「5分間なんでも送金できる」形にすること（D2 の狙いが崩れる）

## 作り方の比較

| 案 | 内容 | 採否 |
|---|---|---|
| A. 6章に S1〜S3 を足す | ステップアップ固有の検証を独立した `Check` にし、項目を外すと攻撃が通るテストを付ける | **採用**（ユーザーが選択）。盗んだセッションと攻撃者自身の鍵での送金、承認後の金額改ざん、承認の使い回しを再現できる |
| B. ルート内のアプリロジックにする | 正常系と拒否のテストだけを書く | 不採用。外したときに何が通るかを学ぶという PoC の主眼から外れる |

取引への紐づけ方（こちらの判断）:

| 案 | 内容 | 採否 |
|---|---|---|
| 行で紐づける | challenge は乱数のまま。options で取引ハッシュを challenge の行に保存し、verify 成功時にセッションの `approved_tx_hash` へ写す | **採用**。docs/01 §5.3・§8 のスキーマどおり。challenge はサーバーが発行し、行は使い捨てなので、サーバー側の状態だけで紐づけが成り立つ |
| challenge に取引を埋め込む | challenge = SHA-256(取引 ‖ 乱数) とし、署名が取引を覆うようにする | 不採用。認証器は取引内容を表示しないので、利用者が何に署名したかの保証は増えない。サーバーが行を引けば同じことが確かめられ、仕組みが増えるだけ |

## 設計

### 流れ

docs/01 §5.3 の図どおり。補足:

1. `POST /api/transfer {to, amount}` → 有効な承認がなければ `401 {error: "step_up_required", check: "S2" | "S3"}`
2. `POST /api/stepup/options {to, amount}` → 取引ハッシュを計算し、`purpose: 'stepup'`、`user_id` = セッションのユーザー、`tx_hash` を持つ challenge の行を作る。`allowCredentials` はそのユーザーの credential（id と transports）
3. ブラウザで `navigator.credentials.get()`
4. `POST /api/stepup/verify` → `STEPUP_CHECKS` を通し、signCount 等を保存し、**セッションIDを再発行**したうえで、新しいセッションに `stepup_at` = 現在時刻と `approved_tx_hash` = 行の `tx_hash` を記録する（docs/01 §8 のセッション方針「ステップアップ時に再発行」）
5. `POST /api/transfer {to, amount}`（再送）→ `TRANSFER_GATE_CHECKS` を通ったら残高を減らし、履歴を記録する

### 取引ハッシュ

- `txHash = base64url(SHA-256(JSON.stringify({ kind: 'transfer', to, amount })))`。キーの順序はこの固定順で組み立てる（正規化のため、受け取ったオブジェクトをそのまま文字列にしない）
- `to` は前後の空白を除いた1〜64文字の文字列、`amount` は 1 以上 1,000,000 以下の整数。zod（`shared/src/transfer.ts`）で検証し、違反は既存どおり `400 invalid_request`
- `kind` を含めるのは、M7 で `{ kind: 'delete_credential', credentialId }` を同じ仕組みで承認したときに、別の種類の操作の承認として流用されないようにするため

### 検証項目（docs/01 §6 に追加）

新しい節「6.5 ステップアップ時のみ」を足す（既存の 6.5 差分テストは 6.6 に繰り下げる）。

| # | 検証 | 外した場合に通る攻撃 | 実行する場所 |
|---|---|---|---|
| S1 | credential の持ち主がセッションのユーザーと一致し、`userHandle` が返っていればそれもセッションのユーザーを指す（WebAuthn L3 §7.2 の手順6、ユーザーが ceremony の前に特定されている場合） | セッションを盗んだ攻撃者が、自分のアカウントに登録した自分のパスキーで承認し、被害者として送金する | `/api/stepup/verify`（`STEPUP_CHECKS`） |
| S2 | 送金内容の取引ハッシュが、セッションの承認済みハッシュと一致 | 承認後に金額や送金先を書き換えた送金が通る | `/api/transfer`（`TRANSFER_GATE_CHECKS`） |
| S3 | 承認があり、5分以内で、未使用（承認をこの送金で消費できた） | 5分を過ぎた承認での送金、1回の承認での2回目の送金。ステップアップなしの送金も S3 が拒否するが、S3 を外しても S2 が承認なしとして拒否する（多層防御） | `/api/transfer`（`TRANSFER_GATE_CHECKS`） |

C5 はステップアップでは別の縛り方になる（docs/01 §6.1 に既に書かれている内容を実装する）。

- `expected.purpose === 'stepup'` のとき: 一時 Cookie は使わず、行の `user_id` がセッションのユーザーと一致することを確かめる。一致しなければ `CheckError('C5', ...)`
- それ以外: 今までどおり Cookie と照合する
- `CeremonyContext` に `sessionUserId: string | undefined`（ステップアップのときだけ値が入る）を足す。C5 は purpose で分岐する。ステップアップ用に別の ID を作らないのは、6章で C5 を「誰に発行した challenge か」の項目として1つにまとめているため（D14）

### パイプライン（`pipeline.ts`）

```ts
// ログインとの違い: L2（userHandle が指すユーザー）の代わりに S1（セッションのユーザー）
export const STEPUP_CHECKS: readonly Check<StepupContext>[] = Object.freeze([
  C4, C2, C5, C1, C3, A1, A2, A3, L1, S1, L3, L4, A4,
]);

// 送金の前に通す。S3 が先: 承認を消費してから内容を比べる（C4 と同じ考え方で、
// 内容が違う送金を試した時点で承認は使い切りになる）
export const TRANSFER_GATE_CHECKS: readonly Check<TransferContext>[] = Object.freeze([S3, S2]);
```

- ステップアップに L2 を入れない理由: `allowCredentials` を指定した認証では `userHandle` が返らないことがある（WebAuthn L3 §5.2.2 で nullable）。L2 は `userHandle` を必須にしているので、正当な承認が拒否されうる。S1 は、`userHandle` があればそれも確かめる
- `StepupContext` は `AuthenticationContext` に `sessionUserId: string` を足したもの。組み立ては `buildAuthenticationContext` を共有し、`expected.purpose` を `'stepup'` にする
- `TransferContext`:
  ```ts
  interface TransferContext {
    txHash: string;               // 送金リクエストから計算したハッシュ
    now: Date;
    /** セッションの承認を消費する。消費できたら承認時刻とハッシュを返す。既に無ければ undefined */
    consumeApproval(): { stepupAt: string; approvedTxHash: string } | undefined;
    /** S3 が消費した承認（S2 が読む） */
    approval: { stepupAt: string; approvedTxHash: string } | undefined;
  }
  ```
  S3 は `consumeApproval()` を呼んで `approval` に入れ、無ければ「承認がない（未実施または使用済み）」、`stepupAt` から5分を過ぎていれば「期限切れ」で拒否する。S2 は `approval.approvedTxHash === txHash` を確かめる（`approval` が無いときも拒否）
- 消費は1文で行う: `UPDATE sessions SET approved_tx_hash = NULL WHERE id = ? AND approved_tx_hash IS NOT NULL RETURNING stepup_at, approved_tx_hash`。同じ承認で同時に2つの送金が来ても、1つしか消費できない
- テストで S3 を外すと、承認は消費されず期限も見られない。S2 が読む `approval` は、テスト用の context では消費せずに読んだ値を入れておく（harness が用意する）
- S2 は承認が無いときも拒否する（承認の有無を S3 だけに任せると、S2 単体では承認なしを通してしまい、db.ts のコメントが警告している fail-open になるため）。そのため「ステップアップなしの送金」は S3 を外しても S2 が拒否する（`withoutCheckRejectedBy: 'S2'`）。S3 を外すと通る攻撃は「期限切れ」と「2回目の送金」
- 「同じ承認での2回目の送金」のシナリオは、1回目も2回目も S3 を外したゲートで通す（1回目を本物のゲートで通すと承認が消費済みになり、2回目は S2 が承認なしで拒否してしまい、S3 の役割を示せない）
- `pipeline.test.ts` に `STEPUP_ITEMS` と `TRANSFER_GATE_ITEMS` を足す。凍結されていること、`STEPUP_CHECKS` の先頭が C4 であること、`TRANSFER_GATE_CHECKS` の先頭が S3 であることを確かめる

### エラーコード（`CHECK_ERROR_CODES`）

| ID | コード | HTTP |
|---|---|---|
| S1 | `credential_not_owned` | 400（他の検証項目と同じ） |
| S2 | `step_up_required` | 401 |
| S3 | `step_up_required` | 401 |

S2・S3 は、クライアントがステップアップをやり直せば済む状況なので、受け入れ基準どおり `step_up_required` にそろえる。どちらで落ちたかは `check` で分かる。`errorHandler` は CheckError の HTTP ステータスを項目ごとに引けるようにする（既定 400、S2・S3 は 401）。

### API（docs/01 §7 を更新）

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| POST | `/api/stepup/options` | 要 | 本文 `{to, amount}`。残高不足なら `400 insufficient_funds`（承認を無駄にしないため、ここで先に断る）。応答は `StepupOptionsResponse`（`challenge`、`rpId`、`timeout`、`userVerification: 'required'`、`allowCredentials: [{type:'public-key', id, transports}]`） |
| POST | `/api/stepup/verify` | 要 | 本文は `AuthenticationResponse`。応答 `{ me, credential, inspection? }`（`LoginVerifyResponse` と同じ形） |
| POST | `/api/transfer` | 要 + ステップアップ | 本文 `{to, amount}`。応答 `{ transfer: {id, to, amount, createdAt}, balance }` |
| GET | `/api/transfers` | 要 | 応答 `{ balance, transfers: [...] }`（新しい順に最大20件） |
| GET | `/api/me` | 要 | `MeResponse` に `balance` を足す |

送金の実行（S3・S2 を通った後）:

- `UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?` と `INSERT INTO transfers` を1つのトランザクションで行う。更新が0行なら `400 insufficient_funds`
- 承認の消費はこのトランザクションの外で、ゲートの時点で確定する。残高不足や送金の失敗でも承認は戻さない（使い捨ての原則を単純に保つ。options で残高を先に確かめるので、普通は起きない）

### セッション

- `sessions.ts` に `rotateSession(db, oldToken, now, approval)` を足す。古い行を削除し、同じ `user_id`・`auth_at`・`expires_at`（絶対期限は延ばさない）で新しいトークンの行を作り、`stepup_at` と `approved_tx_hash` を記録する。`session/http.ts` 側で Cookie を差し替える
- `Session` 型に `approvedTxHash` は載せない（画面にも出さない）。`stepupAt` はすでにある
- ステップアップの有効期間 `STEPUP_TTL_MS = 5 * 60 * 1000`（docs/01 §8、Q3）

### 登録時の残高

登録で `users` の行を作るときに `balance = 100000`（`INITIAL_BALANCE`）を入れる。スキーマの既定値は変えない（変えると `SCHEMA_VERSION` を上げてボリュームの作り直しが要る）。既存の開発DBのユーザーは残高0のままなので、docs/03 に「`docker compose down -v` で作り直すか、`UPDATE users SET balance = 100000` を実行する」と書く。

### 可視化（M4 の延長）

- `CeremonyInspection.ceremony` に `'stepup'` を足す。`runInspected` に `{ ceremony: 'stepup', ctx: StepupContext }` を足し、`STEPUP_CHECKS` を選ばせる（route が検証項目のリストを渡さない原則は維持）
- `storedCredential` はログインと同じく L3 を通ったときだけ載せる
- `expected` に取引ハッシュは載せない（clientDataJSON に現れないので、比べる対象がない）
- 送金のゲート（S2・S3）は ceremony ではないので `inspection` の対象にしない。拒否は `check` で表示する

### 画面（`web/`）

ログイン中だけ「送金」セクションを出す。

```
送金                         残高: 100,000
送金先 [__________]  金額 [_______]  [送金する]
状態: 認証器の操作を待っています...（ステップアップ）
履歴
  2026-11-24 10:00  test-account-1   1,000
```

- 「送金する」→ `/api/transfer` → `401 step_up_required` なら自動で `/api/stepup/options` → `startAuthentication` → `/api/stepup/verify` → `/api/transfer` を再送。ステップアップ後の再送でも 401 なら、もう一度は回さずエラーを表示する（無限ループ防止）
- 結果、残高、履歴、`/api/me` の `stepupAt` を更新する。ステップアップの `inspection` は「直近の ceremony」に出す
- ステップアップ中は Conditional UI を止める必要はない（ログイン中は Conditional UI を動かしていない）

### テスト

- 正常系: `checks/S1.test.ts`、`S2.test.ts`、`S3.test.ts`、C5 のステップアップ分岐の正常系と拒否
- 攻撃再現: `server/test/stepup-attacks.test.ts`（既存の `login-attacks.test.ts` と同じ形。全項目が満たされた状態では拒否し、その項目だけを外すと通る。他の項目がなお拒否する場合は `withoutCheckRejectedBy`）
  - `STEPUP_CHECKS` の全項目にシナリオがあることをテストする。C1〜A4・L1・L3・L4 はログインと同じ改ざんでよい
  - C5: 被害者のセッションに発行された challenge への署名済み応答を、攻撃者が自分のセッションから送る。C5 を外しても、credential の持ち主が攻撃者でないので S1 が拒否する（`withoutCheckRejectedBy: 'S1'`）
  - S1: 被害者のセッション（盗まれた Cookie）で、攻撃者が自分のアカウントの鍵で署名する。S1 を外すと承認が記録され、送金できる
  - `server/test/transfer-gate-attacks.test.ts`（同じ形）: S2 は承認後に金額を変えた送金。S3 は5分1秒後の送金と、同じ承認での2回目の送金。承認なしの送金は S3 が拒否し、S3 を外しても S2 が拒否する
- ルート: `routes/stepup.test.ts`、`routes/transfer.test.ts`（supertest、`now` を注入）。ステップアップなしで `401 step_up_required`、承認後の送金で残高が減る、金額を変えると 401（S2）、期限切れで 401（S3）、2回目で 401（S3）、他人の鍵で 400（S1）、セッションIDが変わる、残高不足、入力違反、未ログインで 401 `unauthenticated`
- E2E: 既存の Playwright と仮想認証器で、登録 → 送金 → 残高の減少と履歴を確かめる
- `server/src/webauthn/CLAUDE.md` の不変条件に `STEPUP_CHECKS`・`TRANSFER_GATE_CHECKS` と `runInspected({ ceremony: 'stepup' })` を足す

### ドキュメント

- docs/01: §6.1 の C5 はそのまま（実装が追いつく）、§6.5 を追加、§6.6 に繰り下げ、§7 の API 表、§5.3 の補足（消費の順序、セッションIDの再発行、L2 を使わない理由）、§12 の受け入れ基準の項目一覧に S1〜S3
- decisions: S1〜S3 を立てたこと（案 A）、取引への紐づけ方、承認の消費をゲートの先頭で確定させること、初期残高
- docs/03: ブラウザでのステップアップの確認手順、DB で `sessions.approved_tx_hash` が消えることの確認、既存DBの残高
- M6 完了で worklog と Zenn 記事の下書き

### こちらで決めたこと（実装の細部）

- ステップアップの保存は `saveAuthentication` を使わず専用にする（`saveAuthentication` は `userByHandle` を必須にしているため）。signCount の UPDATE の競合チェック（A4）は同じ形で行う
- `rotateSession` は `last_seen_at` を現在時刻にする
- `/api/transfer` は、リクエスト本文の検証（zod）をゲートより先に行う。形式違反のリクエストで承認を消費しない
- `balance` を足した `MeResponse` は、ログインと登録の応答にも同じく載る

## 実装者に任せること

- `STEPUP_CHECKS` 用の context の組み立てを `authentication.ts` に足すか、`stepup.ts` に分けるか
- 攻撃テストのハーネス（`LoginHarness` を拡張するか、`StepupHarness` を作るか）
- 画面の細かい文言と配置
