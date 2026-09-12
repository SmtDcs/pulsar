# Pulsar v0

Pulsar is a Stellar Testnet prototype for instant game moves. Every move is handled by a sequencer in milliseconds, and a single `settle` transaction writes the final result to the chain.

Tic-tac-toe is the demo game. Run the same game in two modes and feel the difference:

- **Pulsar mode** — moves go over HTTP to a sequencer (~0.1 ms each). One `SessionRegistry.settle` call at the end writes the final board and winner to Stellar.
- **L1 mode** — every move is a Soroban transaction on `SlowTicTacToe`, so each one waits for a real Testnet ledger close (~5 s).

The contrast is the point. Stellar closes a ledger roughly every 5 seconds, which is fine for payments and unusable for interactive apps. Pulsar borrows the idea from Solana's MagicBlock: run the session off-chain, settle the result on L1.

Why build this here: MagicBlock proved the model on Solana. Stellar has all the pieces Soroban contracts need for it — contract auth, fee-bumping, fast finality — but nobody has put them together yet. The aim is to be to Stellar what MagicBlock is to Solana. v0 is the tic-tac-toe proof of that idea; the trust layer that turns it into a platform is v1–v4 below.

It is a small, honest prototype. No L2, no token, no relayers, no fraud proofs — the sequencer is trusted in v0, and this README's trust model section says exactly what that means.

## Try it

Requirements: Node 22+, pnpm, Rust and [stellar-cli](https://github.com/stellar/stellar-cli/releases) 27.x on your PATH.

```bash
cp .env.example .env
node scripts/gen-keys.mjs   # 3 fresh Testnet keypairs, only if .env doesn't exist
pnpm install
./scripts/demo.sh
```

`demo.sh` funds those 3 accounts via Friendbot (if needed), deploys both contracts when there are no IDs in `.env` yet, then starts the sequencer and web app. Open two tabs at `http://localhost:3000`, create a match in one, copy the `/m/...` URL into the other, switch to player B, play.

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

`deploy.sh` writes the IDs into `.env` and `apps/web/.env.local`, and regenerates the TypeScript contract bindings in `packages/bindings/` (committed, so a reviewer doesn't need stellar-cli to run the demo).

## How it's built

```
contracts/session-registry   Soroban: session lifecycle (open / commit / settle / close / force_close)
contracts/slow-tictactoe     Soroban: on-chain tic-tac-toe for L1 mode
apps/sequencer               Fastify + TS: in-memory matches, chain transactions, latency measurement
apps/web                     Next.js: one-page UI, L1 vs Pulsar toggle, latency HUD
packages/shared              game rules + packed 12-byte result encoding + sha256 state hash
packages/bindings            generated TS clients for both contracts
scripts/                     gen-keys / fund / deploy / demo
```

The sequencer holds the operator key and, for this local demo only, the two player secrets from `.env`. It builds transactions with the operator as source account and satisfies each player's `require_auth` by signing the auth entries with their keys. All chain submissions go through a serial queue, since there's one source account.

## Tests

```bash
cd contracts/session-registry && cargo test   # 15 tests
cd contracts/slow-tictactoe && cargo test     # 11 tests
pnpm -r test                                  # shared + sequencer (vitest)
```

## Trust model

v0 is a trusted-sequencer prototype. The sequencer signs all chain traffic and could, in principle, settle a fabricated result. The only protection a player has is `force_close` once `timeout_ledgers` passes. The demo player secrets live in `.env` and are used by the sequencer to authorize moves — fine for a Testnet toy, irresponsible near real funds, so no mainnet keys, ever.

What's deliberately missing: fraud proofs, player-signed auth, ZK. Those are v1–v4, noted below.

## Where this goes next

> v1: commit every N moves on-chain. v2: player-signed auth entries, no secrets on sequencer. v3: optimistic challenge / WASM replay. v4: ZK settle (X-Ray).

## More

- [DEMO.md](./DEMO.md) — a 10-minute reviewer script
- The grant pitch lives outside the repo (talk to the author for it)