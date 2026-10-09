# Voice Terrain Runner

声の高さ・大きさ・リズムで、走る先の地形をつくる横スクロールレースゲーム（JPHACKS 向け共同開発練習）。
要件定義: [docs/requirements.md](docs/requirements.md) / 開発ルール: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## 必要なもの（Windows）
PowerShell で:
```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install GitHub.cli
gh auth login
```

## 起動
```powershell
gh repo clone koubeyapurin/audio-race
cd audio-race
npm ci
npm run dev        # http://localhost:5173 を Chrome / Edge で開く
```

## 操作
| | マイク | キーボード |
|---|---|---|
| 上り / 下り | 基準より高い / 低い声 | ↑ / ↓ |
| 変化の強さ | 声の大きさ | ← / → または W / S |
| 小さな波 | 「タン、タン」と区切った声 | Space |
| ポーズ | | Esc |

## テスト・ビルド
```powershell
npm run typecheck
npm test
npm run build      # dist/ に出力
npm run preview    # ビルド結果をローカル確認
```

## デプロイ
`main` に push（PR マージ）すると GitHub Actions が GitHub Pages に公開します。
公開URL: https://koubeyapurin.github.io/audio-race/

## 構成
```
src/core/     types.ts（モジュール間の契約）, config.ts（調整用定数）
src/input/    キーボード / マイク入力 → ControlInput     … レーンA
src/scenes/   タイトル・マイク準備・結果画面              … レーンA（play.ts のみレーンB）
src/render/   hud.ts（レーンA）, world.ts（レーンB）
src/terrain/  地形生成                                   … レーンB
src/game/     ステージ・当たり判定・得点                   … レーンB
```
マイク音声はブラウザ内でのみ処理し、録音・外部送信はしません。
