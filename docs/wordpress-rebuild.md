# 自動重建與清除 Cloudflare 快取

網站是「WordPress 內容 → GitHub Actions 建置 → GitHub Pages → Cloudflare」的靜態站。
所以 WP 改了內容，前端不會自己變；必須重建，而且重建後還要清 Cloudflare 快取。

這份文件說明兩件事：

1. **重建完成後自動清 Cloudflare 快取**（GitHub Actions 已設定好，只差 secrets）
2. **WordPress 後台觸發重建**（發文自動觸發 + 手動按鈕）

---

## 一、讓 GitHub Actions 自動清 Cloudflare 快取

流程已寫在 `.github/workflows/deploy.yml`：部署成功後等 15 秒，執行 `scripts/purge-cloudflare.mjs`。
沒設定 secrets 時會自動跳過、不會讓部署失敗。

### 只清 cystudio.tw，不動其他 custom hostname

預設使用 **Purge by hostname**（`{"hosts":["cystudio.tw","www.cystudio.tw"]}`），
只會清除這兩個 host 的快取，同一個 zone 裡的其他 custom hostname（Cloudflare for SaaS 客戶網域）不受影響。
全方案（Free／Pro／Business／Enterprise）都支援，一次最多 100 個 hostname。

要改清哪些 hostname：repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** 新增

| Name | Value | 說明 |
|---|---|---|
| `CLOUDFLARE_PURGE_HOSTS` | `cystudio.tw,www.cystudio.tw` | 逗號分隔；不設就用這個預設值 |
| `CLOUDFLARE_PURGE_MODE` | `host`（預設）或 `everything` | `everything` = 整個 zone 全清，會連其他 custom hostname 一起清 |

（`everything` 只在確定要全 zone 清除時才用，平常留空或設 `host`。）

### 1. 建立 Cloudflare API Token

1. 登入 Cloudflare → 右上角頭像 → **My Profile** → **API Tokens** → **Create Token**
2. 選 **Create Custom Token**
3. 設定：
   - **Permissions**：`Zone` → `Cache Purge` → `Purge`
   - **Zone Resources**：`Include` → `Specific zone` → `cystudio.tw`
4. Create Token，把 token 複製下來（只會顯示一次）

### 2. 取得 Zone ID

Cloudflare → 選 `cystudio.tw` → 右側 **Overview** 頁面最下方 **API** 區塊 → **Zone ID**。

### 3. 加到 GitHub repo secrets

repo → **Settings** → **Secrets and variables** → **Actions** → **Secrets** → **New repository secret**：

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 步驟 1 的 token |
| `CLOUDFLARE_ZONE_ID` | 步驟 2 的 Zone ID |

完成後，之後每次部署（push / 排程 / 手動 / WP 觸發）都會自動清快取。

### 本機測試（可選）

```powershell
$env:CLOUDFLARE_API_TOKEN='your-token'
$env:CLOUDFLARE_ZONE_ID='your-zone-id'
npm run purge

# 只印出會送出的請求內容，不真的清除
npm run purge -- --dry-run
```

### 後台手動清除（不用 API）

Cloudflare → `cystudio.tw` → **Caching** → **Configuration** → **Purge Cache** → **Custom Purge** →
**Purge by** 選 **Hostname** → 輸入 `cystudio.tw`（一行一個，可加 `www.cystudio.tw`）→ Purge。
這樣也只會清這兩個 hostname。

---

## 二、WordPress 後台觸發 GitHub 重建

### 做法：WP 打 GitHub `repository_dispatch`

`.github/workflows/deploy.yml` 已加入 `repository_dispatch: types: [wp-update]`，
WP 端只要送一個 POST 到 GitHub API，就會觸發一次完整的建置＋部署＋清快取。

外掛檔案：`wordpress/cystudio-rebuild.php`

功能：

- 文章／作品 **發佈、更新、刪除** 後，**排程 1 小時後**自動重建（這段時間內的多次修改會合併成一次）
- WP 後台 **工具 → 重建前端網站** 有手動「立即重建前端」按鈕（立即執行，並取消等待中的排程）
- 會顯示上次觸發時間、下次排程時間

要改延遲時間：在 `wp-config.php` 加常數（秒）：

```php
define('CYSTUDIO_REBUILD_DELAY', 1800); // 30 分鐘；預設 3600（1 小時）
```

> 自動重建用 WordPress 內建的 WP-Cron，排程時間到要有網站流量才會執行。
> 流量很低的站可能延後；要準時可改用主機 cron 呼叫 `wp-cron.php`，或按「立即重建前端」。

### 1. 建立 GitHub Fine-grained Token

1. GitHub → 右上角頭像 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. 設定：
   - **Repository access**：`Only select repositories` → `cystudiotw/cystudio`
   - **Permissions** → **Repository permissions** → **Contents**：`Read and write`
     （`repository_dispatch` 需要 Contents 寫入權限）
   - Expiration：依喜好（到期前記得換）
3. Generate token，複製 `github_pat_...`

### 2. 上傳外掛到 WordPress

把 `wordpress/cystudio-rebuild.php` 放到 WP 主機的：

```
wp-content/mu-plugins/cystudio-rebuild.php
```

`mu-plugins` 資料夾不存在就自己建立（mu-plugin 會自動啟用，不用到後台啟用）。
沒有 FTP／檔案權限的話，也可以把檔案內容貼到主題的 `functions.php`，或用 Code Snippets 外掛新增一段 PHP。

> 注意：放在 `functions.php` 的話，換主題會失效；`mu-plugins` 比較安全。

### 3. 在 `wp-config.php` 設定常數

在 `wp-config.php`（`/* That's all, stop editing! */` 之前）加入：

```php
define('CYSTUDIO_GITHUB_TOKEN', 'github_pat_xxxxxxxxxxxxxxxx');
define('CYSTUDIO_GITHUB_REPO', 'cystudiotw/cystudio');
```

### 4. 驗證

1. WP 後台 → **工具 → 重建前端網站** → 按「立即重建前端」
2. 應該出現綠色提示；到 GitHub repo → **Actions** 會看到一筆 `repository_dispatch` 觸發的 run
3. 約 1–2 分鐘後線上網站更新，並自動清 Cloudflare 快取

之後在 WP 發文或按「更新」，會在 1 小時後自動重建，不用再手動去 GitHub 按 Run workflow。

---

## 常見問題

**Q：改了 WP 內容，等多久會上線？**
編輯後 **1 小時**自動重建（建置＋部署＋清快取再約 1–2 分鐘）。這 1 小時內連續修改多次只會重建一次（合併成最新內容）。想立刻上線就按「工具 → 重建前端網站 → 立即重建前端」。

**Q：WP 主機送不出請求？**
外掛用 `wp_remote_post()` 連 `api.github.com`，主機防火牆／資安外掛若擋外連就會失敗。
到「工具 → 重建前端網站」按鈕測試，失敗時會顯示 GitHub 回傳的錯誤。

**Q：Token 放哪裡安全？**
放在 `wp-config.php` 常數（不進資料庫、不會被外掛介面看到）。Token 權限只給這一個 repo 的 Contents 寫入即可。

**Q：`repository_dispatch` 沒反應？**
這個事件只會執行 **預設分支（main）** 上的 workflow，確認 `deploy.yml` 已 push 到 main。

**Q：排程重建還在嗎？**
在。每天台灣時間 09:00 仍會自動重建一次，當作保險。
