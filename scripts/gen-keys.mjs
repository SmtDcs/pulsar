#!/usr/bin/env node
/**
 * Generate 3 fresh Stellar keypairs (player A, player B, operator) into .env.
 * Only runs when .env does not exist — never overwrites, never commits.
 *
 * Stellar TESTNET only. These are demo keys: the sequencer holds the
 * player secrets for the local demo. Do not use real funds.
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
  PLAYER_A: Keypair.random(),
  PLAYER_B: Keypair.random(),
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
console.log("Generated 3 Testnet keypairs in .env (kept secret, git-ignored):");
for (const [name, kp] of Object.entries(keys)) {
  console.log(`  ${name.padEnd(9)} ${kp.publicKey()}`);
}
console.log("Fund them next: ./scripts/fund.sh");
