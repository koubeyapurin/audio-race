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

## 遊び方
1. タイトルで **「マイクで遊ぶ（M）」** か **「キーボードで遊ぶ（Enter）」** を選ぶ
2. マイクの場合は準備画面で ① マイクを許可 → ② 2秒間静かにする（雑音の測定）→ ③「あー」と2秒伸ばす（基準の声の高さ）→ ④ スタート
   - 感度は「反応しやすい」と「標準」から選べる。下り・上りが足りないときは、低い声・高い声を測って自分の声域に合わせられる
   - マイクが使えないとき（拒否・未接続・http の LAN アクセスなど）は理由が表示され、「キーボードで遊ぶ（K）」に切り替えられる
3. ランナーは自動で右へ走る。黄色い点線（生成ライン）から先の地形が、今の入力で作られる
4. 音符（1個100点）を取り、赤い障害物を避けてゴールへ（ライフ3、クリアボーナス300点）
   - 下から生える柱は、地面を高くして埋めれば越えられる。上から垂れる壁は、地面を低くしてくぐる

| | マイク | キーボード |
|---|---|---|
| 上り / 下り | 基準より高い / 低い声 | ↑ / ↓ |
| 変化の強さ | 声の大きさ | ← / → または W / S |
| 小さな山 | 「タン、タン」と区切った声 | Space |
| 声を止める | 平らに戻る | キーを離すと平らに戻る |

| 画面 | キー |
|---|---|
| プレイ中 | Esc: ポーズ（マイクも停止）|
| ポーズ中 | Esc / Enter: 再開、T: タイトルへ |
| 結果 | R: リトライ、Esc: タイトルへ |

タブを切り替えると自動でポーズします。ベストスコアはブラウザに保存されます。

### マイクの値を確認したいとき
`npm run dev` → http://localhost:5173/spike/mic.html で、RMS・音程・onset をリアルタイムに表示できます（本番ビルドには含まれません）。

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
spike/        マイクの検証ページ（開発用）               … レーンA
src/scenes/   タイトル・マイク準備・結果画面              … レーンA（play.ts のみレーンB）
src/render/   hud.ts（レーンA）, world.ts・effects.ts（レーンB）
src/terrain/  地形生成                                   … レーンB
src/game/     ステージ・当たり判定・得点                   … レーンB
```
マイク音声はブラウザ内でのみ処理し、録音・外部送信はしません。
