#!/usr/bin/env bash
# Start the UbiQUIC (QUICMQ) NATS sidecar — the only message broker the agents
# talk to. Builds first if the binary is missing. Listens on the host/port from
# packages/Services/UbiQUIC/config.yml (127.0.0.1:4433 by default).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIDECAR="$HERE/packages/Services/UbiQUIC"
BIN="$SIDECAR/zig-out/bin/quicmq-nats"

export ZIG_LOCAL_CACHE_DIR="${ZIG_LOCAL_CACHE_DIR:-/tmp/ubiquic-zig-cache}"
export ZIG_GLOBAL_CACHE_DIR="${ZIG_GLOBAL_CACHE_DIR:-/tmp/ubiquic-zig-global}"

if [ ! -x "$BIN" ]; then
  echo "sidecar binary missing — building..."
  bash "$HERE/scripts/ubiquic-build.sh"
fi

cd "$SIDECAR"
exec "$BIN"
