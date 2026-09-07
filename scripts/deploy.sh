#!/usr/bin/env bash
# Build + deploy both contracts to Stellar Testnet with the OPERATOR key,
# initialize them, persist contract IDs in .env + apps/web/.env.local, and
# regenerate the TypeScript bindings in packages/bindings/.
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="$(pwd)"
export PATH="$HOME/bin:$PATH"

command -v stellar >/dev/null 2>&1 || { echo "stellar CLI not found (see README)"; exit 1; }
[ -f .env ] || { echo ".env missing — run: node scripts/gen-keys.mjs && ./scripts/fund.sh"; exit 1; }

# shellcheck disable=SC1091
source .env
: "${OPERATOR_SECRET:?OPERATOR_SECRET missing in .env}"
: "${OPERATOR_PUBLIC:?OPERATOR_PUBLIC missing in .env}"

# The stellar CLI picks up SOROBAN_RPC_URL from the environment (it is set by
# .env for the sequencer); when it does, it also demands the passphrase.
export STELLAR_NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE"
export STELLAR_NETWORK="testnet"

# --- register the operator key as a stellar-cli identity -------------------
IDENTITY_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/stellar/identity"
mkdir -p "$IDENTITY_DIR"
printf 'secret_key = "%s"\n' "$OPERATOR_SECRET" > "$IDENTITY_DIR/pulsar-operator.toml"
if [ "$(stellar keys public-key pulsar-operator)" != "$OPERATOR_PUBLIC" ]; then
  echo "OPERATOR_PUBLIC in .env does not match OPERATOR_SECRET"
  exit 1
fi
SOURCE=pulsar-operator
NETWORK=testnet

# --- build -------------------------------------------------------------------
echo "==> Building contracts (stellar contract build)..."
(cd contracts/session-registry && stellar contract build)
(cd contracts/slow-tictactoe && stellar contract build)

REGISTRY_WASM=contracts/session-registry/target/wasm32v1-none/release/session_registry.wasm
TTT_WASM=contracts/slow-tictactoe/target/wasm32v1-none/release/slow_tictactoe.wasm

deploy_one() { # $1 name, $2 wasm -> echoes the contract ID
  echo "==> Deploying $1..." >&2
  local out id
  # The CLI logs to stderr; the contract ID appears in the lab.stellar.org
  # URL line. Capture both streams and parse the strkey (C + 55 base32
  # chars — tx hashes are lowercase hex, accounts start with G).
  out=$(stellar contract deploy \
    --source-account "$SOURCE" \
    --network "$NETWORK" \
    --wasm "$2" \
    --ignore-checks 2>&1)
  echo "$out" | tail -4 >&2
  id=$(echo "$out" | LC_ALL=C grep -oE 'C[A-Z2-7]{55}' | tail -1)
  if [ -z "$id" ]; then
    echo "could not parse contract ID from deploy output" >&2
    exit 1
  fi
  echo "$id"
}

upsert_env() { # $1 key, $2 value (root .env)
  if grep -q "^$1=" .env; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    echo "$1=$2" >> .env
  fi
}

# --- SessionRegistry ----------------------------------------------------------
if [ -n "${SESSION_REGISTRY_ID:-}" ]; then
  echo "==> Reusing SESSION_REGISTRY_ID=$SESSION_REGISTRY_ID"
else
  SESSION_REGISTRY_ID=$(deploy_one "SessionRegistry" "$REGISTRY_WASM")
  upsert_env SESSION_REGISTRY_ID "$SESSION_REGISTRY_ID"
  echo "    SessionRegistry: $SESSION_REGISTRY_ID"
fi
echo "==> Initializing SessionRegistry (admin=operator, operator=operator)..."
stellar contract invoke --id "$SESSION_REGISTRY_ID" --source-account "$SOURCE" \
  --network "$NETWORK" -- initialize --admin "$OPERATOR_PUBLIC" --operator "$OPERATOR_PUBLIC"

# --- SlowTicTacToe ------------------------------------------------------------
if [ -n "${SLOW_TICTACTOE_ID:-}" ]; then
  echo "==> Reusing SLOW_TICTACTOE_ID=$SLOW_TICTACTOE_ID"
else
  SLOW_TICTACTOE_ID=$(deploy_one "SlowTicTacToe" "$TTT_WASM")
  upsert_env SLOW_TICTACTOE_ID "$SLOW_TICTACTOE_ID"
  echo "    SlowTicTacToe:   $SLOW_TICTACTOE_ID"
fi
echo "==> Initializing SlowTicTacToe (admin=operator)..."
stellar contract invoke --id "$SLOW_TICTACTOE_ID" --source-account "$SOURCE" \
  --network "$NETWORK" -- initialize --admin "$OPERATOR_PUBLIC"

# --- web env -------------------------------------------------------------------
cat > apps/web/.env.local <<EOF
NEXT_PUBLIC_SEQUENCER_URL=http://localhost:8787
NEXT_PUBLIC_PLAYER_A_PUBLIC=$PLAYER_A_PUBLIC
NEXT_PUBLIC_PLAYER_B_PUBLIC=$PLAYER_B_PUBLIC
NEXT_PUBLIC_SESSION_REGISTRY_ID=$SESSION_REGISTRY_ID
NEXT_PUBLIC_SLOW_TICTACTOE_ID=$SLOW_TICTACTOE_ID
EOF

# --- TypeScript bindings -------------------------------------------------------
# Generated from the local wasm (same spec as the deployed contract), then
# patched so they work as workspace packages importing TS source directly.
echo "==> Generating TypeScript bindings into packages/bindings/ ..."
rm -rf packages/bindings/session-registry packages/bindings/slow-tictactoe
stellar contract bindings typescript \
  --wasm "$REGISTRY_WASM" \
  --output-dir packages/bindings/session-registry --overwrite
stellar contract bindings typescript \
  --wasm "$TTT_WASM" \
  --output-dir packages/bindings/slow-tictactoe --overwrite
node scripts/patch-bindings.mjs

echo "==> Deploy complete."
echo "    SessionRegistry: $SESSION_REGISTRY_ID"
echo "    SlowTicTacToe:   $SLOW_TICTACTOE_ID"
