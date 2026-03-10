import {
  JINA_API_KEY,
  JINA_SEARCH_BASE_URL,
  USER_AGENT,
  fetchText,
  filterResultsByDomains,
  normalizeUrl,
  normalizeWhitespace,
} from "../lib/shared.mjs";

function collectSnippet(lines, maxLength = 320) {
  const snippet = normalizeWhitespace(lines.filter(Boolean).join(" "));
  if (snippet.length <= maxLength) return snippet;
  return `${snippet.slice(0, maxLength - 1)}...`;
}

function dedupeResults(results, maxResults) {
  const deduped = [];
  const seen = new Set();
  for (const result of results) {
    const url = normalizeUrl(result.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    deduped.push({
      ...result,
      url,
      title: normalizeWhitespace(result.title),
      snippet: normalizeWhitespace(result.snippet),
      position: deduped.length + 1,
    });
    if (deduped.length >= maxResults) break;
  }
  return deduped;
}

function parseTitleBlocks(text) {
  const blocks = text
    .split(/\n(?=Title:\s)/)
    .map((block) => block.trim())
    .filter(Boolean);

  const results = [];
  for (const block of blocks) {
    const title = /^Title:\s*(.+)$/m.exec(block)?.[1];
    const url = /^URL Source:\s*(https?:\/\/\S+)/m.exec(block)?.[1];
    if (!title || !url) continue;

    const publishedAt = /^Published Time:\s*(.+)$/m.exec(block)?.[1] ?? null;
    const snippetSource = block
      .split(/\n+/)
      .filter((line) => !/^(Title|URL Source|Published Time|Markdown Content|Description|Summary|Content):/i.test(line));
    results.push({
      title,
      url,
      snippet: collectSnippet(snippetSource),
      publishedAt,
      rawScore: null,
    });
  }
  return results;
}

function parseMarkdownLinks(text) {
  const pattern = /(?:^|\n)(?:\d+[.)]\s+|[-*]\s+)\[(.+?)\]\((https?:\/\/[^)]+)\)\s*([\s\S]*?)(?=\n(?:\d+[.)]\s+|[-*]\s+)\[|$)/g;
  const results = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const snippetLines = match[3]
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    results.push({
      title: match[1],
      url: match[2],
      snippet: collectSnippet(snippetLines),
      publishedAt: null,
      rawScore: null,
    });
  }

  return results;
}

function parseLooseUrlBlocks(text) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const results = [];
  for (const block of blocks) {
    const url = /(https?:\/\/\S+)/.exec(block)?.[1];
    if (!url) continue;

    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const title = lines.find((line) => !line.startsWith("http")) ?? url;
    results.push({
      title,
      url,
      snippet: collectSnippet(lines.filter((line) => line !== title && !line.startsWith("http"))),
      publishedAt: null,
      rawScore: null,
    });
  }

  return results;
}

function parseJinaSearchText(text, maxResults) {
  const parsers = [
    parseTitleBlocks,
    parseMarkdownLinks,
    parseLooseUrlBlocks,
  ];

  for (const parser of parsers) {
    const results = dedupeResults(parser(text), maxResults);
    if (results.length > 0) return results;
  }

  return [];
}

export const jinaSearchProvider = {
  name: "jina-search",
  lane: "general_web",
  costTier: "free_key",
  stability: "official",
  note: "Jina Search via s.jina.ai. Requires JINA_API_KEY because keyless access is disabled.",
  supports: {
    freshness: false,
    domains: false,
    language: false,
    news: false,
    content: true,
    region: false,
  },
  getAuthMode() {
    return "api_key";
  },
  isConfigured() {
    return Boolean(JINA_API_KEY);
  },
  async search(query, options) {
    if (!JINA_API_KEY) {
      throw new Error("JINA_API_KEY is not set");
    }

    const params = new URLSearchParams({ q: query });
    const text = await fetchText(`${JINA_SEARCH_BASE_URL}/?${params.toString()}`, {
      headers: {
        "Accept": "text/plain, text/markdown;q=0.9, */*;q=0.8",
        "Authorization": `Bearer ${JINA_API_KEY}`,
        "User-Agent": USER_AGENT,
      },
      timeoutMs: 25_000,
    });

    const results = parseJinaSearchText(text, options.maxResults);
    return filterResultsByDomains(results, options.includeDomains, options.excludeDomains);
  },
};
