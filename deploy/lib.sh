# Shared by the scripts in this directory. It is sourced, never run on its own.
#
# It changes to the repository root and defines `compose`, the single Docker
# Compose invocation of this deployment. Why the directory matters:
#   - the --env-file option is resolved against the current directory;
#   - relative paths inside the compose files (build context, env_file) are
#     resolved against the directory of the FIRST -f file, the repository root.
#     docker-compose.yml therefore has to stay first.

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$deploy_dir/.." && pwd)"
cd "$root"

# Settings and generated secrets of the database and the server.
env_file="deploy/.env.production"
# Cloudflare Tunnel connector token (read by the `tunnel` container only).
tunnel_env_file="deploy/.env.tunnel"

for required in docker-compose.yml deploy/docker-compose.tunnel.yml "$env_file" "$tunnel_env_file"; do
  if [ ! -f "$required" ]; then
    echo "Missing file: $root/$required" >&2
    exit 1
  fi
done

# This deployment is configured by deploy/.env.production alone. Docker Compose
# prefers variables of the calling shell over the env file, so the names the
# compose files read are removed from the environment of this script first.
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES \
  RD_IMAGE RD_BUILD_TARGET RD_PORT RD_DB_PORT \
  POSTGRES_PASSWORD SESSION_SECRET PUBLIC_ORIGIN

# The env file handed to the server container (see docker-compose.yml).
export RD_COMPOSE_ENV_FILE="$env_file"

compose() {
  docker compose --env-file "$env_file" \
    -f docker-compose.yml -f deploy/docker-compose.tunnel.yml "$@"
}

# Prints one setting of the production env file. Only used for values that are
# not secret (port, public address).
setting() {
  sed -n "s/^$1=//p" "$env_file" | tail -n 1
}
