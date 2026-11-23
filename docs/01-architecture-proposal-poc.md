# アーキテクチャ提案書（PoC）: パスキー認証とステップアップ認証

- 作成日: 2026-11-23
- ステータス: 提案（レビュー待ち）
- 前提: [00-background.md](./00-background.md)
- 関連ナレッジ: [02-knowledge-passkey.md](./02-knowledge-passkey.md)

---

## 1. 目的

パスキー（WebAuthn）による登録・ログインと、高リスク操作前のステップアップ認証を最小構成で実装し、仕組みを理解する。

成功の定義は次の3点とする。

1. パスキーの登録・ユーザー名なしログインがブラウザで動く
2. サーバー側の検証項目をすべて自前のテストで確認でき、どれか一つを外すと攻撃が通ることを再現できる
3. ログイン済みでも「送金」操作の直前にパスキー再認証を要求でき、古いセッションだけでは送金できない

## 2. スコープ

### 対象

| 区分 | 内容 |
|---|---|
| 登録 | 新規ユーザー作成とパスキー登録、既存ユーザーへの2本目のパスキー追加 |
| 認証 | discoverable credential によるユーザー名なしログイン、Conditional UI（入力欄のオートフィル） |
| ステップアップ | 模擬「送金」API の直前にパスキー再認証を要求する |
| セッション | サーバー側セッション、ログイン時のID再発行、認証時刻の保持 |
| 可視化 | clientDataJSON、authenticatorData のフラグ、signCount などを画面とログに出す |
| 攻撃再現 | origin 改ざん、challenge 再利用、UVなし、別RP IDの鍵、などをテストで再現する |

### 対象外

- 本番運用（冗長化、監視、レート制限の作り込み）
- attestation による認証器の機種検証（`attestation: "none"` で進める）
- アカウント復旧フロー（設計上の論点として 9章に記載するのみ）
- パスワード認証との併用・移行
- ネイティブアプリ（iOS / Android）からの利用

## 3. 用語

| 用語 | 意味 |
|---|---|
| RP（Relying Party） | 認証を受け入れる側のサービス。本PoCのサーバー |
| RP ID | 鍵を紐づけるドメイン。PoCでは `localhost` |
| 認証器（Authenticator） | 秘密鍵を保持し署名する主体。端末内蔵（Touch ID、Windows Hello）、スマホ、セキュリティキーなど |
| パスキー | discoverable credential（認証器内にユーザー情報も保存される鍵）の通称。同期型と端末固定型がある |
| Attestation | 登録時に認証器が返すデータ。公開鍵を含む |
| Assertion | 認証時に認証器が返す署名 |
| UP / UV | authenticatorData のフラグ。UP はユーザーが居た（タップ等）、UV は本人確認した（生体・PIN） |
| BE / BS | Backup Eligible / Backup State。同期可能な鍵か、現在同期されているか |
| userHandle | RP がユーザーに割り当てる不透明なID（`user.id`）。メールアドレス等の個人情報は入れない |

## 4. 全体構成

```mermaid
flowchart LR
  subgraph Client["ブラウザ"]
    UI["Web UI<br/>(TypeScript)"]
    WA["WebAuthn API<br/>navigator.credentials"]
  end
  AUTH["認証器<br/>Touch ID / Windows Hello /<br/>スマホ / セキュリティキー"]
  subgraph Server["RP サーバー (Node.js)"]
    API["HTTP API<br/>(Express)"]
    VER["WebAuthn 検証<br/>(自前パイプライン)"]
    SES["セッション管理"]
    STEP["ステップアップ判定"]
  end
  DB[("SQLite<br/>users / credentials /<br/>challenges / sessions")]

  UI --> WA
  WA <--> AUTH
  UI <-->|"JSON over HTTPS<br/>(localhost は HTTP 可)"| API
  API --> VER
  API --> SES
  API --> STEP
  VER --> DB
  SES --> DB
```

### 技術選定

| 層 | 採用 | 理由 |
|---|---|---|
| 言語 | TypeScript（ESM、サーバー・クライアント共通） | 型でWebAuthnの構造体を追いやすい。AIの学習量が多く、型エラーがAIへのフィードバックになる |
| 実行 | Node.js 26（Active LTS）+ `tsx` | ビルドなしで `.ts` を直接実行でき、試行錯誤が速い。`node:sqlite` がフラグなしで使える。Node 25 以降は corepack が同梱されないため、Dockerfile で入れる |
| サーバー | Express 5 | AIの学習量が最も多く、情報も豊富 |
| スキーマ | zod | APIの入出力・設定・DB行を zod で定義し、型とランタイム検証を1か所にまとめる。AIが仕様を読む起点にもなる |
| WebAuthn 検証 | 自前の検証パイプライン（6.0）+ `cbor-x`（CBOR デコードのみ） | 検証を1項目ずつ外して攻撃が通ることを示すには、検証を自分で持つ必要がある。CBOR の文法は学習価値が低いのでライブラリに任せ、authenticatorData の分解・COSE 鍵の変換・各検証は自前で書く |
| WebAuthn 参照実装 | `@simplewebauthn/server`（テストのみ）/ `@simplewebauthn/browser` | サーバー側は本番経路では使わず、同じ入力に対する判定を自前実装と突き合わせる比較用（差分テスト）。ブラウザ側は base64url 変換と Conditional UI の中断処理に使う |
| DB | SQLite（`node:sqlite`。使えなければ better-sqlite3） | ファイル1つで完結し、中身を直接覗ける。Node 組み込みならネイティブビルドが不要 |
| フロント | Vite + 素の TypeScript | フレームワークの知識を前提にしない。画面が増えたら Vue に移行する |
| テスト | Vitest（単体・攻撃再現）、Playwright（E2E） | 15.3 のとおり、仮想認証器でAIが人手なしにE2Eを回せる |
| 品質 | ESLint（typescript-eslint、sonarjs、security）+ Prettier | AIが書いたコードを機械的に検査する。sonarjs で複雑さ、security で危険なパターンを検出する |
| パッケージ管理 | Yarn 4（corepack）の workspaces、`nodeLinker: node-modules` | lockfile で依存を固定する。`server` / `web` / `shared` / `e2e` を1リポジトリで管理し、`shared` の zod を両方から import できる。PnP は AI が `node_modules` を読めずツール相性も悪いため使わない |
| 実行環境 | Docker / Docker Compose | ホストの global 環境を汚さず、壊しても作り直せる |

