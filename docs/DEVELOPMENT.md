# 開発ルール

## レーン（担当範囲）
| レーン | 担当 | 触るファイル |
|---|---|---|
| A: 入力・画面 | @Gaku-Fujioka | `src/input/` `src/scenes/title.ts` `micSetup.ts` `result.ts` `src/render/hud.ts` |
| B: 地形・ゲーム | @koubeyapurin | `src/terrain/` `src/game/` `src/render/world.ts` `src/render/effects.ts` `src/scenes/play.ts` |
| 共有 | 両者 | `src/core/*` `src/main.ts` `package.json` `.github/` `docs/` |

- 仕事は GitHub Issue で振り分ける。Issue に書かれた「触ってよいファイル」以外は変更しない。
- **共有ファイルの変更は `contract:` で始まる小さな PR に分け、相手の Approve を得てからマージ。**
- 相手のレーンのバグを見つけたら、直さずに Issue を立てる。

## 1タスクの流れ（PowerShell）
```powershell
git switch main
git pull
git switch -c feat/a1-keyboard          # feat/<issue番号やタスク名>
# ...実装（AI に Issue 本文を渡す）...
npm run typecheck; npm test; npm run build
git add -A
git commit -m "A1: キーボード入力を実装"
git push -u origin feat/a1-keyboard
gh pr create --fill --base main          # 本文に Closes #<issue番号>
```
- PR は相手が **Approve** してから、作成者が **Squash and merge**。CI が緑であること。
- マージ後: `git switch main; git pull; git branch -d feat/a1-keyboard`

## レビュー（相手の PR）
```powershell
gh pr checkout <PR番号>
npm ci; npm run dev            # 実際に動かす
gh pr review <PR番号> --approve   # または --request-changes -b "理由"
git switch main
```
観点: 受け入れ条件を満たすか / 契約（types.ts）に沿っているか / 担当外のファイルを触っていないか / 動かして壊れていないか。

## コンフリクトしたら
```powershell
git switch feat/xxx
git fetch origin
git merge origin/main         # 衝突箇所を VS Code で解消
npm run typecheck; npm test
git add -A; git commit; git push
```
解消に迷ったら手を止めて相手に相談。`git push --force` は使わない。

## AI の使い方
- **1つの作業フォルダ（ブランチ）で同時に動かす AI は1つだけ。**
  並行で動かすときは worktree を分ける: `git worktree add ..\audio-race-a2 -b feat/a2-mic`
- Claude Code / Codex / Herdr どれを使ってもよい。最初に `CLAUDE.md`（Codex は `AGENTS.md`）を読ませる。
- 実装役と別の AI にレビューさせると見落としが減る（例: Claude Code で実装 → Codex で `gh pr diff` をレビュー）。
- AI の出力は事実と推測を分けて確認。エラー時はブラウザの DevTools Console と CI ログを AI に貼る。

## 調整用デバッグ
- マイクの値の確認ページ: `npm run dev` → http://localhost:5173/spike/mic.html（A2 で作成）
