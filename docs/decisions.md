# 判断の記録（Decision Log）

設計や進め方で「なぜそうしたか」を残す。後から覆すときは行を消さず、新しい行で上書きした旨を書く。

| # | 日付 | 決定 | 理由 | 却下した案 |
|---|---|---|---|---|
| D1 | 2026-11-23 | 認証方式はパスキー（WebAuthn）を軸にする | フィッシング・サーバー漏洩・SIMスワップを構造的に防げる。現時点でログイン保護の最有力 | パスワード + TOTP（フィッシングで中継される） |
| D2 | 2026-11-23 | 送金前にステップアップ認証を入れ、承認を取引内容に紐づける | 二次被害（盗まれたセッションでの送金）への直接の対策 | ログイン時の認証のみ |
| D3 | 2026-11-23 | 実行環境は Docker Compose。ホストには Docker とブラウザだけ | 試して壊せる。`down -v` で完全初期化できる | ホストに Node を直接インストール |
| D4 | 2026-11-23 | 言語は TypeScript（ESM）、`tsx` で直接実行 | AI の学習量が多く、型エラーが AI へのフィードバックになる | Go、Python |
| D5 | 2026-11-23 | サーバーは Express 5 | AI の学習量が最も多い | Hono（当初案。薄いが学習量で劣る） |
| D6 | 2026-11-23 | API の入出力は zod で定義し server / web で共有 | 型とランタイム検証を1か所にまとめ、AI が仕様を読む起点にする | 型定義のみ、OpenAPI |
| D7 | 2026-11-23 | `attestation: "none"` | 学習の焦点は検証ロジック。機種検証は別PoC候補 | `direct` + メタデータ検証 |
| D8 | 2026-11-23 | セッションはサーバー側で持つ（JWT は使わない） | 即時失効を確実にするため | JWT |
| D9 | 2026-11-23 | 普段の開発は仮想認証器、実機は確認時のみ | AI が人手なしで E2E を回せる。実機のパスワード管理画面を散らかさない | 常に実機で確認 |
| D10 | 2026-11-23 | パスキー以外の方式は別ディレクトリの別PoCで試す | 本PoCの学習範囲を保ち、互いに影響させない | 本PoCに混ぜる |
| D11 | 2026-11-23 | WebAuthn の検証は自前パイプラインで実装する（CBOR デコードのみ `cbor-x`）。`@simplewebauthn/server` はテストでの比較用に残す | ライブラリは全項目を一括で検証するため、1項目だけ外して攻撃が通ることを示せない。実際にどう検証されるかを理解するため、工程が増えても自前で持つ。自前実装の誤りは差分テストで検出する | ライブラリに任せ L3・A1 のみ自作（Q2 の当初案）。CBOR まで自作（学習価値が低い） |
| D12 | 2026-11-23 | 登録時の一時状態（userHandle、表示名）と challenge は SQLite の `challenges` テーブルに置き、`DELETE … RETURNING` で取得と同時に削除する | `tsx watch` の再起動で消えない。`sqlite3` で中身を確認できる。本番で使う Redis の TTL + `GETDEL` に近い形になる。DB はコンテナのボリューム内にありホストを汚さない | サーバープロセスのメモリ（Map）。再起動で ceremony の途中の状態が消え、サーバーが1台の構成でしか成り立たない |
| D13 | 2026-11-23 | Yarn 4 workspaces（`nodeLinker: node-modules`）で `server` / `web` / `shared` / `e2e` を管理する。`shared` はビルドせず `.ts` を直接公開。開発用 Dockerfile は1つ、`node_modules` はボリューム1つ。検証は `yarn check` に一本化し、skip 禁止・検証 ID の一覧一致・import 境界・`noUncheckedIndexedAccess` をツールで強制する | `shared` の zod を server / web の両方から解決できる。AI が実行するコマンドを1本にし、守らせたいルールは文章ではなく `yarn check` の失敗として返す。検証とテストを隣に置き、ディレクトリ単位の CLAUDE.md で読む範囲を狭くする | workspace ごとの別 `node_modules` ボリューム（`shared` から依存を解決できない）、Yarn PnP（AI が依存の中身を読めない）、`shared` をビルドして配布（古い成果物を読む取り違え） |
| D14 | 2026-11-23 | challenge の照合は一時 Cookie（`ceremony=<行ID>`）で行い、要求元ブラウザに縛る。検証項目 C5 として独立させる。ステップアップは行の `user_id` とセッションで縛る | 署名済み応答が送信前に漏れても（XSS、ログ混入）、別ブラウザからは通らない。多くのフレームワークが challenge をセッションに置き Cookie で引く実運用の形に近い。C5 を外すと通る攻撃をテストで再現でき、「誰に発行した challenge か」まで学べる | clientDataJSON の challenge 値で検索（実装は小さいが、期限内なら漏れた応答をどのブラウザからでも使える） |
| D15 | 2026-11-23 | 実装前に GitHub Actions の CI を置く。マスキング検査（`scripts/mask-check.sh`）は今から必須、`yarn check` は `compose.yaml` ができた時点から `docker compose` 経由で自動的に走る | M1 の最初のコードから CI に守られた状態で始められる。公開リポジトリなので、個人情報の混入を人の grep だけに頼らない。個人名など公開できないパターンはリポジトリの secret（`MASK_PATTERNS`）で渡し、ログには「ファイル:行」だけを出して中身を漏らさない | M1 完了後に CI を追加（最初の実装が無検査になる）、マスキングのパターンをリポジトリに直書き（パターン自体が個人情報になる） |
| D16 | 2026-11-23 | Node.js 26（`node:26.13.1-slim`）、TypeScript 6.0.3 を使う。corepack は Dockerfile で npm から入れる | Node 26 は現在の Active LTS で、`node:sqlite` がフラグなしで動く。TypeScript 7.0（Go 実装）は typescript-eslint 8.73 が未対応（`typescript >=4.8.4 <6.1.0`）で、型情報付き lint が使えなくなる | Node 24（corepack 同梱だがサポート期間が短い）、TypeScript 7.0（lint が動かない） |
| D17 | 2026-11-23 | `yarn install` は一回限りの `deps` サービスで行い、`server` / `web` は `service_completed_successfully` で待つ。Yarn の install state は `node_modules` ボリューム内に置く | 1つの `node_modules` ボリュームに複数サービスが同時に install すると壊れる。CI では `CI=true` を渡すだけで immutable install になり、lockfile の更新漏れを検出できる。`.yarn/` をホストに作らない | 各サービスの起動時に install（同時実行で競合）、ホストで install（D3 に反する） |
| D18 | 2026-11-23 | ファイル監視はポーリングを既定にする（`WATCH_POLLING=true`）。Web のホスト側ポートは `WEB_PORT` で変えられるようにし、`RP_ORIGIN` を追従させる | M1 で、macOS 上の Docker（Rancher Desktop）では変更イベントが届かずホットリロードしないことを確認した。また別の開発サーバーが `[::1]:5173` を使っていると `localhost:5173` がそちらに奪われ、Docker 側は衝突を報告しなかった | `[::1]` にも公開する（この環境では IPv4 しか転送されず効果がなかった） |
| D19 | 2026-11-23 | lint は警告もエラー扱いにする（`--max-warnings 0`）。例外は理由コメント付きの `eslint-disable-next-line` だけ | 警告を残せると、AI が「警告だから」と無視して積み上がる。例外を書く場所に理由を残させる | 警告を許容 |
| D20 | 2026-11-23 | `e2e` workspace と Playwright サービスは M3 で追加する（D13 の構成のうち M1 では作らない） | M1 の時点では E2E で確かめる画面がない。Playwright 公式イメージは大きく、使わないうちは CI と起動を遅くするだけ | M1 で空の `e2e` を作る |
| D21 | 2026-11-23 | challenge の行は clientDataJSON の challenge 値で引き（`challenge` 列は UNIQUE）、Cookie との一致は独立した検査 C5 で確かめる。D14 の「Cookie の行IDで引く」を改める | Cookie の値で行を引くと、ブラウザへの縛りが行の取り出し方に埋め込まれ、C5 だけを外して「別ブラウザからの応答が通る」ことを再現できない。値で引いて C5 で比べても、縛りの強さは D14 と同じ | D14 のまま Cookie の行IDで引く（C5 を独立させられない） |
| D22 | 2026-11-23 | 登録完了時のセッション発行は M3（ログイン）で実装する。M2 では登録して credential を保存するところまで | セッション（ID 再発行、期限、Cookie）はログインと一緒に作るほうがまとまりがよい。M2 の完了条件は「credentials テーブルに公開鍵が入る」 | M2 で登録時のセッションだけ先に作る |
| D23 | 2026-11-23 | 登録応答のうち `fmt` が `none` 以外のもの、AT フラグや attestedCredentialData がないもの、`rawId` と authData 内の credentialId が食い違うものは、検証項目ではなくデコード失敗（`malformed_response`）として拒否する | `attestation: "none"` を要求しており、ブラウザは attestation を `none` に置き換える。ID の食い違いや構造の欠落は「検証を外すと通る攻撃」ではなく、応答として成立していない | 6章の検証項目として追加（外したときに再現する攻撃が定義できない） |
