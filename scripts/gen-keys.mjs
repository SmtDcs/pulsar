#!/usr/bin/env node
/**
 * Generate ONE fresh Stellar operator keypair into .env (v2).
 * Only runs when .env does not exist — never overwrites, never commits.
 *
 * Stellar TESTNET only. In v2 the sequencer holds ONLY the operator key;
 * player keys are generated per-browser (localStorage) and never stored here.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

if (existsSync(envPath)) {
  console.log(".env already exists — keeping existing keys.");
  process.exit(0);
}

const template = readFileSync(path.join(root, ".env.example"), "utf8");

const keys = {
  OPERATOR: Keypair.random(),
};

let out = template;
for (const [name, kp] of Object.entries(keys)) {
  const pub = kp.publicKey();
  const sec = kp.secret();
  out = out.replace(new RegExp(`${name}_PUBLIC="G\\.\\.\\."`), `${name}_PUBLIC="${pub}"`);
  out = out.replace(new RegExp(`${name}_SECRET="S\\.\\.\\."`), `${name}_SECRET="${sec}"`);
}

writeFileSync(envPath, out, { mode: 0o600 });
console.log("Generated the Testnet operator keypair in .env (kept secret, git-ignored):");
for (const [name, kp] of Object.entries(keys)) {
  console.log(`  ${name.padEnd(9)} ${kp.publicKey()}`);
}
console.log("Fund it next: ./scripts/fund.sh");
