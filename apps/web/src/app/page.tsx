"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createMatch,
  getHealth,
  shortKey,
  type HealthInfo,
  type Mode,
} from "@/lib/api";

const IDENTITY_KEY = "pulsar-identity";

export default function HomePage() {
  const router = useRouter();
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("pulsar");
  const [identity, setIdentity] = useState<"A" | "B">("A");
  const [busy, setBusy] = useState(false);
  const [joinId, setJoinId] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(IDENTITY_KEY);
    if (stored === "A" || stored === "B") setIdentity(stored);
    getHealth()
      .then(setHealth)
      .catch((e: Error) => setError(`sequencer unreachable: ${e.message}`));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(IDENTITY_KEY, identity);
  }, [identity]);

  const create = async () => {
    if (!health) return;
    setBusy(true);
    setError(null);
    try {
      const m = await createMatch({
        mode,
        playerA: health.playerA,
        playerB: health.playerB,
      });
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
                <option value="A">A · X · {shortKey(health?.playerA ?? "")} (first)</option>
                <option value="B">B · O · {shortKey(health?.playerB ?? "")}</option>
              </select>
            </div>

            <button className="primary" onClick={create} disabled={busy || !health}>
              {busy
                ? mode === "pulsar"
                  ? "opening session on-chain…"
                  : "creating match…"
                : mode === "pulsar"
                  ? "Create Pulsar match"
                  : "Create L1 match"}
            </button>

            <div className="row">
              <input
                type="text"
                placeholder="match id (e.g. 42 or l1-…)"
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
              sequencer — <b>lastMoveMs</b> shows the latency. One <code>settle</code> tx writes
              the final board + winner to <code>SessionRegistry</code>.
            </li>
            <li>
              <b style={{ color: "var(--l1)" }}>L1</b>: each move is a Soroban transaction on{" "}
              <code>SlowTicTacToe</code> and waits ~5s for a ledger close. Same UI, honest slowness.
            </li>
          </ul>
          <p style={{ marginTop: 14, color: "var(--muted)", fontSize: 12, fontFamily: "var(--mono)" }}>
            Trusted-sequencer prototype: the operator signs chain traffic and holds the demo player
            keys. Testnet only, no real funds.
          </p>
        </section>
      </div>

      <footer className="footer-note">
        Pulsar v0 — Instaward prototype. Sequencer: http://localhost:8787 · Explorer:{" "}
        <a href="https://stellar.expert/explorer/testnet" target="_blank" rel="noreferrer">
          stellar.expert/testnet
        </a>
      </footer>
    </main>
  );
}
