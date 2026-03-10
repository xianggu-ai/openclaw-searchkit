import {
  SEARXNG_BASE_URL,
  SEARXNG_ENGINES,
  SEARXNG_LANGUAGE,
  USER_AGENT,
  fetchJson,
  filterResultsByDomains,
  normalizeUrl,
  normalizeWhitespace,
} from "../lib/shared.mjs";

function buildSearchUrl(params) {
  const base = SEARXNG_BASE_URL.endsWith("/search")
    ? SEARXNG_BASE_URL
    : `${SEARXNG_BASE_URL}/search`;
  return `${base}?${params.toString()}`;
}

function resolveTimeRange(days) {
  if (!days) return null;
  if (days <= 1) return "day";
  if (days <= 31) return "month";
  return "year";
}

export const searxngProvider = {
  name: "searxng",
  lane: "general_web",
  costTier: "free",
  stability: "self_hosted",
  note: "Self-hosted or user-supplied SearXNG instance via SEARXNG_BASE_URL.",
  supports: {
    freshness: true,
    domains: false,
    language: true,
    news: true,
    content: false,
    region: false,
  },
  getAuthMode() {
    return "none";
  },
  isConfigured() {
    return Boolean(SEARXNG_BASE_URL);
  },
  async search(query, options) {
    if (!SEARXNG_BASE_URL) {
      throw new Error("SEARXNG_BASE_URL is not set");
    }

    const params = new URLSearchParams({
      q: query,
      format: "json",
      safesearch: "0",
    });

    if (SEARXNG_ENGINES) params.set("engines", SEARXNG_ENGINES);
    if (SEARXNG_LANGUAGE) params.set("language", SEARXNG_LANGUAGE);
    if (options.topic === "news") params.set("categories", "news");
    const timeRange = resolveTimeRange(options.days);
    if (timeRange) params.set("time_range", timeRange);

    const data = await fetchJson(buildSearchUrl(params), {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    if (!Array.isArray(data.results)) {
      throw new Error(`SearXNG API error: ${JSON.stringify(data).slice(0, 400)}`);
    }

    const results = data.results.map((item, index) => ({
      title: normalizeWhitespace(item.title),
      url: normalizeUrl(item.url),
      snippet: normalizeWhitespace(item.content ?? item.description ?? item.pretty_url ?? ""),
      publishedAt: item.publishedDate ?? item.published_at ?? null,
      rawScore: typeof item.score === "number" ? item.score : null,
      position: index + 1,
    })).filter((item) => item.url);

    return filterResultsByDomains(results, options.includeDomains, options.excludeDomains);
  },
};
