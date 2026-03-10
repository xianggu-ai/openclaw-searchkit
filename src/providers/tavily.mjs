import {
  TAVILY_API_KEY,
  fetchJson,
  normalizeUrl,
  normalizeWhitespace,
} from "../lib/shared.mjs";

export const tavilyProvider = {
  name: "tavily",
  lane: "general_web",
  costTier: "free_credit",
  stability: "official",
  note: "Primary general web provider when TAVILY_API_KEY is configured.",
  supports: {
    freshness: true,
    domains: true,
    language: false,
    news: true,
    content: true,
    region: false,
  },
  getAuthMode() {
    return "api_key";
  },
  isConfigured() {
    return Boolean(TAVILY_API_KEY);
  },
  async search(query, options) {
    if (!TAVILY_API_KEY) {
      throw new Error("TAVILY_API_KEY is not set");
    }

    const body = {
      api_key: TAVILY_API_KEY,
      query,
      search_depth: options.searchDepth ?? "advanced",
      topic: options.topic,
      max_results: options.maxResults,
      include_answer: false,
      include_raw_content: false,
    };

    if (options.includeDomains.length > 0) body.include_domains = options.includeDomains;
    if (options.excludeDomains.length > 0) body.exclude_domains = options.excludeDomains;
    if (options.topic === "news" && options.days) body.days = options.days;

    const data = await fetchJson("https://api.tavily.com/search", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!Array.isArray(data.results)) {
      throw new Error(`Tavily API error: ${JSON.stringify(data)}`);
    }

    return data.results.map((item, index) => ({
      title: normalizeWhitespace(item.title),
      url: normalizeUrl(item.url),
      snippet: normalizeWhitespace(item.content),
      publishedAt: item.published_date ?? item.publishedAt ?? null,
      rawScore: typeof item.score === "number" ? item.score : null,
      position: index + 1,
    })).filter((item) => item.url);
  },
  async extract(urls) {
    if (!TAVILY_API_KEY || urls.length === 0) {
      return { success: new Map(), failed: [] };
    }

    const data = await fetchJson("https://api.tavily.com/extract", {
      method: "POST",
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        urls,
      }),
    });

    const success = new Map();
    for (const item of data.results ?? []) {
      const url = normalizeUrl(item.url);
      const rawContent = normalizeWhitespace(item.raw_content);
      if (url && rawContent) success.set(url, rawContent);
    }

    return {
      success,
      failed: data.failed_results ?? [],
    };
  },
};
