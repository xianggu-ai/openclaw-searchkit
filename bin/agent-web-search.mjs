#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv } from "../src/lib/load-env.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "..");

loadDotEnv({
  searchPaths: [process.cwd(), projectRoot],
});

const { main } = await import("../src/index.mjs");
await main();
