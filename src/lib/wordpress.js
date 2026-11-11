const root = (import.meta.env.WP_URL || 'https://cystudio.tw').replace(/\/$/, '');
export const projectType = import.meta.env.WP_PROJECT_TYPE || 'project';
export const projectTaxonomy = import.meta.env.WP_PROJECT_TAXONOMY || 'catalogue';

async function api(path) {
  const url = `${root}/wp-json/wp/v2/${path}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`WordPress API ${response.status} at ${url}`);
  return response.json();
}

// build 期間的模組層暫存：同一批資料（文章/專案/分類）整個 build 只抓一次
// 僅 build 生效（import.meta.env.PROD）；dev 每次請求都抓最新，方便即時預覽 WP 變更
const buildCache = import.meta.env.PROD ? new Map() : null;

async function all(path) {
  if (buildCache?.has(path)) return buildCache.get(path);
  const items = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}&_embed`);
    if (!Array.isArray(batch)) return [];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  buildCache?.set(path, items);
  return items;
}

export const getPosts = () => all('posts?status=publish');
export const getCategories = () => all('categories?hide_empty=true');
export const getProjects = () => all(`${projectType}?status=publish`);
export const getCatalogues = () => all(`${projectTaxonomy}?hide_empty=true`);
export const getPost = async (slug) => (await api(`posts?slug=${encodeURIComponent(slug)}&_embed`))[0] ?? null;
export const getProject = async (slug) => (await api(`${projectType}?slug=${encodeURIComponent(slug)}&_embed`))[0] ?? null;

export function imageOf(item) {
  const media = item?._embedded?.['wp:featuredmedia']?.[0];
  return media?.media_details?.sizes?.large?.source_url || media?.source_url || '';
}

// 卡片縮圖：特色圖抓不到（附件被設為私密或已刪除，WP 只回 401 錯誤物件）時，退回內文第一張圖
export function thumbOf(item) {
  const featured = imageOf(item);
  if (featured) return featured;
  const match = String(item?.content?.rendered || '').match(/<img\b[^>]*\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  return match ? (match[1] ?? match[2]) : '';
}
export function termsOf(item, taxonomy) {
  const groups = item?._embedded?.['wp:term'] || [];
  return groups.flat().filter((term) => term.taxonomy === taxonomy);
}

// ACF 自訂欄位：brief（作品簡介 HTML）與 url（作品外部連結）
// brief 偶爾會殘留區塊編輯器的屬性（contenteditable、role、rich-text class），輸出前清掉
export function briefOf(item) {
  const html = String(item?.acf?.brief || '').trim();
  if (!html) return '';
  return html
    .replace(/\s(?:contenteditable|role|aria-multiline|aria-label|spellcheck|translate|data-rich-text-format-boundary)="[^"]*"/gi, '')
    .replace(/\sclass="[^"]*(?:rich-text|block-editor-rich-text)[^"]*"/gi, '');
}

export function urlOf(item) {
  return String(item?.acf?.url || '').trim();
}
const entities = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—',
  ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  copy: '©', reg: '®', trade: '™', deg: '°', middot: '·', bull: '•', permil: '‰',
  times: '×', divide: '÷', prime: '′', Prime: '″',
};

function codePoint(code) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (match, dec) => codePoint(Number(dec)))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

function plainText(value = '') {
  return decodeEntities(
    String(value)
      .replace(/<a\b[^>]*\bmore-link\b[^>]*>[\s\S]*?<\/a\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function clean(value = '') {
  return plainText(value);
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  let end = limit;
  // Avoid cutting a Latin word in half: back up to the previous word boundary.
  if (/[A-Za-z0-9]/.test(text[end]) && /[A-Za-z0-9]/.test(text[end - 1])) {
    for (let index = limit; index > 0; index -= 1) {
      if (!/[A-Za-z0-9]/.test(text[index - 1])) { end = index; break; }
    }
    if (end < Math.max(limit * 0.6, 20)) end = limit;
  }
  return `${text.slice(0, end).trim()}…`;
}

export function excerptOf(post, limit = 90) {
  const excerpt = plainText(post?.excerpt?.rendered || '');
  if (!excerpt) return '';
  const withoutMarker = excerpt.replace(/\s*\[?\s*…\s*\]?\s*$/u, '');
  if (withoutMarker === excerpt) return excerpt;
  // WordPress auto-trimmed this excerpt by words (it cuts Latin words mid-way and
  // appends "[…]"). Rebuild it from the content with a character-based truncation.
  const content = plainText(post?.content?.rendered || '');
  return content ? truncate(content, limit) : withoutMarker;
}
export function routeSlug(slug = '') {
  try { return decodeURIComponent(slug); } catch { return slug; }
}

// 有提供「原網址.webp」對應檔的圖片來源：WP 圖床（*.cystudio.tw）與本機 /images
const webpHosts = [/(^|\.)cystudio\.tw$/i];

// 回傳 圖片網址 + '.webp'（給支援 WebP 的瀏覽器用）；非點陣圖或來源不符時回傳空字串
export function webpOf(url = '') {
  const value = String(url || '').split('#')[0];
  const [path, ...query] = value.split('?');
  if (!/\.(jpe?g|png|gif)$/i.test(path)) return '';
  if (/^https?:\/\//i.test(path)) {
    let host = '';
    try { host = new URL(path).hostname; } catch { return ''; }
    if (!webpHosts.some((pattern) => pattern.test(host))) return '';
  }
  return `${path}.webp${query.length ? `?${query.join('?')}` : ''}`;
}

function webpSrcset(srcset = '') {
  return srcset.split(',').map((candidate) => {
    const parts = candidate.trim().split(/\s+/);
    const webp = webpOf(parts[0]);
    return webp ? [webp, ...parts.slice(1)].join(' ') : candidate.trim();
  }).join(', ');
}

// 把內容 HTML 裡的 <img> 包上 <picture>，讓支援 WebP 的瀏覽器改載 原網址.webp
export function withWebp(html = '') {
  return String(html || '').replace(/<img\b[^>]*\/?>/gi, (tag) => {
    const attr = (name) => {
      const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
      return match ? (match[1] ?? match[2]) : '';
    };
    const webp = webpOf(attr('src'));
    if (!webp) return tag;
    const srcset = attr('srcset');
    const sizes = attr('sizes');
    const source = `<source srcset="${srcset ? webpSrcset(srcset) : webp}" type="image/webp"${sizes ? ` sizes="${sizes}"` : ''}/>`;
    return `<picture>${source}${tag}</picture>`;
  });
}
export function dateOf(item) {
  return item?.date ? new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(item.date)) : '';
}
