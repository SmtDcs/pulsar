"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  attachL1,
  closeMatch,
  explorerTxUrl,
  getMatch,
  pulsarMove,
  settleMatch,
  shortKey,
  type MatchInfo,
} from "@/lib/api";
import { closeSession, createGame, fundAddress, playMove } from "@/lib/chain";
import { ensureWallet, walletAddress } from "@/lib/wallet";

const IDENTITY_KEY = "pulsar-identity";
const NO_TURN: 1 | 2 | 0 = 0;

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
  const [closing, setClosing] = useState(false);
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
  const myWallet = match ? ensureWallet(identity).publicKey() : null;
  const iAm =
    match && myWallet === match.playerA ? "A" : match && myWallet === match.playerB ? "B" : null;
  const myTurn =
    match != null &&
    match.status === "open" &&
    match.winner === 0 &&
    match.next === (iAm === "A" ? 1 : 2);

  // v2: player A's browser creates the on-chain L1 game with its own wallet,
  // then attaches the game id to the sequencer shell.
  useEffect(() => {
    if (!match || match.mode !== "l1" || match.gameId || l1CreateTried.current) return;
    if (iAm !== "A") return; // only the player who signs create_game does it
    l1CreateTried.current = true;
    setCreatingL1(true);
    setBanner({ kind: "waiting", text: "funding + signing create_game with your wallet (SlowTicTacToe)…" });
    const walletA = ensureWallet("A");
    const fund = (addr: string) => fundAddress(addr).catch(() => false);
    Promise.all([fund(match.playerA), fund(match.playerB)])
      .catch(() => undefined)
      .then(() => createGame(walletA, match.playerA, match.playerB))
      .then(async ({ id, txHash }) => {
        if (!alive.current) return;
        await attachL1(matchId, id, txHash);
        setBanner({ kind: "ok", text: "game created on-chain — A moves first" });
        void refresh();
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
  }, [match, matchId, refresh, iAm]);

  const onCell = async (cell: number) => {
    if (!match || !iAm || busyCell !== null) return;
    if (match.mode === "l1" && !match.gameId) {
      setBanner({ kind: "err", text: "L1 game not created yet" });
      return;
    }
    setBusyCell(cell);
    setBanner(null);
    try {
      if (match.mode === "pulsar") {
        setBanner({ kind: "waiting", text: "ensuring your wallet is funded…" });
        await fundAddress(match.playerA === myWallet ? match.playerA : match.playerB).catch(() => false);
        setBanner(null);
        const r = await pulsarMove(matchId, match.playerA === myWallet ? match.playerA : match.playerB, cell);
        setMatch((prev) =>
          prev
            ? { ...prev, board: r.board, next: r.next, winner: r.winner, lastMoveMs: r.lastMoveMs ?? prev.lastMoveMs }
            : prev,
        );
      } else {
        // v2: L1 moves are signed HERE with the current player's wallet and
        // submitted straight to the Testnet RPC; the poll mirrors chain state.
        setBanner({ kind: "waiting", text: "funding + signing play with your wallet — waiting for a Testnet ledger close (~5s)…" });
        await fundAddress(match.playerA === myWallet ? match.playerA : match.playerB).catch(() => false);
        const t0 = performance.now();
        const { txHash } = await playMove(ensureWallet(identity), match.gameId!, cell);
        const ledgerLatencyMs = Math.round(performance.now() - t0);
        await refresh();
        const after = (await getMatch(matchId)).txHashes;
        setMatch((prev) =>
          prev
            ? {
                ...prev,
                txHashes: txHash && !after.includes(txHash) ? [...after, txHash] : after,
                lastMoveMs: ledgerLatencyMs,
              }
            : prev,
        );
        setBanner({ kind: "ok", text: `move confirmed on ledger in ${ledgerLatencyMs} ms` });
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

  const onClose = async () => {
    if (!match || !iAm || !match.sessionId) return;
    setClosing(true);
    setBanner({ kind: "waiting", text: "signing close with your wallet (SessionRegistry.close)…" });
    try {
      const caller = match.playerA === myWallet ? match.playerA : match.playerB;
      await fundAddress(caller).catch(() => false);
      const { txHash } = await closeSession(ensureWallet(identity), caller, match.sessionId);
      await closeMatch(matchId, caller, txHash);
      setBanner({ kind: "ok", text: `session closed on ledger ✅ tx ${txHash}` });
      await refresh();
    } catch (e) {
      setBanner({ kind: "err", text: (e as Error).message });
    } finally {
      setClosing(false);
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
    match.mode === "pulsar" &&
    match.status === "open" &&
    match.winner !== 0 &&
    !settling &&
    iAm === "A";

  const canClose =
    match.mode === "pulsar" && match.status === "settled" && !closing && iAm !== null;

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
              <span className="you">you play as (your wallet)</span>
              <select
                value={identity}
                onChange={(e) => setIdentity(e.target.value as "A" | "B")}
                style={{ width: "auto" }}
              >
                <option value="A">A · ✕ · {shortKey(walletAddress("A"))}</option>
                <option value="B">B · ◯ · {shortKey(walletAddress("B"))}</option>
              </select>
            </div>
            {iAm === null && (
              <div className="banner err">
                this browser does not hold a wallet for either player of this match
              </div>
            )}

            {canSettle && (
              <button className="primary" onClick={onSettle} disabled={settling}>
                {settling ? "settling…" : "Settle on Stellar (1 tx)"}
              </button>
            )}
            {canClose && (
              <button className="ghost" onClick={onClose} disabled={closing}>
                {closing ? "closing…" : "Close session (sign with your key)"}
              </button>
            )}
            {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}
            {match.mode === "l1" && match.gameId === null && !creatingL1 && (
              <div className="banner waiting">waiting for player A to create the on-chain game…</div>
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
            {match.mode === "pulsar" && (
              <div className="stat">
                <div className="k">state commits</div>
                <div className="v">
                  {match.commitsCount}
                  {match.commitInFlight ? " (pin in flight…)" : ""}
                </div>
              </div>
            )}
            {match.mode === "pulsar" && match.lastCommitTxHash && (
              <div className="stat" style={{ maxWidth: "100%" }}>
                <div className="k">last commit</div>
                <div className="v" style={{ overflowWrap: "anywhere" }}>
                  <a href={explorerTxUrl(match.lastCommitTxHash)} target="_blank" rel="noreferrer">
                    {shortKey(match.lastCommitTxHash, 8, 8)}
                  </a>
                  {match.lastCommitStateHashHex && (
                    <div className="muted" style={{ fontSize: 10 }}>
                      {match.lastCommitStateHashHex.slice(0, 24)}…
                    </div>
                  )}
                </div>
              </div>
            )}
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
          ? "pulsar: moves are sequencer-side; state is pinned on-chain every few moves (commit) and the settle tx lands the final board on Stellar."
          : "l1: every move is signed in your browser and is already on-chain — see the tx list above."}{" "}
        · player keys never leave this browser.
      </footer>
    </main>
  );
}
