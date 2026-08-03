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
# Sharding brukes av CI for å kjøre suiten parallelt. Filene fordeles etter
# målt kjøretid (tests/shard.js + tests/durations.json), så shardene blir like
# tunge. Kjøretiden per fil skrives ut til slutt; tests/measure.sh gjør den om
# til nye tall i durations.json.
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
# Kostnadsbasert fordeling etter målt kjøretid — se tests/shard.js.
mapfile -t FILES < <(node tests/shard.js "$SHARD_INDEX" "$SHARD_TOTAL")

if [ ${#FILES[@]} -eq 0 ]; then
  echo "✗ Ingen testfiler i shard $SHARD_INDEX/$SHARD_TOTAL"; exit 1
fi

echo "→ Shard $SHARD_INDEX/$SHARD_TOTAL: ${#FILES[@]} testfiler mot $HUSKIS_URL"
echo

FAILED=()
TIMED=()
for f in "${FILES[@]}"; do
  echo "──────── $f ────────"
  started=$SECONDS
  if node "$f"; then
    echo "✓ $f"
  else
    echo "✗ $f"
    FAILED+=("$f")
  fi
  elapsed=$(( SECONDS - started ))
  TIMED+=("$elapsed	$f")
  echo "  ⏱  ${elapsed}s"
  echo
done

# ---- Kjøretid per fil ----
# Fordelingen over er kostnadsbasert, så tallene her er kilden den leser fra:
# `tests/measure.sh` slår sammen linjene fra alle shards til durations.json.
echo "════════ Kjøretid (shard $SHARD_INDEX/$SHARD_TOTAL) ════════"
printf '%s\n' "${TIMED[@]}" | sort -rn | while IFS=$'\t' read -r secs file; do
  printf '  %4ds  %s\n' "$secs" "$file"
done
echo "  ————"
printf '  %4ds  til sammen\n' "$SECONDS"
echo

# I CI havner den samme tabellen i jobbsammendraget, så en shard som løper
# løpsk er synlig uten å åpne loggen.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Shard $SHARD_INDEX/$SHARD_TOTAL — ${SECONDS}s totalt"
    echo
    echo "| Sekunder | Testfil |"
    echo "|---:|---|"
    printf '%s\n' "${TIMED[@]}" | sort -rn | while IFS=$'\t' read -r secs file; do
      echo "| $secs | \`$file\` |"
    done
  } >> "$GITHUB_STEP_SUMMARY"
fi

echo "════════ Oppsummering (shard $SHARD_INDEX/$SHARD_TOTAL) ════════"
echo "Kjørte ${#FILES[@]} testfiler, ${#FAILED[@]} feilet."
if [ ${#FAILED[@]} -gt 0 ]; then
  for f in "${FAILED[@]}"; do echo "  ✗ $f"; done
  exit 1
fi
echo "✅ Alle grønne."
