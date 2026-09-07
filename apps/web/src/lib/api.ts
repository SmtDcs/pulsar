export const SEQUENCER_URL = (
  process.env.NEXT_PUBLIC_SEQUENCER_URL ?? "http://localhost:8787"
).replace(/\/$/, "");

export type Mode = "pulsar" | "l1";
export type MatchStatus = "open" | "settled" | "closed";

export interface HealthInfo {
  ok: boolean;
  ledger: number | null;
  playerA: string;
  playerB: string;
  sessionRegistryId: string;
  slowTicTacToeId: string | null;
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

export async function createL1Game(
  id: string,
  playerA: string,
  playerB: string,
): Promise<{ matchId: string; gameId: string; txHash: string }> {
  const res = await fetch(`${SEQUENCER_URL}/matches/${encodeURIComponent(id)}/l1/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerA, playerB }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `L1 create failed (${res.status})`);
  return json;
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

export async function l1Move(
  id: string,
  player: string,
  cell: number,
): Promise<MoveResult> {
  const res = await fetch(`${SEQUENCER_URL}/matches/${encodeURIComponent(id)}/l1/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player, cell }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `L1 move failed (${res.status})`);
  return json;
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
