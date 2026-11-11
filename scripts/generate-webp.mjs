// 為 public/images 裡的點陣圖產生 原檔名.webp（給支援 WebP 的瀏覽器載入用）
// 已存在的 .webp 不會重複產生；執行：npm run webp（build 前也會自動跑一次）
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve('public/images');
const raster = /\.(jpe?g|png)$/i;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (raster.test(entry.name)) files.push(full);
  }
  return files;
}

const files = await walk(root);
let created = 0;
for (const file of files) {
  const target = `${file}.webp`;
  try { await access(target); continue; } catch { /* 還沒產生過 */ }
  await sharp(file).webp({ quality: 82 }).toFile(target);
  created += 1;
  console.log(`+ ${path.relative(process.cwd(), target)}`);
}
console.log(`WebP 產生完成：新增 ${created} 個（掃到 ${files.length} 張點陣圖）`);
