# Contributing

Thanks for contributing.

## Development

1. Copy `.env.example` to `.env` if you want to test provider-backed search locally.
2. Run `npm run check` before opening a PR.
3. Use `node ./benchmark/run-benchmark.mjs` for a quick regression check.

## Scope

- provider adapters should stay isolated in `src/providers/`
- orchestration logic should stay in `src/index.mjs`
- benchmark fixtures should remain small, deterministic, and easy to run

## Pull Requests

- keep changes narrow and explain the provider or orchestration tradeoff
- add or update benchmark fixtures when behavior changes materially
- avoid introducing mandatory paid dependencies for the default setup