バージョンは実装開始時点の最新安定版で固定する。Node.js もベースイメージのタグ（`node:26.13.1-slim`）で固定する。例外として TypeScript は 6.0 系にする。7.0（Go 実装）は typescript-eslint が未対応のため（D16）。

### 実行環境（Docker）

試して壊せることを優先し、すべてをコンテナ内で完結させる。ホストに必要なのは Docker とブラウザだけとする。

**方針**

- ホストに Node.js、npm パッケージ、SQLite を入れない。`yarn install` もテストもコンテナ内で実行する。
- リポジトリ全体を `/app` にバインドマウントしてホットリロードする。ルートの `node_modules`（`/app/node_modules`）と SQLite のDBファイルは名前付きボリュームに置き、ホストのディレクトリには作らない。
- 開発用イメージは ルートの `Dockerfile` 1つにし、`deps` / `server` / `web` で共用する。`yarn install` は一回限りの `deps` サービスが行い、`server` と `web` はその完了を待って起動する。共有ボリュームへの同時インストールを避けるため（D17）。E2E だけは `@playwright/test` とバージョンを揃えた Playwright 公式イメージで別サービスにする。
- 依存のバージョン衝突があると、workspace 配下（`server/node_modules` 等）にも `node_modules` が作られ、バインドマウント経由でホストに出てくる。M1 の完了条件で、これが作られていないことを確認する。
- `docker compose down -v` でDB・依存パッケージごと完全に初期化できる状態を保つ。壊したら消して作り直す、を前提にする。
- ブラウザと認証器（Touch ID 等）はホスト側のものを使う。WebAuthn はブラウザと OS の機能なので、コンテナに入れる必要はない。

**構成**

```mermaid
flowchart LR
  subgraph Host["ホスト（Docker とブラウザのみ）"]
    BR["ブラウザ<br/>http://localhost:5173"]
    TID["認証器<br/>Touch ID 等"]
  end
  subgraph Compose["docker compose"]
    WEB["web<br/>Vite dev server<br/>:5173"]
    SRV["server<br/>Express<br/>:3000"]
    E2E["e2e<br/>Playwright<br/>(必要時のみ)"]
    VOL1[("vol: node_modules")]
    VOL2[("vol: sqlite-data")]
  end
  BR <--> TID
  BR -->|"localhost:5173"| WEB
  WEB -->|"/api を proxy"| SRV
  SRV --- VOL2
  WEB --- VOL1
  SRV --- VOL1
  E2E -->|"仮想認証器で操作"| WEB
```

| サービス | 役割 | 公開ポート | マウント |
|---|---|---|---|
| `deps` | `yarn install` を実行して終了する。CI（`CI=true`）では lockfile を書き換えない immutable install になる | なし | `.`（`/app`）、`node_modules`、`yarn_cache` |
| `web` | Vite 開発サーバー。`/api` を `server` へプロキシ | `127.0.0.1:${WEB_PORT:-5173}` | `.`（`/app`）、`node_modules` |
| `server` | Express API | 公開しない（`web` 経由のみ） | `.`（`/app`）、`node_modules`、`sqlite_data` |
| `e2e`（任意） | Playwright のヘッドレス Chromium。`profiles` で必要時のみ起動。`network_mode: service:web` で web と同じネットワークを使い、`http://localhost:<WEB_PORT>` を開く（D29） | なし | `.`（`/app`）、`node_modules`（Node のバージョンが同じで依存は JS のみなので共有） |
| `tunnel`（任意） | ngrok / cloudflared。クロスデバイス認証を試すときだけ `profiles` で起動 | なし | なし |

**WebAuthn との整合**

- ブラウザから見た origin は `http://localhost:5173` になる。コンテナ内部のホスト名（`server` 等）は origin に現れないので、RP ID は `localhost` のままでよい。
- フロントと API を Vite のプロキシで同一オリジンにまとめ、CORS と Cookie の SameSite 問題を避ける。
- ポートは `127.0.0.1` にのみバインドし、LAN 内の他端末からは見えないようにする。
- RP ID・許可 origin は環境変数（`RP_ID`、`RP_ORIGIN`）で渡し、トンネル利用時に切り替えられるようにする。

**基本操作**

| 操作 | コマンド |
|---|---|
| 起動 | `docker compose up -d` |
| ログ確認 | `docker compose logs -f server` |
| 検査（typecheck → lint → test） | `docker compose run --rm server yarn check` |
| E2E | `bash scripts/e2e.sh`（専用のプロジェクト名・ボリューム・ポートで起動し、終わったら消す。開発用の DB を汚さない） |
| DBを覗く | `docker compose exec server sqlite3 /data/app.db`（`sqlite3` CLI は Dockerfile で入れる） |
| 完全初期化 | `docker compose down -v` |
| クロスデバイス試験 | `docker compose --profile tunnel up -d` |

### 実行環境の制約

