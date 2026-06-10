#!/bin/bash

set -euo pipefail

# Wrap the Bazel command so each shard uploads enough metadata for the final
# aggregate check to reconstruct failed logs and target statuses.
if [ "$#" -lt 4 ] || [ "$3" != "--" ]; then
    echo "Usage: run_ci_bazel_test_targets.sh <results_dir> <targets> -- <bazel_command...>" >&2
    exit 1
fi

results_path="$1"
targets_path="$2"
script_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shift 3

mkdir -p "$results_path"

# Preserve the exact requested targets. The final check uses this to map
# bazel-testlogs paths back to labels and to report targets Bazel never ran.
cp "$targets_path" "$results_path/targets.txt"

# Stream Bazel output normally while also saving it for summary extraction.
set +e
"$@" 2>&1 | tee "$results_path/bazel_output.log"
bazel_exit_code="${PIPESTATUS[0]}"
set -e

echo "$bazel_exit_code" > "$results_path/bazel_exit_code.txt"

# Parse Bazel's summary before exiting with the original Bazel status.
"$script_path/write_ci_bazel_target_statuses.sh" \
    "$results_path/targets.txt" \
    "$results_path/bazel_output.log" \
    > "$results_path/target_statuses.txt"

exit "$bazel_exit_code"
