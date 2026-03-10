import {
  DDG_HTML_URL,
  decodeHtmlEntities,
  fetchText,
  filterResultsByDomains,
  normalizeUrl,
  normalizeWhitespace,
} from "../lib/shared.mjs";

function parseDuckDuckGoHtml(html, maxResults) {
  const results = [];
  const patterns = [
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
    /<h2[^>]*class="[^"]*result__title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
    /<article[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && results.length < maxResults) {
      const url = normalizeUrl(match[1]);
      const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ""));
      const snippet = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, ""));
      if (!url || !title) continue;
      results.push({
        title: normalizeWhitespace(title),
        url,
        snippet: normalizeWhitespace(snippet),
        publishedAt: null,
        rawScore: null,
        position: results.length + 1,
      });
    }
    if (results.length > 0) break;
  }

  return results;
}

export const duckduckgoProvider = {
  name: "duckduckgo",
  lane: "general_web",
  costTier: "free",
  stability: "community",
  note: "DuckDuckGo HTML fallback without an official search API contract.",
  supports: {
    freshness: false,
    domains: false,
    language: false,
    news: false,
    content: false,
    region: true,
  },
  getAuthMode() {
    return "none";
  },
  isConfigured() {
    return true;
  },
  async search(query, options) {
    const searchParams = new URLSearchParams({ q: query });
    if (options.region) searchParams.set("kl", options.region);

    const html = await fetchText(`${DDG_HTML_URL}?${searchParams.toString()}`, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });

    return filterResultsByDomains(
      parseDuckDuckGoHtml(html, options.maxResults),
      options.includeDomains,
      options.excludeDomains,
    );
  },
};
