# AI エージェント向けガイド（Claude Code / Codex 共通）

- 要件: docs/requirements.md、開発ルール: docs/DEVELOPMENT.md を必ず読む。
- 作業は GitHub Issue 単位。Issue の「触ってよいファイル」以外は編集しない。
  共有ファイル（src/core/*, src/main.ts, package.json, .github/）は変更が必要なら手を止めて人間に確認する。
- `src/core/types.ts` の型が契約。実装は契約に合わせ、契約を勝手に変えない。
- ゲームループは src/main.ts の1本だけ。シーンやモジュールで requestAnimationFrame / setInterval のループを作らない。
- 地形・ゲーム進行は DOM に依存しない純粋なロジックにして Vitest でテストする（`*.test.ts` を同じフォルダに置く）。
- マイク: 録音保存・外部送信をしない。stop() で全トラックを止める。外部 API / クラウドは使わない。
- 完了前に `npm run typecheck`、`npm test`、`npm run build` を実行して通ること。
- `main` に直接 commit / push しない。`git push --force` しない。
- 応答・コミットメッセージ・PR は日本語。
