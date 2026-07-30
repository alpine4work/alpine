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

# Run the GUI on the port immediately after the local DynamoDB instance.
dynamo_local_gui_port=$((DYNAMO_LOCAL_PORT + 1))

HOST=localhost \
    PORT="$dynamo_local_gui_port" \
    DYNAMO_ENDPOINT="http://localhost:$DYNAMO_LOCAL_PORT" \
    AWS_ACCESS_KEY_ID=local \
    AWS_REGION=us-east-1 \
    "$(rlocation cyberworlds/admin/dynamo/local/dynamodb_admin.sh)"
