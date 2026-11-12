// 部署完成後清除 Cloudflare 快取
//
// 預設「只清指定 hostname」的快取（purge by hostname），
// 不會動到同一個 zone 裡的其他 custom hostname。
//
// 使用時機：
//   1. GitHub Actions 部署成功後自動執行（deploy.yml 最後一步）
//   2. 本機手動執行：npm run purge
//
// 需要的環境變數（GitHub repo → Settings → Secrets and variables → Actions → Secrets）：
//   CLOUDFLARE_API_TOKEN  — Cloudflare API Token（權限：Zone → Cache Purge → Purge）
//   CLOUDFLARE_ZONE_ID    — cystudio.tw 的 Zone ID
//
// 選用環境變數：
//   CLOUDFLARE_PURGE_HOSTS — 要清除的 hostname，逗號分隔
//                            預設 cystudio.tw（不存在 www 也沒關係）
//   CLOUDFLARE_PURGE_MODE  — host（預設）或 everything（整個 zone 全清，會影響所有 hostname）
//
// 未設定 token / zone id 時直接跳過（exit 0），不會讓部署流程失敗。

const token = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
const zoneId = (process.env.CLOUDFLARE_ZONE_ID || '').trim();
const mode = (process.env.CLOUDFLARE_PURGE_MODE || 'host').trim().toLowerCase();
// GitHub Actions 的 vars 沒設定時會是空字串，空字串要視為「用預設值」
const hostsRaw = (process.env.CLOUDFLARE_PURGE_HOSTS || '').trim() || 'cystudio.tw';
const hosts = hostsRaw
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const dryRun = process.argv.includes('--dry-run');

if (!token || !zoneId) {
  console.log('[purge] 未設定 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID，跳過清除快取。');
  console.log('[purge] 設定方式見 docs/wordpress-rebuild.md');
  process.exit(0);
}

if (mode !== 'everything' && hosts.length === 0) {
  console.error('[purge] CLOUDFLARE_PURGE_HOSTS 是空的，不知道要清哪個 hostname。');
  process.exit(1);
}

const endpoint = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cloudflare 一次最多 100 個操作（hostname / URL）
function chunk(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function purge(body) {
  if (dryRun) {
    console.log(`[purge] dry-run 請求內容：${JSON.stringify(body)}`);
    return true;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        console.log(`[purge] 已清除：${JSON.stringify(body)}`);
        return true;
      }

      const detail = JSON.stringify(data.errors ?? data);
      console.error(`[purge] 第 ${attempt} 次失敗：HTTP ${response.status} ${detail}`);

      // 429 / 1134 = 超過 purge 速率限制，等久一點再試
      const rateLimited = response.status === 429 || (data.errors || []).some((e) => e.code === 1134);
      if (rateLimited) await sleep(15000);
      else if (attempt < 3) await sleep(2000 * attempt);
    } catch (error) {
      console.error(`[purge] 第 ${attempt} 次失敗：${error.message}`);
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }

  return false;
}

const bodies = mode === 'everything' ? [{ purge_everything: true }] : chunk(hosts, 100).map((part) => ({ hosts: part }));

if (mode === 'everything') {
  console.log('[purge] 模式：everything（整個 zone 全部清除，包含所有 custom hostname）');
} else {
  console.log(`[purge] 模式：host（只清 ${hosts.join(', ')} 的快取）`);
}

for (const body of bodies) {
  const ok = await purge(body);
  if (!ok) {
    console.error('[purge] Cloudflare 快取清除失敗（已重試 3 次）');
    process.exit(1);
  }
}

console.log('[purge] 完成');
process.exit(0);
