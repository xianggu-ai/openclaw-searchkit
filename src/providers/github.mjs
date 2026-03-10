import {
  GITHUB_TOKEN,
  USER_AGENT,
  fetchJson,
  filterResultsByDomains,
  normalizeWhitespace,
} from "../lib/shared.mjs";

function githubHeaders() {
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

function trimSnippet(text, maxLength = 260) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

async function searchRepositories(query, perPage) {
  const params = new URLSearchParams({
    q: `${query} in:name,description,readme`,
    per_page: String(perPage),
    sort: "stars",
    order: "desc",
  });
  const data = await fetchJson(`https://api.github.com/search/repositories?${params.toString()}`, {
    headers: githubHeaders(),
  });

  return (data.items ?? []).map((item, index) => ({
    title: item.full_name,
    url: item.html_url,
    snippet: trimSnippet([
      item.description ?? "",
      item.language ? `Language: ${item.language}.` : "",
      Number.isFinite(item.stargazers_count) ? `Stars: ${item.stargazers_count}.` : "",
      Array.isArray(item.topics) && item.topics.length > 0 ? `Topics: ${item.topics.join(", ")}.` : "",
    ].filter(Boolean).join(" ")),
    publishedAt: item.updated_at ?? item.pushed_at ?? item.created_at ?? null,
    rawScore: typeof item.score === "number" ? item.score : null,
    position: index + 1,
  }));
}

async function searchIssues(query, perPage) {
  const params = new URLSearchParams({
    q: `${query} in:title,body type:issue`,
    per_page: String(perPage),
    sort: "updated",
    order: "desc",
  });
  const data = await fetchJson(`https://api.github.com/search/issues?${params.toString()}`, {
    headers: githubHeaders(),
  });

  return (data.items ?? []).map((item, index) => ({
    title: item.title,
    url: item.html_url,
    snippet: trimSnippet([
      `Repo: ${item.repository_url.split("/repos/")[1] ?? "unknown"}.`,
      `State: ${item.state}.`,
      item.body ? trimSnippet(item.body, 180) : "",
    ].filter(Boolean).join(" ")),
    publishedAt: item.updated_at ?? item.created_at ?? null,
    rawScore: typeof item.score === "number" ? item.score : null,
    position: index + 1,
  }));
}

export const githubProvider = {
  name: "github",
  lane: "community",
  costTier: "free",
  stability: "official",
  note: "Good for repos, issues, examples, and troubleshooting context.",
  supports: {
    freshness: true,
    domains: false,
    language: false,
    news: false,
    content: false,
    region: false,
  },
  getAuthMode() {
    return GITHUB_TOKEN ? "api_key" : "none";
  },
  isConfigured() {
    return true;
  },
  async search(query, options) {
    const perPage = Math.max(1, Math.min(10, Math.ceil(options.maxResults / 2)));
    const shouldSearchRepos = options.intent.docs || options.intent.community || !options.intent.troubleshoot;
    const shouldSearchIssues = options.intent.troubleshoot || options.intent.community;

    const tasks = [];
    if (shouldSearchRepos) tasks.push(searchRepositories(query, perPage));
    if (shouldSearchIssues) tasks.push(searchIssues(query, perPage));
    if (tasks.length === 0) tasks.push(searchRepositories(query, perPage));

    const settled = await Promise.allSettled(tasks);
    const merged = [];
    for (const item of settled) {
      if (item.status === "fulfilled") merged.push(...item.value);
    }

    return filterResultsByDomains(
      merged.slice(0, options.maxResults),
      options.includeDomains,
      options.excludeDomains,
    );
  },
};
