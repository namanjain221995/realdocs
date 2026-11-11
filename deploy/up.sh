#!/usr/bin/env bash
# Builds the server image from the working tree and starts (or updates) the
# RealtimeDocs deployment: database, server and Cloudflare Tunnel connector.
#
#   deploy/up.sh
#
# Run it again after a code change or after editing one of the env files: only
# containers whose image or settings changed are replaced. The data volumes are
# never touched. The command returns when the database and the server report
# healthy and the tunnel container runs.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ $# -ne 0 ]; then
  echo "deploy/up.sh takes no arguments." >&2
  exit 64
fi

compose up -d --build --wait

echo
compose ps
echo
echo "RealtimeDocs is up ($(date -u +%Y-%m-%dT%H:%M:%SZ)). Check it with deploy/status.sh."
