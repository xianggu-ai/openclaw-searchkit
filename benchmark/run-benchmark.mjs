#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { loadDotEnv } from "../src/lib/load-env.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "..");

loadDotEnv({
  searchPaths: [process.cwd(), projectRoot],
});

const { normalizeParams, orchestrateSearch, listProviders } = await import("../src/index.mjs");

function usage() {
  console.error(
    [
      "Usage: node benchmark/run-benchmark.mjs [options]",
      "",
      "Options:",
      "  --queries <path>     Query fixture JSON (default: benchmark/queries.sample.json)",
      "  --out <path>         Output JSON path (default: benchmark/output/<timestamp>.json)",
      "  --delay-ms <n>       Delay between queries (default: 250)",
      "  --provider <names>   Override provider for all benchmark cases",
      "  --debug              Pass debug=true into orchestrateSearch",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv = process.argv.slice(2)) {
  const params = {
    queriesPath: resolve(projectRoot, "benchmark/queries.sample.json"),
    outPath: "",
    delayMs: 250,
    provider: "",
    debug: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") usage();
    if (arg === "--debug") {
      params.debug = true;
      continue;
    }
    if (arg === "--queries" && argv[i + 1]) {
      params.queriesPath = resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--out" && argv[i + 1]) {
      params.outPath = resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--delay-ms" && argv[i + 1]) {
      params.delayMs = Number.parseInt(argv[i + 1], 10) || 250;
      i += 1;
      continue;
    }
    if (arg === "--provider" && argv[i + 1]) {
      params.provider = argv[i + 1];
      i += 1;
      continue;
    }

    console.error(`Unknown arg: ${arg}`);
    usage();
  }

  return params;
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function evaluateCase(expectation = {}, response) {
  const checks = [];

  if (typeof expectation.minResults === "number") {
    checks.push({
      name: `minResults>=${expectation.minResults}`,
      passed: response.results.length >= expectation.minResults,
    });
  }

  if (Array.isArray(expectation.anyDomainMatches) && expectation.anyDomainMatches.length > 0) {
    const matched = response.results.some((result) =>
      expectation.anyDomainMatches.some((pattern) => result.domain?.includes(pattern)),
    );
    checks.push({
      name: `anyDomainMatches:${expectation.anyDomainMatches.join(",")}`,
      passed: matched,
    });
  }

  if (Array.isArray(expectation.anyTitleIncludes) && expectation.anyTitleIncludes.length > 0) {
    const matched = response.results.some((result) =>
      expectation.anyTitleIncludes.some((pattern) =>
        result.title.toLowerCase().includes(pattern.toLowerCase()),
      ),
    );
    checks.push({
      name: `anyTitleIncludes:${expectation.anyTitleIncludes.join(",")}`,
      passed: matched,
    });
  }

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function buildCaseParams(benchmarkCase, overrides) {
  return normalizeParams({
    query: benchmarkCase.query,
    provider: overrides.provider || benchmarkCase.provider || "auto",
    count: benchmarkCase.count ?? 5,
    rounds: benchmarkCase.rounds ?? 2,
    perQuery: benchmarkCase.perQuery ?? 5,
    extractTop: benchmarkCase.extractTop ?? 0,
    extractChars: benchmarkCase.extractChars ?? 1200,
    topic: benchmarkCase.topic ?? "auto",
    days: benchmarkCase.days ?? null,
    region: benchmarkCase.region ?? "wt-wt",
    includeDomains: benchmarkCase.includeDomains ?? [],
    excludeDomains: benchmarkCase.excludeDomains ?? [],
    debug: overrides.debug,
    listProviders: false,
  });
}

async function runCase(benchmarkCase, overrides) {
  const params = buildCaseParams(benchmarkCase, overrides);
  const startedAt = new Date().toISOString();
  const started = performance.now();

  try {
    const response = await orchestrateSearch(params);
    const elapsedMs = Math.round(performance.now() - started);
    const evaluation = evaluateCase(benchmarkCase.expect, response);

    return {
      id: benchmarkCase.id,
      name: benchmarkCase.name ?? benchmarkCase.id,
      query: benchmarkCase.query,
      provider: response.provider,
      startedAt,
      elapsedMs,
      passed: evaluation.passed,
      checks: evaluation.checks,
      diagnostics: response.diagnostics,
      queries: response.queries,
      topResults: response.results.map((result) => ({
        rank: result.rank,
        title: result.title,
        url: result.url,
        domain: result.domain,
        providers: result.providers,
      })),
    };
  } catch (error) {
    return {
      id: benchmarkCase.id,
      name: benchmarkCase.name ?? benchmarkCase.id,
      query: benchmarkCase.query,
      provider: params.provider,
      startedAt,
      elapsedMs: Math.round(performance.now() - started),
      passed: false,
      error: error.message,
      checks: [],
      topResults: [],
    };
  }
}

async function main() {
  const args = parseArgs();
  const fixture = JSON.parse(await readFile(args.queriesPath, "utf8"));
  if (!Array.isArray(fixture)) {
    throw new Error("Benchmark fixture must be a JSON array");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = args.outPath || resolve(projectRoot, `benchmark/output/${timestamp}.json`);
  await mkdir(dirname(outPath), { recursive: true });

  const results = [];
  for (let index = 0; index < fixture.length; index += 1) {
    const benchmarkCase = fixture[index];
    console.error(`[benchmark] ${index + 1}/${fixture.length} ${benchmarkCase.id} :: ${benchmarkCase.query}`);
    results.push(await runCase(benchmarkCase, args));
    if (index < fixture.length - 1 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
  }

  const summary = {
    ranAt: new Date().toISOString(),
    fixturePath: args.queriesPath,
    outputPath: outPath,
    providerOverride: args.provider || null,
    providers: listProviders(),
    cases: results,
    totals: {
      total: results.length,
      passed: results.filter((item) => item.passed).length,
      failed: results.filter((item) => !item.passed).length,
      avgElapsedMs: results.length > 0
        ? Math.round(results.reduce((sum, item) => sum + item.elapsedMs, 0) / results.length)
        : 0,
    },
  };

  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.error(
    `[benchmark] done: ${summary.totals.passed}/${summary.totals.total} passed, avg ${summary.totals.avgElapsedMs}ms`,
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`[benchmark] failed: ${error.message}`);
  process.exit(1);
});
