import { describe, expect, it } from "vitest";
import { MatchEngine } from "../src/engine.js";

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function pulsarEngine() {
  const e = new MatchEngine();
  e.createPulsar("1", A, B, 60);
  e.attachSession("1", "1", "tx-open");
  return e;
}

describe("MatchEngine — Pulsar moves", () => {
  it("starts empty with A to move", () => {
    const e = pulsarEngine();
    const m = e.get("1");
    expect(m.board).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(m.next).toBe(1);
    expect(m.winner).toBe(0);
    expect(m.status).toBe("open");
  });

  it("applies legal alternating moves", () => {
    const e = pulsarEngine();
    e.applyMove("1", A, 4);
    e.applyMove("1", B, 0);
    const m = e.get("1");
    expect(m.board[4]).toBe(1);
    expect(m.board[0]).toBe(2);
    expect(m.next).toBe(1);
    expect(m.moveCount).toBe(2);
  });

  it("rejects a move out of turn", () => {
    const e = pulsarEngine();
    expect(() => e.applyMove("1", B, 0)).toThrowError(/turn/);
  });

  it("rejects an occupied cell", () => {
    const e = pulsarEngine();
    e.applyMove("1", A, 4);
    expect(() => e.applyMove("1", B, 4)).toThrowError(/occupied/);
  });

  it("rejects an out-of-range cell", () => {
    const e = pulsarEngine();
    expect(() => e.applyMove("1", A, 9)).toThrow();
    expect(() => e.applyMove("1", A, -1)).toThrow();
  });

  it("rejects a stranger", () => {
    const e = pulsarEngine();
    expect(() => e.applyMove("1", "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", 0)).toThrowError(
      /not part of this match/,
    );
  });

  it("rejects moves on a missing match", () => {
    const e = pulsarEngine();
    expect(() => e.applyMove("999", A, 0)).toThrowError(/not found/);
  });
});

describe("MatchEngine — win / draw / settle", () => {
  it("detects a win and blocks further moves", () => {
    const e = pulsarEngine();
    for (const [p, c] of [
      [A, 0], [B, 3], [A, 1], [B, 4], [A, 2],
    ] as const) {
      e.applyMove("1", p, c);
    }
    const m = e.get("1");
    expect(m.winner).toBe(1);
    expect(() => e.applyMove("1", B, 8)).toThrowError(/already over/);
  });

  it("builds the 12-byte settle payload for a win", () => {
    const e = pulsarEngine();
    for (const [p, c] of [
      [A, 0], [B, 3], [A, 1], [B, 4], [A, 2],
    ] as const) {
      e.applyMove("1", p, c);
    }
    const { result, stateHash } = e.settlePayload("1");
    expect(result).toHaveLength(12);
    expect(result[0]).toBe(1); // version
    expect(result[1]).toBe(1); // winner A
    expect(result[11]).toBe(5); // move count
    expect(stateHash).toHaveLength(32);
  });

  it("draw encodes winner byte 0", () => {
    const e = pulsarEngine();
    for (const [p, c] of [
      [A, 0], [B, 1], [A, 2], [B, 4], [A, 3], [B, 5], [A, 7], [B, 6], [A, 8],
    ] as const) {
      e.applyMove("1", p, c);
    }
    const m = e.get("1");
    expect(m.winner).toBe(3);
    const { result } = e.settlePayload("1");
    expect(result[1]).toBe(0);
  });

  it("refuses settle before the game is over", () => {
    const e = pulsarEngine();
    e.applyMove("1", A, 4);
    expect(() => e.settlePayload("1")).toThrowError(/not finished/);
  });

  it("rejects moves after settle", () => {
    const e = pulsarEngine();
    for (const [p, c] of [
      [A, 0], [B, 3], [A, 1], [B, 4], [A, 2],
    ] as const) {
      e.applyMove("1", p, c);
    }
    const { result, stateHash } = e.settlePayload("1");
    e.markSettled("1", "TXHASH", "abcd", "ef01");
    expect(e.get("1").status).toBe("settled");
    expect(() => e.applyMove("1", B, 8)).toThrowError(/settled/);
    expect(() => e.settlePayload("1")).toThrowError(/settled/);
    // payload bytes unchanged after settle
    void result;
    void stateHash;
  });
});

describe("MatchEngine — v1 periodic commits", () => {
  it("commits every N moves with strictly increasing nonces", () => {
    const e = pulsarEngine();
    e.applyMove("1", A, 0);
    e.applyMove("1", B, 1);
    expect(e.commitDue("1", 3)).toBe(false); // moveCount 2
    e.applyMove("1", A, 2);
    expect(e.commitDue("1", 3)).toBe(true); // moveCount 3
    const p1 = e.commitPayload("1");
    expect(p1.nonce).toBe(1);
    e.markCommitSubmitted("1");
    expect(e.commitDue("1", 3)).toBe(false); // in-flight
    const st = e.commitPayload("1").stateHash;
    e.markCommitConfirmed("1", "tx-c1", Array.from(st, (b) => b.toString(16).padStart(2, "0")).join(""));
    expect(e.get("1").commitsCount).toBe(1);

    e.applyMove("1", B, 5);
    e.applyMove("1", A, 6);
    e.applyMove("1", B, 7);
    expect(e.commitDue("1", 3)).toBe(true); // moveCount 6
    const p2 = e.commitPayload("1");
    expect(p2.nonce).toBe(2);
  });

  it("does not commit after the game is won or settled", () => {
    const e = pulsarEngine();
    for (const [p, c] of [
      [A, 0], [B, 3], [A, 1], [B, 4], [A, 2],
    ] as const) {
      e.applyMove("1", p, c); // A wins on move 5
    }
    expect(e.get("1").winner).toBe(1);
    expect(e.commitDue("1", 3)).toBe(false); // game over
    e.markSettled("1", "tx-s", "00", "aa");
    expect(e.get("1").status).toBe("settled");
    expect(e.commitDue("1", 3)).toBe(false); // settled
  });

  it("does not commit when the session is not attached yet", () => {
    const e = new MatchEngine();
    e.createPulsar("2", A, B, 60);
    e.applyMove("2", A, 0);
    e.applyMove("2", B, 1);
    e.applyMove("2", A, 2);
    expect(e.commitDue("2", 3)).toBe(true);
    expect(() => e.commitPayload("2")).toThrowError(/session not attached/);
  });
});

describe("MatchEngine — L1 shell", () => {
  it("creates a shell and attaches an on-chain game", () => {
    const e = new MatchEngine();
    e.createL1Shell("abc", A, B);
    expect(() => e.applyMove("abc", A, 0)).toThrowError(/not a Pulsar match/);
    e.attachL1Game("abc", "7", "tx-create");
    const m = e.syncL1("abc", [1, 0, 0, 0, 0, 0, 0, 0, 0], 2, 0, 1, "tx-1", 5123);
    expect(m.gameId).toBe("7");
    expect(m.board[0]).toBe(1);
    expect(m.next).toBe(2);
    expect(m.lastMoveMs).toBe(5123);
    expect(m.txHashes).toContain("tx-1");
    expect(m.status).toBe("open");
  });

  it("marks an L1 match settled when a winner lands on-chain", () => {
    const e = new MatchEngine();
    e.createL1Shell("abc", A, B);
    e.attachL1Game("abc", "7");
    const m = e.syncL1("abc", [1, 1, 1, 2, 2, 0, 0, 0, 0], 2, 1, 5, "tx-5", 5000);
    expect(m.winner).toBe(1);
    expect(m.status).toBe("settled");
  });
});
