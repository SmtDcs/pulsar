# Pulsar v2

Pulsar is a Stellar Testnet prototype for instant game moves. Every move is handled by a sequencer in milliseconds, and a single `settle` transaction writes the final result to the chain.

Tic-tac-toe is the demo game. Run the same game in two modes and feel the difference:

- **Pulsar mode** — moves go over HTTP to a sequencer (~0.1 ms each). The sequencer pins the state on-chain every N moves (`SessionRegistry.commit`), and one `settle` call at the end writes the final board and winner to Stellar.
- **L1 mode** — every move is a Soroban transaction on `SlowTicTacToe`, signed **in your browser** and sent straight to the RPC, so each move waits for a real Testnet ledger close (~5 s).

The contrast is the point. Stellar closes a ledger roughly every 5 seconds, which is fine for payments and unusable for interactive apps. Pulsar borrows the idea from Solana's MagicBlock: run the session off-chain, settle the result on L1.

Why build this here: MagicBlock proved the model on Solana. Stellar has all the pieces Soroban contracts need for it — contract auth, fee-bumping, fast finality — but nobody has put them together yet. The aim is to be to Stellar what MagicBlock is to Solana. v2 is the tic-tac-toe proof of that idea; the remaining trust work is v3–v4 below.

It is a small, honest prototype. No L2, no token, no relayers, no fraud proofs — but since v2 the sequencer no longer holds any player secret; every player-authorized on-chain operation is signed in the player's browser.

## Try it

Requirements: Node 22+, pnpm, Rust and [stellar-cli](https://github.com/stellar/stellar-cli/releases) 27.x on your PATH.

```bash
cp .env.example .env
node scripts/gen-keys.mjs   # one fresh Testnet operator keypair, only if .env doesn't exist
pnpm install
./scripts/demo.sh
```

`demo.sh` funds the operator account via Friendbot (if needed), deploys both contracts when there are no IDs in `.env` yet, then starts the sequencer and web app. Open two tabs at `http://localhost:3000`, create a match in one, copy the `/m/...` URL into the other, and play. **Each browser generates its own player keypair** (stored in localStorage) and signs its own on-chain ops — the sequencer only ever sees public keys.

If a port is already taken, set `WEB_PORT` / `PORT` in `.env`.

Deploy without the demo runner:

```bash
./scripts/fund.sh
./scripts/deploy.sh
```

## Contracts (Stellar Testnet)

| Contract | ID | What it does |
|---|---|---|
| SessionRegistry | `CDVG3ZYPHW5AJOWZHLZDW6XBUDR3WGYSIT34YDPBDCW5TUAII72WR4JH` | opens a session, locks it to the sequencer, commits state hashes, settles the result, lets players force-close after a timeout |
| SlowTicTacToe | `CCCR4BS4XH7VQ6MP2PNDPPUWMTESFEF4TW65ZDNQ73O7PKOI6EHCX556` | the fully on-chain tic-tac-toe game used by L1 mode |

`deploy.sh` writes the IDs into `.env`, and regenerates the TypeScript contract bindings in `packages/bindings/` (committed, so a reviewer doesn't need stellar-cli to run the demo).

## How it's built

```
contracts/session-registry   Soroban: session lifecycle (open / commit / settle / close / force_close)
contracts/slow-tictactoe     Soroban: on-chain tic-tac-toe for L1 mode
apps/sequencer               Fastify + TS: in-memory matches, operator-signed commit/settle, latency
apps/web                     Next.js: one-page UI, browser wallets, L1 vs Pulsar toggle, latency HUD
packages/shared              game rules + packed 12-byte result encoding + sha256 state hash
packages/bindings            generated TS clients for both contracts (browser-safe)
scripts/                     gen-keys / fund / deploy / demo
```

**v2 key custody.** Player keys are generated in the browser (`apps/web/src/lib/wallet.ts`), stored only in localStorage, and **never** sent to the sequencer. Player-authorized operations (`open_session`, `create_game`, `play`, `close`) are built with the generated bindings in the browser, signed with the player's keypair, and submitted directly to the Testnet RPC (which is CORS-open). The sequencer holds only the operator key, which it uses to authorize its own `commit` and `settle` transactions. All operator submissions go through a serial queue, since there's one source account.

## Tests

```bash
cd contracts/session-registry && cargo test   # 15 tests
cd contracts/slow-tictactoe && cargo test     # 11 tests
pnpm -r test                                  # shared + sequencer (vitest)
```

## Trust model

Since v2 the sequencer cannot sign as a player: the only keys it holds are the operator's. Players sign their own on-chain ops in the browser. What the sequencer can still do is **refuse to submit** a move or **settle a session** — in Pulsar mode the final `settle` is operator-signed, so a malicious sequencer could in principle settle a fabricated final result. The protection a player has: `force_close` once `timeout_ledgers` passes, plus the public verified sessions history. This is a Testnet prototype — no mainnet keys, ever.

What's deliberately missing: optimistic fraud proofs / WASM replay, ZK. Those are v3–v4 below.

## Where this goes next

> v3: optimistic challenge / WASM replay — anyone can re-run the game from the committed state hashes and dispute a bad settle. v4: ZK settle (X-Ray) — prove the result in a single compact proof instead of replaying.

## More

- [DEMO.md](./DEMO.md) — a 10-minute reviewer script
- The grant pitch lives outside the repo (talk to the author for it)