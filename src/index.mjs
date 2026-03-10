/**
 * OpenClaw SearchKit: provider-agnostic multi-round web search orchestration.
 *
 * Default behavior:
 * - Round 1: run the seed query on the primary provider set
 * - Round 2+: rewrite the query to fill coverage gaps
 * - Merge, dedupe, and rerank results across rounds/providers
 * - Optionally extract top-page content for the best matches
 *
 * Compatible with the old interface:
 *   openclaw-searchkit --query "AI news"
 *   openclaw-searchkit --query "AI news" --provider tavily
 *   openclaw-searchkit --query "AI news" --provider duckduckgo
 *
 * New options:
 *   --provider auto|tavily|searxng|jina-search|duckduckgo|github|stackexchange|mediawiki
 *   --provider tavily,github
 *   --list-providers
 *   --rounds 2
 *   --per-query 5
 *   --extract-top 3
 *   --extract-chars 1200
 *   --topic auto|general|news
 *   --days 7
 *   --region wt-wt
 *   --include-domains docs.example.com,github.com
 *   --exclude-domains csdn.net
 *   --debug
 */

import { pathToFileURL } from "node:url";

import {
  COMMUNITY_DOMAINS,
  JINA_API_KEY,
  JINA_READER_PREFIX,
  LOW_SIGNAL_DOMAINS,
  OFFICIAL_PATH_HINTS,
  SEARXNG_BASE_URL,
  TAVILY_API_KEY,
  USER_AGENT,
  clampInt,
  containsCjk,
  debugLog,
  extractDomain,
  fetchText,
  looksLikeSiteRestricted,
  normalizeWhitespace,
  normalizeUrl,
  overlapScore,
  splitCsv,
  tokenizeQuery,
} from "./lib/shared.mjs";
import {
  getProvider,
  getProviderNames,
  listProviders,
} from "./providers/index.mjs";

export function usage() {
  console.error(
    [
      'Usage: openclaw-searchkit --query "search term" [options]',
      "",
      "Options:",
      "  --provider <names>                  auto or a comma-list of providers",
      `                                      Supported: auto, ${getProviderNames().join(", ")}`,
      "  --count <n>                        Final result count (default: 5)",
      "  --rounds <n>                       Search rounds (default: 2, max: 4)",
      "  --per-query <n>                    Results fetched per query run (default: 5, max: 10)",
      "  --extract-top <n>                  Extract content for the top N results (default: 0)",
      "  --extract-chars <n>                Max extracted chars per result (default: 1200)",
      "  --topic auto|general|news          Search topic hint (default: auto)",
      "  --days <n>                         Days window for recent/news queries",
      "  --region <kl>                      DuckDuckGo region, e.g. wt-wt / us-en / cn-zh",
      "  --include-domains a.com,b.com      Prefer only these domains where supported",
      "  --exclude-domains a.com,b.com      Exclude these domains where supported",
      "  --list-providers                   Print provider metadata as JSON and exit",
      "  --debug                            Emit orchestrator progress to stderr",
    ].join("\n"),
  );
  process.exit(2);
}

export function getDefaultParams() {
  return {
    query: "",
    provider: "auto",
    count: 5,
    rounds: 2,
    perQuery: 5,
    extractTop: 0,
    extractChars: 1200,
    topic: "auto",
    days: null,
    region: "wt-wt",
    includeDomains: [],
    excludeDomains: [],
    debug: false,
    listProviders: false,
  };
}