- WebAuthn はセキュアコンテキストでしか動かない。`http://localhost` は例外として許可されるので、PoCは `localhost` で動かす。
- RP ID は origin のホスト名と一致するか、その上位ドメインである必要がある。`127.0.0.1` と `localhost` は別物として扱われるので混在させない（ポートのバインド先が `127.0.0.1` でも、ブラウザでは `localhost` で開く）。
- スマホを使ったクロスデバイス認証（QRコード経由）を試す場合は、`tunnel` サービスで HTTPS の公開URLを用意し、`RP_ID` と `RP_ORIGIN` をそのドメインに切り替える。RP ID が変わると既存のパスキーは使えなくなるので、DBも初期化する。

## 5. 処理フロー

### 5.1 登録（Registration / Attestation）

```mermaid
sequenceDiagram
  autonumber
  participant U as ユーザー
  participant B as ブラウザ
  participant A as 認証器
  participant S as RPサーバー
  participant D as DB

  U->>B: 表示名を入力して「パスキーを作成」
  B->>S: POST /api/register/options {displayName}
  S->>S: userHandle を乱数生成（64byte以内）
  S->>S: challenge を乱数生成（32byte）
  S->>D: challenge を保存（用途=register, 有効期限5分）
  S-->>B: PublicKeyCredentialCreationOptions + Set-Cookie: ceremony=<行ID>
  B->>A: navigator.credentials.create()
  A->>U: 生体認証 / PIN を要求
  U->>A: 本人確認
  A->>A: 鍵ペア生成、秘密鍵を保持
  A-->>B: attestationObject + clientDataJSON
  B->>S: POST /api/register/verify（Cookie: ceremony）
  S->>D: Cookie の行IDで challenge を取得し即削除（使い捨て）
  S->>S: 6章の登録時検証
  S->>D: user と credential（公開鍵, signCount, BE/BS, transports）を保存
  S->>S: セッション発行
  S-->>B: 登録完了
```

登録オプションの主な値:

| 項目 | 値 | 意図 |
|---|---|---|
| `rp.id` | `localhost` | 鍵を紐づけるドメイン |
| `user.id` | 乱数（base64url） | 個人情報を認証器に保存しない |
| `pubKeyCredParams` | ES256(-7), RS256(-257) | 主要な認証器をカバー |
| `authenticatorSelection.residentKey` | `required` | パスキー（ユーザー名なしログイン）にする |
| `authenticatorSelection.userVerification` | `required` | 生体・PINを必須にする |
| `attestation` | `none` | 機種検証は対象外 |
| `excludeCredentials` | そのユーザーの既存credential | 同じ認証器への二重登録を防ぐ |
| `timeout` | 300000 ms | |

### 5.2 認証（Authentication / Assertion）

```mermaid
sequenceDiagram
  autonumber
  participant U as ユーザー
  participant B as ブラウザ
  participant A as 認証器
  participant S as RPサーバー
  participant D as DB

  B->>S: POST /api/login/options
  S->>S: challenge 生成
  S->>D: challenge 保存（用途=login）
  S-->>B: PublicKeyCredentialRequestOptions（allowCredentials は空）+ Set-Cookie: ceremony=<行ID>
  B->>A: navigator.credentials.get()（mediation: conditional も可）
  A->>U: 保存済みパスキーの選択と本人確認
  U->>A: 本人確認
  A->>A: authenticatorData ‖ SHA-256(clientDataJSON) に署名
  A-->>B: authenticatorData + clientDataJSON + signature + userHandle
  B->>S: POST /api/login/verify（Cookie: ceremony）
  S->>D: Cookie の行IDで challenge を取得し即削除
  S->>D: credentialId で credential を、userHandle でユーザーを検索し、credential がそのユーザーのものか確認（L2）
  S->>S: 6章の認証時検証（公開鍵で署名検証）
  S->>D: signCount, last_used_at, BS を更新
  S->>S: 既存セッションを破棄し新しいセッションIDを発行
  S-->>B: ログイン完了
```

`allowCredentials` を空にすることで、ユーザーがIDを入力せずに認証器側のパスキー一覧から選べる。サーバーは返ってきた `userHandle` と `credentialId` からユーザーを特定する。

セッションは `userHandle` が指すユーザーに対して発行する。`credentialId` の持ち主ではなく `userHandle` を起点にするのは、仕様の手順どおりであり、L2 を外したときに「攻撃者が自分の鍵で署名し、被害者の `userHandle` を送ると被害者としてログインできる」ことを再現できるため（D28）。

### 5.3 ステップアップ認証（送金前の再認証）

二次被害対策の中心。ログイン済みセッションを盗まれても、送金にはその場でのパスキー署名が要る状態を作る。

```mermaid
sequenceDiagram
  autonumber
  participant B as ブラウザ
  participant A as 認証器
  participant S as RPサーバー

  B->>S: POST /api/transfer {to, amount}
  S->>S: セッションの stepup_at を確認
  alt stepup_at が5分以内 かつ 同じ取引内容
    S-->>B: 200 送金完了
  else 期限切れ or 未実施
    S-->>B: 401 {error: "step_up_required"}
    B->>S: POST /api/stepup/options {to, amount}
    S->>S: challenge 生成。取引内容のハッシュと紐づけて保存
    S-->>B: RequestOptions（allowCredentials = そのユーザーの credential のみ）
    B->>A: navigator.credentials.get()
    A-->>B: assertion
    B->>S: POST /api/stepup/verify
    S->>S: 認証時検証 + セッションのユーザーと credential の所有者が一致するか確認
    S->>S: stepup_at と承認済み取引ハッシュをセッションに記録
    S-->>B: 200
    B->>S: POST /api/transfer {to, amount}（再送）
    S-->>B: 200 送金完了（承認済み取引ハッシュは使い捨て）
  end
```

