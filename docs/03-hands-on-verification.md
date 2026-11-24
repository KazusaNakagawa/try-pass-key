# 動作確認の手順: 実機と DB で仕組みを確かめる

- 作成日: 2026-11-23
- 位置づけ: 自分の手で動かして、設計（[01-architecture-proposal-poc.md](./01-architecture-proposal-poc.md)）どおりに動いているかを確かめる手順。結果と気づきは [worklog](./worklog/) に書く

自動テスト（`yarn check`、`bash scripts/e2e.sh`）はソフトウェア認証器と仮想認証器で動く。ここに書くのは、人が実機とツールで確かめる手順である。

---

## 1. 起動する

```bash
docker compose up -d --wait
```

ブラウザで `http://localhost:5173` を開く（`127.0.0.1` ではなく `localhost`）。

- 画面に別のアプリが出る場合、別の開発サーバーが `[::1]:5173` を使っている（K9）。`.env.example` を `.env` にコピーし、`WEB_PORT=5174` などに変えて起動し直す。以降の `5173` は読み替える
- サーバーが起動せず、ログに `database schema version ... is older` と出る場合、DB が古いスキーマで作られている（D26）。`docker compose down -v` で作り直す。そのときはパスワードマネージャーに残っている `localhost` のパスキーも削除する（DB を消すと使えなくなる）

## 2. 実機で登録・ログインする

### 登録

1. 「パスキーを作成」の表示名はテスト用の名前（`test-user-1` など）のままにする。表示名は認証器に保存されることがある（仕様上は任意。1Password は保存していた）。同期型なら他の端末にも渡ると考えられるが、未確認
2. 「パスキーを作成」を押し、1Password や iCloud キーチェーンなどの保存先を選んで保存する（Touch ID は保存先ではなく、鍵を使うときの本人確認）
3. 「登録しました」と結果が出て、「ログイン状態」が「ログイン中」になる（登録するとログインもする）

### ログイン（ボタン）

1. 「ログアウト」を押す
2. 「パスキーでログイン」を押す。名前は入力しない
3. 1Password などのパスキー選択が出るので選ぶ。「ログインしました」と出る

### ログイン（オートフィル = Conditional UI）

1. ログアウトし、ページを再読み込みする（ページを開いた時点で、裏でパスキーの待ち受けが始まる）
2. 「ユーザー名」の入力欄を空にして、クリックする。**ボタンは押さない**
3. 欄の下の候補（Chrome のオートフィル、または 1Password のメニュー）にパスキーが出るので選ぶ
4. 「ログインしました**（オートフィル）**」と出れば Conditional UI での成功。ボタンで入った場合は「（オートフィル）」が付かない

### 「直近の ceremony」を読む

登録・ログインのたびに、画面下の「直近の ceremony」が更新される（開発時のみ、D33）。ページを再読み込みすると消える。

| 表示 | 見どころ |
|---|---|
| 見出し | `登録（受理）`、`ログイン（拒否: C3）` のように、結果と落ちた検証項目 |
| 検証 | 6章の項目を実行順に並べる。`✓` 通過、`✗` 拒否、`-` 実行されていない（前の項目で止まった） |
| 期待値 / 実際 | type、origin、rpIdHash を並べる。違う値は赤字になる |
| flags | UP / UV（本人確認）/ BE / BS（同期型か）/ AT（登録時の鍵データ）/ ED |
| signCount | ログインでは「保存値」と並べる。1Password の同期パスキーは両方 0 のまま（A4 の「両方 0 なら許容」） |
| clientDataJSON | ブラウザが書いた JSON そのもの。challenge と origin がここに入り、認証器の署名の対象になる |

拒否の表示は、DB から鍵を消してからログインすると手で見られる。パスワードマネージャーには鍵が残るので、ブラウザは古い鍵で署名し、サーバーは L1（登録済みの鍵か）で拒否する。

```bash
docker compose exec server sqlite3 /data/app.db "PRAGMA foreign_keys = ON; DELETE FROM users;"
```

ログアウトしてから「パスキーでログイン」を押し、残っている鍵を選ぶと「ログイン（拒否: L1）」になり、L1 が `✗`、L2 以降が `-` になる。終わったらパスワードマネージャーの `localhost` のパスキーも消す。origin の改ざんなど、ブラウザが作らない応答は自動テスト（`server/test/login-attacks.test.ts`）で再現し、応答の `inspection` に同じ情報が入る。

Chrome + 1Password（macOS）では、候補を選ぶと Chrome のパスキー選択 → macOS の「サインイン」シート（提供元: 1Password）の順に確認が出た。

### よくある戸惑い

| 見えたもの | 理由 | どうするか |
|---|---|---|
| ログインを押したら、スマホ用の QR コードとセキュリティキーの案内が出た | このブラウザのどこにも `localhost` のパスキーがないので、Chrome が「別のデバイスのパスキー」を代わりに出している | キャンセルして、先に登録する。QR を用意する必要はない |
| パスワードマネージャーの項目名が登録した表示名と違う | 1Password は、保存時にページのユーザー名欄に入っていた文字を項目名にすることがある | 気にしなくてよい。サーバーは userHandle で識別し、項目名は使わない |
| 同じ名前のパスキーが複数並ぶ | 登録するたびに別ユーザーになる。表示名は区別に使われない | 不要なものは削除する |

## 3. DB の中身を見る

DB は Docker の名前付きボリュームの中にあり、ホストのフォルダからは開けない（D3）。写しを取り出して DB クライアントで開く。

```bash
bash scripts/db-snapshot.sh            # ~/Downloads/try-pass-key-snapshot.db
bash scripts/db-snapshot.sh ~/tmp/x.db # 書き出し先を指定
```

