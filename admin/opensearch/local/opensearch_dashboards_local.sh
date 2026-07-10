#!/bin/bash

# --- begin runfiles.bash initialization v3 ---
# Copy-pasted from the Bazel Bash runfiles library v3.
set -uo pipefail; set +e; f=bazel_tools/tools/bash/runfiles/runfiles.bash
source "${RUNFILES_DIR:-/dev/null}/$f" 2>/dev/null || \
    source "$(grep -sm1 "^$f " "${RUNFILES_MANIFEST_FILE:-/dev/null}" | cut -f2- -d' ')" 2>/dev/null || \
    source "$0.runfiles/$f" 2>/dev/null || \
    source "$(grep -sm1 "^$f " "$0.runfiles_manifest" | cut -f2- -d' ')" 2>/dev/null || \
    source "$(grep -sm1 "^$f " "$0.exe.runfiles_manifest" | cut -f2- -d' ')" 2>/dev/null || \
    { echo>&2 "ERROR: cannot find $f"; exit 1; }; f=; set -e
# --- end runfiles.bash initialization v3 ---

source "$(rlocation cyberworlds/.env.development)"

# Apply the developer's local overrides (e.g. per-worktree port offsets and
# `DEV_ENV_PATHS_NAME_SUFFIX`) the same way `parseDotenv()` does, so the GUI
# connects to the same local OpenSearch instance that `dev` started instead of
# the default ports (which in a git worktree belong to a different dev
# environment). `bazel run` sets `BUILD_WORKSPACE_DIRECTORY` to the workspace
# root, which is where the git-ignored `.env.development.local` lives.
if [ -n "${BUILD_WORKSPACE_DIRECTORY:-}" ] &&
    [ -f "${BUILD_WORKSPACE_DIRECTORY}/.env.development.local" ]; then
    source "${BUILD_WORKSPACE_DIRECTORY}/.env.development.local"
fi

platform_name="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch_name="$(uname -m)"
if [ "$arch_name" = "x86_64" ]; then
    arch_name="amd64"
fi
if [ "$arch_name" = "aarch64" ]; then
    arch_name="arm64"
fi

node="$(rlocation "nodejs_${platform_name}_${arch_name}/bin/node")"
export OSD_NODE_HOME="$(cd "$(dirname "$node")/.." && pwd)"

opensearch_dashboards_bin="$(rlocation opensearch_dashboards_local/bin/opensearch-dashboards)"

exec "$opensearch_dashboards_bin" \
    -H localhost \
    -p "$OPENSEARCH_DASHBOARDS_LOCAL_PORT" \
    --opensearch "http://localhost:${OPENSEARCH_LOCAL_PORT}"