設計上のポイント:

- challenge を取引内容（送金先・金額）に紐づける。承認後に金額を書き換えても通らない。
- 承認は1回の取引にのみ有効で、使ったら消す。
- `allowCredentials` をログイン中ユーザーの鍵に限定し、別人の鍵での承認を拒否する。
- ブラウザ上で改ざんされた画面に騙されて承認するリスクは残る（WebAuthn は取引内容を認証器に表示しない）。この限界は9章に記す。

## 6. サーバー側の検証項目

PoCの学習の中心。ライブラリが内部で行う検証を列挙し、各項目に対して「外すと何が通るか」をテストで再現する。

### 6.0 検証パイプライン（自前実装）

ライブラリの `verify*Response` は全項目を一括で検証するため、1項目だけ外せない。そこで検証を自前で実装し、項目ごとに独立した関数にする。

```ts
// 各検証は ID（C1, A3 など）を持つ独立した関数
type Check = { id: CheckId; run: (ctx: CeremonyContext) => void }; // 失敗時は CheckError(id) を投げる

// 本番経路は定数のリストだけを使う
export const AUTHENTICATION_CHECKS: readonly Check[] = [checkType, checkChallenge, checkOrigin, /* ... */];

export function runChecks(ctx: CeremonyContext, checks: readonly Check[]) { /* 順に実行 */ }
```

- **処理の分担**: CBOR のデコードだけ `cbor-x` に任せる。authenticatorData のバイト列の分解（rpIdHash 32byte、flags 1byte、signCount 4byte、attestedCredentialData）、COSE 鍵から `node:crypto` の公開鍵への変換、署名検証は自前で書く。
- **外す方法**: テストでは `AUTHENTICATION_CHECKS` から1項目を除いたリストを `runChecks` に渡し、改ざんした応答が通ることを示す。本番のルートが受け取るのは定数のリストだけで、検証を無効にするフラグや環境変数は作らない（無効化の経路を本番コードに残さない）。
- **自前実装の誤りへの備え**: 同じ入力（正常系と攻撃パターン）を `@simplewebauthn/server` にも通し、受理するか拒否するかの判定が一致することを差分テストで確認する。食い違った場合は、どちらが仕様（W3C WebAuthn Level 3 の 7章）に沿っているかを調べ、結果を `02-knowledge-passkey.md` に記録する。
- **エラーの返し方**: `CheckError` は失敗した項目の ID を持ち、7章のエラーコードへ変換する。どの検証で落ちたかをログと `/api/debug/last-ceremony` で確認できるようにする。

### 6.1 共通（clientDataJSON）

| # | 検証 | 外した場合に通る攻撃 |
|---|---|---|
| C1 | `type` が `webauthn.create` / `webauthn.get` | 登録用の応答を認証に流用 |
| C2 | `challenge` がサーバー発行の未使用・期限内の値と一致 | リプレイ攻撃（過去の署名の再送） |
| C3 | `origin` が許可 origin（`RP_ORIGIN`）と完全一致し、`crossOrigin` が true でない | フィッシングサイト経由の応答、他サイトの iframe から呼ばせた応答を受理 |
| C4 | challenge を、他のどの検査よりも、また attestationObject のデコードよりも先に削除する（検証の成否にかかわらず使い捨て）。同時に2つのリクエストが行を見つけた場合は、削除できた方だけが続行する | 同じ challenge での二重登録・二重ログイン、壊れた応答を送って challenge を使い回すこと |
| C5 | challenge が要求元のブラウザに発行されたもの（challenge の値で引いた行の ID が一時 Cookie `ceremony` の値と一致。ステップアップでは行の `user_id` がセッションのユーザーと一致） | 漏れた署名済み応答（XSS での窃取、ログへの混入など）を、攻撃者が別のブラウザから送って受理される |

### 6.2 authenticatorData

| # | 検証 | 外した場合に通る攻撃 |
|---|---|---|
| A1 | `rpIdHash` が SHA-256(`localhost`) と一致 | 別ドメイン用の鍵による署名を受理 |
| A2 | UP フラグが立っている | ユーザー不在での自動署名 |
| A3 | UV フラグが立っている | 端末を拾った第三者が生体・PINなしで使用 |
| A4 | `signCount` が前回より大きい（両方0なら同期パスキーとして許容） | 複製された認証器の検知漏れ |

### 6.3 登録時のみ

| # | 検証 | 意図 |
|---|---|---|
| R1 | 公開鍵のアルゴリズムが要求した `pubKeyCredParams` に含まれる | 弱いアルゴリズムの混入防止 |
| R2 | `credentialId` が未登録 | 他人の credential の乗っ取り防止 |
| R3 | BE / BS の組み合わせが正しい（BS=1 なら BE=1）。正しいものを保存する | 同期型か端末固定型かを後で判断材料にする。矛盾したフラグを信用しない |
| R4 | `credentialId` が 1023 バイト以下（WebAuthn L3 §7.1） | 巨大な ID が主キーとして保存され、allowCredentials 等で送り返され続ける |
| R5 | RSA 鍵は 2048 ビット以上かつ e = 65537（ES256、Ed25519 は鍵長固定なので対象外） | 素因数分解できる弱い鍵が登録され、署名を偽造される |

### 6.4 認証時のみ

| # | 検証 | 意図 |
|---|---|---|
| L1 | `credentialId` が登録済み | 未知の鍵の拒否 |
| L2 | 返ってきた `userHandle` と credential の所有者が一致 | credential とユーザーの取り違え防止 |
| L3 | 保存した公開鍵で `authenticatorData ‖ SHA-256(clientDataJSON)` の署名を検証 | 署名偽造の拒否。認証の本体 |

