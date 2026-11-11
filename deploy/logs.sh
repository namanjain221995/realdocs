#!/usr/bin/env bash
# Shows container logs of the RealtimeDocs deployment.
#
#   deploy/logs.sh <db|server|tunnel|all> [docker compose logs options]
#
# Without options the last 200 lines are shown. Examples:
#   deploy/logs.sh tunnel
#   deploy/logs.sh server --follow
#   deploy/logs.sh all --since 10m
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  echo "Usage: deploy/logs.sh <db|server|tunnel|all> [docker compose logs options]" >&2
  exit 64
}

[ $# -ge 1 ] || usage
service="$1"
shift
case "$service" in
  db | server | tunnel) services=("$service") ;;
  all) services=() ;;
  *) usage ;;
esac

[ $# -gt 0 ] || set -- --tail 200
compose logs "$@" ${services[@]+"${services[@]}"}
