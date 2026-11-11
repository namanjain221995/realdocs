#!/usr/bin/env bash
# Runs a command inside a running container of the RealtimeDocs deployment.
#
#   deploy/exec.sh [docker compose exec options] <db|server> <command> [arguments]
#
# Examples:
#   deploy/exec.sh server realtimedocs bootstrap-admin --email you@example.com --name "Your Name" --generate
#   deploy/exec.sh server realtimedocs reset-password --email you@example.com --generate
#   deploy/exec.sh server realtimedocs cleanup
#
# (The tunnel container holds nothing but the cloudflared program: it has no
# shell to run commands in.)
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ $# -lt 2 ]; then
  echo "Usage: deploy/exec.sh [docker compose exec options] <db|server> <command> [arguments]" >&2
  exit 64
fi

compose exec "$@"
