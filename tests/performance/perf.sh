#!/usr/bin/env bash
# Runs a scenario of the performance framework: tests/performance/perf.sh <scenario[,...]> [options]
# See README.md. The generator's dependencies are those of tests/load, so it runs from there.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$root/scripts/dev-env.sh" >/dev/null
ulimit -n 65536 2>/dev/null || true
cd "$root/tests/load"
[ -f .stage/server/dist/main.js ] || node --import tsx src/stack.ts stage
exec node --import tsx ../performance/src/run.ts "$@"
