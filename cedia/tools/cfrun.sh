#!/usr/bin/env bash
# Run a command with CLOUDFLARE_API_TOKEN from the local keychain (item
# rr26-cf-token, mirrored from 1Password). The value never hits stdout.
#   cfrun.sh wrangler d1 create rr26
#   cfrun.sh curl -s https://api.cloudflare.com/client/v4/...
set -euo pipefail
CLOUDFLARE_API_TOKEN="$(security find-generic-password -a rr26 -s rr26-cf-token -w)"
export CLOUDFLARE_API_TOKEN
cd "$(dirname "$0")/../worker"
if [ "${1:-}" = "wrangler" ]; then
  shift
  exec npx -y wrangler "$@"
fi
exec "$@"
