# Daily Plate｜雙人熱量日記（手機 App 版 / PWA）

這是一個可部署、可加入手機主畫面的雙人飲食日記（PWA），包含手機直接開相機或相簿上傳、AI 熱量/三大營養素推估、逐項修正、分食百分比、兩人每日總量、今天／明天／歷史日期切換、近 7 日趨勢圖，以及雙人共用的私有資料庫。手機版加入底部分頁、適合觸控的編輯畫面與主畫面圖示。

## 加入 iPhone／Android 主畫面

完成正式部署並取得 **HTTPS 網址** 後：

- **iPhone（Safari）**：用 Safari 開啟網站 → 分享 →「加入主畫面」→「加入」。之後直接點手機桌面的 Daily Plate 圖示。
- **Android（Chrome）**：用 Chrome 開啟網站 → 右上角「⋮」選單 →「安裝應用程式」或「加入主畫面」。各手機顯示名稱略有不同。
- 網站內的「⌂ 加入手機」會顯示安裝步驟；在支援的 Android 瀏覽器也可能提供直接安裝按鈕。

**這是 PWA 網頁 App，不是 App Store／Google Play 上架的原生 App**。不用經過商店審核就能先用手機桌面啟動，但需要有公開的 HTTPS 網址。手機拍照、雙人雲端同步與 AI 分析都需要網路。斷線時僅顯示離線說明，不會假裝成功上傳或同步。

如果只是解壓縮檔案並開啟 `index.html`，可在預覽模式操作，但不能從那個本機檔案進行正式 PWA 安裝，也無法讓兩台手機共用資料。

## 先在自己電腦預覽（不必有 API key）

直接開啟 `index.html`，或在資料夾執行：

```bash
python3 -m http.server 8000
```

到 `http://localhost:8000` 就能操作「預覽模式」，手動輸入熱量與拍照記錄。**預覽模式不提供真的 AI 分析、不會跨裝置共用**，資料只存在目前瀏覽器的 `localStorage`。正式共用前請依下方啟用雲端。

## 正式上線：一次性設定

需要三個服務：

- **Supabase**：存兩人的帳號、食物資料及照片。免費方案可能足以先試用，實際限制以官網為準。
- **OpenAI API**：分析餐點照片，依 API 使用量計費，與 ChatGPT 訂閱分開。
- **Vercel**：託管網站與隱藏 API key 的 `/api/analyze` 後端。實際費率/限制以官網為準。

### 1. 建立 Supabase 專案

1. 登入 <https://supabase.com> → New project。
2. SQL Editor → New query → 貼上 `sql/setup.sql` 的全文 → Run。
3. 若最後一行 `alter publication supabase_realtime add table public.meals` 顯示「already member」，表示即時更新已開啟；可略過那一行重跑其餘 SQL。若 SQL 執行出錯，先修正再往下。
4. Project Settings → API Keys：取得 **Publishable key（或 legacy anon key）**。Project Settings → Data API：取得 **Project URL**。（不同版本的 Supabase UI 可能顯示位置不同。）
5. 在 `config.js` 填入：

```js
window.DAILY_PLATE_CONFIG = {
  supabaseUrl: 'https://你的專案.supabase.co',
  supabaseAnonKey: '你的 publishable 或 anon key'
};
```

6. Authentication → Providers → Email：確認開啟 Email 登入。若有啟用 Confirm email，註冊後須先驗證信箱。Auth → URL Configuration 需加入你部署後的網址（Site URL / Redirect URLs）。
7. Storage 中應出現 private bucket `meal-photos`（SQL 已建立）。不要把 bucket 改成 public。

**重要**：`config.js` 是公開前端設定，**只能**放公開的 publishable/anon key。不要放 Supabase `service_role`、`secret` 或 OpenAI API key。

### 2. 建立 OpenAI API key

1. 到 <https://platform.openai.com/api-keys> 建立 API key，並設定合適的用量限制。
2. 不要把這把 key 貼進 `config.js` 或任何 Git 儲存庫。

### 3. 部署到 Vercel

1. 將這整個資料夾推送到**私人** GitHub repository（可自行決定是否公開程式碼；密鑰仍不可入庫）。
2. 登入 <https://vercel.com> → Add New → Project → Import GitHub repository。
3. Framework Preset 選 **Other**，Root Directory 為本專案資料夾，無需 build command；Vercel 會提供靜態網站與 `api/analyze.js` 函式。
4. 在 Project Settings → Environment Variables 設定：