export function normalizeParams(rawParams = {}) {
  const params = {
    ...getDefaultParams(),
    ...rawParams,
  };

  params.includeDomains = Array.isArray(params.includeDomains)
    ? params.includeDomains
    : splitCsv(params.includeDomains);
  params.excludeDomains = Array.isArray(params.excludeDomains)
    ? params.excludeDomains
    : splitCsv(params.excludeDomains);

  if (!params.listProviders && !params.query) {
    throw new Error("query is required");
  }

  if (!["auto", "general", "news"].includes(params.topic)) {
    throw new Error(`Unsupported topic: ${params.topic}`);
  }

  params.requestedProviders = Array.isArray(rawParams.requestedProviders)
    ? [...new Set(rawParams.requestedProviders)]
    : resolveRequestedProviders(params.provider);

  return params;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = argv;
  const params = getDefaultParams();

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") usage();
    if (arg === "--debug") {
      params.debug = true;
      continue;
    }
    if (arg === "--list-providers") {
      params.listProviders = true;
      continue;
    }
    if ((arg === "--query" || arg === "-q") && args[i + 1]) {
      params.query = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--provider" && args[i + 1]) {
      params.provider = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--count" && args[i + 1]) {
      params.count = clampInt(args[i + 1], 1, 20, 5);
      i += 1;
      continue;
    }
    if (arg === "--rounds" && args[i + 1]) {
      params.rounds = clampInt(args[i + 1], 1, 4, 2);
      i += 1;
      continue;
    }
    if (arg === "--per-query" && args[i + 1]) {
      params.perQuery = clampInt(args[i + 1], 1, 10, 5);
      i += 1;
      continue;
    }
    if (arg === "--extract-top" && args[i + 1]) {
      params.extractTop = clampInt(args[i + 1], 0, 10, 0);
      i += 1;
      continue;
    }
    if (arg === "--extract-chars" && args[i + 1]) {
      params.extractChars = clampInt(args[i + 1], 200, 10_000, 1200);
      i += 1;
      continue;
    }
    if (arg === "--topic" && args[i + 1]) {
      params.topic = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--days" && args[i + 1]) {
      params.days = clampInt(args[i + 1], 1, 365, null);
      i += 1;
      continue;
    }
    if (arg === "--region" && args[i + 1]) {
      params.region = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--include-domains" && args[i + 1]) {
      params.includeDomains = splitCsv(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--exclude-domains" && args[i + 1]) {
      params.excludeDomains = splitCsv(args[i + 1]);
      i += 1;
      continue;
    }
    console.error(`Unknown arg: ${arg}`);
    usage();
  }

  try {
    return normalizeParams(params);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    usage();
  }
}

function resolveRequestedProviders(providerArg) {
  if (providerArg === "auto") return [];
  const requested = splitCsv(providerArg);
  if (requested.length === 0) {
    throw new Error("At least one provider must be specified");
  }
  const supported = new Set(getProviderNames());
  for (const providerName of requested) {
    if (!supported.has(providerName)) {
      throw new Error(`Unsupported provider: ${providerName}`);
    }
  }
  return [...new Set(requested)];
}

