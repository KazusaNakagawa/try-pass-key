# M4 可視化 設計（短い版）

- 作成日: 2026-11-24
- 対象: docs/01 §11 の M4「直近の ceremony の clientDataJSON、フラグ、signCount を画面に表示できる」

## 目的

ブラウザと認証器が実際に何を返し、サーバーが何を期待して、6章のどの項目で受け入れたか・落としたかを画面で読めるようにする。PoC の目的（認証の仕組みを手で理解する）のための学習用の表示で、M5 の攻撃再現や記事のスクリーンショットにも使う。

## ゴール / 非ゴール / やってはいけないこと

- ゴール: 登録とログインの verify で、成功時も検証で拒否されたときも、デコード結果・期待値・各検証項目の結果を表示する
- 非ゴール: 再読み込み後も表示を残すこと、過去の履歴、ステップアップ（M6 で同じ仕組みに乗せる）
- やってはいけないこと: 検証項目（`server/src/webauthn/checks/`）の判定や `REGISTRATION_CHECKS` / `AUTHENTICATION_CHECKS` の順序を変えること。表示のために検証を飛ばす・弱める経路を作ること。本番相当（`NODE_ENV=production`）でデバッグ情報を返すこと

## 作り方の比較

| 案 | 内容 | 採否 |
|---|---|---|
| A. verify の応答に載せる | 開発時だけ、verify の成功応答と 400 のエラー応答に `inspection` を足す | **採用**。リクエストしたブラウザだけが受け取るので他人の情報が見えず、サーバーに状態を持たない。curl での攻撃再現でも同じ情報が出る。再読み込みで消えるのは許容 |
| B. `GET /api/debug/last-ceremony` | サーバーのメモリにブラウザごとの直近の記録を持つ（docs/01 の当初案） | 不採用。ブラウザを区別する Cookie と記録の保存・期限管理が増える |
| C. ブラウザ側でデコード | サーバーは変えない | 不採用。サーバーの期待値や落ちた項目が分からず、拒否の表示ができない |

## 設計

### 応答の形（`shared/src/inspection.ts`）

```ts
CeremonyInspection = {
  ceremony: 'register' | 'login',
  expected: { type, origin, rpId, rpIdHash /* hex */ },
  clientData: { json /* デコードした文字列そのまま */, type, challenge /* base64url */, origin, crossOrigin },
  authenticatorData:
    | { rpIdHash /* hex */, flags: { up, uv, be, bs, at, ed }, signCount, aaguid?, credentialId? }
    | { error: string },          // デコードに失敗した（malformed）
  storedCredential?: { signCount, backupEligible, backupState }, // ログインで鍵が見つかったとき
  checks: { id: CheckId, result: 'pass' | 'fail' | 'not_run' }[],  // パイプラインの順
  failure?: { check?: CheckId, message: string },
}
```

- 成功時: `RegisterVerifyResponse` / `LoginVerifyResponse` に `inspection?` を足す
- 拒否時: `ApiError` に `inspection?` を足す

### サーバー

- `pipeline.ts` の `runChecks` に、各項目の結果を受け取るコールバック（省略可）を足す。項目の並びと「全部通らないと進まない」動きは変えない
- 新しい `server/src/webauthn/inspect.ts` が、チェック後の文脈から `CeremonyInspection` を組み立てる。`authData` などは遅延デコードなので、組み立ては必ずチェックの後に行い、デコードの例外は `authenticatorData.error` に入れる（C4 が先に challenge を消費する順序を崩さない）
- ルートは「文脈を作る → チェック → 保存」をまとめて囲み、例外時は組み立てた `inspection` を `res.locals` に置いて投げ直す。エラーハンドラは `CheckError` / `ParseError` の本文に `res.locals.inspection` があれば足す。保存時の A4（同時ログイン）も同じ扱い
- 文脈を作る前の失敗（リクエスト形式違反、clientDataJSON が読めない）は `inspection` なし
- `config.nodeEnv === 'production'` のときは `inspection` を付けない

### 画面（`web/src/inspector.ts`）

「直近の ceremony」セクションを足し、verify の応答（成功・失敗とも）の `inspection` を表示する。

```
直近の ceremony: ログイン（拒否: C3）
検証  C4 ✓ C2 ✓ C5 ✓ C1 ✓ C3 ✗ A1 - A2 - ...
                期待値                    実際
type            webauthn.get              webauthn.get
origin          http://localhost:5174     https://evil.example
rpIdHash        49960de5...               49960de5...
flags           UP=1 UV=1 BE=1 BS=1 AT=0 ED=0
signCount       0（保存値 0）
clientDataJSON  {"type":"webauthn.get","challenge":"...","origin":"..."}
```

### テスト

- ルートのテスト: 成功時に全項目 `pass`。origin を改ざんした応答で C3 が `fail`、以降が `not_run`、期待値と実際の origin が入る。`production` では `inspection` が付かない
- 既存の攻撃再現テストはそのまま通ること
- E2E: 登録とログインのあとに「直近の ceremony」が表示される

### ドキュメント

- docs/01 の API 表から `/api/debug/last-ceremony` を外し、verify 応答の `inspection` を書く
- decisions に1行（案A を選んだ理由）
- docs/03 に画面の読み方を足す
- M4 完了時に worklog と Zenn 記事の下書き

## 実装者に任せること

- 画面の細かな見た目（色、折りたたみ）
- `inspection` の組み立てを登録とログインでどこまで共通化するか
