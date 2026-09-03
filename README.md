# gcal-privacy-sync

同じGoogleアカウント内の複数カレンダー（共有カレンダーなど）から予定をコピーして同期するGoogle Apps Scriptです。

タイトルや詳細を「予定あり」に匿名化してコピーできるため、Outlookなど他社カレンダーへiCal購読で連携する際の「予定ありブロック」用カレンダーを作る用途にも使えます（下記「他社カレンダー（Outlookなど）との連携」参照）。

## 機能

- **複数カレンダー対応**: 複数の共有カレンダーを一括で同期
- 予定のタイトルを「予定あり」に変換（プライバシー保護）
- カレンダーごとに異なる色・タイトルを設定可能
- 自動同期（15分/1時間ごと）
- 予定の追加・変更・削除を自動追従
- 終日イベントにも対応

## ファイル構成

```
├── src/
│   ├── Code.gs               # メイン同期
│   ├── Config.gs             # 設定
│   ├── Events.gs             # 作成・更新・説明文
│   ├── OrganizerRouting.gs   # 主催者でコピー先切替（任意）
│   ├── InviteRuleMatching.gs # ルール判定（Calendar API イベント用）
│   ├── Utils.gs / Debug.gs / Triggers.gs
│   └── appsscript.json
├── scripts/
│   └── inject-sync-pairs.js  # CI で SYNC_PAIRS_JSON を注入
├── .github/workflows/deploy.yml
├── package.json
├── LICENSE
└── README.md
```

## セットアップ

### 方法1: 手動コピー

