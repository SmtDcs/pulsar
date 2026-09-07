#!/usr/bin/env bash
# Pulsar v0 demo launcher: fund, deploy if needed, start sequencer + web.
# Ctrl-C stops both services.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/bin:$PATH"

command -v node >/dev/null 2>&1 || { echo "node 22+ required"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm required"; exit 1; }

echo "==> Installing dependencies..."
pnpm install

if [ ! -f .env ]; then
  echo "==> No .env found — generating 3 Testnet keypairs..."
  node scripts/gen-keys.mjs
fi

echo "==> Funding demo accounts (Friendbot)..."
./scripts/fund.sh

# shellcheck disable=SC1091
source .env
if [ -z "${SESSION_REGISTRY_ID:-}" ] || [ -z "${SLOW_TICTACTOE_ID:-}" ]; then
  echo "==> Contract IDs missing — deploying to Testnet..."
  ./scripts/deploy.sh
  # shellcheck disable=SC1091
  source .env
else
  echo "==> Using deployed contracts:"
  echo "    SessionRegistry: $SESSION_REGISTRY_ID"
  echo "    SlowTicTacToe:   $SLOW_TICTACTOE_ID"
fi

CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return
  CLEANED=1
  echo ""
  echo "==> Stopping sequencer and web..."
  # Children were started with setsid: killing the negative PID takes down
  # the whole process group (pnpm -> tsx/next -> node).
  [ -n "${SEQ_PID:-}" ] && kill -- "-$SEQ_PID" 2>/dev/null || true
  [ -n "${WEB_PID:-}" ] && kill -- "-$WEB_PID" 2>/dev/null || true
  sleep 2
  [ -n "${SEQ_PID:-}" ] && kill -KILL -- "-$SEQ_PID" 2>/dev/null || true
  [ -n "${WEB_PID:-}" ] && kill -KILL -- "-$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

WEB_PORT="${WEB_PORT:-3000}"

echo "==> Starting sequencer on :${PORT:-8787}..."
setsid bash -c 'pnpm --filter @pulsar/sequencer dev' > /tmp/pulsar-sequencer.log 2>&1 &
SEQ_PID=$!

echo "==> Starting web on :$WEB_PORT..."
setsid bash -c "cd apps/web && pnpm exec next dev -p '$WEB_PORT'" > /tmp/pulsar-web.log 2>&1 &
WEB_PID=$!

echo "==> Waiting for services..."
for i in $(seq 1 60); do
  if curl -s -m 2 "http://localhost:${PORT:-8787}/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -s -m 2 "http://localhost:${PORT:-8787}/health" && echo "" || {
  echo "Sequencer failed to start. Log:"; tail -30 /tmp/pulsar-sequencer.log; exit 1;
}

for i in $(seq 1 60); do
  if curl -s -m 2 -o /dev/null "http://localhost:$WEB_PORT/" 2>/dev/null; then break; fi
  sleep 1
done

echo ""
echo "=============================================================="
echo "  Pulsar v0 demo is running:"
echo "    Web UI:       http://localhost:$WEB_PORT"
echo "    Sequencer:    http://localhost:${PORT:-8787}"
echo "    Explorer:     https://stellar.expert/explorer/testnet"
echo ""
echo "  Open two browser tabs at http://localhost:$WEB_PORT —"
echo "  create a match in tab 1 (play as A), open the same /m/... URL"
echo "  in tab 2 (play as B). Toggle L1 vs Pulsar at match creation."
echo "=============================================================="
echo "Ctrl-C to stop."

wait
