/**
 * In-memory match engine for the Pulsar sequencer.
 *
 * Pure logic (no chain, no HTTP) so it is unit-testable:
 *  - Pulsar matches: moves applied locally in microseconds, one settle
 *    transaction at the end.
 *  - L1 matches: a shell record; the board itself lives fully on-chain
 *    in SlowTicTacToe and is mirrored here after each move.
 */
import {
  applyMove,
  emptyBoard,
  winnerOf,
  encodeResult,
  stateHash,
  type Board,
} from "@pulsar/shared";

export type Mode = "pulsar" | "l1";
export type MatchStatus = "open" | "settled" | "closed";

export interface Match {
  matchId: string;
  mode: Mode;
  /** SessionRegistry session id (Pulsar) — decimal string in URLs. */
  sessionId?: string;
  /** SlowTicTacToe game id (L1). */
  gameId?: string;
  playerA: string;
  playerB: string;
  board: Board;
  next: 1 | 2;
  winner: 0 | 1 | 2 | 3;
  moveCount: number;
  status: MatchStatus;
  lastMoveMs: number | null;
  txHashes: string[];
  timeoutLedgers?: number;
  resultHex?: string;
  stateHashHex?: string;
  settleTxHash?: string;
  createdAt: number;
}

export class MatchEngine {
  private matches = new Map<string, Match>();

  createPulsar(matchId: string, sessionId: string, playerA: string, playerB: string, timeoutLedgers: number): Match {
    const m: Match = {
      matchId,
      mode: "pulsar",
      sessionId,
      playerA,
      playerB,
      board: emptyBoard(),
      next: 1,
      winner: 0,
      moveCount: 0,
      status: "open",
      lastMoveMs: null,
      txHashes: [],
      timeoutLedgers,
      createdAt: Date.now(),
    };
    this.matches.set(matchId, m);
    return m;
  }

  createL1Shell(matchId: string, playerA: string, playerB: string): Match {
    const m: Match = {
      matchId,
      mode: "l1",
      playerA,
      playerB,
      board: emptyBoard(),
      next: 1,
      winner: 0,
      moveCount: 0,
      status: "open",
      lastMoveMs: null,
      txHashes: [],
      createdAt: Date.now(),
    };
    this.matches.set(matchId, m);
    return m;
  }

  attachL1Game(matchId: string, gameId: string, txHash?: string): Match {
    const m = this.get(matchId);
    if (m.mode !== "l1") throw new Error("not an L1 match");
    if (m.gameId) throw new Error("L1 game already created");
    m.gameId = gameId;
    if (txHash) m.txHashes.push(txHash);
    return m;
  }

  get(matchId: string): Match {
    const m = this.matches.get(matchId);
    if (!m) throw new Error(`match ${matchId} not found`);
    return m;
  }

  /** Apply a Pulsar (off-chain) move. Throws on any illegal move. */
  applyMove(matchId: string, player: string, cell: number): Match {
    const m = this.get(matchId);
    if (m.mode !== "pulsar") throw new Error("not a Pulsar match");
    if (m.status !== "open") throw new Error(`match is ${m.status}`);
    if (m.winner !== 0) throw new Error("game is already over");
    if (player !== m.playerA && player !== m.playerB) {
      throw new Error("player is not part of this match");
    }
    const expected: 1 | 2 = m.next;
    const asPlayer: 1 | 2 = player === m.playerA ? 1 : 2;
    if (asPlayer !== expected) {
      throw new Error(`not ${asPlayer === 1 ? "A" : "B"}'s turn`);
    }
    m.board = applyMove(m.board, cell, asPlayer); // throws on illegal cell
    m.moveCount += 1;
    m.winner = winnerOf(m.board);
    m.next = m.next === 1 ? 2 : 1;
    return m;
  }

  /** Mirror an on-chain L1 move result (board read back from SlowTicTacToe). */
  syncL1(matchId: string, board: Board, next: 1 | 2, winner: 0 | 1 | 2 | 3, moveCount: number, txHash: string, ledgerLatencyMs: number): Match {
    const m = this.get(matchId);
    if (m.mode !== "l1") throw new Error("not an L1 match");
    m.board = board;
    m.next = next;
    m.winner = winner;
    m.moveCount = moveCount;
    m.lastMoveMs = ledgerLatencyMs;
    if (txHash && !m.txHashes.includes(txHash)) m.txHashes.push(txHash);
    if (m.winner !== 0 && m.status === "open") {
      // Final state is already on-chain by construction in L1 mode.
      m.status = "settled";
    }
    return m;
  }

  /** Build the 12-byte result + sha256 state hash for settle. */
  settlePayload(matchId: string): { result: Uint8Array; stateHash: Uint8Array } {
    const m = this.get(matchId);
    if (m.mode !== "pulsar") throw new Error("not a Pulsar match");
    if (m.status !== "open") throw new Error(`match is ${m.status}`);
    if (m.winner === 0) throw new Error("game is not finished yet");
    const resultWinner: 0 | 1 | 2 = m.winner === 3 ? 0 : m.winner;
    const result = encodeResult(resultWinner, m.board, m.moveCount);
    return { result, stateHash: stateHash(result) };
  }

  markSettled(matchId: string, txHash: string, resultHex: string, stateHashHex: string): Match {
    const m = this.get(matchId);
    if (m.mode !== "pulsar") throw new Error("not a Pulsar match");
    m.status = "settled";
    m.settleTxHash = txHash;
    if (!m.txHashes.includes(txHash)) m.txHashes.push(txHash);
    m.resultHex = resultHex;
    m.stateHashHex = stateHashHex;
    return m;
  }
}
