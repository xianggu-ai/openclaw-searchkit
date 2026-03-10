# OpenClaw SearchKit

[English](README.md)

面向 OpenClaw 及其他 Agent 工作流的搜索编排工具包。

它由三层组成：

- provider 适配层：支持 Tavily、SearXNG、Jina Search、DuckDuckGo、GitHub、Stack Exchange、MediaWiki
- 编排层：负责 query rewrite、多轮补搜、provider 路由、去重、重排、正文抽取回退
- 接入层：提供 CLI 和可编程 API，方便嵌入到其他 agent 或研究流水线

## 为什么需要它

很多搜索集成只做一件事：调用一次 API，然后直接返回结果。对 agent 来说这通常不够。

真实可用的联网搜索往往还需要：

- 搜之前先改写原始 query
- 排障类问题优先走社区和问答源
- 概念类问题补知识型来源
- 把多轮、多 provider 的结果合并起来
- 按来源质量和 query 相关性重新排序
- 必要时继续抽取正文，而不是只停留在标题和摘要

这个项目把 `provider layer` 和 `orchestration layer` 拆开，让两层都可以独立演进。

## 特性

- 基于覆盖情况的多轮搜索
- 支持显式指定 provider，例如 `--provider tavily,github`
- 支持 `--provider auto` 自动路由
- 输出结构化 JSON，包含诊断信息
- 支持 Tavily Extract 和 Jina Reader 的正文抽取回退
- 自带 benchmark 脚本和样例查询
- 无运行时依赖

## 支持的 Provider

| Provider | 类型 | 认证 | 说明 |
| --- | --- | --- | --- |
| `tavily` | 通用网页搜索 | API key | 默认能力最强的通用源之一 |
| `searxng` | 通用网页搜索 | 无 | 自带实例或自托管实例 |
| `jina-search` | 通用网页搜索 | API key | 更适合 LLM / 文本型检索流水线 |
| `duckduckgo` | 通用网页搜索 | 无 | HTML fallback，非官方稳定 API |
| `github` | 社区 / 代码 | 可选 token | repo、issue、示例、讨论 |
| `stackexchange` | 社区 / 问答 | 可选 key | 排障和使用经验 |
| `mediawiki` | 知识型来源 | 无 | 概念和背景补充 |

## 快速开始

```bash
cd openclaw-searchkit
cp .env.example .env
node ./bin/openclaw-searchkit.mjs --list-providers
node ./bin/openclaw-searchkit.mjs --query "OpenClaw web search Perplexity Sonar docs" --count 5
```

CLI 会自动加载当前工作目录或 package 根目录下的 `.env`。

## 环境变量

参考 [.env.example](.env.example)。

常见组合：

- 最低成本可用：`JINA_API_KEY` 或 `SEARXNG_BASE_URL`
- 更强的通用网页搜索：`TAVILY_API_KEY`
- 更好的代码 / 社区结果：`GITHUB_TOKEN`
- 更高的 Stack Exchange 配额：`STACKEXCHANGE_KEY`

## CLI 用法

```bash
node ./bin/openclaw-searchkit.mjs --query "node fetch error not working" --rounds 2
node ./bin/openclaw-searchkit.mjs --query "OpenClaw overview" --provider mediawiki
node ./bin/openclaw-searchkit.mjs --query "OpenClaw docs" --provider tavily,github
```

常用参数：

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

## 作为库使用

```js
import { normalizeParams, orchestrateSearch } from "openclaw-searchkit";

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

样例 fixture： [benchmark/queries.sample.json](benchmark/queries.sample.json)

运行方式：

```bash
node ./benchmark/run-benchmark.mjs
node ./benchmark/run-benchmark.mjs --provider github
node ./benchmark/run-benchmark.mjs --queries ./benchmark/queries.sample.json --out ./benchmark/output/latest.json
```

benchmark 会输出完整 JSON 报告，包括：

- 每条 query 的耗时
- 实际使用到的 provider
- top results
- 简单的预期检查，例如域名命中或标题命中

## 目录结构

- [src/index.mjs](src/index.mjs)：兼容 CLI 的库入口
- [src/lib/shared.mjs](src/lib/shared.mjs)：共享 env / config / network 工具
- [src/providers/index.mjs](src/providers/index.mjs)：provider registry
- [benchmark/run-benchmark.mjs](benchmark/run-benchmark.mjs)：fixture runner

## 开发

- 贡献指南： [CONTRIBUTING.md](CONTRIBUTING.md)
- 变更记录： [CHANGELOG.md](CHANGELOG.md)
- CI： [.github/workflows/ci.yml](.github/workflows/ci.yml)

## 说明

- `duckduckgo` 仅作为 fallback，不建议作为唯一主搜索源。
- 公共 SearXNG 实例经常会限流，或者直接禁用 JSON 输出，自托管更稳。
- `jina-search` 当前需要 `JINA_API_KEY`。
- 这个仓库虽然是从本地 OpenClaw 工作流里抽出来的，但项目本身并不依赖 OpenClaw 内部实现。