1. [Google Apps Script](https://script.google.com/) にアクセス
2. 「新しいプロジェクト」を作成
3. `src/Code.gs` と `src/Config.gs` の内容をコピー

### 方法2: clasp を使用（推奨）

#### ローカル環境でのセットアップ

```bash
# claspをインストール
npm install -g @google/clasp

# Googleアカウントでログイン
clasp login

# 新しいGASプロジェクトを作成
clasp create --title "Calendar Sync" --rootDir src

# または既存のプロジェクトに接続
# .clasp.json を作成:
# {
#   "scriptId": "YOUR_SCRIPT_ID",
#   "rootDir": "src"
# }

# コードをプッシュ
clasp push
```

#### GitHub Actions 自動デプロイの設定

1. **GASプロジェクトのスクリプトIDを取得**
   - GASエディタ → プロジェクトの設定 → スクリプトID

2. **clasp認証情報を取得**

   **通常の環境（ブラウザあり）:**
   ```bash
   clasp login
   cat ~/.clasprc.json
   ```

   **Docker/SSH等のヘッドレス環境:**
   ```bash
   # --no-localhost オプションでURLが表示される
   clasp login --no-localhost

   # 表示されたURLをブラウザがある別のPCで開く
   # Googleアカウントで認証後、表示される認証コードをコピー
   # CLIに貼り付けてEnter

   # 認証情報を確認
   cat ~/.clasprc.json
   ```

3. **GitHubリポジトリのSecretsを設定**
   - `Settings` → `Secrets and variables` → `Actions` → `New repository secret`
   - 必要なのは次の **3つだけ** です（`INVITE_ROUTING_JSON` などは不要・未使用）。
   - `SCRIPT_ID`: GASのスクリプトID
   - `CLASPRC_JSON`: `~/.clasprc.json` の内容をそのまま貼り付け
   - `SYNC_PAIRS_JSON`: 同期ペア設定のJSON（下記参照）

4. **`SYNC_PAIRS_JSON` の設定**

   カレンダーIDなどの機密情報はGitHubリポジトリに含めず、Secretsから注入します。
   以下のJSON形式で設定してください:

   ```json
   [
     {
       "name": "仕事カレンダー",
       "sourceCalendarId": "work@group.calendar.google.com",
       "eventTitle": "予定あり",
       "eventColor": 8,
       "destinations": [
         { "calendarId": "primary", "showAsBusy": true, "includeOriginalLink": false },
         { "calendarId": "shared@group.calendar.google.com", "eventTitle": "外出", "eventColor": 6, "showAsBusy": false, "includeOriginalLink": true }
       ]
     },
     {
       "name": "チームカレンダー",
       "sourceCalendarId": "team@group.calendar.google.com",
       "eventTitle": "",
       "eventColor": 7,
       "destinations": [
         { "calendarId": "primary" }
       ]
     }
   ]
   ```

   #### ソース側フィールド

   | フィールド | 必須 | 説明 |
   |-----------|------|------|
   | `name` | ○ | 識別用の名前（ログ表示用） |
   | `sourceCalendarId` | ○ | コピー元カレンダーID（メールアドレス形式） |
   | `destinations` | ○ | コピー先の配列（下記参照） |
   | `eventTitle` | | デフォルトのタイトル（空文字 `""` で元のタイトルを使用） |
   | `eventColor` | | デフォルトの色 1-11（省略でデフォルト色） |

   #### destinations 内のフィールド

   | フィールド | 必須 | 説明 |
   |-----------|------|------|
   | `calendarId` | ○ | コピー先カレンダーID（`"primary"` でメインカレンダー） |
   | `eventTitle` | | このコピー先専用のタイトル（省略でソース側のデフォルトを使用） |
   | `eventColor` | | このコピー先専用の色（省略でソース側のデフォルトを使用） |
   | `showAsBusy` | | このコピー先を「予定あり（busy）」として表示するか（省略で共通設定の `SHOW_AS_BUSY` を使用） |
   | `descriptionMode` | | コピー先の予定に表示するdescription。`'full'`(元イベントのdescriptionをそのままコピー) / `'link'`(元予定へのリンクのみ) / `'none'`(常に空文字、省略時のデフォルト) |
   | `includeOriginalLink` | | 後方互換用。`descriptionMode`未指定時のみ、`true`→`'link'`, `false`→`'none'`として扱われる |
   | `organizerDestinations` | | （任意）主催者などの条件で **別カレンダーへコピー先を切り替える**ルール配列（下記） |

   > 同期の追跡情報（どのソースイベントのコピーか）はdescriptionには一切書き込まず、予定の非表示メタデータ（`CalendarEvent.setTag`）に保持する。`descriptionMode: 'full'`にしても追跡用の文字列が混ざることはない。

   > **Note**: `SYNC_PAIRS_JSON` が未設定の場合、`src/Config.gs` のデフォルト値がそのまま使われます。

5. **mainブランチにpushすると自動デプロイ**

## 主催者でコピー先を切り替える（`organizerDestinations`）

通常の同期（`syncSinglePair`）のなかで、ソースの各イベントについて **Calendar API の `Events.get`** で主催者・参加者・タイトルを取得し、**上から順に**ルールと照合します。最初にマッチしたルールの `destCalendarId` に、そのイベントのコピーを作成・更新します（`Events.move` は使いません）。

### 前提（必須）

- GAS エディタの **「サービス」→「高度な Google サービス」**で **Calendar API** を有効化
- 併せて **Google Cloud Console 側の「Google Calendar API」**も有効化

### 設定例

```json
{
  "calendarId": "default-dest@group.calendar.google.com",
  "eventTitle": "予定あり",
  "organizerDestinations": [
    {
      "destCalendarId": "external-block@group.calendar.google.com",
      "organizerEmailEndsWith": "@partner.example.com",
      "eventTitle": "予定あり"
    }
  ]
}
```

- `calendarId` は **マッチしなかったとき**の既定のコピー先です。
- ルール内の `destCalendarId` は **マッチしたとき**のコピー先です（省略時は `calendarId` と同じ扱い）。

#### ルールで使える条件

`organizerIsSelf`, `organizerEmailContains`, `organizerEmailEndsWith`, `attendeeIsSelf`, `attendeeEmailEquals`, `attendeeEmailContains`, `attendeeEmailEndsWith`, `summaryContains`, `titleContains`（いずれか1つ以上必須）

ルールごとに `eventTitle` / `eventColor` / `showAsBusy` / `includeOriginalLink` を上書きできます。

### 2. カレンダーIDの確認

カレンダーIDを確認するには:

1. [Google カレンダー](https://calendar.google.com/) を開く
2. 左サイドバーのカレンダー名にカーソルを合わせ、3点メニュー → 「設定と共有」
3. 「カレンダーの統合」セクションの「カレンダーID」をコピー

または、スクリプトで `listCalendars()` を実行すると、利用可能なカレンダー一覧が表示されます。

### 3. 設定

`src/Config.gs` の `getSyncPairsRaw()` を編集して、同期するカレンダーペアを設定:

```javascript
function getSyncPairsRaw() {
  return [
    {
      name: '仕事カレンダー',
      sourceCalendarId: 'work@group.calendar.google.com',
      eventTitle: '予定あり',    // デフォルトのタイトル
      eventColor: 8,             // デフォルトの色
      destinations: [
        { calendarId: 'primary' },
        { calendarId: 'shared@group.calendar.google.com', eventTitle: '外出', eventColor: 6 },
      ],
    },
    {
      name: 'チームカレンダー',
      sourceCalendarId: 'team@group.calendar.google.com',
      eventTitle: '',            // 空文字で元のタイトルを使用
      eventColor: 7,
      destinations: [
        { calendarId: 'primary' },
      ],
    },
  ];
}
```

### 4. 実行とテスト

1. `syncCalendars` 関数を選択して実行
2. 初回は権限の承認が必要です
3. ログで結果を確認

### 5. 自動同期の設定

定期的に自動同期するには:

- `setupTrigger()` を実行 → 15分ごとに同期
- `setupHourlyTrigger()` を実行 → 1時間ごとに同期

## 同期ペアの設定項目

| 項目 | 説明 | 例 |
|------|------|-----|
| `name` | 識別用の名前（ログ表示用） | `'仕事カレンダー'` |
| `sourceCalendarId` | コピー元カレンダーID | `'xxx@group.calendar.google.com'` |
| `destinations` | コピー先の配列（コピー先ごとに設定可能） | 下記参照 |
| `eventTitle` | デフォルトのタイトル（空文字で元タイトル） | `'予定あり'` |
| `eventColor` | デフォルトの色（1-11） | `8` |

**destinations 内の設定項目:**

| 項目 | 説明 | 例 |
|------|------|-----|
| `calendarId` | コピー先カレンダーID | `'primary'` |
| `eventTitle` | このコピー先専用のタイトル（省略でデフォルト値） | `'外出'` |
| `eventColor` | このコピー先専用の色（省略でデフォルト値） | `6` |
| `organizerDestinations` | 主催者条件で別カレンダーへ振り分け（任意） | 上記セクション参照 |

## イベントカラー一覧

| 番号 | 色 |
|------|-----|
| 1 | ラベンダー |
| 2 | セージ |
| 3 | ブドウ |
| 4 | フラミンゴ |
| 5 | バナナ |
| 6 | ミカン |
| 7 | ピーコック |
| 8 | グラファイト |
| 9 | ブルーベリー |
| 10 | バジル |
| 11 | トマト |

## 共通設定 (getCommonConfig)

| 設定項目 | 説明 | デフォルト |
|---------|------|-----------|
| `DAYS_BEFORE` | 過去何日分を同期 | `7` |
| `DAYS_AFTER` | 未来何日分を同期 | `30` |
| `COPY_ALL_DAY_EVENTS` | 終日イベントもコピー | `false` |
| `DEBUG_MODE` | デバッグログを出力 | `false` |

## 便利な関数

| 関数名 | 説明 |
|-------|------|
| `syncCalendars()` | 手動で同期を実行 |
| `listCalendars()` | 利用可能なカレンダー一覧を表示 |
| `setupTrigger()` | 15分ごとの自動同期を設定 |
| `setupHourlyTrigger()` | 1時間ごとの自動同期を設定 |
| `removeTriggers()` | 自動同期を停止 |
| `clearSyncedEvents()` | 全ペアの同期予定を削除 |
| `clearSyncedEventsForPair(index)` | 特定ペアの同期予定を削除 |

## 注意事項

- コピー元カレンダーへのアクセス権限が必要です
- Google Apps Script の実行時間制限（6分/回）があります
- 大量の予定がある場合は `DAYS_BEFORE` / `DAYS_AFTER` を小さくしてください

## 他社カレンダー（Outlookなど）との連携

このスクリプトのコピー先はGoogleカレンダー限定です。Outlookなど他社カレンダーに「予定あり」だけを見せたい場合は、次の手順で「中継カレンダー」を経由させます。

1. Googleで「予定あり」専用の新規カレンダーを作成する（例: `Busy Block`）
2. `getSyncPairsRaw()` の `destinations` にこの新規カレンダーを追加し、`eventTitle: '予定あり'`, `showAsBusy: true` を指定する

   ```javascript
   {
     name: '本業カレンダー',
     sourceCalendarId: 'work@example.com',
     destinations: [
       { calendarId: 'primary' }, // 既存の全文コピー
       { calendarId: 'busy-block@group.calendar.google.com', eventTitle: '予定あり', showAsBusy: true, descriptionMode: 'none' },
     ],
   }
   ```

3. `Busy Block` カレンダーの設定画面 → 「カレンダーの統合」→ **Secret address in iCal format** をコピーする
   （Public address は非公開のまま使えないため、必ず Secret address を使う）
4. Outlook側で「インターネットカレンダーの購読」にそのURLを貼る

これでOutlook側にはタイトル・詳細を伏せた「予定あり」だけが数十分単位のラグで反映される。双方向・即時反映が必要な場合は OneCal / Reclaim.ai 等のサードパーティ同期サービスを検討してください。

## ライセンス

[MIT License](LICENSE)
