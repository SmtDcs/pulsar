/**
 * Pulsar sequencer — HTTP API.
 *
 * Pulsar mode: moves are applied to the in-memory engine (target < 50 ms);
 * the sequencer pins state on-chain every N moves (SessionRegistry.commit)
 * and one `settle` transaction lands the final result.
 * L1 mode: every move is a real Soroban transaction against
 * `SlowTicTacToe` and waits for a ledger close (~5 s) — moves are submitted
 * by the players' browsers directly; this server only mirrors chain state.
 *
 * v2 trust model: the sequencer holds NO player secrets. Player-authorized
 * operations (`open_session`, `create_game`, `play`, `close`) are signed in
 * the player's browser and submitted straight to the Testnet RPC. The
 * sequencer's operator key only authorizes its own `commit` and `settle`.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { performance } from "node:perf_hooks";
import { toHex } from "@pulsar/shared";
import { MatchEngine, type Match } from "./engine.js";
import {
  chainGetLedger,
  chainGetSession,
  chainSettle,
  chainCommit,
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
    commitsCount: m.commitsCount,
    commitInFlight: m.commitInFlight,
    lastCommitTxHash: m.lastCommitTxHash ?? null,
    lastCommitStateHashHex: m.lastCommitStateHashHex ?? null,
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
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      horizonUrl: config.horizonUrl,
      sessionRegistryId: config.sessionRegistryId,
      slowTicTacToeId: config.slowTicTacToeId || null,
      commitEveryMoves: config.commitEveryMoves,
      defaultTimeoutLedgers: config.defaultTimeoutLedgers,
    };
  });

  /**
   * v2: the player's browser generates its own keypair. Testnet accounts need
   * a small XLM balance to pay Soroban fees, so the sequencer proxies the
   * Friendbot faucet. This is a demo convenience call, never mainnet.
   */
  app.post<{ Body: { address: string } }>("/fund", async (req, reply) => {
    const address = req.body?.address;
    if (!address?.startsWith("G") || address.length !== 56) {
      return reply.status(400).send({ error: "address must be a G... Stellar public key" });
    }
    try {
      const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
      const json = (await res.json().catch(() => ({}))) as { hash?: string; problem?: string };
      if (!res.ok) {
        return reply.status(400).send({ error: json.problem ?? `friendbot failed (${res.status})` });
      }
      return reply.status(200).send({ hash: json.hash ?? "", funded: true });
    } catch (err) {
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  /**
   * Create a match.
   *  - mode "pulsar" (default): creates an in-memory shell; the player's
   *    browser opens SessionRegistry.open_session (signed with its own key)
   *    and calls POST /matches/:id/attach.
   *  - mode "l1": create a shell now; the player's browser submits
   *    SlowTicTacToe.create_game and calls POST /matches/:id/l1/attach.
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

      // v2: the browser holds player A's key. This endpoint only creates an
      // in-memory shell; the player's browser submits SessionRegistry.open_session
      // (signed with their own key) and then calls POST /matches/:id/attach.
      const matchId = `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const m = engine.createPulsar(matchId, playerA, playerB, timeoutLedgers);
      return reply.status(201).send(publicMatch(m));
    },
  );

  /**
   * v2: player A's browser opened SessionRegistry.open_session with its own
   * key. This endpoint verifies the on-chain session (players must match the
   * shell, and the contract operator must be the sequencer) and attaches it.
   */
  app.post<{ Params: { id: string }; Body: { sessionId: string; txHash?: string } }>(
    "/matches/:id/attach",
    async (req, reply) => {
      const body = req.body ?? ({} as { sessionId?: string; txHash?: string });
      const sessionId = body.sessionId;
      if (!sessionId || !/^\d+$/.test(sessionId)) {
        return reply.status(400).send({ error: "sessionId must be a decimal string" });
      }
      try {
        const m = engine.get(req.params.id);
        if (m.mode !== "pulsar") throw new Error("not a Pulsar match");
        if (m.sessionId) throw new Error(`session already attached: ${m.sessionId}`);
        // Verify against the ledger before trusting the browser:
        // the session must be bound to THIS match's two players and the
        // contract's operator must be the sequencer's operator.
        const s = await chainGetSession(sessionId);
        if (s.player_a !== m.playerA || s.player_b !== m.playerB) {
          throw new Error("session players do not match the match shell");
        }
        if (s.sequencer !== config.operatorPublic) {
          throw new Error("session sequencer is not this sequencer's operator");
        }
        if (s.status !== 1) throw new Error("session is not Open");
        engine.attachSession(req.params.id, sessionId, body.txHash);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      return reply.status(200).send(publicMatch(engine.get(req.params.id)));
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
      // v1: pin state on-chain every `commitEveryMoves` moves. Submissions are
      // serialized inside chainCommit; players never sign, operator key only.
      if (engine.commitDue(req.params.id, config.commitEveryMoves)) {
        const payload = engine.commitPayload(req.params.id);
        engine.markCommitSubmitted(req.params.id);
        const matchId = req.params.id;
        void chainCommit(m.sessionId!, payload.nonce, payload.stateHash)
          .then(({ txHash }) => {
            engine.markCommitConfirmed(matchId, txHash, toHex(payload.stateHash));
          })
          .catch((err) => {
            req.log.warn({ err }, "commit tx failed");
            engine.markCommitFailed(matchId);
          });
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

  /**
   * v2: a player closed the settled session in the contract with their own
   * browser key (SessionRegistry.close). The sequencer just reflects the
   * already-on-chain status in the in-memory match record.
   */
  app.post<{ Params: { id: string }; Body: { caller: string; txHash?: string } }>(
    "/matches/:id/close",
    async (req, reply) => {
      const body = req.body ?? ({} as { caller?: string; txHash?: string });
      const caller = body.caller;
      let m: Match;
      try {
        m = engine.get(req.params.id);
        if (m.mode !== "pulsar") throw new Error("not a Pulsar match");
        if (m.status !== "settled") throw new Error("only a settled session can be closed");
        if (!caller?.startsWith("G") || (caller !== m.playerA && caller !== m.playerB)) {
          throw new Error("caller must be player A or B");
        }
        if (body.txHash && !m.txHashes.includes(body.txHash)) m.txHashes.push(body.txHash);
        m.status = "closed";
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      return reply.status(200).send(publicMatch(m));
    },
  );

  app.post<{ Params: { id: string }; Body: { gameId: string; txHash?: string } }>(
    "/matches/:id/l1/attach",
    async (req, reply) => {
      const body = req.body ?? ({} as { gameId?: string; txHash?: string });
      const gameId = body.gameId;
      if (!gameId || !/^\d+$/.test(gameId)) {
        return reply.status(400).send({ error: "gameId must be a decimal string" });
      }
      let m: Match;
      try {
        m = engine.get(req.params.id);
        if (m.mode !== "l1") throw new Error("not an L1 match");
        engine.attachL1Game(req.params.id, gameId, body.txHash);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      // Read the authoritative on-chain state back so the shell is in sync.
      try {
        const g = await chainGetGame(gameId);
        m = engine.syncL1(
          req.params.id,
          g.board as Match["board"],
          g.next === 2 ? 2 : 1,
          g.winner as 0 | 1 | 2 | 3,
          g.move_count,
          body.txHash ?? "",
          -1,
        );
      } catch (err) {
        req.log.warn({ err }, "failed to read L1 game after attach");
      }
      return reply.status(200).send(publicMatch(engine.get(req.params.id)));
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
