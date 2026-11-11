# Source this file to use the project-pinned toolchain on this host:
#   . scripts/dev-env.sh
# It only prepends the project-local Node.js (see .node-version) to PATH.
_rd_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
if [ -x "$_rd_root/.toolchain/node/bin/node" ]; then
  export PATH="$_rd_root/.toolchain/node/bin:$PATH"
fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
unset _rd_root
