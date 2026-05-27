#!/bin/bash

# Splits Bazel test targets into deterministic buckets by hashing each target
# label. Used in CI to distribute test targets across multiple runners.
#
# Usage: bucket_test_targets.sh <bucket> <bucket_count> <bazel_query_expression>
#
# Example:
#   bucket_test_targets.sh 1 2 'tests(//...) except attr(tags, "integration_test", tests(//...))'
#
# Outputs one Bazel target label per line for the given bucket.

set -euo pipefail

bucket="$1"
bucket_count="$2"
query="$3"

if [ "$bucket" -lt 1 ] || [ "$bucket" -gt "$bucket_count" ]; then
    echo "Error: bucket must be between 1 and $bucket_count" >&2
    exit 1
fi

stderr_file=$(mktemp)
trap 'rm -f "$stderr_file"' EXIT

all_targets=$(admin/bin/bazel query "$query" 2>"$stderr_file") || {
    echo "Error: bazel query failed:" >&2
    cat "$stderr_file" >&2
    exit 1
}

echo "$all_targets" | while IFS= read -r target; do
    # Use a simple hash of the target label to assign it to a bucket. cksum is
    # POSIX and produces a deterministic hash.
    hash=$(echo "$target" | cksum | cut -d' ' -f1)
    target_bucket=$(( (hash % bucket_count) + 1 ))
    if [ "$target_bucket" -eq "$bucket" ]; then
        echo "$target"
    fi
done