function dedupeQuerySpecs(querySpecs) {
  const seen = new Set();
  return querySpecs.filter((querySpec) => {
    const key = normalizeWhitespace(querySpec.query.toLowerCase());
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectIntent(query) {
  const lower = query.toLowerCase();
  const source = `${query} ${lower}`;
  const hasAny = (terms) => terms.some((term) => source.includes(term));
  return {
    docs: hasAny([
      "api", "sdk", "docs", "documentation", "guide", "install", "setup",
      "configure", "config", "官方", "文档", "教程", "用法",
    ]),
    troubleshoot: hasAny([
      "bug", "error", "fail", "fix", "issue", "not working", "problem",
      "troubleshoot", "workaround", "报错", "错误", "失败", "问题", "无法",
    ]),
    freshness: hasAny([
      "2025", "2026", "current", "latest", "news", "recent", "today",
      "update", "最新", "新闻", "最近", "今天",
    ]),
    community: hasAny([
      "best practice", "case study", "example", "how people use", "reddit",
      "review", "workflow", "how", "improve", "method", "methods", "optimize",
      "plan", "practice", "别人怎么用", "借鉴", "案例", "经验", "最佳实践",
      "如何", "怎么", "提升", "优化", "方案", "方法", "实践", "改进",
    ]),
    knowledge: hasAny([
      "what is", "overview", "background", "history", "百科", "是什么", "介绍", "背景",
    ]),
  };
}

function resolveTopic(params, intent) {
  if (params.topic !== "auto") return params.topic;
  return intent.freshness ? "news" : "general";
}

function buildOfficialVariant(query) {
  return containsCjk(query)
    ? `${query} 官方 文档 official docs API`
    : `${query} official docs documentation API`;
}

function buildCommunityVariant(query) {
  return containsCjk(query)
    ? `${query} github reddit stackoverflow 经验 讨论`
    : `${query} github reddit stackoverflow discussion examples`;
}

function buildTroubleshootVariant(query) {
  return containsCjk(query)
    ? `${query} 报错 问题 解决 fix workaround`
    : `${query} error issue fix workaround solution`;
}

function buildFreshnessVariant(query) {
  return containsCjk(query)
    ? `${query} 最新 更新 news`
    : `${query} latest update news`;
}

function buildBroadVariant(query) {
  return containsCjk(query)
    ? `${query} 方法 指南 示例`
    : `${query} guide methods examples`;
}

function buildKnowledgeVariant(query) {
  return containsCjk(query)
    ? `${query} 是什么 背景 介绍`
    : `${query} overview background introduction`;
}

function buildSeedQueries(params, intent) {
  const seedQueries = [{ query: params.query, strategy: "seed" }];
  if (intent.docs && !looksLikeSiteRestricted(params.query)) {
    seedQueries.push({ query: buildOfficialVariant(params.query), strategy: "official-probe" });
  }
  if (intent.knowledge) {
    seedQueries.push({ query: buildKnowledgeVariant(params.query), strategy: "knowledge-probe" });
  }
  return dedupeQuerySpecs(seedQueries);
}

function summarizeCoverage(results) {
  const summary = {
    totalResults: results.length,
    officialCount: 0,
    communityCount: 0,
    docsLikeCount: 0,
    knowledgeCount: 0,
    recentCount: 0,
  };

  const now = Date.now();
  for (const result of results) {
    if (result.signals.official) summary.officialCount += 1;
    if (result.signals.community) summary.communityCount += 1;
    if (result.signals.docsLike) summary.docsLikeCount += 1;
    if (result.signals.knowledge) summary.knowledgeCount += 1;
    if (result.publishedAt) {
      const ageMs = now - new Date(result.publishedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs <= 7 * 24 * 60 * 60 * 1000) {
        summary.recentCount += 1;
      }
    }
  }

  return summary;
}

function buildFollowUpQueries(params, intent, coverage, usedQueries) {
  const followUps = [];

  if (intent.docs && coverage.officialCount < 2) {
    followUps.push({ query: buildOfficialVariant(params.query), strategy: "official-gap" });
  }
  if ((intent.community || intent.troubleshoot) && coverage.communityCount < 2) {
    followUps.push({ query: buildCommunityVariant(params.query), strategy: "community-gap" });
  }
  if (intent.troubleshoot) {
    followUps.push({ query: buildTroubleshootVariant(params.query), strategy: "troubleshoot-gap" });
  }
  if (intent.freshness) {
    followUps.push({ query: buildFreshnessVariant(params.query), strategy: "freshness-gap" });
  }
  if (intent.knowledge && coverage.knowledgeCount < 1) {
    followUps.push({ query: buildKnowledgeVariant(params.query), strategy: "knowledge-gap" });
  }
  if (coverage.totalResults < Math.max(params.count * 2, 6)) {
    followUps.push({ query: buildBroadVariant(params.query), strategy: "broad-gap" });
  }

  const used = new Set(usedQueries.map((querySpec) => normalizeWhitespace(querySpec.query.toLowerCase())));
  return dedupeQuerySpecs(followUps).filter(
    (querySpec) => !used.has(normalizeWhitespace(querySpec.query.toLowerCase())),
  );
}

function unique(items) {
  return [...new Set(items)];
}

function getEnabledProviderNames() {
  return listProviders()
    .filter((provider) => provider.enabled)
    .map((provider) => provider.name);
}

function resolveRoundProviders(params, intent, roundIndex) {
  if (params.requestedProviders.length > 0) return params.requestedProviders;

  const enabled = new Set(getEnabledProviderNames());
  const providers = [];
  const addIfEnabled = (providerName) => {
    if (enabled.has(providerName)) providers.push(providerName);
  };

  if (roundIndex === 1) {
    if (enabled.has("tavily")) {
      providers.push("tavily");
    } else if (enabled.has("searxng")) {
      providers.push("searxng");
    } else if (enabled.has("jina-search")) {
      providers.push("jina-search");
    } else {
      providers.push("duckduckgo");
    }
  } else {
    addIfEnabled("tavily");
    addIfEnabled("searxng");
    addIfEnabled("jina-search");
    addIfEnabled("duckduckgo");
  }

  if (intent.docs || intent.community || intent.troubleshoot) {
    addIfEnabled("github");
  }
  if (intent.community || intent.troubleshoot) {
    addIfEnabled("stackexchange");
  }
  if (intent.knowledge || (!intent.docs && !intent.freshness && roundIndex > 1)) {
    addIfEnabled("mediawiki");
  }

  if (providers.length === 0) providers.push("duckduckgo");
  return unique(providers);
}

function buildRunPlan(params, intent) {
  const rounds = [];
  const usedQueries = [];

  const seedQueries = buildSeedQueries(params, intent);
  rounds.push({ round: 1, queries: seedQueries });
  usedQueries.push(...seedQueries);

  for (let round = 2; round <= params.rounds; round += 1) {
    rounds.push({ round, queries: [] });
  }

  return { rounds, usedQueries };
}

async function runSearch(providerName, querySpec, params, intent, roundIndex) {
  const provider = getProvider(providerName);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerName}`);
  }
  if (!provider.isConfigured()) {
    throw new Error(`Provider is not configured: ${providerName}`);
  }

  const topic = resolveTopic(params, intent);
  const options = {
    topic,
    days: params.days,
    includeDomains: params.includeDomains,
    excludeDomains: params.excludeDomains,
    maxResults: params.perQuery,
    region: params.region,
    searchDepth: roundIndex === 1 ? "advanced" : "basic",
    intent,
    roundIndex,
  };

  const results = await provider.search(querySpec.query, options);

  return {
    provider: providerName,
    round: roundIndex,
    query: querySpec.query,
    strategy: querySpec.strategy,
    topic,
    results: results.map((result, index) => ({
      ...result,
      url: normalizeUrl(result.url),
      provider: providerName,
      position: result.position ?? index + 1,
    })).filter((result) => result.url),
  };
}

function isCommunityDomain(domain) {
  return COMMUNITY_DOMAINS.has(domain);
}

function isDocsLikeUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.startsWith("docs.")
      || parsed.hostname.startsWith("developers.")
      || parsed.hostname.startsWith("developer.")
      || parsed.hostname.startsWith("api.")
      || OFFICIAL_PATH_HINTS.some((hint) => parsed.pathname.startsWith(hint) || parsed.pathname.includes(`${hint}/`))
    );
  } catch {
    return false;
  }
}

function isOfficialDomain(domain, url, queryTokens) {
  if (!domain || isCommunityDomain(domain)) return false;
  if (domain.startsWith("docs.") || domain.startsWith("developer.") || domain.startsWith("developers.") || domain.startsWith("api.")) {
    return true;
  }
  if (isDocsLikeUrl(url)) return true;
  return queryTokens.some((token) => token.length > 2 && domain.includes(token));
}

function isKnowledgeSource(domain) {
  return domain.endsWith("wikipedia.org") || domain.endsWith("wiktionary.org");
}

function buildAggregatedResults(runs, params, intent) {
  const queryTokens = tokenizeQuery(params.query);
  const resultsByUrl = new Map();

  for (const run of runs) {
    for (const result of run.results) {
      const url = normalizeUrl(result.url);
      if (!url) continue;
      const domain = extractDomain(url);
      const providerMeta = getProvider(run.provider);
      const entry = resultsByUrl.get(url) ?? {
        url,
        domain,
        title: result.title,
        snippet: result.snippet,
        publishedAt: result.publishedAt,
        rawScores: [],
        providers: new Set(),
        lanes: new Set(),
        queries: new Set(),
        strategies: new Set(),
        bestPosition: Number.POSITIVE_INFINITY,
        hits: 0,
      };

      entry.providers.add(run.provider);
      if (providerMeta?.lane) entry.lanes.add(providerMeta.lane);
      entry.queries.add(run.query);
      entry.strategies.add(run.strategy);
      entry.bestPosition = Math.min(entry.bestPosition, result.position);
      entry.hits += 1;
      if (!entry.title || result.title.length > entry.title.length) entry.title = result.title;
      if (!entry.snippet || result.snippet.length > entry.snippet.length) entry.snippet = result.snippet;
      if (!entry.publishedAt && result.publishedAt) entry.publishedAt = result.publishedAt;
      if (typeof result.rawScore === "number") entry.rawScores.push(result.rawScore);
      resultsByUrl.set(url, entry);
    }
  }

  const ranked = [...resultsByUrl.values()].map((entry) => {
    const combinedText = `${entry.title} ${entry.snippet}`.toLowerCase();
    const docsLike = isDocsLikeUrl(entry.url);
    const community = isCommunityDomain(entry.domain);
    const knowledge = isKnowledgeSource(entry.domain) || entry.lanes.has("knowledge");
    const official = isOfficialDomain(entry.domain, entry.url, queryTokens);
    const tokenMatches = overlapScore(combinedText, queryTokens);
    const providerCount = entry.providers.size;
    const queryCount = entry.queries.size;
    const rawScoreAverage = entry.rawScores.length > 0
      ? entry.rawScores.reduce((sum, score) => sum + score, 0) / entry.rawScores.length
      : 0;

    let score = 0;
    score += providerCount * 8;
    score += Math.max(0, 18 - ((entry.bestPosition - 1) * 3));
    score += tokenMatches * 5;
    score += Math.min(queryCount, 3) * 6;
    score += Math.min(entry.hits, 4) * 4;
    score += rawScoreAverage * 20;

    if (official) score += intent.docs ? 22 : 18;
    if (docsLike) score += intent.docs ? 14 : 10;
    if (community) score += (intent.community || intent.troubleshoot) ? 18 : 12;
    if (knowledge) score += intent.knowledge ? 18 : 8;
    if (intent.freshness && entry.publishedAt) {
      const ageMs = Date.now() - new Date(entry.publishedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs <= 14 * 24 * 60 * 60 * 1000) {
        score += 10;
      }
    }
    if (tokenMatches === 0) score -= 24;
    if (tokenMatches === 1) score -= 8;
    if (LOW_SIGNAL_DOMAINS.has(entry.domain)) score -= 8;

    return {
      title: entry.title,
      url: entry.url,
      snippet: entry.snippet,
      publishedAt: entry.publishedAt,
      score: Number(Math.max(0, Math.min(0.999, score / 100)).toFixed(3)),
      orchestrationScore: Math.round(score),
      domain: entry.domain,
      providers: [...entry.providers],
      queries: [...entry.queries],
      strategies: [...entry.strategies],
      rawScore: entry.rawScores.length > 0 ? Number(rawScoreAverage.toFixed(3)) : null,
      signals: {
        official,
        docsLike,
        community,
        knowledge,
      },
    };
  });

  ranked.sort((left, right) => right.orchestrationScore - left.orchestrationScore);
  return ranked.slice(0, params.count);
}

async function extractWithJina(url) {
  const text = await fetchText(`${JINA_READER_PREFIX}${url}`, {
    headers: {
      "Accept": "text/plain, text/markdown;q=0.9, */*;q=0.8",
      "User-Agent": USER_AGENT,
    },
    timeoutMs: 25_000,
  });
  return normalizeWhitespace(text);
}

async function enrichWithContent(results, params, debug) {
  if (params.extractTop <= 0 || results.length === 0) return results;

  const extractTargets = results.slice(0, params.extractTop).map((result) => result.url);
  const tavilyProvider = getProvider("tavily");
  const tavilyExtraction = tavilyProvider?.extract
    ? await tavilyProvider.extract(extractTargets).catch((error) => {
      debugLog(debug, "Tavily extract failed", { error: error.message });
      return { success: new Map(), failed: [] };
    })
    : { success: new Map(), failed: [] };

  const contentByUrl = new Map(tavilyExtraction.success);
  for (const url of extractTargets) {
    if (contentByUrl.has(url)) continue;
    try {
      const content = await extractWithJina(url);
      if (content) contentByUrl.set(url, content);
    } catch (error) {
      debugLog(debug, "Jina extract failed", { url, error: error.message });
    }
  }

  return results.map((result, index) => {
    const content = contentByUrl.get(result.url);
    return {
      ...result,
      rank: index + 1,
      content: content ? content.slice(0, params.extractChars) : undefined,
      extractionProvider: content
        ? (tavilyExtraction.success.has(result.url) ? "tavily-extract" : "jina-reader")
        : undefined,
    };
  });
}

export async function orchestrateSearch(params) {
  const intent = detectIntent(params.query);
  const plan = buildRunPlan(params, intent);
  const completedRuns = [];

  for (const roundEntry of plan.rounds) {
    let querySpecs = roundEntry.queries;

    if (roundEntry.round > 1) {
      const currentResults = buildAggregatedResults(completedRuns, {
        ...params,
        count: Math.max(params.count * 2, 8),
      }, intent);
      const coverage = summarizeCoverage(currentResults);
      querySpecs = buildFollowUpQueries(params, intent, coverage, plan.usedQueries);
      roundEntry.queries = querySpecs;
      plan.usedQueries.push(...querySpecs);
      if (querySpecs.length === 0) break;
    }

    const providers = resolveRoundProviders(params, intent, roundEntry.round);
    const tasks = [];
    for (const querySpec of querySpecs) {
      for (const provider of providers) {
        tasks.push(runSearch(provider, querySpec, params, intent, roundEntry.round));
      }
    }

    debugLog(params.debug, `round ${roundEntry.round} executing`, {
      providers,
      queries: querySpecs.map((querySpec) => ({ query: querySpec.query, strategy: querySpec.strategy })),
    });

    const settled = await Promise.allSettled(tasks);
    for (const item of settled) {
      if (item.status === "fulfilled") {
        completedRuns.push(item.value);
        continue;
      }
      debugLog(params.debug, `round ${roundEntry.round} task failed`, { error: item.reason?.message ?? String(item.reason) });
    }
  }

  let results = buildAggregatedResults(completedRuns, params, intent);
  results = await enrichWithContent(results, params, params.debug);
  results = results.map((result, index) => ({
    ...result,
    rank: result.rank ?? index + 1,
  }));

  const coverage = summarizeCoverage(results);
  const usedProviders = [...new Set(completedRuns.map((run) => run.provider))];
  return {
    provider: usedProviders.join("+"),
    query: params.query,
    topic: resolveTopic(params, intent),
    roundsExecuted: new Set(completedRuns.map((run) => run.round)).size,
    queries: completedRuns.map((run) => ({
      round: run.round,
      provider: run.provider,
      query: run.query,
      strategy: run.strategy,
      resultCount: run.results.length,
    })),
    diagnostics: {
      intent,
      coverage,
      extractTop: params.extractTop,
      tavilyEnabled: Boolean(TAVILY_API_KEY),
      searxngEnabled: Boolean(SEARXNG_BASE_URL),
      jinaSearchEnabled: Boolean(JINA_API_KEY),
      requestedProviders: params.requestedProviders.length > 0 ? params.requestedProviders : ["auto"],
      availableProviders: listProviders(),
    },
    results,
  };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const params = parseArgs(argv);
    if (params.listProviders) {
      console.log(JSON.stringify({ providers: listProviders() }, null, 2));
      return;
    }
    const response = await orchestrateSearch(params);
    console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.error(`Search failed: ${error.message}`);
    process.exit(1);
  }
}

export {
  listProviders,
  resolveRequestedProviders,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
