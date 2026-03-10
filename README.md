# Agent Web Search Orchestrator

Provider-agnostic multi-round web search orchestration for agentic workflows.

It combines three layers:

- provider adapters for Tavily, SearXNG, Jina Search, DuckDuckGo, GitHub, Stack Exchange, and MediaWiki
- orchestration for query rewriting, multi-round follow-up search, provider routing, dedupe, rerank, and extraction fallback
- a CLI plus a small programmatic API for embedding into other agents or research pipelines

## Why this exists

Most search integrations stop at "call one API once". In practice, agentic web research needs more:

- rewrite the original query before searching
- route troubleshooting queries to community sources
- route concept queries to knowledge sources
- combine multiple runs and multiple providers
- rerank by source quality and query overlap
- optionally extract page content for the best results

This package separates the orchestration layer from the provider layer so you can improve either independently.

## Features

- multi-round search with coverage-aware follow-up queries
- explicit providers via `--provider tavily,github`
- automatic routing via `--provider auto`
- structured JSON output with diagnostics
- optional top-result content extraction via Tavily Extract and Jina Reader
- benchmark runner with sample fixtures
- zero runtime dependencies

## Supported Providers

| Provider | Type | Auth | Notes |
| --- | --- | --- | --- |
| `tavily` | general web | API key | strongest default if configured |
| `searxng` | general web | none | bring your own public or self-hosted instance |
| `jina-search` | general web | API key | text-first search, good for LLM pipelines |
| `duckduckgo` | general web | none | HTML fallback, unofficial |
| `github` | community/code | optional token | repos, issues, examples |
| `stackexchange` | community/help | optional key | troubleshooting and usage patterns |
| `mediawiki` | knowledge | none | concept/background coverage |

## Quick Start

```bash
cd agent-web-search-orchestrator
cp .env.example .env
node ./bin/agent-web-search.mjs --list-providers
node ./bin/agent-web-search.mjs --query "OpenClaw web search Perplexity Sonar docs" --count 5
```

The CLI auto-loads `.env` from the current working directory or the package root.

## Environment

See [.env.example](.env.example).

Typical setups:

- cheapest useful setup: `JINA_API_KEY` or `SEARXNG_BASE_URL`
- stronger general web: `TAVILY_API_KEY`
- better code/community results: `GITHUB_TOKEN`
- higher Stack Exchange quota: `STACKEXCHANGE_KEY`

## CLI Usage

```bash
node ./bin/agent-web-search.mjs --query "node fetch error not working" --rounds 2
node ./bin/agent-web-search.mjs --query "OpenClaw overview" --provider mediawiki
node ./bin/agent-web-search.mjs --query "OpenClaw docs" --provider tavily,github
```

Common options:

- `--provider auto|tavily|searxng|jina-search|duckduckgo|github|stackexchange|mediawiki`
- `--count <n>`
- `--rounds <n>`
- `--per-query <n>`
- `--extract-top <n>`
- `--topic auto|general|news`
- `--include-domains a.com,b.com`
- `--exclude-domains a.com,b.com`
- `--list-providers`
- `--debug`

## Library Usage

```js
import { normalizeParams, orchestrateSearch } from "agent-web-search-orchestrator";

const params = normalizeParams({
  query: "OpenClaw overview",
  provider: "auto",
  rounds: 2,
  count: 5,
});

const result = await orchestrateSearch(params);
console.log(result.results[0]);
```

## Benchmark

Sample fixture: [benchmark/queries.sample.json](benchmark/queries.sample.json)

Run:

```bash
node ./benchmark/run-benchmark.mjs
node ./benchmark/run-benchmark.mjs --provider github
node ./benchmark/run-benchmark.mjs --queries ./benchmark/queries.sample.json --out ./benchmark/output/latest.json
```

The benchmark writes a full JSON report with:

- elapsed time per query
- providers actually used
- top results
- simple expectation checks such as domain or title matches

## Package Layout

- [src/index.mjs](src/index.mjs): CLI-compatible library entry
- [src/lib/shared.mjs](src/lib/shared.mjs): shared env/config/network helpers
- [src/providers/index.mjs](src/providers/index.mjs): provider registry
- [benchmark/run-benchmark.mjs](benchmark/run-benchmark.mjs): fixture runner

## Development

- contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- release notes: [CHANGELOG.md](CHANGELOG.md)
- CI: [.github/workflows/ci.yml](.github/workflows/ci.yml)

## Notes

- `duckduckgo` is kept as a fallback, not as a primary high-quality source.
- public SearXNG instances often rate limit or disable JSON output; self-hosting is more reliable.
- Jina Search currently requires `JINA_API_KEY`.
- this repo is extracted from a local OpenClaw-oriented workflow, but the package itself is not tied to OpenClaw internals.
