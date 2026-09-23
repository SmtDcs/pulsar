/**
 * @pulsar/web — browser-side on-chain operations (v2).
 *
 * Player-authorized Soroban calls are built and signed HERE, in the browser,
 * using the generated contract bindings and the player's own wallet keypair.
 * The Testnet RPC is CORS-open, so the browser submits straight to the
 * network. The sequencer never sees these secrets.
 */
import { Client as RegistryClient } from "@pulsar/session-registry-bindings";
import { Client as TttClient } from "@pulsar/slow-tictactoe-bindings";
import type { Keypair } from "@stellar/stellar-sdk";
import { getHealth } from "./api";
import { SEQUENCER_URL } from "./api";

async function net() {
  return getHealth(); // cached by the caller in practice; fine to re-read
}

export interface ChainResult {
  id: string;
  txHash: string;
}

/** SessionRegistry.open_session — signed by player A's wallet. */
export async function openSession(
  wallet: Keypair,
  playerA: string,
  playerB: string,
  timeoutLedgers: number,
): Promise<ChainResult> {
  const h = await net();
  const client = await RegistryClient.from<RegistryClient>({
    contractId: h.sessionRegistryId,
    networkPassphrase: h.networkPassphrase,
    rpcUrl: h.rpcUrl,
    publicKey: wallet.publicKey(),
    signTransaction: wallet,
  });
  const tx = await client.open_session(
    { player_a: playerA, player_b: playerB, timeout_ledgers: timeoutLedgers },
    { fee: "10000" },
  );
  const sessionId = tx.result.unwrap().toString();
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("open_session submitted but tx hash missing");
  return { id: sessionId, txHash: hash };
}

/** SlowTicTacToe.create_game — signed by player A's wallet. */
export async function createGame(
  wallet: Keypair,
  playerA: string,
  playerB: string,
): Promise<ChainResult> {
  const h = await net();
  const client = await TttClient.from<TttClient>({
    contractId: h.slowTicTacToeId!,
    networkPassphrase: h.networkPassphrase,
    rpcUrl: h.rpcUrl,
    publicKey: wallet.publicKey(),
    signTransaction: wallet,
  });
  const tx = await client.create_game(
    { player_a: playerA, player_b: playerB },
    { fee: "10000" },
  );
  const gameId = tx.result.unwrap().toString();
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("create_game submitted but tx hash missing");
  return { id: gameId, txHash: hash };
}

/** SlowTicTacToe.play — signed by the wallet of the player whose turn it is. */
export async function playMove(
  wallet: Keypair,
  gameId: string,
  cell: number,
): Promise<{ txHash: string }> {
  const h = await net();
  const client = await TttClient.from<TttClient>({
    contractId: h.slowTicTacToeId!,
    networkPassphrase: h.networkPassphrase,
    rpcUrl: h.rpcUrl,
    publicKey: wallet.publicKey(),
    signTransaction: wallet,
  });
  const tx = await client.play({ id: BigInt(gameId), cell }, { fee: "10000" });
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("play submitted but tx hash missing");
  return { txHash: hash };
}

/** SessionRegistry.close — signed by a player's wallet. */
export async function closeSession(
  wallet: Keypair,
  caller: string,
  sessionId: string,
): Promise<{ txHash: string }> {
  const h = await net();
  const client = await RegistryClient.from<RegistryClient>({
    contractId: h.sessionRegistryId,
    networkPassphrase: h.networkPassphrase,
    rpcUrl: h.rpcUrl,
    publicKey: wallet.publicKey(),
    signTransaction: wallet,
  });
  const tx = await client.close({ caller, id: BigInt(sessionId) }, { fee: "10000" });
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("close submitted but tx hash missing");
  return { txHash: hash };
}

/** Fund a Testnet address via the sequencer's Friendbot proxy. */
export async function fundAddress(address: string): Promise<boolean> {
  const res = await fetch(`${SEQUENCER_URL}/fund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) return false;
  const json = (await res.json().catch(() => ({}))) as { funded?: boolean };
  return json.funded === true;
}