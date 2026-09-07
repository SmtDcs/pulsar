/**
 * Chain operations for the Pulsar sequencer (Stellar Testnet).
 *
 * All transactions are built with the OPERATOR key as invoker/fee-payer.
 * When a contract function requires the auth of a demo player (via
 * `require_auth`), the matching auth entry is signed with that player's
 * keypair — the sequencer holds the same demo secrets from .env.
 *
 * All submissions run through a serial queue: the operator is the source
 * account of every transaction, so concurrent submissions would race on
 * the account sequence number.
 */
import { performance } from "node:perf_hooks";
import { Buffer } from "node:buffer";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as RegistryClient } from "@pulsar/session-registry-bindings";
import { Client as TttClient, type Game } from "@pulsar/slow-tictactoe-bindings";
import { config } from "./config.js";

const operatorKp = Keypair.fromSecret(config.operatorSecret);

/** Demo player keypairs held by the sequencer (local demo only). */
const playerKeypairs = new Map<string, Keypair>();
function keypairFor(address: string): Keypair {
  const existing = playerKeypairs.get(address);
  if (existing) return existing;
  const secret =
    address === config.playerAPublic
      ? config.playerASecret
      : address === config.playerBPublic
        ? config.playerBSecret
        : address === operatorKp.publicKey()
          ? config.operatorSecret
          : null;
  if (!secret) {
    throw new Error(`no secret held for ${address} (demo players A/B and operator only)`);
  }
  const kp = Keypair.fromSecret(secret);
  playerKeypairs.set(address, kp);
  return kp;
}

const rpcServer = new rpc.Server(config.rpcUrl, { allowHttp: false });

let registryClient: RegistryClient | null = null;
let tttClient: TttClient | null = null;

async function getRegistry(): Promise<RegistryClient> {
  if (!registryClient) {
    registryClient = await RegistryClient.from({
      contractId: config.sessionRegistryId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      publicKey: operatorKp.publicKey(),
      signTransaction: operatorKp,
    });
  }
  return registryClient;
}

async function getTtt(): Promise<TttClient> {
  if (!tttClient) {
    if (!config.slowTicTacToeId) {
      throw new Error("SLOW_TICTACTOE_ID not configured — L1 mode is disabled");
    }
    tttClient = await TttClient.from({
      contractId: config.slowTicTacToeId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      publicKey: operatorKp.publicKey(),
      signTransaction: operatorKp,
    });
  }
  return tttClient;
}

/** Serialize all chain submissions (shared source account sequence). */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const METHOD_OPTS = { fee: "10000" } as const;

interface Submittable {
  signAuthEntries: (o?: object) => Promise<void>;
  signAndSend: (o?: object) => Promise<{ sendTransactionResponse?: { hash?: string } }>;
}

async function signAndSend(tx: Submittable, authAddress?: string) {
  if (authAddress) {
    const kp = keypairFor(authAddress);
    await tx.signAuthEntries({
      ...basicNodeSigner(kp, config.networkPassphrase),
      address: authAddress,
    });
  }
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("transaction submitted but hash missing");
  return { hash };
}

export async function chainGetLedger(): Promise<number> {
  const resp = await rpcServer.getLatestLedger();
  return resp.sequence;
}

/** SessionRegistry.open_session — player_a signs the auth entry. */
export async function chainOpenSession(
  playerA: string,
  playerB: string,
  timeoutLedgers: number,
): Promise<{ sessionId: string; txHash: string }> {
  return enqueue(async () => {
    const client = await getRegistry();
    const tx = await client.open_session(
      { player_a: playerA, player_b: playerB, timeout_ledgers: timeoutLedgers },
      METHOD_OPTS,
    );
    const sessionId = tx.result.unwrap(); // u64 (bigint), from simulation
    const { hash } = await signAndSend(tx, playerA);
    return { sessionId: sessionId.toString(), txHash: hash };
  });
}

/** SessionRegistry.settle — operator-only auth. */
export async function chainSettle(
  sessionId: string,
  stateHash: Uint8Array,
  result: Uint8Array,
): Promise<{ txHash: string }> {
  return enqueue(async () => {
    const client = await getRegistry();
    const tx = await client.settle(
      {
        id: BigInt(sessionId),
        state_hash: Buffer.from(stateHash),
        result: Buffer.from(result),
      },
      METHOD_OPTS,
    );
    const { hash } = await signAndSend(tx);
    return { txHash: hash };
  });
}

/** SlowTicTacToe.create_game — player_a signs the auth entry. */
export async function chainCreateGame(
  playerA: string,
  playerB: string,
): Promise<{ gameId: string; txHash: string }> {
  return enqueue(async () => {
    const client = await getTtt();
    const tx = await client.create_game(
      { player_a: playerA, player_b: playerB },
      METHOD_OPTS,
    );
    const gameId = tx.result.unwrap(); // u64
    const { hash } = await signAndSend(tx, playerA);
    return { gameId: gameId.toString(), txHash: hash };
  });
}

/** SlowTicTacToe.play — the current player signs the auth entry. */
export async function chainPlay(
  gameId: string,
  player: string,
  cell: number,
): Promise<{ txHash: string; ledgerLatencyMs: number }> {
  return enqueue(async () => {
    const client = await getTtt();
    const tx = await client.play({ id: BigInt(gameId), cell }, METHOD_OPTS);
    const t0 = performance.now();
    const { hash } = await signAndSend(tx, player);
    const ledgerLatencyMs = Math.round(performance.now() - t0);
    return { txHash: hash, ledgerLatencyMs };
  });
}

/** SlowTicTacToe.get_game — read-only simulation. */
export async function chainGetGame(gameId: string): Promise<Game> {
  const client = await getTtt();
  const tx = await client.get_game({ id: BigInt(gameId) }, METHOD_OPTS);
  return tx.result.unwrap();
}
