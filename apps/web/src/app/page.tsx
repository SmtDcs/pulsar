"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  attachMatch,
  createMatch,
  getHealth,
  shortKey,
  type HealthInfo,
  type Mode,
} from "@/lib/api";
import { fundAddress, openSession } from "@/lib/chain";
import { ensureWallet, walletAddress } from "@/lib/wallet";

const IDENTITY_KEY = "pulsar-identity";

export default function HomePage() {
  const router = useRouter();
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("pulsar");
  const [identity, setIdentity] = useState<"A" | "B">("A");
  const [busy, setBusy] = useState(false);
  const [joinId, setJoinId] = useState("");
  const [addresses, setAddresses] = useState({ a: "", b: "" });

  useEffect(() => {
    const stored = window.localStorage.getItem(IDENTITY_KEY);
    if (stored === "A" || stored === "B") setIdentity(stored);
    getHealth()
      .then(setHealth)
      .catch((e: Error) => setError(`sequencer unreachable: ${e.message}`));
    // v2: generate + persist both player wallets in this browser on first use.
    setAddresses({ a: walletAddress("A"), b: walletAddress("B") });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(IDENTITY_KEY, identity);
  }, [identity]);

  const create = async () => {
    if (!health) return;
    setBusy(true);
    setError(null);
    try {
      // Shell first, then player A's browser opens the on-chain session and
      // attaches it. The sequencer verifies the session before binding.
      const m = await createMatch({
        mode,
        playerA: addresses.a,
        playerB: addresses.b,
        timeoutLedgers: health.defaultTimeoutLedgers,
      });
      if (mode === "pulsar") {
        const walletA = ensureWallet("A");
        // v2: browser-generated keys are unknown to the network until funded.
        // The sequencer proxies the Testnet Friendbot faucet (never mainnet).
        const fund = async (addr: string) => {
          if (!(await fundAddress(addr))) {
            // Friendbot "already exists"/snag — the account may already exist.
            // Don't block the demo on it; open_session will fail loudly if truly stuck.
          }
        };
        await fund(addresses.a);
        await fund(addresses.b);
        const { id, txHash } = await openSession(
          walletA,
          addresses.a,
          addresses.b,
          health.defaultTimeoutLedgers,
        );
        await attachMatch(m.matchId, id, txHash);
      }
      router.push(`/m/${m.matchId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <h1>
            Pulsar<span className="dot">●</span>
          </h1>
          <small>instant moves · final result on Stellar</small>
        </div>
        <span className="net">testnet · ledger {health?.ledger ?? "…"}</span>
      </header>

      {error && (
        <div className="banner err" style={{ marginBottom: 16 }}>
          {error}
          <div className="muted">
            Start the demo first: <code>./scripts/demo.sh</code>
          </div>
        </div>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>New match</h2>
          <div className="stack">
            <div className="mode-toggle">
              <button
                className="mode-option"
                data-mode="pulsar"
                data-selected={mode === "pulsar"}
                onClick={() => setMode("pulsar")}
                type="button"
              >
                <span className="mode-name">Pulsar (ms)</span>
                <span className="mode-sub">sequencer moves · one settle tx at the end</span>
              </button>
              <button
                className="mode-option"
                data-mode="l1"
                data-selected={mode === "l1"}
                onClick={() => setMode("l1")}
                type="button"
              >
                <span className="mode-name">L1 (~5s)</span>
                <span className="mode-sub">every move is a Soroban tx · waits for a ledger</span>
              </button>
            </div>

            <div className="identity">
              <span className="you">play as</span>
              <select
                value={identity}
                onChange={(e) => setIdentity(e.target.value as "A" | "B")}
                style={{ flex: 1 }}
              >
                <option value="A">A · X · {shortKey(addresses.a)} (first)</option>
                <option value="B">B · O · {shortKey(addresses.b)}</option>
              </select>
            </div>

            <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
              <b>v2 — keys live in this browser.</b> The on-chain open for this match is
              signed here with player A&apos;s wallet and submitted straight to the Testnet
              RPC. The sequencer only sees public keys — it cannot act as a player.
            </div>

            <button className="primary" onClick={create} disabled={busy || !health}>
              {busy
                ? mode === "pulsar"
                  ? "opening session with your key…"
                  : "creating match…"
                : mode === "pulsar"
                  ? "Create Pulsar match"
                  : "Create L1 match"}
            </button>

            <div className="row">
              <input
                type="text"
                placeholder="match id (e.g. p-… or l1-…)"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value.trim())}
              />
              <button
                className="ghost"
                disabled={!joinId}
                onClick={() => router.push(`/m/${joinId}`)}
                type="button"
              >
                Join
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>How this demo works</h2>
          <ul style={{ lineHeight: 2, color: "var(--muted)", fontSize: 14, paddingLeft: 18 }}>
            <li>
              <b style={{ color: "var(--pulsar)" }}>Pulsar</b>: each move is an HTTP call to the
              sequencer — <b>lastMoveMs</b> shows the latency. Every{" "}
              {health?.commitEveryMoves ?? "—"} moves the state is pinned on-chain (
              <code>commit</code>), and one <code>settle</code> tx writes the final board +
              winner to <code>SessionRegistry</code>.
            </li>
            <li>
              <b style={{ color: "var(--l1)" }}>L1</b>: each move is a Soroban transaction on{" "}
              <code>SlowTicTacToe</code> and waits ~5s for a ledger close — submitted from
              this browser with your own key. Same UI, honest slowness.
            </li>
          </ul>
          <p style={{ marginTop: 14, color: "var(--muted)", fontSize: 12, fontFamily: "var(--mono)" }}>
            wallets: A {shortKey(addresses.a)} · B {shortKey(addresses.b)} — secrets stay in
            localStorage, never on the sequencer.
          </p>
        </section>
      </div>

      <footer className="footer-note">
        Pulsar — Instaward prototype. Sequencer:{" "}
        {process.env.NEXT_PUBLIC_SEQUENCER_URL ?? "http://localhost:8787"} · Explorer:{" "}
        <a href="https://stellar.expert/explorer/testnet" target="_blank" rel="noreferrer">
          stellar.expert/testnet
        </a>
      </footer>
    </main>
  );
}
