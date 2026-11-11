#!/usr/bin/env bash
# Stops the RealtimeDocs deployment and removes its containers and its network.
#
#   deploy/down.sh
#
# The data volumes (database and uploaded files) are KEPT. This script never
# removes volumes and accepts no arguments, so an option such as -v cannot slip
# through. Start again with deploy/up.sh.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ $# -ne 0 ]; then
  echo "deploy/down.sh takes no arguments. It stops the containers and keeps the data volumes." >&2
  exit 64
fi

compose down

echo
echo "Stopped. The data is kept in these Docker volumes:"
docker volume ls --filter "label=com.docker.compose.project=realtimedocs" --format '  {{.Name}}'
echo "Start again with deploy/up.sh."