## 7. API 仕様

全API は JSON。認証済み API はセッションCookie（`HttpOnly; SameSite=Lax; Path=/`、HTTPS時は `Secure`）を要求する。状態変更系は `Origin` ヘッダーを検証して CSRF を防ぐ。

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| POST | `/api/register/options` | 不要 | 新規ユーザーの登録オプションを返す |
| POST | `/api/register/verify` | 不要 | attestation を検証しユーザーと credential を作成、ログイン状態にする |
| POST | `/api/credentials/options` | 要 | ログイン中ユーザーに追加するパスキーの登録オプション |
| POST | `/api/credentials/verify` | 要 | 追加パスキーを検証・保存 |
| GET | `/api/credentials` | 要 | 登録済みパスキー一覧（作成日、最終利用日、BE/BS、transports） |
| DELETE | `/api/credentials/:id` | 要 + ステップアップ | パスキー削除。最後の1本は削除不可 |
| POST | `/api/login/options` | 不要 | 認証オプションを返す |
| POST | `/api/login/verify` | 不要 | assertion を検証しセッションを発行 |
| POST | `/api/logout` | 要 | セッション破棄 |
| GET | `/api/me` | 要 | ユーザー情報と `auth_at` / `stepup_at` |
| POST | `/api/stepup/options` | 要 | 取引内容に紐づく再認証オプション |
| POST | `/api/stepup/verify` | 要 | 再認証を検証しセッションに承認を記録 |
| POST | `/api/transfer` | 要 + ステップアップ | 模擬送金。残高を減らし履歴を記録する |
| GET | `/api/debug/last-ceremony` | 開発時のみ | 直近の登録・認証のデコード結果を返す（学習用の可視化） |

エラー応答は `{ "error": "<code>", "detail": "<人間向け説明>" }` に統一する。主なコードは `invalid_challenge`、`invalid_origin`、`user_verification_required`、`unknown_credential`、`signature_invalid`、`step_up_required`。

6章の検証で拒否した場合は、どの項目で落ちたかを `check`（`C3` など）で返す（学習用の可視化）。検証項目とコードの対応は `server/src/http/errors.ts` の `CHECK_ERROR_CODES` にある。デコードできない応答は `malformed_response`、リクエスト本文の形式違反は `invalid_request`、`Origin` ヘッダーの不一致は `invalid_request_origin`（403）。

## 8. データモデル

```mermaid
erDiagram
  users ||--o{ credentials : has
  users ||--o{ sessions : has
  users ||--o{ transfers : makes

  users {
    text id PK "内部ID (UUID)"
    blob user_handle UK "WebAuthn user.id (乱数)"
    text display_name
    integer balance "模擬残高"
    text created_at
  }
  credentials {
    blob id PK "credentialId"
    text user_id FK
    blob public_key "COSE形式"
    integer sign_count
    text transports "JSON配列"
    integer backup_eligible "BE"
    integer backup_state "BS"
    text aaguid "認証器の種類 (none でもゼロとは限らない。1Password は自社の値を返す)"
    text created_at
    text last_used_at
  }
  challenges {
    text id PK
    blob challenge
    text purpose "register / login / stepup"
    blob user_handle "register時のみ。options で生成した userHandle"
    text display_name "register時のみ"
    text user_id "stepup時のみ"
    text tx_hash "stepup時の取引ハッシュ"
    text expires_at
  }
  sessions {
    text id PK "SHA-256(トークン)。トークン(32byte乱数)は Cookie にだけある"
    text user_id FK
    text auth_at "ログイン(または登録)時刻"
    text last_seen_at "最終アクセス(アイドル期限用)"
    text stepup_at "直近の再認証時刻"
    text approved_tx_hash "承認済み取引 (使い捨て)"
    text expires_at
  }
  transfers {
    text id PK
    text user_id FK
    text to_account
    integer amount
    text created_at
  }
```

challenge は登録・認証前のためユーザーと紐づかないことが多く、セッションではなくDBに置いて使い捨てを保証する。期限切れの行は起動時と定期的に削除する。

**challenge の照合（C2, C5）**: 行は clientDataJSON の challenge の値で引き（C2）、その行の ID が一時 Cookie の値と一致するかを別の検査として確かめる（C5）。Cookie の値で直接引くと照合が行の取り出し方に埋め込まれ、C5 だけを外して攻撃を再現できないため（D21。D14 の縛りの強さは変わらない）。

- Cookie: `ceremony=<行ID>; HttpOnly; SameSite=Strict; Path=/api; Max-Age=300`（HTTPS 時は `Secure`）
- verify: `SELECT * FROM challenges WHERE challenge = ?` で行を引き（`challenge` 列は UNIQUE）、C2 で用途と期限、C4 で `DELETE FROM challenges WHERE id = ? RETURNING id` による消費、C5 で Cookie との一致を確かめる
- ステップアップはログイン中なので一時 Cookie を使わず、行の `user_id` とセッションのユーザーの一致で縛る
- 判断の経緯は decisions の D14、D21

登録の options から verify までの一時状態（`user_handle`、`display_name`）も challenge の行に持たせる。`users` の行は verify が成功したときに初めて作るので、途中で離脱しても未完成のユーザーが残らない。

- **プロセスのメモリに置かない理由**: `tsx watch` は保存のたびにプロセスを再起動するため、メモリに置くと ceremony の途中で状態が消える。DB なら `sqlite3` で中身も覗ける。
- **削除は1文で行い、成否を見る**: `DELETE FROM challenges WHERE id = ? RETURNING id` が行を返さなければ、別のリクエストが先に使ったとみなして拒否する（C4）。C4 はパイプラインの先頭で実行し、attestationObject のデコードはその後まで遅らせる（D24）。後続の検査が失敗しても、応答が壊れていても、challenge は使い捨てになる。
- **実運用との対応**: 本番でサーバーを複数台にするなら Redis 等の共有ストアに TTL 付きで置き、`GETDEL` で取り出すのが一般的。SQLite の構成はその縮小版として扱う。

