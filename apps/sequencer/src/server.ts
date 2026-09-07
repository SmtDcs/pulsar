/**
 * Pulsar sequencer — HTTP API.
 *
 * Pulsar mode: moves are applied to the in-memory engine (target < 50 ms)
 * and one `SessionRegistry.settle` transaction lands the final result.
 * L1 mode: every move is a real Soroban transaction against
 * `SlowTicTacToe` and waits for a ledger close (~5 s).
 *
 * Trusted-sequencer prototype: the operator key signs chain traffic and
 * the demo player secrets live in .env. Testnet only.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { performance } from "node:perf_hooks";
import { toHex } from "@pulsar/shared";
import { MatchEngine, type Match } from "./engine.js";
import {
  chainGetLedger,
  chainOpenSession,
  chainSettle,
  chainCreateGame,
  chainPlay,
  chainGetGame,
} from "./chain.js";
import { config } from "./config.js";

const engine = new MatchEngine();

export function publicMatch(m: Match) {
  return {
    matchId: m.matchId,
    mode: m.mode,
    sessionId: m.sessionId ?? null,
    gameId: m.gameId ?? null,
    playerA: m.playerA,
    playerB: m.playerB,
    board: m.board,
    next: m.next,
    winner: m.winner,
    moveCount: m.moveCount,
    status: m.status,
    lastMoveMs: m.lastMoveMs,
    txHashes: m.txHashes,
    settleTxHash: m.settleTxHash ?? null,
    resultHex: m.resultHex ?? null,
    stateHashHex: m.stateHashHex ?? null,
    timeoutLedgers: m.timeoutLedgers ?? null,
  };
}

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    // Local demo: any localhost origin (the web app port is configurable).
    origin: [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],
  });

  app.get("/health", async () => {
    let ledger: number | null = null;
    try {
      ledger = await chainGetLedger();
    } catch {
      // RPC hiccup — health is still ok, ledger is optional.
    }
    return {
      ok: true,
      ledger,
      playerA: config.playerAPublic,
      playerB: config.playerBPublic,
      sessionRegistryId: config.sessionRegistryId,
      slowTicTacToeId: config.slowTicTacToeId || null,
    };
  });

  /**
   * Create a match.
   *  - mode "pulsar" (default): submit SessionRegistry.open_session;
   *    matchId == session id (decimal string).
   *  - mode "l1": create a shell now; the client then calls
   *    POST /matches/:id/l1/create to submit SlowTicTacToe.create_game.
   */
  app.post<{ Body: { mode?: string; playerA: string; playerB: string; timeoutLedgers?: number } }>(
    "/matches",
    async (req, reply) => {
      const body = req.body ?? ({} as { playerA?: string; playerB?: string });
      const playerA = body.playerA;
      const playerB = body.playerB;
      const mode = body.mode === "l1" ? "l1" : "pulsar";
      if (!playerA?.startsWith("G") || !playerB?.startsWith("G")) {
        return reply.status(400).send({ error: "playerA and playerB must be G... addresses" });
      }
      if (playerA === playerB) {
        return reply.status(400).send({ error: "playerA and playerB must differ" });
      }

      if (mode === "l1") {
        const matchId = `l1-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        engine.createL1Shell(matchId, playerA, playerB);
        return reply.status(201).send(publicMatch(engine.get(matchId)));
      }

      const timeoutLedgers = body.timeoutLedgers ?? config.defaultTimeoutLedgers;
      if (!Number.isInteger(timeoutLedgers) || timeoutLedgers < 10 || timeoutLedgers > 1200) {
        return reply.status(400).send({ error: "timeoutLedgers must be an integer in [10, 1200]" });
      }
      const { sessionId, txHash } = await chainOpenSession(playerA, playerB, timeoutLedgers);
      const matchId = sessionId; // match id (web) = session id decimal string
      const m = engine.createPulsar(matchId, sessionId, playerA, playerB, timeoutLedgers);
      m.txHashes.push(txHash);
      return reply.status(201).send(publicMatch(m));
    },
  );

  app.get<{ Params: { id: string } }>("/matches/:id", async (req, reply) => {
    let m: Match;
    try {
      m = engine.get(req.params.id);
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
    // L1 matches mirror on-chain state; refresh on every poll.
    if (m.mode === "l1" && m.gameId) {
      try {
        const g = await chainGetGame(m.gameId);
        m.board = g.board as Match["board"];
        m.next = g.next === 2 ? 2 : 1;
        m.winner = g.winner as 0 | 1 | 2 | 3;
        m.moveCount = g.move_count;
        if (g.winner !== 0 && m.status === "open") m.status = "settled";
      } catch (err) {
        req.log.warn({ err }, "failed to read L1 game state");
      }
    }
    return reply.status(200).send(publicMatch(m));
  });

  app.post<{ Params: { id: string }; Body: { player: string; cell: number } }>(
    "/matches/:id/move",
    async (req, reply) => {
      const body = req.body ?? ({} as { player?: string; cell?: number });
      const player = body.player;
      const cell = body.cell;
      if (!player?.startsWith("G") || !Number.isInteger(cell)) {
        return reply.status(400).send({ error: "body must be { player: G..., cell: 0-8 }" });
      }
      let m: Match;
      try {
        const t0 = performance.now();
        m = engine.applyMove(req.params.id, player, cell);
        m.lastMoveMs = Math.round((performance.now() - t0) * 100) / 100; // ms, 2 decimals
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      return reply.status(200).send({
        matchId: m.matchId,
        board: m.board,
        next: m.next,
        winner: m.winner,
        lastMoveMs: m.lastMoveMs,
      });
    },
  );

  app.post<{ Params: { id: string } }>("/matches/:id/settle", async (req, reply) => {
    let payload: { result: Uint8Array; stateHash: Uint8Array };
    try {
      payload = engine.settlePayload(req.params.id);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    const sessionId = engine.get(req.params.id).sessionId!;
    const { txHash } = await chainSettle(sessionId, payload.stateHash, payload.result);
    const m = engine.markSettled(
      req.params.id,
      txHash,
      toHex(payload.result),
      toHex(payload.stateHash),
    );
    return reply.status(200).send({
      txHash,
      resultHex: m.resultHex,
      stateHashHex: m.stateHashHex,
    });
  });

  app.post<{ Params: { id: string }; Body: { playerA: string; playerB: string } }>(
    "/matches/:id/l1/create",
    async (req, reply) => {
      const body = req.body ?? ({} as { playerA?: string; playerB?: string });
      const playerA = body.playerA;
      const playerB = body.playerB;
      if (!playerA?.startsWith("G") || !playerB?.startsWith("G")) {
        return reply.status(400).send({ error: "playerA and playerB must be G... addresses" });
      }
      try {
        const m = engine.get(req.params.id);
        if (m.mode !== "l1") throw new Error("not an L1 match");
        if (m.gameId) throw new Error("L1 game already created");
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      const { gameId, txHash } = await chainCreateGame(playerA, playerB);
      engine.attachL1Game(req.params.id, gameId, txHash);
      return reply.status(200).send({ matchId: req.params.id, gameId, txHash });
    },
  );

  app.post<{ Params: { id: string }; Body: { player: string; cell: number } }>(
    "/matches/:id/l1/move",
    async (req, reply) => {
      const body = req.body ?? ({} as { player?: string; cell?: number });
      const player = body.player;
      const cell = body.cell;
      if (!player?.startsWith("G") || !Number.isInteger(cell) || cell < 0 || cell > 8) {
        return reply.status(400).send({ error: "body must be { player: G..., cell: 0-8 }" });
      }
      let m: Match;
      try {
        m = engine.get(req.params.id);
        if (m.mode !== "l1" || !m.gameId) throw new Error("L1 game not created yet");
        if (m.winner !== 0) throw new Error("game is already over");
        const asPlayer: 1 | 2 = player === m.playerA ? 1 : 2;
        if (asPlayer !== m.next) throw new Error(`not ${asPlayer === 1 ? "A" : "B"}'s turn`);
        if (m.board[cell] !== 0) throw new Error(`cell ${cell} is already occupied`);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }

      const { txHash, ledgerLatencyMs } = await chainPlay(m.gameId, player, cell);
      // Read back the authoritative on-chain state.
      const g = await chainGetGame(m.gameId);
      engine.syncL1(
        req.params.id,
        g.board as Match["board"],
        g.next === 2 ? 2 : 1,
        g.winner as 0 | 1 | 2 | 3,
        g.move_count,
        txHash,
        ledgerLatencyMs,
      );
      const after = engine.get(req.params.id);
      return reply.status(200).send({
        board: after.board,
        next: after.next,
        winner: after.winner,
        txHash,
        ledgerLatencyMs,
      });
    },
  );

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: "not found" });
  });

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const message = err instanceof Error ? err.message : "internal error";
    reply.status(status).send({ error: message });
  });

  return app;
}
