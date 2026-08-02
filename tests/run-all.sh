#!/usr/bin/env bash
# ============================================================
# Kjører HELE JS-testsuiten i én runde — både de rene node-testene og
# nettlesertestene (Playwright + Chromium).
#
# Testene er frittstående skript uten runner (se tests/CLAUDE.md): denne fila
# er kun løkken rundt dem, slik at CI og et lokalt «kjør alt» gjør nøyaktig det
# samme. Hver fil kjøres for seg; en feilende fil stopper ikke resten, så én
# runde viser ALLE bruddene.
#
# Bruk:
#   tests/run-all.sh                    # alt, starter en lokal server ved behov
#   SHARD_INDEX=1 SHARD_TOTAL=4 tests/run-all.sh    # én av fire like biter
#   HUSKIS_URL=http://localhost:8000 tests/run-all.sh
#
# Sharding brukes av CI for å kjøre suiten parallelt. Filene sorteres og
# fordeles round-robin, så hver shard får en blanding av raske og trege filer.
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."

: "${HUSKIS_URL:=http://localhost:8000}"
: "${SHARD_INDEX:=1}"
: "${SHARD_TOTAL:=1}"
export HUSKIS_URL

# Playwright er installert globalt (se tests/CLAUDE.md), så node må få vite hvor.
if [ -z "${NODE_PATH:-}" ]; then
  NODE_PATH="$(npm root -g 2>/dev/null || true)"
  export NODE_PATH
fi

# ---- Lokal server: start bare hvis URL-en ikke allerede svarer ----
SERVER_PID=""
cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT

if ! curl -sfo /dev/null "$HUSKIS_URL/index.html"; then
  port="${HUSKIS_URL##*:}"
  case "$port" in ''|*[!0-9]*) port=8000 ;; esac
  echo "→ Starter lokal server på port $port"
  python3 -m http.server "$port" >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    curl -sfo /dev/null "$HUSKIS_URL/index.html" && break
    sleep 0.25
  done
  if ! curl -sfo /dev/null "$HUSKIS_URL/index.html"; then
    echo "✗ Fikk ikke opp en server på $HUSKIS_URL"; exit 1
  fi
fi

# ---- Fordel filene på shards ----
FILES=()
i=0
for f in $(ls tests/*.test.js | sort); do
  if [ $(( i % SHARD_TOTAL )) -eq $(( (SHARD_INDEX - 1) % SHARD_TOTAL )) ]; then
    FILES+=("$f")
  fi
  i=$(( i + 1 ))
done

if [ ${#FILES[@]} -eq 0 ]; then
  echo "✗ Ingen testfiler i shard $SHARD_INDEX/$SHARD_TOTAL"; exit 1
fi

echo "→ Shard $SHARD_INDEX/$SHARD_TOTAL: ${#FILES[@]} testfiler mot $HUSKIS_URL"
echo

FAILED=()
for f in "${FILES[@]}"; do
  echo "──────── $f ────────"
  if node "$f"; then
    echo "✓ $f"
  else
    echo "✗ $f"
    FAILED+=("$f")
  fi
  echo
done

echo "════════ Oppsummering (shard $SHARD_INDEX/$SHARD_TOTAL) ════════"
echo "Kjørte ${#FILES[@]} testfiler, ${#FAILED[@]} feilet."
if [ ${#FAILED[@]} -gt 0 ]; then
  for f in "${FAILED[@]}"; do echo "  ✗ $f"; done
  exit 1
fi
echo "✅ Alle grønne."
