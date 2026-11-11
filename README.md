# cystudio.tw — Astro 前端（WordPress headless）

Build 時從 WordPress REST API 抓取內容（文章、作品案例），產出純靜態 HTML，部署到 GitHub Pages。訪客瀏覽時完全不依賴 WP 主機。

## 本機開發

```bash
npm install
npm run dev        # dev 即時抓 WP（改 WP 內容重新整理就看得到）
npm run build      # 產出 dist/（約 10 秒，同 build 內容只抓一次 API）
npm run preview    # 本機預覽 dist/ 正式產出
```

## 更新文章 / 作品（不用改任何程式碼）

1. WordPress 後台發佈文章（建議設定：分類、特色圖、excerpt）
2. GitHub → **Actions** → **Deploy to GitHub Pages** → **Run workflow**
3. 等 1–2 分鐘自動上站

也可以什麼都不按：**每天台灣時間 09:00 會自動重建**，抓取 WP 最新內容。

## 部署結構

- `push 到 main` → 自動 build + 部署
- `public/CNAME` = `cystudio.tw`（GitHub Pages 自訂網域）
- 環境變數 `WP_URL`：WP API 位址。DNS 把 cystudio.tw 切到 GitHub Pages 之後，WP 搬家到新位址（如 `wp.cystudio.tw`）時，在 repo **Settings → Secrets and variables → Actions → Variables** 新增 `WP_URL` 即可，程式不用改。

## 相關目錄

- `src/lib/wordpress.js` — WP API 抓取與資料處理（WebP、ACF、摘要）
- `src/lib/schema.js` — JSON-LD 結構化資料產生器
- `scripts/generate-webp.mjs` — build 前自動產生本地圖片 WebP（prebuild）
- `scripts/generate-og.mjs` — 重產 og-image.jpg（`npm run og`）