### セッション方針

| 項目 | 値 |
|---|---|
| 方式 | サーバー側セッション（JWTは使わない。即時失効を確実にするため） |
| ID再発行 | ログイン時・登録完了時・ステップアップ時に再発行（セッション固定攻撃対策）。既存のセッションは破棄する |
| 保存形式 | DB にはトークンの SHA-256 だけを置く。DB が漏れても有効なセッションは渡らない（D27） |
| Cookie | `session`。`HttpOnly; SameSite=Lax; Path=/`、HTTPS 時は `Secure`。状態変更系は `Origin` ヘッダーの検証で CSRF を防ぐ |
| アイドル期限 | 30分 |
| 絶対期限 | 8時間 |
| ステップアップ有効期間 | 5分、かつ承認した1取引のみ |

## 9. 脅威モデルと限界

| 脅威 | PoCでの対策 | 残るリスク |
|---|---|---|
| フィッシング（AiTM含む） | origin / rpIdHash 検証（C3, A1） | なし（WebAuthnの構造で防がれる） |
| リプレイ | challenge の使い捨て（C2, C4）、要求元ブラウザへの紐づけ（C5） | なし |
| サーバーDB漏洩 | 公開鍵しか持たない | セッションIDが漏れると有効期間中は悪用される |
| 盗まれたセッションでの送金 | ステップアップ必須 | ステップアップ有効期間（5分）内の窃取 |
| 承認後の取引改ざん | challenge を取引ハッシュに紐づけ | なし |
| 画面改ざんによる誤承認（Man-in-the-Browser） | 対象外 | 認証器は取引内容を表示しないため残る。本番では別経路での通知・確認が必要 |
| 端末の乗っ取り | UV必須（A3） | ロック解除済み端末を操作される場合は防げない |
| 同期元（iCloud、Google、1Password 等）の乗っ取り、またはロック解除中の端末へのマルウェア | BE/BS と AAGUID を記録し可視化 | 防げない。保管庫が開かれれば秘密鍵も使われる。高リスク用途では端末固定鍵（BE=0）の要求を検討 |
| アカウント復旧の悪用 | 対象外（複数パスキー登録を促すのみ） | 本番では復旧経路が最弱点になる。設計の要検討事項 |

## 10. ディレクトリ構成（予定）

```
try-pass-key/
├── CLAUDE.md                   # AI向けの入口。構成、コマンド、守るべき不変条件
├── package.json                # workspaces: [server, web, shared, e2e]。check / lint / typecheck / test / e2e
├── .yarnrc.yml                 # Yarn 4（corepack）、nodeLinker: node-modules
├── tsconfig.base.json          # strict + noUncheckedIndexedAccess。各 workspace が extends
├── eslint.config.js            # 全 workspace 共通（import 境界、skip 禁止を含む）
├── Dockerfile                  # 開発用イメージ（server / web 共用、sqlite3 CLI 入り）
├── compose.yaml                # web / server / e2e / tunnel(任意) とボリューム定義
├── .env.example                # RP_ID, RP_ORIGIN など
├── docs/
│   ├── 00-background.md
│   ├── 01-architecture-proposal-poc.md
│   ├── 02-knowledge-passkey.md
│   ├── decisions.md            # 判断の記録
│   └── worklog/                # 日ごとの作業ログ
├── plans/                      # マイルストーンごとの実装計画（AIに渡す単位）
├── prompts/                    # AIに渡すプロンプトの雛形（実装、レビュー、攻撃再現）
├── shared/                     # @app/shared。ビルドせず .ts を exports で直接公開
│   ├── package.json
│   └── src/schema.ts           # zod スキーマ。API の入出力を server と web で共有
├── e2e/                        # Playwright + 仮想認証器（Playwright 公式イメージで実行）
│   └── package.json
├── server/
│   ├── package.json
│   ├── src/
│   │   ├── index.ts            # Express アプリ起動
│   │   ├── config.ts           # RP ID, origin, 期限値
│   │   ├── db.ts               # SQLite 接続とスキーマ
│   │   ├── routes/
│   │   │   ├── register.ts
│   │   │   ├── login.ts
│   │   │   ├── credentials.ts
│   │   │   ├── stepup.ts
│   │   │   └── transfer.ts
│   │   ├── webauthn/
│   │   │   ├── CLAUDE.md       # このディレクトリの不変条件（15.1）
│   │   │   ├── options.ts      # Creation / Request options の生成
│   │   │   ├── parse.ts        # clientDataJSON、authenticatorData、attestationObject の分解
│   │   │   ├── cose.ts         # COSE 鍵 → node:crypto KeyObject
│   │   │   ├── checks/         # 6章の検証を1項目1関数で。テストを隣に置く
│   │   │   │   ├── C1.ts
│   │   │   │   ├── C1.test.ts
│   │   │   │   └── ...
│   │   │   ├── pipeline.ts     # REGISTRATION_CHECKS / AUTHENTICATION_CHECKS と runChecks
│   │   │   └── debug.ts        # デバッグ用デコード
│   │   └── session/            # セッション、ステップアップ判定ミドルウェア
│   └── test/                   # 複数の検証にまたがるテスト
│       ├── soft-authenticator.ts # テスト用のソフトウェア認証器
│       ├── pipeline.test.ts    # パイプラインの検証 ID が 6章の一覧と完全一致するか
│       ├── attacks.test.ts     # 攻撃再現（改ざんした応答を投げる、1項目外すと通る）
│       └── differential.test.ts # 自前パイプラインと @simplewebauthn/server の判定一致
└── web/
    ├── package.json
    ├── vite.config.ts          # /api を server へプロキシ
    ├── index.html
    └── src/
        ├── main.ts
        ├── register.ts
        ├── login.ts
        ├── transfer.ts
        └── inspector.ts        # clientDataJSON / フラグの可視化
```

