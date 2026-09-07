#!/usr/bin/env node
/**
 * Patch the package.json of freshly generated stellar-cli TS bindings so
 * they work as pnpm workspace packages that export TS source directly
 * (no build step). Run by scripts/deploy.sh after regeneration.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  { dir: "packages/bindings/session-registry", name: "@pulsar/session-registry-bindings" },
  { dir: "packages/bindings/slow-tictactoe", name: "@pulsar/slow-tictactoe-bindings" },
];

for (const { dir, name } of targets) {
  const file = path.join(root, dir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const patched = {
    name,
    version: "0.0.0",
    private: true,
    type: "module",
    main: "./src/index.ts",
    types: "./src/index.ts",
    exports: { ".": "./src/index.ts" },
    dependencies: {
      "@stellar/stellar-sdk": pkg.dependencies?.["@stellar/stellar-sdk"] ?? "^16.0.1",
      buffer: pkg.dependencies?.buffer ?? "6.0.3",
    },
  };
  writeFileSync(file, JSON.stringify(patched, null, 2) + "\n");
  console.log(`patched ${file}`);
}
