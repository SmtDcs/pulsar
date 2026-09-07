/**
 * @pulsar/shared — tic-tac-toe rules + Pulsar result encoding.
 *
 * Board: 9 cells, row-major. 0 = empty, 1 = X (player A, moves first),
 * 2 = O (player B). The same rules are re-implemented in Rust inside
 * `contracts/slow-tictactoe`; keep them in sync.
 */
import { sha256 } from "@noble/hashes/sha256";

export type Cell = 0 | 1 | 2;
export type Board = [Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell];

/** Winner codes: 0 = in progress, 1 = player A, 2 = player B, 3 = draw. */
export type Winner = 0 | 1 | 2 | 3;

/** `winner` byte inside the 12-byte result payload (draw is 0 there). */
export type ResultWinner = 0 | 1 | 2;

export const RESULT_VERSION = 1;
export const RESULT_BYTES = 12;
export const DRAW = 3;

const WIN_LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6], // diagonals
];

export function emptyBoard(): Board {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * Apply a move for `player` on `cell`. Throws if the cell index is out of
 * range or the cell is already occupied. Turn order is enforced by the
 * caller (match engine / contract), not here.
 */
export function applyMove(board: Board, cell: number, player: 1 | 2): Board {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) {
    throw new Error(`invalid cell ${cell}: must be an integer 0..8`);
  }
  if (board[cell] !== 0) {
    throw new Error(`cell ${cell} is already occupied`);
  }
  const next = board.slice() as Board;
  next[cell] = player;
  return next;
}

/** 0 = nobody yet, 1 = A, 2 = B, 3 = draw (only when the board is full). */
export function winnerOf(board: Board): Winner {
  for (const [a, b, c] of WIN_LINES) {
    const v = board[a];
    if (v !== undefined && v !== 0 && v === board[b] && v === board[c]) {
      return v;
    }
  }
  if (board.every((c) => c !== 0)) {
    return DRAW;
  }
  return 0;
}

/**
 * Packed Pulsar session result (12 bytes):
 *   version: u8 = 1 | winner: u8 (0=draw,1=A,2=B) | board: 9 × u8 | move_count: u8
 */
export function encodeResult(
  winner: ResultWinner,
  board: Board,
  moveCount: number,
): Uint8Array {
  const out = new Uint8Array(RESULT_BYTES);
  out[0] = RESULT_VERSION;
  out[1] = winner;
  for (let i = 0; i < 9; i++) {
    const c = board[i];
    if (c !== 0 && c !== 1 && c !== 2) throw new Error(`invalid cell value ${c}`);
    out[2 + i] = c;
  }
  if (!Number.isInteger(moveCount) || moveCount < 0 || moveCount > 255) {
    throw new Error(`invalid moveCount ${moveCount}`);
  }
  out[11] = moveCount;
  return out;
}

export function decodeResult(bytes: Uint8Array): {
  winner: number;
  board: Board;
  moveCount: number;
} {
  if (bytes.length !== RESULT_BYTES) {
    throw new Error(`result must be ${RESULT_BYTES} bytes, got ${bytes.length}`);
  }
  if (bytes[0] !== RESULT_VERSION) {
    throw new Error(`unsupported result version ${bytes[0]}`);
  }
  const board = Array.from(bytes.slice(2, 11)) as Board;
  return { winner: bytes[1]!, board, moveCount: bytes[11]! };
}

/** state_hash = sha256(version || winner || board[9] || move_count), 32 raw bytes. */
export function stateHash(result: Uint8Array): Uint8Array {
  return sha256(result);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length === 0) return new Uint8Array(0);
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("invalid hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
