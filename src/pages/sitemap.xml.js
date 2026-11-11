import { getPosts, getProjects, getCategories, getCatalogues } from '../lib/wordpress.js';

export async function GET({ site }) {
  const urls = new Set([new URL('/', site).href, new URL('/blog/', site).href, new URL('/catalogue/', site).href]);
  try {
    const [posts, projects, categories, catalogues] = await Promise.all([getPosts(), getProjects(), getCategories(), getCatalogues()]);
    posts.forEach(item => urls.add(new URL(`/blog/${item.slug}/`, site).href));
    projects.forEach(item => urls.add(new URL(`/project/${item.slug}/`, site).href));
    categories.forEach(item => urls.add(new URL(`/category/${item.slug}/`, site).href));
    catalogues.forEach(item => urls.add(new URL(`/catalogue/${item.slug}/`, site).href));
  } catch (error) { console.warn(`Sitemap includes base URLs only: ${error.message}`); }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...urls].map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
