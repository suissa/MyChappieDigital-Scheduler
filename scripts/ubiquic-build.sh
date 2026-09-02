#!/usr/bin/env bash
# Build the UbiQUIC (QUICMQ) Zig sidecar. Run from any shell that can reach WSL;
# zig 0.16 lives in WSL and the project is on the Windows drive, so the zig
# cache is redirected to a native path (drvfs rename-into-cache is unreliable).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIDECAR="$HERE/packages/Services/UbiQUIC"

export ZIG_LOCAL_CACHE_DIR="${ZIG_LOCAL_CACHE_DIR:-/tmp/ubiquic-zig-cache}"
export ZIG_GLOBAL_CACHE_DIR="${ZIG_GLOBAL_CACHE_DIR:-/tmp/ubiquic-zig-global}"
mkdir -p "$ZIG_LOCAL_CACHE_DIR" "$ZIG_GLOBAL_CACHE_DIR"

cd "$SIDECAR"
zig version
zig build test
zig build
echo "built: $SIDECAR/zig-out/bin/quicmq-nats"