攻撃再現テストでは、本物の認証器の代わりにテスト内で鍵ペアを作って署名する「ソフトウェア認証器」を用意する。これにより origin や rpIdHash を自由に改ざんした応答を作れる。

## 11. マイルストーン

| # | 内容 | 完了条件 |
|---|---|---|
| M1 | 骨組み | `docker compose up` だけでサーバーとフロントが起動し、SQLite のスキーマが作成される。ホストに `node_modules` やDBファイルが作られない |
| M2 | 登録 | ブラウザでパスキーを作成し、credentials テーブルに公開鍵が入る |
| M3 | ログイン | ユーザー名なしでログインでき、`/api/me` が返る。Conditional UI も動く |
| M4 | 可視化 | 直近の ceremony の clientDataJSON、フラグ、signCount を画面に表示できる |
| M5 | 検証テスト | 6章の全項目に対し、正常系と「その項目を外したパイプラインでは攻撃が通る」異常系のテストがある。差分テストで `@simplewebauthn/server` と判定が一致する |
| M6 | ステップアップ | 送金前の再認証が動き、期限切れ・取引改ざん・他人の鍵が拒否される |
| M7 | 複数パスキー | 2本目の追加、一覧、削除（ステップアップ付き）ができる |
| M8 | 振り返り | 学んだこと、9章の残リスクへの考察を docs/ にまとめる |

## 12. 受け入れ基準

- [ ] ホストに Docker 以外をインストールせずに、起動・テスト・初期化ができる
- [ ] `docker compose down -v` の後に `up` すると、ユーザー0件のまっさらな状態に戻る
- [ ] Chrome と Safari の両方で、登録とユーザー名なしログインが成功する
- [ ] 6章の C1〜C5、A1〜A4、R1〜R5、L1〜L3 のそれぞれにテストがあり、すべて通る
- [ ] origin を改ざんした assertion、使用済み challenge の再送、別ブラウザに発行された challenge での応答、UV=0 の assertion が拒否されることをテストで示せる
- [ ] ログイン済みでもステップアップなしの送金が `step_up_required` で拒否される
- [ ] ステップアップ後に金額を変えた送金が拒否される
- [ ] ログイン時にセッションIDが変わる
- [ ] パスキーで防げる脅威と防げない脅威を、9章の表を使って説明できる

## 13. 未決事項

| # | 論点 | 現時点の案 |
|---|---|---|
| Q1 | クロスデバイス認証（スマホでQR）を試すか | M7以降の任意課題。ngrok で HTTPS 化して試す |
| Q2 | 検証ロジックをライブラリに頼らず自作する範囲 | 決定（D11）: 6章の全項目を自前パイプラインで実装する。CBOR デコードのみ `cbor-x`。`@simplewebauthn/server` はテストでの比較用 |
| Q3 | ステップアップ有効期間 | 5分で開始し、体験してから調整する |
| Q4 | 端末固定鍵（BE=0）を高リスク操作で必須にするか | PoCでは記録・表示のみ。考察を M8 にまとめる |
| Q5 | 別方式（02 の3章）をどれから試すか | M8 の振り返りで、パスキーで残ったリスクに効くものから選ぶ |

## 14. 別方式PoCへの拡張

パスキー以外の方式（DPoP / DBSC、端末固定のセキュリティキー、mTLS など）を試す場合は、本PoCとは別ディレクトリ（`poc-<方式名>/`）に Docker で独立して構築し、互いに影響しないようにする。候補と比較は [02-knowledge-passkey.md](./02-knowledge-passkey.md) の3章にまとめた。

## 15. AI駆動開発の方針

本PoCは AI（Claude Code 等）に実装させる前提で進める。AI が読みやすく、AI が自分で正しさを確かめられる形にする。

### 15.1 AI が理解しやすい構成

| 方針 | 具体策 |
|---|---|
| 仕様を型とスキーマに寄せる | API の入出力・設定・DB行を `shared/src/schema.ts`（`@app/shared`）の zod で定義する。ビルドせず `.ts` を直接 export するので、古い成果物を読む取り違えが起きない。AI は文章より型を正確に読む |
| 入口を1つにする | `CLAUDE.md` に構成、コマンド（すべて `docker compose` 経由）、6章の検証項目を「消してはいけない不変条件」として書く |
| 作業単位を明示する | マイルストーンごとに `plans/` に計画を置き、AI にはその単位で渡す |
| プロンプトを資産にする | よく使う指示を `prompts/` に置く。例: 「6章の検証項目を1つ外して、通ってしまう攻撃のテストを書け」 |
| 検証コマンドを1本にする | `docker compose run --rm server yarn check`（typecheck → lint → test）だけを AI に毎回実行させ、通るまで完了扱いにしない。E2E は遅いので `yarn e2e` に分ける。コンテナ内で動くので AI が環境を壊してもホストに影響しない |
| コンテキストを近くに置く | 検証の関数とそのテストを隣に置く（`checks/C1.ts` と `checks/C1.test.ts`）。`server/src/webauthn/CLAUDE.md` に、検証無効化フラグの禁止、6章との対応、差分テストの意味を書く。ルートの `CLAUDE.md` は短く保つ |
| 1ファイル1責務 | ルート、検証、セッションを分け、AI が読む範囲を狭くする |

