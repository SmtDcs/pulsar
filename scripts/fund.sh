#!/usr/bin/env bash
# Fund the 3 demo accounts (PLAYER_A, PLAYER_B, OPERATOR) via Friendbot.
# Stellar Testnet only. Safe to re-run: already-funded accounts just error.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo ".env missing — run: node scripts/gen-keys.mjs"
  exit 1
fi

# shellcheck disable=SC1091
source .env

for var in PLAYER_A_PUBLIC PLAYER_B_PUBLIC OPERATOR_PUBLIC; do
  addr="${!var}"
  if [ -z "$addr" ] || [ "$addr" = "G..." ]; then
    echo "$var is not set in .env"
    exit 1
  fi
  echo "Funding $var ($addr) via Friendbot..."
  if curl -s -m 60 "https://friendbot.stellar.org?addr=${addr}" -o /tmp/friendbot-${var}.json; then
    if grep -q '"ok"' /tmp/friendbot-${var}.json 2>/dev/null || \
       grep -q '"hash"' /tmp/friendbot-${var}.json 2>/dev/null; then
      echo "  funded (or already funded)"
    else
      echo "  NOTE: $(head -c 200 /tmp/friendbot-${var}.json)"
    fi
  else
    echo "  Friendbot unreachable — retry later: ./scripts/fund.sh"
    exit 1
  fi
done
echo "All demo accounts funded."
