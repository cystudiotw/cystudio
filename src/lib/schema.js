// Schema.org 結構化資料（JSON-LD）產生器
// 全部為純函式：傳入基本值，回傳可 JSON.stringify 的物件
const site = String(import.meta.env.SITE || 'https://cystudio.tw').replace(/\/$/, '');
export const siteUrl = site;

const logo = { '@type': 'ImageObject', url: `${site}/images/large-logo.png`, width: 800, height: 200 };

// 全站共用的 Organization 節點（facts 來源：llms.txt、頁尾、WP Yoast schema）
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${site}/#organization`,
    name: '雲橙工作室',
    alternateName: ['雲橙網頁設計工作室', 'cystudio'],
    url: `${site}/`,
    logo,
    email: 'cystudio.tw@gmail.com',
    founder: { '@type': 'Person', name: 'Mark Chen', jobTitle: '創辦人兼技術長' },
    foundingDate: '2013',
    address: { '@type': 'PostalAddress', addressCountry: 'TW', addressLocality: '台中市' },
    sameAs: ['https://www.facebook.com/profile.php?id=100069025302263'],
    taxID: '82601473',
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: 'cystudio.tw@gmail.com',
      availableLanguage: ['zh-Hant'],
    },
  };
}

// 全站共用的 WebSite 節點
export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${site}/#website`,
    name: '雲橙網頁設計工作室',
    alternateName: 'cystudio',
    url: `${site}/`,
    inLanguage: 'zh-Hant',
    publisher: { '@id': `${site}/#organization` },
  };
}

// 麵包屑：items = [{ name, url }]（最後一層可只給 name）
export function breadcrumbSchema(items = []) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };
}

// 部落格文章
export function articleSchema({ title, description, url, image, published, modified, keywords } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(url ? { mainEntityOfPage: { '@type': 'WebPage', '@id': url } } : {}),
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
    ...(keywords?.length ? { keywords: keywords.join(', ') } : {}),
    inLanguage: 'zh-Hant',
    author: { '@type': 'Person', name: 'Mark Chen' },
    publisher: { '@id': `${site}/#organization`, ...logo },
    isPartOf: { '@id': `${site}/#website` },
  };
}

// 作品案例
export function creativeWorkSchema({ title, description, url, image, published, modified, keywords } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: title,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(url ? { mainEntityOfPage: { '@type': 'WebPage', '@id': url }, url } : {}),
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
    ...(keywords?.length ? { keywords: keywords.join(', ') } : {}),
    inLanguage: 'zh-Hant',
    creator: { '@id': `${site}/#organization` },
    publisher: { '@id': `${site}/#organization` },
    isPartOf: { '@id': `${site}/#website` },
  };
}

// 列表頁（部落格索引、分類、作品目錄）
export function collectionSchema({ title, description, url, items = [] } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    ...(description ? { description } : {}),
    ...(url ? { url, mainEntityOfPage: { '@id': url } } : {}),
    isPartOf: { '@id': `${site}/#website` },
    ...(items.length ? {
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: items.length,
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          ...(item.url ? { url: item.url } : {}),
          ...(item.name ? { name: item.name } : {}),
        })),
      },
    } : {}),
  };
}