### 15.2 ルールをツールで強制する

文章で頼むだけのルールは、AI がテストを通そうとしたときに破られる。破ったら `yarn check` が落ちる形にする。

| ルール | 強制する手段 |
|---|---|
| 攻撃再現テストを skip させない（K4） | `@vitest/eslint-plugin` の `no-disabled-tests` / `no-focused-tests` をエラーにする |
| 検証項目を減らさせない | `REGISTRATION_CHECKS` / `AUTHENTICATION_CHECKS` の ID が 6章の一覧と完全一致することを `pipeline.test.ts` で確かめる。リストから1項目消すとこのテストが落ちる |
| 層をまたぐ import をさせない | `no-restricted-imports` で `web` → `server`、`checks/` → `routes/` を禁止する |
| バイト列解析での範囲外アクセス | `tsconfig.base.json` で `strict` + `noUncheckedIndexedAccess`。`buf[i]` が `undefined` になりうることを型で検出する |

### 15.3 人手なしで回るテスト

パスキーは本来 Touch ID などの操作が要るので、そのままでは AI が自力で動作確認できない。そこで次の2段構えにする。

- **単体・攻撃再現（Vitest）**: テスト内のソフトウェア認証器で署名を作る（10章）。
- **E2E（Playwright）**: Chromium の仮想認証器（CDP の `WebAuthn.addVirtualAuthenticator`）を使い、登録→ログイン→ステップアップ→送金をブラウザ操作として通す。コンテナ内のヘッドレス Chromium で動くので、AI が実装後に自分で回せる。

実機（Touch ID、Safari、スマホ）での確認は人が行い、12章の受け入れ基準でチェックする。

## 16. 懸念点と対策

| # | 懸念 | 影響 | 対策 |
|---|---|---|---|
| K1 | 実機で試すと、`localhost` 用のパスキーが iCloud キーチェーンや Google パスワードマネージャーに残る | 実害はない（`localhost` 以外では使われず、既存のパスキーにも触れない）。一覧が散らかる程度 | 普段の開発は仮想認証器（DevTools / E2E）で行い、実機確認後は不要なパスキーを削除する。表示名にはテスト用の名前を使う。詳細は [02-knowledge-passkey.md](./02-knowledge-passkey.md) の1章 |
| K2 | `docker compose down -v` でDBを消しても、認証器側にはパスキーが残る | 使えないパスキーが一覧に出続け、選ぶと `unknown_credential` になる | 学習項目として扱う。Signal API（`PublicKeyCredential.signalUnknownCredential` など）で認証器に削除を伝える実装を M7 の任意課題にする |
| K3 | RP ID を変えると既存のパスキーがすべて使えなくなる | トンネル利用時に毎回作り直しになる | `.env` で切り替え、切り替え時はDBも初期化する手順を `CLAUDE.md` に書く |
| K4 | AI がテストを通すために検証を緩める | 6章の検証が抜けたまま「動く」状態になる。学習目的が崩れる | 6章の各項目に対応する攻撃再現テストを先に書き（TDD）、`CLAUDE.md` に「攻撃再現テストを消す・skip する変更は禁止」と明記する |
| K5 | `/api/debug/last-ceremony` が他のコードに混ざって残る | 本番に持ち込むと情報漏洩になる | `NODE_ENV=development` のときだけルートを登録する。PoCを本番に流用しない前提も `CLAUDE.md` に書く |
| K6 | macOS の Docker でバインドマウントのファイル監視が遅い・効かない | ホットリロードが不安定になる。M1 で実際に発生した（Rancher Desktop。変更イベントが届かず、ファイルの追加・削除がコンテナから見えるまで約10〜12秒遅れる） | ポーリングを既定にした（`WATCH_POLLING=true`。tsx は `CHOKIDAR_USEPOLLING`、Vite は `server.watch.usePolling`）。遅延はホストのファイル共有方式が原因なので、気になる場合は Docker 実行環境の共有方式（virtiofs 等）を見直す |
| K7 | Safari と Chrome で挙動が違う（Conditional UI、エラーの出方） | Chrome だけで作ると Safari で動かない | 12章の受け入れ基準どおり両方で確認する。差分は M8 の振り返りに記録する |
| K8 | 一時 Cookie `ceremony` は1つしか持てない | 複数タブで同時に ceremony を始めると、後のタブが前のタブの challenge を上書きし、前のタブは `invalid_challenge` になる。Conditional UI はページ表示時に options を取るので起きやすい | PoC では失敗させ、options を取り直す（Conditional UI は再起動）。本番で問題になる場合は Cookie に複数の行IDを持たせる |
| K9 | ブラウザは `localhost` を IPv6 の `::1` から試す。別の開発サーバーが `[::1]:5173` で待ち受けていると、そちらが応答する | 本PoCではなく別アプリの画面や API が返る。Docker 側は衝突を報告しない（M1 で発生） | `.env` の `WEB_PORT` で空いているポートに変える（`RP_ORIGIN` も自動で追従する）。画面の「サーバー状態」に `status: ok` とテーブル一覧が出ることで見分ける |
| K10 | Chromium の仮想認証器（自動のユーザー存在シミュレーション）は、Conditional UI の要求にもすぐ応答する | 実機ではユーザーが候補を選ぶまで待つ要求が、E2E では即座にログインになる。ログアウト直後に再ログインしてしまい、ボタンでのログインを試せない（M3 で発生） | E2E を分ける。Conditional UI はその自動応答で確かめ、ボタンでのログインは `isConditionalMediationAvailable` を false にして「Conditional UI 非対応のブラウザ」として確かめる。実機での Conditional UI は人が確認する |
