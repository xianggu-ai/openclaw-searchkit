import {
  STACKEXCHANGE_KEY,
  STACKEXCHANGE_SITE,
  fetchJson,
  filterResultsByDomains,
  normalizeWhitespace,
} from "../lib/shared.mjs";

function buildSnippet(item) {
  const bits = [];
  if (Array.isArray(item.tags) && item.tags.length > 0) {
    bits.push(`Tags: ${item.tags.join(", ")}.`);
  }
  if (typeof item.score === "number") bits.push(`Score: ${item.score}.`);
  if (typeof item.answer_count === "number") bits.push(`Answers: ${item.answer_count}.`);
  if (item.is_answered) bits.push("Accepted/answered.");
  const owner = item.owner?.display_name ? `Owner: ${item.owner.display_name}.` : "";
  if (owner) bits.push(owner);
  return normalizeWhitespace(bits.join(" "));
}

export const stackexchangeProvider = {
  name: "stackexchange",
  lane: "community",
  costTier: "free",
  stability: "official",
  note: "Best for troubleshooting and usage patterns from Stack Overflow and related sites.",
  supports: {
    freshness: true,
    domains: false,
    language: false,
    news: false,
    content: false,
    region: false,
  },
  getAuthMode() {
    return STACKEXCHANGE_KEY ? "api_key" : "none";
  },
  isConfigured() {
    return true;
  },
  async search(query, options) {
    const params = new URLSearchParams({
      order: "desc",
      sort: "relevance",
      site: STACKEXCHANGE_SITE,
      q: query,
      pagesize: String(Math.min(10, options.maxResults)),
    });
    if (STACKEXCHANGE_KEY) params.set("key", STACKEXCHANGE_KEY);

    const data = await fetchJson(`https://api.stackexchange.com/2.3/search/advanced?${params.toString()}`);
    const results = (data.items ?? []).map((item, index) => ({
      title: normalizeWhitespace(item.title),
      url: item.link,
      snippet: buildSnippet(item),
      publishedAt: item.last_activity_date
        ? new Date(item.last_activity_date * 1000).toISOString()
        : null,
      rawScore: typeof item.score === "number" ? item.score : null,
      position: index + 1,
    }));

    return filterResultsByDomains(results, options.includeDomains, options.excludeDomains);
  },
};
