# try-pass-key

パスキー（WebAuthn）を自分で実装して、認証の仕組みを理解するための PoC です。

正規ユーザーとしてシステムを操作され資産を抜かれる「二次被害」への備えとして、ログイン時のパスキー認証に加え、送金など高リスク操作の直前に再認証するステップアップ認証まで実装します。背景は [docs/00-background.md](docs/00-background.md) を参照してください。

> [!NOTE]
> 現在は M3（パスキーの登録と、ユーザー名なしログイン）まで実装済みです。進捗は [マイルストーン](docs/01-architecture-proposal-poc.md#11-マイルストーン) を参照してください。

## このPoCで確かめること

- 登録と認証で、ブラウザ・認証器・サーバーの間に何が流れているか
- サーバー側で何を検証すべきか、検証を1つ外すとどの攻撃が通るか（[検証項目](docs/01-architecture-proposal-poc.md#6-サーバー側の検証項目)）
- ログイン済みでも、送金にはその場でのパスキー署名を要求する設計（[ステップアップ認証](docs/01-architecture-proposal-poc.md#53-ステップアップ認証送金前の再認証)）
- パスキーで防げる脅威と防げない脅威の境界（[脅威モデル](docs/01-architecture-proposal-poc.md#9-脅威モデルと限界)）

## 構成

TypeScript / Express / Vite / SQLite を Docker Compose で動かします。ホストに必要なのは Docker とブラウザだけです。詳細は [全体構成](docs/01-architecture-proposal-poc.md#4-全体構成) を参照してください。

## 使い方

```bash
docker compose up -d                    # 起動 → http://localhost:5173
docker compose run --rm server yarn check # 型検査・lint・テスト
bash scripts/e2e.sh                     # E2E（仮想認証器。使い捨てのスタックで実行）
docker compose down -v                  # DB・依存ごと完全に初期化
```

`127.0.0.1` ではなく `localhost` で開いてください。パスキーはドメインに紐づくため、両者は別物として扱われます。

別の開発サーバーが 5173 番を使っていると、`localhost:5173` でそちらが表示されることがあります。その場合は `.env.example` を `.env` にコピーし、`WEB_PORT` を空いているポートに変えてください。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/00-background.md](docs/00-background.md) | 背景と問題意識 |
| [docs/01-architecture-proposal-poc.md](docs/01-architecture-proposal-poc.md) | アーキテクチャ提案（API、データモデル、検証項目、マイルストーン） |
| [docs/02-knowledge-passkey.md](docs/02-knowledge-passkey.md) | 調査ナレッジ（同期パスキーのリスク、他の認証方式） |
| [docs/decisions.md](docs/decisions.md) | 判断の記録 |
| [docs/worklog/](docs/worklog/) | 作業ログ |

## 注意

学習用の PoC です。本番環境での利用は想定していません。
