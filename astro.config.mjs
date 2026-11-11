import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://cystudio.tw',
  output: 'static',
  trailingSlash: 'always',
  redirects: {
    // 舊的文章網址 /post/... 改為 /blog/...
    '/post/[slug]': '/blog/[slug]',
  },
});