- 取り出した時点の写しなので、その後の操作を見るには再実行し、DB クライアントで更新する
- リポジトリの中には書き出せないようにしてある（公開リポジトリのため）
- コンテナ内で直接見る場合は `docker compose exec server sqlite3 /data/app.db`。行を削除するときは先に `PRAGMA foreign_keys = ON;` を実行する（しないと `ON DELETE CASCADE` が働かない）

### DBeaver で開く

1. 新しい接続で SQLite を選び、スナップショットのファイルを指定する
2. テーブル一覧は **Window → Database Navigator** で開き、接続 → Tables と展開する（左が「Files」のままだとテーブルが見えない）
3. SQL は SQL エディタに書いて Cmd + Enter で実行する

### 文字化けして見える列について

`credentials.id`、`credentials.public_key`、`users.user_handle` はバイナリ（BLOB）で、そのまま表示すると文字化けする。**暗号化されているわけではない。**

| 種類 | 列 | 説明 |
|---|---|---|
| バイナリ（そのまま） | `credentials.id`、`public_key`、`users.user_handle` | 16進で見れば読める。公開鍵は秘密ではないので、隠す必要がない。秘密鍵はサーバーに一度も来ない |
| ハッシュ | `sessions.id` | トークンの SHA-256。元のトークンには戻せない |
| 暗号化 | なし | この PoC では使っていない |

16進で見る SQL:

```sql
SELECT u.display_name, c.aaguid, c.sign_count, c.backup_eligible, c.backup_state,
       hex(c.id) AS credential_id, hex(c.public_key) AS public_key,
       c.created_at, c.last_used_at
FROM users u JOIN credentials c ON c.user_id = u.id;

PRAGMA user_version;  -- スキーマのバージョン（現在 2）
```

DBeaver 全体の表示を16進にするには、Settings → Editors → Data Editor → Binary で formatter を Hex にする。

### 公開鍵（COSE）を読む

ES256 の鍵は `A5 01 02 03 26 20 01 21 58 20 …` で始まる。

| バイト | 意味 |
|---|---|
| `A5` | 5項目の CBOR マップ |
| `01 02` | kty（鍵の種類）= 2（EC2、楕円曲線） |
| `03 26` | alg = -7（ES256） |
| `20 01` | crv = 1（P-256） |
| `21 58 20` + 32バイト | x 座標 |
| `22 58 20` + 32バイト | y 座標 |

サーバーの `server/src/webauthn/cose.ts` が x と y を取り出して公開鍵に変換し、ログインのたびに署名を確かめる（L3）。

### その他の列の読み方

| 列 | 見どころ |
|---|---|
| `credentials.aaguid` | 認証器の種類。1Password は `bada5566-a7aa-401f-bd96-45619a55120d`（`attestation: "none"` でもゼロにならない） |
| `credentials.sign_count` | 1Password の同期パスキーは 0 のままだった（iCloud は未確認）。E2E の仮想認証器では 1 から始まり、ログインのたびに増えた。仕様上、カウンタは SHOULD で、実装しない認証器は常に 0 を返す（WebAuthn L3 §6.1.1）ので、実物のセキュリティキーで 0 のままでも異常とは限らない（A4） |
| `credentials.backup_eligible` / `backup_state` | BE / BS。同期できる鍵か、同期済みか |
| `credentials.last_used_at` | ログインの検証を通るたびに更新される |
| `challenges` | 進行中・中断した ceremony の分だけ残る。期限切れは1分ごとに消える |

## 4. セッションを確かめる

### 期限を読む

```sql
SELECT id, auth_at, last_seen_at, expires_at FROM sessions;
```

- `expires_at` は `auth_at` のちょうど 8 時間後（絶対期限）
- `last_seen_at` はアクセスのたびに進み、ここから 30 分アクセスがないと切れる（アイドル期限）
- ログインのたびに古いセッションは消え、新しい ID が発行される（セッション固定対策）。ログイン中の行は1つだけになる

### Cookie と DB のハッシュを照合する

1. ブラウザの DevTools で **Application → Storage → Cookies → http://localhost:5173** を開き、`session` の Value をコピーする
2. 次のどちらかで SHA-256 → base64url を計算する

ターミナル（DevTools の Console ではない）:

```bash
printf %s '<コピーした値>' | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '='
```

DevTools の Console（JavaScript）:

```js
const t = '<コピーした値>';
const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
btoa(String.fromCharCode(...new Uint8Array(h))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
```

3. 結果が DB の `sessions.id` と一致すれば、「Cookie にはトークン、DB にはそのハッシュだけ」が確かめられる（D27）。DB が漏れても、ハッシュを Cookie に入れてもログインできない

Cookie の値はログイン中のセッションそのものなので、会話・記事・Issue には貼らない。

### HttpOnly を確かめる

DevTools の Console で次を実行する。

```js
document.cookie
```

`session` は出てこない。JavaScript からは読めないので、XSS があってもトークンは盗めない。ただし XSS のスクリプトは被害者のブラウザの中から API を呼べるので、HttpOnly だけで XSS の被害がなくなるわけではない。

## 5. 後片付け

- パスワードマネージャー（1Password、iCloud キーチェーン、Chrome）から `localhost` のパスキーを削除する。macOS はシステム設定の「パスワード」、Chrome は `chrome://password-manager`
- DB を作り直すなら `docker compose down -v`。パスキーと DB は片方だけ消すと、使えないパスキーや持ち主のいないユーザーが残る（K2）
- スナップショット（`~/Downloads/try-pass-key-snapshot.db`）も不要なら削除する
