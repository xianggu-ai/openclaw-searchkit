export const TAVILY_API_KEY = (process.env.TAVILY_API_KEY ?? "").trim();
export const JINA_API_KEY = (process.env.JINA_API_KEY ?? "").trim();
export const JINA_SEARCH_BASE_URL = (
  process.env.JINA_SEARCH_BASE_URL
  ?? "https://s.jina.ai"
).trim().replace(/\/+$/, "");
export const GITHUB_TOKEN = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "").trim();
export const STACKEXCHANGE_KEY = (process.env.STACKEXCHANGE_KEY ?? "").trim();
export const STACKEXCHANGE_SITE = (process.env.STACKEXCHANGE_SITE ?? "stackoverflow").trim();
export const SEARXNG_BASE_URL = (
  process.env.SEARXNG_BASE_URL
  ?? process.env.SEARXNG_URL
  ?? ""
).trim().replace(/\/+$/, "");
export const SEARXNG_LANGUAGE = (process.env.SEARXNG_LANGUAGE ?? "").trim();
export const SEARXNG_ENGINES = (process.env.SEARXNG_ENGINES ?? "").trim();
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
export const JINA_READER_PREFIX = "https://r.jina.ai/";
export const USER_AGENT = "openclaw-searchkit/0.1.0";

export const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to",
  "was", "what", "when", "where", "which", "who", "why", "with", "vs",
]);

export const COMMUNITY_DOMAINS = new Set([
  "github.com",
  "news.ycombinator.com",
  "reddit.com",
  "stackoverflow.com",
  "stackexchange.com",
  "community.openai.com",
  "discuss.python.org",
  "discourse.org",
]);

export const LOW_SIGNAL_DOMAINS = new Set([
  "skillsdirectory.com",
  "pdfcoffee.com",
  "scribd.com",
  "coursehero.com",
  "chegg.com",
]);

export const OFFICIAL_PATH_HINTS = [
  "/api",
  "/api-reference",
  "/docs",
  "/documentation",
  "/guide",
  "/guides",
  "/reference",
];

export function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function splitCsv(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function debugLog(enabled, message, data) {
  if (!enabled) return;
  if (typeof data === "undefined") {
    console.error(`[web-search] ${message}`);
    return;
  }
  console.error(`[web-search] ${message}`, JSON.stringify(data));
}

export async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: "follow",
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  return JSON.parse(text);
}

export function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function containsCjk(text) {
  return /[\u3400-\u9fff]/u.test(text);
}

export function decodeHtmlEntities(text) {
  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };
  return String(text ?? "").replace(/&[^;]+;/g, (match) => entities[match] || match);
}

export function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  let url = String(rawUrl).trim();
  if (!url) return "";
  if (url.startsWith("//")) url = `https:${url}`;

  if (url.includes("duckduckgo.com/l/")) {
    try {
      const wrapped = new URL(url.startsWith("http") ? url : `https:${url}`);
      const uddg = wrapped.searchParams.get("uddg");
      if (uddg) url = decodeURIComponent(uddg);
    } catch {
      return "";
    }
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.hash = "";
    const removableParams = [...parsed.searchParams.keys()].filter((key) =>
      /^(utm_|ref$|ref_src$|fbclid$|gclid$|mc_cid$|mc_eid$|source$)/i.test(key),
    );
    for (const key of removableParams) parsed.searchParams.delete(key);
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

export function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function filterResultsByDomains(results, includeDomains = [], excludeDomains = []) {
  const includeSet = new Set(includeDomains.map((domain) => domain.toLowerCase()));
  const excludeSet = new Set(excludeDomains.map((domain) => domain.toLowerCase()));

  return results.filter((result) => {
    const domain = extractDomain(result.url);
    if (!domain) return false;
    if (excludeSet.has(domain)) return false;
    if (includeSet.size === 0) return true;
    return includeSet.has(domain);
  });
}

export function looksLikeSiteRestricted(query) {
  return /\bsite:|https?:\/\//i.test(query);
}

export function tokenizeQuery(query) {
  const normalized = normalizeWhitespace(query.toLowerCase());
  const latinTokens = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  const tokens = new Set(latinTokens);
  if (containsCjk(query)) {
    tokens.add(normalizeWhitespace(query));
  }
  return [...tokens];
}

export function overlapScore(text, tokens) {
  const haystack = normalizeWhitespace(text).toLowerCase();
  if (!haystack) return 0;
  let matches = 0;
  for (const token of tokens.slice(0, 12)) {
    if (haystack.includes(token.toLowerCase())) matches += 1;
  }
  return matches;
}
