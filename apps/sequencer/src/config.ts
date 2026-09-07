/**
 * Sequencer configuration, loaded from apps/sequencer/.env or the repo
 * root .env (deploy.sh writes contract IDs into the root .env).
 */
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// Prefer a local .env, fall back to the repo root .env.
for (const candidate of [
  path.resolve(here, "../../.env"), // apps/sequencer/.env
  path.resolve(here, "../../../.env"), // repo root .env
]) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  networkPassphrase:
    process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  rpcUrl:
    process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  horizonUrl:
    process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  operatorSecret: required("OPERATOR_SECRET"),
  sessionRegistryId: required("SESSION_REGISTRY_ID"),
  slowTicTacToeId: process.env.SLOW_TICTACTOE_ID ?? "",
  playerASecret: process.env.PLAYER_A_SECRET ?? "",
  playerBSecret: process.env.PLAYER_B_SECRET ?? "",
  playerAPublic: process.env.PLAYER_A_PUBLIC ?? "",
  playerBPublic: process.env.PLAYER_B_PUBLIC ?? "",
  defaultTimeoutLedgers: Number(process.env.DEFAULT_TIMEOUT_LEDGERS ?? 300),
};
