/**
 * Chain operations for the Pulsar sequencer (Stellar Testnet).
 *
 * v2: the sequencer ONLY ever authorizes its own operations — `commit`
 * (v1 periodic state pins) and `settle`. Player-authority operations
 * (`open_session`, `create_game`, `play`, `close`) are signed in the
 * player's browser and submitted directly to the Testnet RPC. The
 * sequencer holds no player secrets.
 *
 * All submissions run through a serial queue: the operator is the source
 * account of every transaction, so concurrent submissions would race on
 * the account sequence number.
 */
import { Buffer } from "node:buffer";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { Client as RegistryClient, type Session } from "@pulsar/session-registry-bindings";
import { Client as TttClient, type Game } from "@pulsar/slow-tictactoe-bindings";
import { config } from "./config.js";

const operatorKp = Keypair.fromSecret(config.operatorSecret);

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

async function signAndSend(tx: Submittable) {
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("transaction submitted but hash missing");
  return { hash };
}

export async function chainGetLedger(): Promise<number> {
  const resp = await rpcServer.getLatestLedger();
  return resp.sequence;
}

/**
 * SessionRegistry.get_session — read-only simulation used to verify that a
 * browser-opened session was bound to the right players (v2 attach flow).
 */
export async function chainGetSession(sessionId: string): Promise<Session> {
  const client = await getRegistry();
  const tx = await client.get_session({ id: BigInt(sessionId) }, METHOD_OPTS);
  return tx.result.unwrap();
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

/** SessionRegistry.commit — operator-only auth (v1 periodic commits). */
export async function chainCommit(
  sessionId: string,
  nonce: number,
  stateHash: Uint8Array,
): Promise<{ txHash: string }> {
  return enqueue(async () => {
    const client = await getRegistry();
    const tx = await client.commit(
      {
        id: BigInt(sessionId),
        nonce,
        state_hash: Buffer.from(stateHash),
      },
      METHOD_OPTS,
    );
    const { hash } = await signAndSend(tx);
    return { txHash: hash };
  });
}

/** SlowTicTacToe.get_game — read-only simulation. */
export async function chainGetGame(gameId: string): Promise<Game> {
  const client = await getTtt();
  const tx = await client.get_game({ id: BigInt(gameId) }, METHOD_OPTS);
  return tx.result.unwrap();
}
