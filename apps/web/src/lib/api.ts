export const SEQUENCER_URL = (
  process.env.NEXT_PUBLIC_SEQUENCER_URL ?? "http://localhost:8787"
).replace(/\/$/, "");

export type Mode = "pulsar" | "l1";
export type MatchStatus = "open" | "settled" | "closed";

export interface HealthInfo {
  ok: boolean;
  ledger: number | null;
  rpcUrl: string;
  networkPassphrase: string;
  horizonUrl: string;
  sessionRegistryId: string;
  slowTicTacToeId: string | null;
  commitEveryMoves: number;
  defaultTimeoutLedgers: number;
}

export interface MatchInfo {
  matchId: string;
  mode: Mode;
  sessionId: string | null;
  gameId: string | null;
  playerA: string;
  playerB: string;
  board: number[];
  next: 1 | 2;
  winner: number;
  moveCount: number;
  status: MatchStatus;
  lastMoveMs: number | null;
  txHashes: string[];
  settleTxHash: string | null;
  resultHex: string | null;
  stateHashHex: string | null;
  timeoutLedgers: number | null;
  commitsCount: number;
  commitInFlight: boolean;
  lastCommitTxHash: string | null;
  lastCommitStateHashHex: string | null;
}

export interface MoveResult {
  board: number[];
  next: 1 | 2;
  winner: number;
  lastMoveMs?: number;
  txHash?: string;
  ledgerLatencyMs?: number;
}

export async function getHealth(): Promise<HealthInfo> {
  const res = await fetch(`${SEQUENCER_URL}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`sequencer health failed: ${res.status}`);
  return res.json();
}

export async function getMatch(id: string): Promise<MatchInfo> {
  const res = await fetch(`${SEQUENCER_URL}/matches/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `failed to load match (${res.status})`);
  }
  return res.json();
}

export async function createMatch(body: {
  mode: Mode;
  playerA: string;
  playerB: string;
  timeoutLedgers?: number;
}): Promise<MatchInfo> {
  const res = await fetch(`${SEQUENCER_URL}/matches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `create failed (${res.status})`);
  return json as MatchInfo;
}

export async function attachMatch(
  id: string,
  sessionId: string,
  txHash?: string,
): Promise<MatchInfo> {
  const res = await fetch(`${SEQUENCER_URL}/matches/${encodeURIComponent(id)}/attach`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, txHash }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `attach failed (${res.status})`);
  return json as MatchInfo;
}

export async function attachL1(
  id: string,
  gameId: string,
  txHash?: string,
): Promise<MatchInfo> {
  const res = await fetch(`${SEQUENCER_URL}/matches/${encodeURIComponent(id)}/l1/attach`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId, txHash }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `L1 attach failed (${res.status})`);
  return json as MatchInfo;
}

export async function pulsarMove(
  id: string,
  player: string,
  cell: number,
): Promise<MoveResult> {
  const res = await fetch(`${SEQUENCER_URL}/matches/${encodeURIComponent(id)}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player, cell }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `move failed (${res.status})`);
  return json;
}

export async function closeMatch(
  id: string,
  caller: string,
  txHash?: string,
): Promise<MatchInfo> {
  const res = await fetch(`${SEQUENCER_URL}/matches/${encodeURIComponent(id)}/close`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caller, txHash }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `close failed (${res.status})`);
  return json as MatchInfo;
}

export async function settleMatch(id: string): Promise<{
  txHash: string;
  resultHex: string;
  stateHashHex: string;
}> {
  const res = await fetch(`${SEQUENCER_URL}/matches/${encodeURIComponent(id)}/settle`, {
    method: "POST",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `settle failed (${res.status})`);
  return json;
}

export function explorerTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function shortKey(key: string | null | undefined, head = 5, tail = 4): string {
  if (!key) return "—";
  if (key.length <= head + tail + 1) return key;
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}
