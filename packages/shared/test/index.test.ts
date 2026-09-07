import { describe, expect, it } from "vitest";
import {
  applyMove,
  decodeResult,
  emptyBoard,
  encodeResult,
  stateHash,
  toHex,
  winnerOf,
} from "../src/index.js";

describe("emptyBoard", () => {
  it("returns 9 empty cells", () => {
    expect(emptyBoard()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("applyMove", () => {
  it("places the player in an empty cell", () => {
    const b = applyMove(emptyBoard(), 4, 1);
    expect(b[4]).toBe(1);
    expect(b.filter((c) => c === 0)).toHaveLength(8);
  });

  it("does not mutate the input board", () => {
    const board = emptyBoard();
    applyMove(board, 0, 2);
    expect(board[0]).toBe(0);
  });

  it("throws on an occupied cell", () => {
    const b = applyMove(emptyBoard(), 3, 1);
    expect(() => applyMove(b, 3, 2)).toThrowError(/occupied/);
  });

  it("throws on out-of-range cells", () => {
    expect(() => applyMove(emptyBoard(), -1, 1)).toThrow();
    expect(() => applyMove(emptyBoard(), 9, 1)).toThrow();
    expect(() => applyMove(emptyBoard(), 1.5, 1)).toThrow();
  });
});

describe("winnerOf", () => {
  it("detects a row win", () => {
    const b: number[] = [1, 1, 1, 0, 2, 2, 0, 0, 0];
    expect(winnerOf(b as never)).toBe(1);
  });

  it("detects a column win", () => {
    const b: number[] = [2, 1, 0, 2, 1, 0, 2, 0, 1];
    expect(winnerOf(b as never)).toBe(2);
  });

  it("detects the main diagonal", () => {
    const b: number[] = [1, 2, 2, 0, 1, 0, 0, 0, 1];
    expect(winnerOf(b as never)).toBe(1);
  });

  it("detects the anti-diagonal", () => {
    const b: number[] = [0, 0, 2, 0, 2, 1, 2, 1, 0];
    expect(winnerOf(b as never)).toBe(2);
  });

  it("returns 3 only for a full board without a line", () => {
    // X: 0,2,3,7,8 — O: 1,4,5,6 — draw
    const b: number[] = [1, 2, 1, 1, 2, 2, 2, 1, 1];
    expect(winnerOf(b as never)).toBe(3);
  });

  it("returns 0 for a full-but-won board? no — win beats draw", () => {
    const b: number[] = [1, 2, 1, 1, 2, 2, 2, 2, 1]; // col 1: 2,2,2 -> O wins? 1,2,1 / 1,2,2 / 2,2,1: col0=1,1,2 no; col1=2,2,2 yes
    expect(winnerOf(b as never)).toBe(2);
  });

  it("returns 0 while the game is in progress", () => {
    const b: number[] = [1, 0, 0, 0, 2, 0, 0, 0, 0];
    expect(winnerOf(b as never)).toBe(0);
  });
});

describe("result encoding", () => {
  it("round-trips a won game", () => {
    const board: number[] = [1, 2, 1, 1, 2, 2, 2, 1, 1];
    const result = encodeResult(2, board as never, 9);
    expect(result).toHaveLength(12);
    expect(result[0]).toBe(1); // version
    expect(result[1]).toBe(2); // winner B
    const decoded = decodeResult(result);
    expect(decoded.winner).toBe(2);
    expect(decoded.moveCount).toBe(9);
    expect(Array.from(decoded.board)).toEqual(board);
  });

  it("encodes a draw with winner byte 0", () => {
    // Canonical draw: X: 0,2,3,7,8 — O: 1,4,5,6
    const draw: number[] = [1, 2, 1, 1, 2, 2, 2, 1, 1];
    expect(winnerOf(draw as never)).toBe(3);
    const result = encodeResult(0, draw as never, 9);
    expect(result[1]).toBe(0);
    expect(decodeResult(result).winner).toBe(0);
  });

  it("rejects bad lengths and versions on decode", () => {
    expect(() => decodeResult(new Uint8Array(11))).toThrow();
    const bad = encodeResult(0, emptyBoard(), 0);
    bad[0] = 9;
    expect(() => decodeResult(bad)).toThrow(/version/);
  });
});

describe("stateHash", () => {
  it("is sha256 of the packed result", async () => {
    const result = encodeResult(1, emptyBoard(), 3);
    const h = stateHash(result);
    expect(h).toHaveLength(32);
    const { createHash } = await import("node:crypto");
    expect(toHex(h)).toBe(
      createHash("sha256").update(result).digest("hex"),
    );
  });
});
