# DEMO — Pulsar reviewer script (~10 minutes)

What you are showing: the **same tic-tac-toe UI** in two modes. L1 mode
pays a Soroban transaction (and a ~5 s ledger wait) for every move —
signed **in the browser**, with a player key that never leaves the
machine. Pulsar mode plays on the sequencer in milliseconds, pins the
state on-chain every N moves, and pays **one** transaction at the end.
Everything runs on **Stellar Testnet**.

## 0. Setup (once, ~3 min)

```bash
./scripts/demo.sh
```

The script:

1. installs dependencies,
2. generates one Testnet operator keypair into `.env` if missing,
3. funds it via Friendbot,
4. deploys `SessionRegistry` + `SlowTicTacToe` if contract IDs are missing,
5. starts the sequencer and the web UI and prints the URLs.

Defaults: web at `http://localhost:3000`, sequencer at
`http://localhost:8787`. If a port is taken, set `WEB_PORT` / `PORT` in
`.env` first — the script prints the actual URLs it is serving on.

Keep the terminal open (Ctrl-C stops both services). Contract IDs are in
`.env`; every tx links to stellar.expert from the UI.

**v2 key note:** each browser generates its own player keypair on first
visit (stored in localStorage only). Player-authorized on-chain
operations (`open_session`, `create_game`, `play`, `close`) are signed in
the browser and submitted straight to the Testnet RPC. The sequencer only
holds the operator key.

## 1. Pulsar match (the point of the project) — ~3 min

1. Open `http://localhost:3000` in **two windows** (or tabs).
2. Window 1: select the **Pulsar (ms)** tile, click **Create Pulsar match**.
   - The browser creates + funds its wallet, signs `open_session` on-chain,
     and lands you on `/m/{matchId}`.
3. Window 2: open the same URL (copy it over), switch the dropdown to
   "you play as **B**" (window 2 has its own wallet key).
4. Play a full game, alternating windows.
   - Point at the HUD: **last move latency** shows single-digit **milliseconds**.
   - Watch **state commits** climb: every N moves a `commit` tx pins the
     current state hash on-chain (tx link in the HUD).
5. Finish the game (say A wins). Click **Settle on Stellar (1 tx)**.
   - After a few seconds the UI shows **"settled on ledger ✅ — winner A (✕)"**
     with a link to `https://stellar.expert/explorer/testnet/tx/{hash}`.
   - Open the link: the `SessionSettled` event / contract data carries the
     12-byte result (version, winner, board, move count) and its sha256 state hash.
6. Optionally: click **Close session (sign with your key)** — the browser
   signs `SessionRegistry.close` and the HUD status becomes `closed`.
7. Transaction count for the match: open_session + a few commits + settle —
   the nine moves themselves never touched the chain.

## 2. L1 match (the honest baseline) — ~3 min

1. Back on `http://localhost:3000` (window 1), select the **L1 (~5s)** tile, click **Create L1 match**.
2. Window 2: same URL, play as B again.
3. Play a few moves; **feel the difference**: every click is signed in the
   browser and submitted to `SlowTicTacToe` directly, and the UI shows
   "waiting for a Testnet ledger close (~5 s)…".
4. Point at the HUD: **last move latency** now reads ~**5000 ms**, vs the
   millisecond values from the Pulsar match.
5. The tx list grows by one per move — every move is already on-chain here.

## 3. What to say while pointing at the screen

- "Pulsar is not an L2: no fraud proofs, no relayer network, no token. A
  session is a Soroban contract (`SessionRegistry`) that locks two players
  to a sequencer; the sequencer can `commit` state hashes and `settle`, and
  players can `force_close` after a timeout."
- "Since v2 the sequencer holds **no player keys** — the browser signs
  `open_session`, `create_game`, `play` and `close` with keys that live in
  localStorage. The sequencer only holds its own operator key, used for the
  periodic `commit` pins and the final `settle`."
- "The settle tx costs the same as one L1 move, but the whole game played
  at millisecond latency."

## 4. Troubleshooting

- **Sequencer unreachable** — check `http://localhost:8787/health`; logs are in `/tmp/pulsar-sequencer.log`.
- **"Account not found" on first on-chain op** — the browser funds its own
  wallet via /fund; if that failed (Friendbot hiccup), click Create again.
- **L1 move fails** — Testnet RPC hiccups happen; retry the move (the
  account sequence is refetched automatically).
- **"match not found"** — the sequencer keeps matches in memory; if you
  restarted it, create a new match (sessions on-chain are unaffected).