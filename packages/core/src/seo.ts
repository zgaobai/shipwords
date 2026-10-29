import type { SiteConfig } from './site';

// Builders for page head, sitemap, robots and llms.txt. Sites decide the content; this only guarantees the format.

export interface PageMeta {
  title: string;
  description: string;
  /** Site-relative path starting with /. */
  path: string;
  image?: string;
  noindex?: boolean;
  /** The page's JSON-LD object, e.g. WebApplication or FAQPage. */
  jsonLd?: Record<string, unknown>[];
}

export function absoluteUrl(site: SiteConfig, path: string) {
  return `${site.url}${path === '/' ? '' : path}`;
}

/** Returns the meta, links and scripts that TanStack Router head() expects. */
export function pageHead(site: SiteConfig, page: PageMeta) {
  const url = absoluteUrl(site, page.path);
  const meta: Record<string, string>[] = [
    { title: page.title },
    { name: 'description', content: page.description },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: site.name },
    { property: 'og:title', content: page.title },
    { property: 'og:description', content: page.description },
    { property: 'og:url', content: url },
    { name: 'twitter:card', content: page.image ? 'summary_large_image' : 'summary' },
  ];
  if (page.image) {
    meta.push({ property: 'og:image', content: page.image }, { name: 'twitter:image', content: page.image });
  }
  if (page.noindex) meta.push({ name: 'robots', content: 'noindex, nofollow' });
  return {
    meta,
    links: [{ rel: 'canonical', href: url }],
    scripts: (page.jsonLd ?? []).map((data) => ({
      type: 'application/ld+json',
      children: JSON.stringify({ '@context': 'https://schema.org', ...data }),
    })),
  };
}

export interface SitemapEntry {
  path: string;
  lastmod?: string;
}

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const textHeaders = (type: string) => ({
  'content-type': `${type}; charset=utf-8`,
  'cache-control': 'public, max-age=3600',
});

export function sitemapXml(site: SiteConfig, entries: SitemapEntry[]): Response {
  const urls = entries.map((entry) => {
    const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : '';
    return `  <url><loc>${escapeXml(absoluteUrl(site, entry.path))}</loc>${lastmod}</url>`;
  });
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('\n');
  return new Response(body, { headers: textHeaders('application/xml') });
}

export function robotsTxt(site: SiteConfig, disallow: string[] = []): Response {
  const lines = [
    'User-agent: *',
    'Allow: /',
    ...disallow.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${site.url}/sitemap.xml`,
  ];
  return new Response(`${lines.join('\n')}\n`, { headers: textHeaders('text/plain') });
}

export interface LlmsPage {
  title: string;
  path: string;
  description: string;
}

/** llms.txt: a site summary for AI search; format at https://llmstxt.org. */
export function llmsTxt(site: SiteConfig, summary: string, pages: LlmsPage[]): Response {
  const body = [
    `# ${site.name}`,
    '',
    `> ${summary}`,
    '',
    '## Pages',
    '',
    ...pages.map((page) => `- [${page.title}](${absoluteUrl(site, page.path)}): ${page.description}`),
    '',
  ].join('\n');
  return new Response(body, { headers: textHeaders('text/plain') });
}

export interface AiCitationLink {
  id: 'chatgpt' | 'claude' | 'perplexity' | 'gemini' | 'grok';
  name: string;
  url: string;
  prompt: string;
}

export function buildAiPrompt(site: SiteConfig, locale = 'en'): string {
  const llmsUrl = `${site.url}/llms.txt`;
  if (locale === 'zh') {
    return `介绍一下 ${site.name} (${site.url})，根据 ${llmsUrl} 总结它的主要功能、价格套餐和使用方式。`;
  }
  return `What is ${site.name} (${site.url})? Summarize its key features, pricing, and how to use it based on ${llmsUrl}.`;
}

/** Generates citation deep links to ChatGPT, Claude, Perplexity, Gemini and Grok with pre-filled prompts. */
export function aiCitationLinks(site: SiteConfig, promptOrLocale: string = 'en'): AiCitationLink[] {
  const prompt = promptOrLocale.length <= 5 ? buildAiPrompt(site, promptOrLocale) : promptOrLocale;
  const q = encodeURIComponent(prompt);
  return [
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      url: `https://chatgpt.com/?q=${q}`,
      prompt,
    },
    {
      id: 'claude',
      name: 'Claude',
      url: `https://claude.ai/new?q=${q}`,
      prompt,
    },
    {
      id: 'perplexity',
      name: 'Perplexity',
      url: `https://www.perplexity.ai/search?q=${q}`,
      prompt,
    },
    {
      id: 'gemini',
      name: 'Gemini',
      url: `https://gemini.google.com/app?q=${q}`,
      prompt,
    },
    {
      id: 'grok',
      name: 'Grok',
      url: `https://x.com/i/grok?text=${q}`,
      prompt,
    },
  ];
}
