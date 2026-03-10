import {
  containsCjk,
  decodeHtmlEntities,
  fetchJson,
  filterResultsByDomains,
  normalizeWhitespace,
  overlapScore,
  tokenizeQuery,
  USER_AGENT,
} from "../lib/shared.mjs";

function buildWikipediaUrl(language, pageId) {
  return `https://${language}.wikipedia.org/?curid=${pageId}`;
}

function resolveLanguages(query) {
  if (!containsCjk(query)) return ["en"];
  return /[a-z]/i.test(query) ? ["zh", "en"] : ["zh"];
}

function buildSearchQueries(query) {
  const simplified = normalizeWhitespace(
    query
      .replace(/\b(what is|overview|background|history|guide|introduction|intro)\b/gi, " ")
      .replace(/(是什么|介绍|背景|历史|概览|指南|方法|示例)/g, " "),
  );

  const candidates = [simplified, normalizeWhitespace(query)].filter(Boolean);
  return [...new Set(candidates)];
}

async function searchLanguage(language, query, maxResults) {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    format: "json",
    origin: "*",
    srlimit: String(Math.min(10, maxResults)),
    srprop: "snippet|timestamp",
  });

  const data = await fetchJson(`https://${language}.wikipedia.org/w/api.php?${params.toString()}`, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  return (data.query?.search ?? []).map((item) => ({
    title: normalizeWhitespace(item.title),
    url: buildWikipediaUrl(language, item.pageid),
    snippet: normalizeWhitespace(decodeHtmlEntities(String(item.snippet ?? "").replace(/<[^>]+>/g, ""))),
    publishedAt: item.timestamp ?? null,
    rawScore: null,
  }));
}

export const mediawikiProvider = {
  name: "mediawiki",
  lane: "knowledge",
  costTier: "free",
  stability: "official",
  note: "Concept and background coverage from Wikipedia/MediaWiki search.",
  supports: {
    freshness: true,
    domains: false,
    language: true,
    news: false,
    content: false,
    region: false,
  },
  getAuthMode() {
    return "none";
  },
  isConfigured() {
    return true;
  },
  async search(query, options) {
    const queryTokens = tokenizeQuery(query);
    const settled = await Promise.allSettled(
      buildSearchQueries(query).flatMap((searchQuery) =>
        resolveLanguages(query).map((language) => searchLanguage(language, searchQuery, options.maxResults)),
      ),
    );
    const merged = [];
    for (const item of settled) {
      if (item.status === "fulfilled") merged.push(...item.value);
    }

    const filtered = merged.filter((item) => {
      const combinedText = `${item.title} ${item.snippet}`;
      return overlapScore(combinedText, queryTokens) > 0;
    });

    const deduped = [];
    const seen = new Set();
    for (const item of filtered) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      deduped.push(item);
    }

    const results = deduped.slice(0, options.maxResults).map((item, index) => ({
      ...item,
      position: index + 1,
    }));

    return filterResultsByDomains(results, options.includeDomains, options.excludeDomains);
  },
};
