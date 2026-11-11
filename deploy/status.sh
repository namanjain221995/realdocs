#!/usr/bin/env bash
# Shows the state of the RealtimeDocs deployment: the containers, the server as
# seen on this host, and the public address as seen through Cloudflare.
#
#   deploy/status.sh
#
# Exit status 0 when every check answers 200, otherwise 1.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ $# -ne 0 ]; then
  echo "deploy/status.sh takes no arguments." >&2
  exit 64
fi

port="$(setting RD_PORT)"
port="${port:-4310}"
public_origin="$(setting PUBLIC_ORIGIN)"

compose ps --all
echo

failures=0
# probe <label> <url>: prints the HTTP status of one GET request.
probe() {
  local label="$1" url="$2" code
  code="$(curl -sS -o /dev/null --max-time 15 -w '%{http_code}' "$url" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    printf 'ok      %-28s %s -> 200\n' "$label" "$url"
  else
    printf 'FAILED  %-28s %s -> %s\n' "$label" "$url" "${code:-no answer}"
    failures=$((failures + 1))
  fi
}

probe 'local health' "http://127.0.0.1:$port/api/health"
probe 'local ready (database)' "http://127.0.0.1:$port/api/ready"
if [ -n "$public_origin" ]; then
  probe 'public health (Cloudflare)' "$public_origin/api/health"
else
  echo "FAILED  PUBLIC_ORIGIN is not set in $env_file"
  failures=$((failures + 1))
fi

if [ "$failures" -ne 0 ]; then
  echo
  echo "$failures check(s) failed. Logs: deploy/logs.sh server, deploy/logs.sh tunnel"
  exit 1
fi