| 名稱 | 內容 | 說明 |
|---|---|---|
| `OPENAI_API_KEY` | `sk-...` | 必填，只可在 Vercel 後端環境變數中設定 |
| `SUPABASE_URL` | `https://你的專案.supabase.co` | 必填 |
| `SUPABASE_ANON_KEY` | 公開的 publishable / anon key | 必填，用來驗證 Supabase 登入 token |
| `OPENAI_VISION_MODEL` | `gpt-4.1-mini` | 選填，預設為這個支援圖片輸入的模型 |

5. Deploy。取得 `https://你的網站.vercel.app` 後將其加入 Supabase Auth URL Configuration。
6. 用你自己的 Email 註冊 / 登入 → 建立空間 → 複製 8 碼邀請碼；請另一位用自己的 Email 註冊 / 登入 → 加入空間。

**注意**：如果在 Vercel 變更環境變數，請重新部署以套用設定。

## 如何紀錄一起吃的餐點

1. 點手機底部「今天／明天」切換日期，或選擇其他日期，按「拍照記錄」。
2. 點「開啟相機」直接拍照，或「從相簿選擇」，再補充餐廳名稱、菜色以及實際食用情況（例如：有糖檸檬茶、湯飯兩人分吃）。
3. 點「AI 估算這張照片」。AI 會把照片中的菜餚逐項列出，附上大致熱量與三大營養素。
4. 依實際情況修正每一項食物的 kcal，然後分別輸入 **兩人的吃掉比例**。例如：

   - 「龍蝦泡飯」整份 700 kcal：你 60%、他 40% → 你 420 kcal、他 280 kcal。
   - 「有糖凍檸茶」整杯 150 kcal：你 0%、他 100% → 你 0 kcal、他 150 kcal。
   - 「青菜」整盤 180 kcal：你 40%、他 40%，另外 20% 沒吃完。

5. 儲存後兩人的當日熱量自動更新；任何一位登入都能看到這筆共同紀錄。

## 隱私、限制與注意事項

- 照片放在 **private Supabase Storage bucket**，只有同一共用空間的登入成員能獲取限時連結。
- API key 保存在伺服器環境變數，使用者瀏覽器看不到 OpenAI 私密金鑰。
- AI 照片估算具有誤差，尤其油、糖、醬料、烹調方式、照片外的食物及食用比例。熱量與三大營養素都可手動修正。
- **不會自動上網查餐廳的正式菜單或營養標示**。如果你能提供菜單、份量或官方營養資料，請手動填入更可靠的數字。AI 不可把推估數字宣稱為官方值。
- 每位帳號**每日最多 20 次 AI 分析**（以 UTC 日為界），避免 API 意外高額使用；超過仍能手動記錄。
- 每個帳號目前只能加入一個共用空間，每個空間最多 2 人；這是刻意的簡化設計。
- 雖然兩人可以各自登入，**同一空間的成員也都可以編輯/刪除共同餐點**。如果要更嚴格的個人權限，可再升級。
- 圖片只用於當次分析請求並持續存於你的 Supabase Storage；OpenAI API 會處理你提交的圖片，請自行確認資料政策與保留選項。
- 這是示範專案，公開商業使用前建議再加上錯誤監控、帳號刪除、內容匯出、圖片清理與更多安全測試。

## 檔案說明

| 檔案 | 功能 |
|---|---|
| `index.html` | 網站入口與 PWA 中繼資料 |
| `manifest.webmanifest`、`icons/` | iPhone / Android 桌面圖示與 PWA 安裝設定 |
| `sw.js`、`offline.html` | 公開網站資源快取與離線提示；不快取私人餐點資料 |
| `styles.css` | 響應式手機與電腦版樣式 |
| `app.js` | 登入、雙人日記、分食、統計、照片與 AI 操作 |
| `config.js` | 可公開的 Supabase 連線參數 |
| `api/analyze.js` | Vercel 伺服器端 AI 推估，包含登入驗證和每日用量限制 |
| `sql/setup.sql` | Supabase 資料表、RLS 權限、私人照片儲存桶、登入建立/加入空間等 |

## 常見問題

**Q: 為什麼沒有 AI 熱量？** 目前可能仍在「預覽模式」、`OPENAI_API_KEY` 未設定，或用量已達上限。也可能是圖片太大、API 設定不正確或模型不可用。手動紀錄仍可使用。

**Q: 為什麼對方看不到紀錄？** 確認兩人登入的是不同 Email，且第二位已輸入正確的邀請碼加入同一空間。私人瀏覽器預覽模式不會同步。

**Q: 為什麼餐點看起來不準？** 光靠照片無法可靠知道食用份量。儲存前請確認每項餐點總熱量與雙方分食比例；有餐廳官方營養標示時應優先使用官方資料。
