# M7 複数パスキー 設計

- 作成日: 2026-11-24
- 対象: docs/01 §11 の M7「2本目の追加、一覧、削除（ステップアップ付き）ができる」
- 関係する決定: D2（ステップアップは二次被害対策）、D37（取引ハッシュに `kind` を含める）、D38・D41（ゲートの順序と承認の読み込み）、D40（ステップアップの challenge はセッションに縛る）

## 目的

ログイン中のユーザーが、パスキーの一覧を見て、2本目を追加し、不要なものを削除できるようにする。追加と削除は、どちらもその場でのパスキー署名（ステップアップ）がなければ通らないようにする（ユーザーが案 A を選択）。

追加にもステップアップを付ける理由: 盗まれたセッションで攻撃者が自分のパスキーを追加できると、Cookie が失効した後もそのパスキーでログインし続けられる。送金よりも被害が長く続く乗っ取りになる。削除だけを守る形では、この攻撃を防げない。

PoC の主眼は M2〜M6 と同じで、検証を1項目ずつ外し、「外すと何が通るか」をテストで再現することにある。

## 現状

- `/api/register/*` は新しいユーザーを作るだけ。既存ユーザーにパスキーを足す経路はない。`excludeCredentials` は常に空（`registration.ts` に「M7 で埋める」とコメントがある）
- ステップアップ（M6）は送金専用。`/api/stepup/options` は `TransferRequest` を受け取り、残高を確かめ、`transferTxHash(tx)` を challenge の行の `tx_hash` に保存する。verify が通ると、セッションの `approved_tx_hash` と `stepup_at` に写す
- 送金のゲート `TRANSFER_GATE_CHECKS` は S3 → S2。承認は `buildTransferContext` で読み込み、S3 は条件付き UPDATE で消費するだけ（D41）。S2 は読み込んだ承認のハッシュと、リクエストから作ったハッシュを比べる
- `transferTxHash` は `{ kind: 'transfer', to, amount }` の SHA-256。`kind` は M7 のために入れてある
- C5 は、purpose が `stepup` のときだけ行の `session_id` とセッションを比べ、それ以外は一時 Cookie `ceremony` と比べる
- `challenges.purpose` の CHECK は `register` / `login` / `stepup` の3つ。スキーマ版は 3。マイグレーションはなく、版を上げたら `docker compose down -v` で作り直す（D26）
- credentials テーブルには、一覧に要る列（`created_at`、`last_used_at`、`backup_eligible`、`backup_state`、`aaguid`、`transports`）がそろっている。名前（ニックネーム）の列はない

## ゴール / 非ゴール / やってはいけないこと

- ゴール
  - `GET /api/credentials` で、ログイン中のユーザーのパスキー一覧を返す
  - 2本目以降の追加: ステップアップで「パスキー追加」を承認 → 追加用の登録 ceremony → 既存ユーザーに credential を保存する
  - 削除: ステップアップで「この credential の削除」を承認 → `DELETE /api/credentials/:id`
  - 承認は操作の種類と対象に縛られる。送金の承認で削除できない、鍵 X の削除の承認で鍵 Y を消せない、追加の承認で2本追加できない
  - 最後の1本は削除できない
  - 上記の攻撃をテストで再現する。既存の S2・S3・C5・C2 を「外すと通る」形で使う
  - 画面で一覧・追加・削除ができ、追加の登録 ceremony とステップアップが「直近の ceremony」に出る
  - E2E で、登録 → 2本目の追加 → 一覧に2本 → 1本削除 → 一覧に1本、を通す（Playwright の仮想認証器を2つ使う）
- 非ゴール
  - パスキーの名前付け（ニックネーム列の追加）。一覧では AAGUID・作成日時・最終使用日時・BE/BS で見分ける
  - パスキーを削除したときに、そのパスキーでログインしたセッションを失効させること。セッションはどの credential でログインしたかを持っていない。攻撃者が追加した鍵を消しても、攻撃者の既存セッションは残る。これは docs/01 §9 に残リスクとして書く
  - クロスデバイス（ハイブリッド、Q1）の実機確認。追加 ceremony 自体はハイブリッドでも動くはずだが、確かめるのは任意
  - 差分テスト（M5）への追加 ceremony の追加
- やってはいけないこと
  - 既存の検証項目（C1〜L4、S1〜S3）の削除・弱体化
  - 検証を飛ばすフラグや引数を本番コードに入れること（`server/src/webauthn/CLAUDE.md`）
  - 新規ユーザー登録（`/api/register/*`）にステップアップやセッションを要求すること。未ログインで使う経路のまま残す

