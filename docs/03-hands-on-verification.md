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

登録・ログインのたびに、画面下の「直近の ceremony」が更新される（サーバーが `INSPECTION=on` のときのみ。compose の開発スタックは既定で on、D33・D34）。最初の ceremony が終わるまでセクションは出ない。ページを再読み込みすると消える。キャンセルなどで検証まで届かなかった操作のあとは、前回の内容を消して「表示する内容がありません」と出す。トンネルで自分以外の端末からも届く状態にするときは、`.env` に `INSPECTION=off` を書いて `docker compose up -d --wait` で作り直してもよい。

| 表示 | 見どころ |
|---|---|
| 見出し | `登録（受理）`、`ログイン（拒否: C3）` のように、結果と落ちた検証項目。応答をデコードできなかったときは `拒否: 形式エラー（A1 の実行中）` のように、デコードが走った項目を添える（その項目の判定で落ちたのではない） |
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

### 送金する（ステップアップ）

ログイン中は「送金（模擬）」が出る。残高は登録時に 100,000 入る（D39）。M6 より前に作ったユーザーは残高 0 のままなので、`docker compose down -v` で作り直すか、次で直す。

```bash
docker compose exec server sqlite3 /data/app.db "UPDATE users SET balance = 100000;"
```

1. 送金先（例: `test-account-1`）と金額（例: `1000`）を入れて「送金する」を押す
2. 最初の送金は `step_up_required` で断られ、画面が自動でステップアップを始める。パスキーの確認（Touch ID、1Password など）が出るので承認する。ログインと違い、候補にはログイン中のユーザーの鍵だけが出る（`allowCredentials`）
3. 承認後に同じ内容で送り直され、「送金しました」と残高・履歴が更新される。「直近の ceremony」に `ステップアップ（受理）` が出て、検証欄に S1 が並ぶ（L2 はない）
4. `#me` の `stepupAt` に承認の時刻が入る

ステップアップなしの送金が拒否されることは、DevTools の Console から送金 API を直接呼ぶと確かめられる（画面を通さないので、自動のステップアップは走らない）。

```js
await (await fetch('/api/transfer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'test-account-1', amount: 1000 }) })).json()
```

`{ error: 'step_up_required', check: 'S3', ... }` が返り、残高は変わらない。ログイン済みでも、承認がなければ送金できない（docs/01 §12 の受け入れ基準）。

金額の改ざん（S2）、期限切れ・2回目の送金（S3）、他人の鍵（S1）はブラウザ操作では作りにくい（画面は承認した内容のまま送り直し、候補には自分の鍵しか出ない）。自動テスト（`server/test/operation-gate-attacks.test.ts`、`server/test/stepup-attacks.test.ts`、`server/src/routes/transfer.test.ts`）で再現している。

### パスキーを追加・削除する（M7）

ログイン中は「パスキー」に、そのユーザーのパスキーが古い順に並ぶ。名前は AAGUID から引く（1Password、Apple Passwords、Google パスワードマネージャーなど。知らないものは AAGUID のまま）。M7 でスキーマが版 4 になったので、それより前の DB は `docker compose down -v` で作り直す。

1. 「パスキーを追加」を押す。まずステップアップ（ログイン中のユーザーの鍵で承認）が出る
2. 続けて新しいパスキーの作成が出る。**今のパスキーとは別の保存先**を選ぶ（例: 1Password で登録したなら、iCloud キーチェーンやスマホ）。同じ保存先を選ぶと `excludeCredentials` に当たって作成が拒否され、「パスキーを作成できませんでした」と出る
3. 拒否・キャンセルの後に、承認が残っているうち（残り1分以上。承認から4分以内）にもう一度押すと、ステップアップなしで作成からやり直せる。その間に送金や削除を試すと承認は消え、次はステップアップから始まる（D48）
4. 「パスキーを追加しました」と出て一覧が2行になる。「直近の ceremony」に `パスキー追加（受理）` が出る
5. ログアウトし、追加した方のパスキーだけでログインできることを確かめる（同じユーザーになる）
6. どちらかの行の「削除」を押す。ステップアップ（その鍵の削除の承認）の後に一覧が1行になる。1行だけのときは削除ボタンが押せない

DB では `credentials` が2行になり、`user_id` が同じ。追加中は `challenges` に `purpose = 'add_credential'` の行があり、`user_id` と `session_id` が入り、`tx_hash` は NULL。

