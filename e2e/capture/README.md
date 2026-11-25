# e2e/capture

Zenn の Book に貼る GIF とスクリーンショットを、Playwright と仮想認証器で撮るためのスクリプト。通常の E2E（`e2e/tests/`）とは別で、`scripts/e2e.sh` や CI では動かない。

| パス | 内容 |
|---|---|
| `capture.sh` | 入口。使い捨てスタックで撮影し、録画から GIF を切り出す |
| `capture.config.ts` | 撮影用の Playwright 設定（録画あり、操作を 250ms ずつ遅くする） |
| `tests/book.spec.ts` | 撮影用のシナリオ。登録とログイン、送金のステップアップ、パスキーの追加 |
| `tools/render-mermaid.py` | Book の mermaid の図を1枚ずつ描画して PNG にする |

撮影結果は Git に入れない。`.local-docs/playwright-capture/output/`（`.gitignore` 済み）に出る。

| 出力 | 内容 |
|---|---|
| `shots/` | 撮った PNG と切り出した GIF |
| `videos/` | GIF にした区間を含む録画（webm、GIF と同じ名前） |
| `marks.json` | GIF を切り出す区間。区間ごとに、録画のパスと、録画の開始からの開始・終了の秒数 |
| `test-results/` | Playwright の出力そのもの |

## 撮る

```bash
bash e2e/capture/capture.sh
```

- `scripts/e2e.sh` と同じく、別のプロジェクト名（`try-pass-key-capture`）・別のボリューム・別のポート（5198、`CAPTURE_WEB_PORT` で変更可）で動かし、終わったら消す。開発 DB にテストユーザーは入らない
- 毎回、出力先を空にしてから撮る。前回の録画や区間を取り違えない
- GIF の切り出しはホストの ffmpeg を使う
- 画面に映るのはテスト用の表示名（`test-user-1` など）と `localhost` だけ。ヘッドレスなのでブラウザのプロファイルやアドレスバーは映らない
- 作ったばかりのファイルは Docker のファイル共有の遅れ（docs/01 K6）でコンテナから見えないことがある。その場合は10秒ほど待って再実行する

## Book に反映する

`shots/` から `~/work/zenn-docs/images/passkey-poc-by-hand/` に、次の名前でコピーする。

| 撮影結果 | Book での名前 | 貼っている章 |
|---|---|---|
| `register.gif` | `e2e-register.gif` | 2章 登録 |
| `login.gif` | `e2e-login-autofill.gif` | 3章 ログイン §5 |
| `inspector-register.png` | `e2e-inspector-register.png` | 4章 可視化 §4 |
| `transfer.gif` | `e2e-transfer-stepup.gif` | 6章 ステップアップ |
| `inspector-stepup.png` | `e2e-inspector-stepup.png` | 6章 ステップアップ §6 |

`passkey-list-two.png`、`session-after-login.png`、`transfer-done.png` は撮っているが Book では使っていない。

## 図を確かめる

Zenn のプレビューは mermaid を外部の埋め込みで描画するので、ヘッドレスのブラウザで撮ると描画が終わらない。mermaid 本体で1図ずつ描画して確かめる（ホストの Chrome を使う）。

```bash
python3 -I e2e/capture/tools/render-mermaid.py ~/work/zenn-docs/books/passkey-poc-by-hand <出力先>
```

できた PNG を開き、`ERR` が出ていないこと、ラベルが重なっていないことを見る。

## 書くときの注意

- 録画用の間（`pause`）は、見る人のためのもので同期ではない。どの手順も、間を置く前に画面の状態を `expect` で待っている
- パスキーの追加は、最初の認証器 A でステップアップを承認させてから認証器 B に切り替える（`e2e/tests/passkey.spec.ts` と同じ手順）。先に A を外すと、ステップアップに使う鍵がなくて失敗する
- 要素のスクリーンショットはその要素までスクロールするので、録画にもスクロールが映る。GIF の終わりは、スクリーンショットの前に記録した終了時刻で切る
- GIF にする区間は `mark(名前, 'start' | 'end')` で記録し、`capture.sh` の `gif 名前 …` で切り出す。録画のパスも区間と一緒に記録するので、テスト名を変えても `capture.sh` は直さなくてよい
- 区間の秒数は、`beforeEach` で `page` を使ってページ（と録画）を作った直後からの時間。録画の開始とほぼそろう