## 作り方の比較

| 案 | 内容 | 採否 |
|---|---|---|
| 1 | ステップアップを「操作」単位に一般化する。options の本文を `kind` で分けた共用体にし、ゲート（S3 → S2）を送金・追加・削除で共有する | 採用（ユーザーが選択）。検証項目を増やさずに、`kind` による分離と S2・S3 の攻撃再現を3操作で使い回せる。D37 の `kind` の使い道そのもの |
| 2 | 操作ごとに専用のステップアップ経路と承認の保存先を作る | 不採用。options・verify・ゲートの組がほぼ同じ形で3つできる。流用防止を保存場所で保証するので、`kind` を外したときの攻撃も再現できない |
| 3 | 追加は「直近にログインした（`auth_at` が5分以内）」で許す | 不採用。ログイン直後に盗まれた Cookie で追加が通り、案 A を選んだ理由に反する |

## 設計

### 1. 操作と取引ハッシュ

`shared` に、ステップアップで承認する操作を `kind` で分けた共用体として定義する。

```ts
StepupOperation =
  | { kind: 'transfer'; to: string; amount: number }        // 既存の TransferRequest と同じ制約
  | { kind: 'add_credential' }
  | { kind: 'delete_credential'; credentialId: Base64Url }
```

`server/src/transfer/tx-hash.ts` の `transferTxHash` を `operationHash(op)` に置き換える（ファイルは `server/src/stepup/operation-hash.ts` などへ移す。場所は実装者の判断）。種類ごとにキーの順を固定して組み立て直し、`JSON.stringify` → SHA-256 → base64url にする。

- transfer: `{ kind, to, amount }`（今の値と同じハッシュになる）
- add_credential: `{ kind }`
- delete_credential: `{ kind, credentialId }`

### 2. `/api/stepup/options` / `verify`

- options の本文を `StepupOperation` にする（送金も `kind: 'transfer'` を付けて送る。画面の `transfer.ts` を直す）
- 種類ごとの事前確認（承認した後にできないと分かる無駄を防ぐ。M6 の残高確認と同じ扱い）
  - transfer: 残高が足りるか（今のまま）
  - add_credential: なし
  - delete_credential: credential がセッションのユーザーのものか（違えば・存在しなければ 404 `credential_not_found`）、最後の1本でないか（409 `last_credential`）
- challenge の行の `tx_hash` に `operationHash(op)` を保存する。verify は変えない（`STEPUP_CHECKS`、セッションの作り直し、`approved_tx_hash` への記録）
- ステップアップの承認時間（5分）、使い捨て、同時実行の扱い（D38）は送金と同じ

### 3. 操作のゲート

`TRANSFER_GATE_CHECKS` を `OPERATION_GATE_CHECKS`（S3 → S2）に改名し、`buildTransferContext` を `buildOperationGateContext(deps, { sessionId, op })` に一般化する。`TransferContext.txHash` には `operationHash(op)` を入れる。S2・S3 の中身は変えない。拒否したときの応答も今と同じ `401 step_up_required`（`check` に S2 / S3）。

ゲートを通す場所:

| 操作 | ゲートを通す場所 | 備考 |
|---|---|---|
| transfer | `POST /api/transfer` | 今のまま |
| add_credential | `POST /api/credentials/verify` | `REGISTRATION_CHECKS` がすべて通った後、保存の前にゲートを通し、承認をここで消費する（ユーザーが案 X を選択）。options はゲートを通さない。作成ダイアログのキャンセルや `excludeCredentials` による失敗の後も、承認が5分以内なら options からやり直せる。ゲートで拒否されたときは鍵を保存しない（challenge は C4 で消費済みなので、やり直しは options から） |
| delete_credential | `DELETE /api/credentials/:id` | ゲートの前に所有と最後の1本を確かめる。所有していなければ 404 を返し、承認は消費しない（他人の credential ID を推測するのに承認を使わせない、かつ状態を変えない） |

削除で所有確認をゲートより前に置く理由: ゲートを先に通すと、他人の credential ID を指定したリクエストでも承認が消費されてしまう。所有確認は認可であり、6章の検証項目ではない（6章の項目は ceremony の応答と承認の検証）。

### 4. 追加の登録 ceremony