```sql
SELECT hex(id), user_id, aaguid, backup_eligible, backup_state, created_at, last_used_at FROM credentials;
SELECT purpose, user_id, session_id, tx_hash FROM challenges;
```

ステップアップなしの削除が拒否されることは、Console から確かめられる（`<id>` は一覧の行の `data-credential-id`）。

```js
await (await fetch('/api/credentials/<id>', { method: 'DELETE' })).json()
```

`{ error: 'step_up_required', check: 'S3', ... }` が返る。

#### 実機での結果（2026-11-24、Chrome + 1Password）

- Apple Passwords（iCloud キーチェーン）での2本目の追加、2本の削除、最後の1本の削除ボタンが押せないことを確かめた。Apple Passwords の鍵は BE=1・BS=1、transports は `hybrid`・`internal`（一覧と `credentials` の値。1Password の鍵も BE=1・BS=1）
- 1Password を選ぶと、`excludeCredentials` に当たっても拒否されず、「既存をアップデート」が出た。選んでも新しい鍵として追加された（docs/02 §1.2、K11）。重複した鍵は「削除」で消せる
- 1Password の項目の「最終編集」時刻と、一覧の「作成」時刻を並べると、どの項目がどの鍵かを推測できる

#### Signal API の効き方を見る

削除した後に、パスワードマネージャーの `localhost` のパスキー一覧を見る。消した鍵が消えている、または隠れているかを確かめ、結果を docs/02 に書く。Chrome 132 以降が `signalAllAcceptedCredentials` に対応している（推測。Console で `typeof PublicKeyCredential.signalAllAcceptedCredentials` が `'function'` なら呼ばれる）。`docker compose down -v` の後に残った古いパスキーでログインを試すと、L1 で拒否されたときに `signalUnknownCredential` が呼ばれる。

### Safari で確かめる（未実施）

docs/01 §12 の「Chrome と Safari の両方で、登録とユーザー名なしログインが成功する」のうち、Safari はまだ確かめていない（docs/04 §2）。Chrome との違いを K7 に記録する。

準備: Safari の「設定 → 詳細 → Web デベロッパ用の機能を表示」をオンにすると、メニューに「開発」が出て Web インスペクタが使える。開発スタックは1章のとおり `docker compose up -d --wait` で起動し、http://localhost:5173 を開く（K9 で `.env` の `WEB_PORT` を変えている場合はそのポート）。

1. **登録**: 表示名を `test-safari-1` にして「パスキーを作成」を押す。どの保存先が提案されたか（iCloud キーチェーンか 1Password か）と、Touch ID が出たかを控える。「直近の ceremony」が `登録（受理）` で ✗ がないことを確かめる
2. **ログイン（ボタン）**: ログアウトし、「パスキーでログイン」で `test-safari-1` に入れることを確かめる
3. **ログイン（オートフィル）**: ログアウトし、ユーザー名の入力欄をクリックする。パスキーの候補が出るか、選ぶとログインできるかを確かめる。Chrome との違いが一番出やすいところ
4. **送金（ステップアップ）**: 送金先 `test-account-1`、金額 `1000` で送金し、残高が 99,000 になることを確かめる
5. **（任意）パスキーの追加**: 「パスキーを追加」で、ステップアップの後に別の保存先を選べるか試す
6. **控えること**: 各手順の成否と画面の違い、登録結果の `aaguid`・`transports`・`backupEligible`・`backupState`、Web インスペクタのコンソールのエラー

結果: （未実施。実施したらここに書き、docs/01 §12 のチェックと K7、docs/04 §2 を更新する）

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

### ステップアップの承認を読む

```sql
SELECT id, auth_at, stepup_at, approved_tx_hash, expires_at FROM sessions;
SELECT purpose, user_id, tx_hash, expires_at FROM challenges WHERE purpose = 'stepup';
SELECT * FROM transfers ORDER BY created_at DESC;
```

- 送金を押した直後（ステップアップ中）は `challenges` に `purpose = 'stepup'` の行があり、`tx_hash` に取引ハッシュが入る。verify で消える
- 承認が済むとセッションの `id` が変わり（再発行）、`stepup_at` と `approved_tx_hash` が入る。`auth_at` と `expires_at` は元のまま
- 送金が済むと `approved_tx_hash` は NULL に戻る（使い捨て、S3）。`stepup_at` は残るので、`/api/me` で最後に承認した時刻が見られる

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
