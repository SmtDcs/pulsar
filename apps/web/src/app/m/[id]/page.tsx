"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  createL1Game,
  explorerTxUrl,
  getMatch,
  l1Move,
  pulsarMove,
  settleMatch,
  shortKey,
  type MatchInfo,
} from "@/lib/api";

const IDENTITY_KEY = "pulsar-identity";

type Banner =
  | { kind: "ok"; text: string }
  | { kind: "err"; text: string }
  | { kind: "waiting"; text: string }
  | null;

export default function MatchPage() {
  const params = useParams<{ id: string }>();
  const matchId = params.id;

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [identity, setIdentity] = useState<"A" | "B">("A");
  const [banner, setBanner] = useState<Banner>(null);
  const [busyCell, setBusyCell] = useState<number | null>(null);
  const [settling, setSettling] = useState(false);
  const [creatingL1, setCreatingL1] = useState(false);
  const l1CreateTried = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const stored = window.localStorage.getItem(IDENTITY_KEY);
    if (stored === "A" || stored === "B") setIdentity(stored);
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(IDENTITY_KEY, identity);
  }, [identity]);

  const refresh = useCallback(async () => {
    try {
      const m = await getMatch(matchId);
      if (alive.current) setMatch(m);
      return m;
    } catch (e) {
      if (alive.current) {
        setBanner({ kind: "err", text: (e as Error).message });
      }
      return null;
    }
  }, [matchId]);

  // Poll the sequencer every 500ms — this is how the "other tab" is seen.
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 500);
    return () => clearInterval(t);
  }, [refresh]);

  const me = identity === "A" ? match?.playerA : match?.playerB;
  const myTurn = match != null && match.status === "open" && match.winner === 0 && match.next === (identity === "A" ? 1 : 2);

  // Auto-create the on-chain L1 game once the shell exists.
  useEffect(() => {
    if (!match || match.mode !== "l1" || match.gameId || l1CreateTried.current) return;
    l1CreateTried.current = true;
    setCreatingL1(true);
    setBanner({ kind: "waiting", text: "creating on-chain game (SlowTicTacToe.create_game)…" });
    createL1Game(matchId, match.playerA, match.playerB)
      .then(() => {
        if (alive.current) {
          setBanner({ kind: "ok", text: "game created on-chain — A moves first" });
          void refresh();
        }
      })
      .catch((e: Error) => {
        if (alive.current) {
          setBanner({ kind: "err", text: `L1 create failed: ${e.message}` });
          l1CreateTried.current = false; // allow retry
        }
      })
      .finally(() => {
        if (alive.current) setCreatingL1(false);
      });
  }, [match, matchId, refresh]);

  const onCell = async (cell: number) => {
    if (!match || !me || busyCell !== null) return;
    setBusyCell(cell);
    setBanner(null);
    try {
      if (match.mode === "pulsar") {
        const r = await pulsarMove(matchId, me, cell);
        setMatch((prev) =>
          prev
            ? { ...prev, board: r.board, next: r.next, winner: r.winner, lastMoveMs: r.lastMoveMs ?? prev.lastMoveMs }
            : prev,
        );
      } else {
        setBanner({ kind: "waiting", text: `move submitted — waiting for a Testnet ledger close (~5s)…` });
        const r = await l1Move(matchId, me, cell);
        setMatch((prev) =>
          prev
            ? {
                ...prev,
                board: r.board,
                next: r.next,
                winner: r.winner,
                txHashes: r.txHash ? [...prev.txHashes, r.txHash] : prev.txHashes,
                lastMoveMs: r.ledgerLatencyMs ?? prev.lastMoveMs,
              }
            : prev,
        );
        setBanner({ kind: "ok", text: `move confirmed on ledger in ${r.ledgerLatencyMs} ms` });
      }
    } catch (e) {
      setBanner({ kind: "err", text: (e as Error).message });
      void refresh();
    } finally {
      setBusyCell(null);
    }
  };

  const onSettle = async () => {
    setSettling(true);
    setBanner({ kind: "waiting", text: "settling on Stellar Testnet — submitting tx…" });
    try {
      const r = await settleMatch(matchId);
      setBanner({ kind: "ok", text: `settled on ledger ✅ tx ${r.txHash}` });
      await refresh();
    } catch (e) {
      setBanner({ kind: "err", text: (e as Error).message });
      await refresh();
    } finally {
      setSettling(false);
    }
  };

  const winnerText = useMemo(() => {
    if (!match || match.winner === 0) return null;
    if (match.winner === 3) return "Draw";
    return `${match.winner === 1 ? "A (X)" : "B (O)"} wins`;
  }, [match]);

  if (!match) {
    return (
      <main className="page">
        <header className="topbar">
          <div className="brand">
            <h1>
              Pulsar<span className="dot">●</span>
            </h1>
            <small>match {matchId}</small>
          </div>
        </header>
        <div className="banner waiting">
          <span className="spinner" />
          loading match…
        </div>
      </main>
    );
  }

  const canSettle =
    match.mode === "pulsar" && match.status === "open" && match.winner !== 0 && !settling;

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <h1>
            Pulsar<span className="dot">●</span>
          </h1>
          <small>
            <Link href="/">← all matches</Link> · match {match.matchId}
          </small>
        </div>
        <span className={`badge ${match.mode}`}>
          {match.mode === "pulsar" ? "pulsar (ms)" : "l1 (~5s)"}
        </span>
      </header>

      <div className="grid-2">
        <section className="panel" style={{ textAlign: "center" }}>
          <div className="row" style={{ justifyContent: "center", marginBottom: 8 }}>
            <span className={`badge ${match.mode}`}>
              {match.mode === "pulsar" ? "pulsar mode" : "l1 mode"}
            </span>
            <span className={`badge ${match.status}`}>{match.status}</span>
            {winnerText && <span className="badge settled">{winnerText}</span>}
          </div>

          <div className="board">
            {match.board.map((cell, i) => {
              const playable =
                myTurn &&
                cell === 0 &&
                busyCell === null &&
                match.winner === 0 &&
                match.status === "open" &&
                !creatingL1;
              const preview = playable && busyCell === i;
              return (
                <button
                  key={i}
                  className="cell"
                  disabled={!playable}
                  onClick={() => onCell(i)}
                  type="button"
                  aria-label={`cell ${i}`}
                >
                  {cell === 1 && <span className="x">✕</span>}
                  {cell === 2 && <span className="o">◯</span>}
                  {preview && (
                    <span className={identity === "A" ? "x preview" : "o preview"}>
                      {identity === "A" ? "✕" : "◯"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="turnline">
            {match.winner !== 0 ? (
              <b>{winnerText}</b>
            ) : match.status !== "open" ? (
              <b>match {match.status}</b>
            ) : (
              <>
                turn: <b>{match.next === 1 ? "A (✕)" : "B (◯)"}</b>
                {myTurn ? " — your move" : " — waiting for opponent"}
              </>
            )}
          </div>

          <div className="stack" style={{ marginTop: 14 }}>
            <div className="identity" style={{ justifyContent: "center" }}>
              <span className="you">you play as</span>
              <select
                value={identity}
                onChange={(e) => setIdentity(e.target.value as "A" | "B")}
                style={{ width: "auto" }}
              >
                <option value="A">A · ✕ · {shortKey(match.playerA)}</option>
                <option value="B">B · ◯ · {shortKey(match.playerB)}</option>
              </select>
            </div>

            {canSettle && (
              <button className="primary" onClick={onSettle} disabled={settling}>
                {settling ? "settling…" : "Settle on Stellar (1 tx)"}
              </button>
            )}
            {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}
            {match.mode === "l1" && match.gameId === null && !creatingL1 && (
              <div className="banner waiting">waiting for the on-chain game to be created…</div>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Hud</h2>
          <div className="hud">
            <div className="stat">
              <div className="k">mode</div>
              <div className={`v ${match.mode === "l1" ? "l1" : ""}`}>
                {match.mode === "pulsar" ? "Pulsar" : "L1"}
              </div>
            </div>
            <div className="stat">
              <div className="k">{match.mode === "pulsar" ? "session id" : "game id"}</div>
              <div className="v">
                {match.mode === "pulsar" ? match.sessionId : (match.gameId ?? "…")}
              </div>
            </div>
            <div className="stat">
              <div className="k">status</div>
              <div className="v">{match.status}</div>
            </div>
            <div className="stat">
              <div className="k">winner</div>
              <div className="v">{match.winner === 0 ? "—" : winnerText}</div>
            </div>
            <div className="stat">
              <div className="k">moves</div>
              <div className="v">{match.moveCount}</div>
            </div>
            <div className="stat">
              <div className="k">last move latency</div>
              <div className={`v big ${match.mode === "l1" ? "l1" : ""}`}>
                {match.lastMoveMs == null ? "—" : `${match.lastMoveMs} ms`}
              </div>
            </div>
          </div>

          {match.settleTxHash && (
            <div className="banner ok" style={{ marginTop: 12 }}>
              settled on ledger ✅ — winner{" "}
              {match.winner === 3 ? "draw" : match.winner === 1 ? "A (✕)" : "B (◯)"} ·{" "}
              <a href={explorerTxUrl(match.settleTxHash)} target="_blank" rel="noreferrer">
                {shortKey(match.settleTxHash, 8, 8)}
              </a>
              {match.resultHex && (
                <div className="muted" style={{ marginTop: 4 }}>
                  result: {match.resultHex}
                  <br />
                  state hash: {match.stateHashHex?.slice(0, 32)}…
                </div>
              )}
            </div>
          )}

          <div className="panel" style={{ marginTop: 16, marginBottom: 0 }}>
            <h2>Transactions ({match.txHashes.length})</h2>
            <div className="txlist">
              {match.txHashes.length === 0 && <span className="muted">no transactions yet</span>}
              {match.txHashes.map((h) => (
                <div key={h}>
                  <a href={explorerTxUrl(h)} target="_blank" rel="noreferrer">
                    {h}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <footer className="footer-note">
        {match.mode === "pulsar"
          ? "pulsar: moves are sequencer-side; the single settle tx lands the final board on-chain."
          : "l1: every move is already on-chain — see the tx list above."}{" "}
      </footer>
    </main>
  );
}