- `POST /api/credentials/options`（要ログイン）: ゲートは通さず、purpose `add_credential` の challenge を発行し、行に `user_id` と `session_id` を保存する。options は新規登録と同じ形で、次だけが違う
  - `user.id` はそのユーザーの既存の `user_handle`、`user.name` / `displayName` は既存の `display_name`。同じ認証器に同じ `user.id` で作ると上書きになる認証器もあるので、`excludeCredentials` で防ぐ
  - `excludeCredentials` に、そのユーザーの既存 credential（`id` と `transports`）を入れる。同じ認証器に2本目を作ろうとすると、ブラウザが `InvalidStateError` を返す
  - 一時 Cookie `ceremony` は発行しない（セッションで縛るため）
- `POST /api/credentials/verify`（要ログイン）: `REGISTRATION_CHECKS` をそのまま通し、続けてゲート（`add_credential`、S3 → S2）を通してから保存する。ゲートを登録の検証の後に置くのは、C4 で challenge を先に使い捨てにする順序（D38 の「成否にかかわらず使い捨て」）を保ち、かつ壊れた応答で承認を消費させないため（設計者の判断）。context は purpose `add_credential` で作り、`sessionUserId` と `sessionId` を入れる。保存は、ユーザーを作らずに credential だけを**challenge の行の `user_id`** のユーザーに足す（設計者の判断。セッションのユーザーではなく行を起点にするのは、D28 と同じく、C5 を外したときの攻撃を再現できるようにするため）。`saveRegistration` は行の `userHandle`・`displayName` を必須にしているので、追加用の保存関数を別に作る。セッション ID は作り直さない（ログイン状態は変わらないため。作り直すかは実装者の判断でよいが、変えるなら decisions に残す）
- C5 の攻撃シナリオ（設計者の判断）: 被害者が正当に追加を始め、セッションに縛られた challenge が発行される。その challenge が漏れる。攻撃者は自分のアカウントでログインし、自分のパスキーで「パスキー追加」を正当に承認しておく（verify のゲートは自分のセッションの承認で通る）。そのうえで、漏れた challenge に自分の認証器で答える応答を作り、自分のセッションから verify に送る。C5 があれば「別のセッションに発行された challenge」として拒否される。C5 を外すと、ゲートは攻撃者自身の承認で通り、保存先が行の `user_id`（被害者）なので、攻撃者の鍵が被害者のアカウントに付く。行の `user_id` とセッションのユーザーの比較を新しい検証項目にはしない（C5 がセッションで縛れば、セッションは1人のユーザーに属するので比較は重複する。D40 で S1 と C5 の重複を避けたのと同じ扱い）
- C2 は purpose の一致も見ているので、新規登録の challenge で追加 verify を通すことも、その逆もできない（既存の C2 の攻撃再現に1ケース足す）
- C5 は「ログイン中に行う ceremony（`stepup` と `add_credential`）はセッションで縛る」に一般化する（攻撃シナリオは上記）
- R2（`credentialId` が未登録）は新規登録と同じく効く。他のユーザーの credential ID を自分に付け替えられない

### 5. 一覧と削除

- `GET /api/credentials`: セッションのユーザーの credential を `created_at` 順で返す。項目は `id`、`createdAt`、`lastUsedAt`、`backupEligible`、`backupState`、`aaguid`、`transports`、`userHandle`（Signal API 用。ユーザー単位で同じ値なので一覧の外側に1つ持たせてもよい）
- `DELETE /api/credentials/:id`: 所有確認（404）→ 最後の1本でないか（409）→ ゲート（401 step_up_required）→ 削除。「最後の1本か」の確認と削除は1つのトランザクションにし、同時に2本消して0本になる競合を防ぐ（`DELETE ... WHERE id = ? AND (SELECT COUNT(*) ...) > 1` の1文でもよい）
- 削除しても、そのユーザーのセッションは消さない（非ゴール参照）

### 6. スキーマ

- `challenges.purpose` の CHECK に `add_credential` を足す
- `add_credential` の行は `user_id` と `session_id` を NOT NULL にする CHECK を足す。`tx_hash` は NULL（承認はセッション側にあり、verify のゲートで消費する）
- `SCHEMA_VERSION` を 4 に上げる。開発 DB は `docker compose down -v` で作り直す

### 7. 画面

ログイン後の画面に「パスキー」セクションを足す。

```
パスキー
┌──────────────────────────────────────────────────────────┐
│ 1Password          作成 11/24 10:02  最終使用 11/24 10:30 │
│ BE=1 BS=1  internal, hybrid                     [削除]   │
├──────────────────────────────────────────────────────────┤
│ iCloud キーチェーン  作成 11/24 10:40  最終使用 —          │
│ BE=1 BS=1  internal, hybrid                     [削除]   │
└──────────────────────────────────────────────────────────┘
[パスキーを追加]
```

