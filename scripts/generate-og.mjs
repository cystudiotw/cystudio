// 產生 OG 分享圖（1200x630）：space.jpg 為底 + 深色遮罩 + 置中 logo
// 執行：npm run og（修改 hero 圖或 logo 後可重跑）
import sharp from 'sharp';

const bg = await sharp('public/images/space.jpg')
  .resize(1200, 630, { fit: 'cover' })
  .toBuffer();

const logo = await sharp('public/images/large-logo.png')
  .resize({ width: 480 })
  .toBuffer();
const logoMeta = await sharp(logo).metadata();

const overlay = Buffer.from(
  `<svg width="1200" height="630">
     <rect width="1200" height="630" fill="rgba(10,14,30,0.55)"/>
   </svg>`
);

await sharp(bg)
  .composite([
    { input: overlay },
    { input: logo, left: Math.round((1200 - logoMeta.width) / 2), top: Math.round((630 - logoMeta.height) / 2) },
  ])
  .jpeg({ quality: 85 })
  .toFile('public/images/og-image.jpg');

const meta = await sharp('public/images/og-image.jpg').metadata();
console.log(`og-image.jpg 完成（${meta.width}x${meta.height}）`);
