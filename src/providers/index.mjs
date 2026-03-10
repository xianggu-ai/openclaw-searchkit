import { duckduckgoProvider } from "./duckduckgo.mjs";
import { githubProvider } from "./github.mjs";
import { jinaSearchProvider } from "./jina-search.mjs";
import { mediawikiProvider } from "./mediawiki.mjs";
import { searxngProvider } from "./searxng.mjs";
import { stackexchangeProvider } from "./stackexchange.mjs";
import { tavilyProvider } from "./tavily.mjs";

const PROVIDERS = [
  tavilyProvider,
  searxngProvider,
  jinaSearchProvider,
  duckduckgoProvider,
  githubProvider,
  stackexchangeProvider,
  mediawikiProvider,
];

const REGISTRY = new Map(PROVIDERS.map((provider) => [provider.name, provider]));

export function getProvider(providerName) {
  return REGISTRY.get(providerName) ?? null;
}

export function getProviderNames() {
  return PROVIDERS.map((provider) => provider.name);
}

export function listProviders() {
  return PROVIDERS.map((provider) => ({
    name: provider.name,
    lane: provider.lane,
    auth: provider.getAuthMode(),
    costTier: provider.costTier,
    stability: provider.stability,
    enabled: provider.isConfigured(),
    supports: provider.supports,
    note: provider.note,
  }));
}