- AAGUID の表示名は、よく使うもの（1Password、iCloud キーチェーン、Google パスワードマネージャー、Chrome のプロファイルなど）だけを小さな表で持ち、知らないものは AAGUID をそのまま出す（実装者の判断。表に入れる値は公開されている AAGUID 一覧で確かめる）
- 削除ボタンは、1本しかないときは無効にする（サーバー側の 409 が本体で、画面は補助）
- 追加・削除は、送金と同じく `step_up_required` を受けたら自動でステップアップしてから再送する。処理中はボタンを無効にする（M6 の送金フォームと同じ）
- 追加の登録 ceremony とステップアップの結果を「直近の ceremony」に出す。`CeremonyInspection.ceremony` に `add_credential` を足す。`inspect.ts` と `runInspected` の `CHECKS` の対応表は `ceremony === 'register'` で分岐しているので、`add_credential` も `REGISTRATION_CHECKS` と登録の形の表示項目を使うように直す

### 8. Signal API（任意課題、K2）

対応ブラウザでだけ動く小さな追加として、この M7 に含める（機能がなければ何もしない）。

- 一覧を読み込んだとき、削除が成功したとき: `PublicKeyCredential.signalAllAcceptedCredentials({ rpId, userId, allAcceptedCredentialIds })` で、サーバーに残っている credential を認証器に伝える。消した鍵が認証器から消える（または隠れる）ことを期待する
- ログインで `unknown_credential`（L1）を受けたとき: `PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })`
- 効き方は認証器（1Password、iCloud キーチェーンなど）ごとに違うはずなので、実機で確かめた結果を docs/03 と docs/02 に書く。確かめていないことは（推測）と書く

### 9. テスト

攻撃再現（「その項目を外したパイプラインでは通る」形）:

| 攻撃 | 止める項目 | テストの置き場所（目安） |
|---|---|---|
| ステップアップなしで追加 verify を通す（盗んだセッションで options と作成までは進める） | S3（外すと S2 が承認なしとして止める。多層防御、送金と同じ） | `operation-gate-attacks.test.ts` |
| 追加の承認1回で2本追加する | S3 | 同上 |
| 送金の承認で削除する / 削除の承認で送金する | S2（`kind` 違い） | 同上 |
| 鍵 X の削除の承認で鍵 Y を削除する | S2 | 同上 |
| 5分を過ぎた承認で追加・削除する | S3 | 同上 |
| 被害者のセッションに発行された追加の challenge に攻撃者が自分の鍵で答え、自分の承認済みセッションから送る | C5 | `add-credential-attacks.test.ts` |
| 新規登録の challenge で追加 verify を通す（とその逆） | C2 | 同上 |
| 他のユーザーの credential ID を追加で付け替える | R2 | 同上 |

既存の `transfer-gate-attacks.test.ts` は、ゲートの改名に合わせて名前を変えるか、送金のケースとして残す（実装者の判断）。テストを消して減らすことはしない。

認可と業務ルール（6章の項目ではないので通常のテスト）:

- 他人の credential の削除は 404、承認は消費されない
- 最後の1本の削除は 409（options の事前確認と DELETE の両方）
- 同時に2本を削除しても0本にならない
- 追加した credential でログインでき、`userHandle` が既存ユーザーを指す
- 1回の承認のあと options を2回取り（1回目の作成は失敗した想定）、2回目で verify が通る。続けて同じ承認で別の鍵の verify を送ると S3 で拒否される

E2E: Playwright の仮想認証器を2つ用意し、1つ目で登録、2つ目で追加、一覧に2本、1本削除、一覧に1本、2つ目の鍵でログインできる、を通す。

### 10. ドキュメント

- docs/01: §5 に「5.4 パスキーの追加と削除」（シーケンス図）、§6.1 の C5 と §6.5 の説明を3操作に広げる、§9 に「攻撃者が追加した鍵を消しても既存セッションは残る」、§11 の M7 に完了の印
- docs/decisions.md: 操作単位への一般化、追加にもステップアップ、追加の承認は verify で消費（options はゲートなし）、削除は所有確認をゲートの前、スキーマ版 4、最後の1本の扱い、をそれぞれ1行
- docs/03: 2本目の追加と削除、Signal API の実機確認の手順
- docs/worklog/2026-11-24.md: 作業記録

## 実装者に任せること

- ファイルの置き場所と名前（`operation-hash.ts` の場所、テストファイル名）
- 一覧の `userHandle` を一覧の外に1つ持つか、各行に持つか
- 追加 verify でセッション ID を作り直すか（変えるなら decisions に記録）
- AAGUID の表示名の表に入れる範囲
- 画面の細かな見た目
