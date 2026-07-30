#!/bin/bash

# Splits Bazel test targets into deterministic buckets. Used in CI to
# distribute test targets across multiple runners.
#
# Usage:
#   bucket_test_targets.sh <bucket> <bucket_count> [options] \
#       <bazel_query_expression>
#
# Options:
#   --balanced-random  Shuffle targets by seed, then distribute them evenly.
#   --seed <seed>      Seed for --balanced-random. Defaults to $GITHUB_RUN_ID
#                      when set.
#
# Example:
#   bucket_test_targets.sh 1 2 'tests(//...)'
#   bucket_test_targets.sh 1 2 --balanced-random 'tests(//...)'
#
# Outputs one Bazel target label per line for the given bucket.

set -euo pipefail

usage() {
    echo "Usage: bucket_test_targets.sh <bucket> <bucket_count> [options] \\" >&2
    echo "    <bazel_query_expression>" >&2
}

if [ "$#" -lt 3 ]; then
    usage
    exit 1
fi

bucket="$1"
bucket_count="$2"
shift 2

bucket_mode="hash"
seed="${GITHUB_RUN_ID:-default}"

while [ "$#" -gt 1 ]; do
    case "$1" in
        --balanced-random)
            bucket_mode="balanced_random"
            shift
            ;;
        --seed)
            if [ "$#" -lt 2 ]; then
                echo "Error: --seed requires a value" >&2
                usage
                exit 1
            fi
            seed="$2"
            shift 2
            ;;
        --seed=*)
            seed="${1#--seed=}"
            shift
            ;;
        --)
            shift
            break
            ;;
        --*)
            echo "Error: unknown option $1" >&2
            usage
            exit 1
            ;;
        *)
            break
            ;;
    esac
done

if [ "$#" -ne 1 ]; then
    usage
    exit 1
fi

query="$1"

if ! [[ "$bucket" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: bucket must be a positive integer" >&2
    exit 1
fi

if ! [[ "$bucket_count" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: bucket_count must be a positive integer" >&2
    exit 1
fi

if [ "$bucket" -gt "$bucket_count" ]; then
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

case "$bucket_mode" in
    hash)
        echo "$all_targets" | while IFS= read -r target; do
            if [ -z "$target" ]; then
                continue
            fi
            # Use a simple hash of the target label to assign it to a bucket.
            # cksum is POSIX and produces a deterministic hash.
            hash=$(echo "$target" | cksum | cut -d' ' -f1)
            target_bucket=$(( (hash % bucket_count) + 1 ))
            if [ "$target_bucket" -eq "$bucket" ]; then
                echo "$target"
            fi
        done
        ;;
    balanced_random)
        printf '%s\n' "$all_targets" |
            while IFS= read -r target; do
                if [ -z "$target" ]; then
                    continue
                fi
                hash=$(printf '%s\n' "$seed:$target" | cksum | cut -d' ' -f1)
                printf '%s\t%s\n' "$hash" "$target"
            done |
            sort -n -k1,1 -k2,2 |
            cut -f2- |
            awk -v bucket="$bucket" -v bucket_count="$bucket_count" '
                {
                    target_bucket = ((NR - 1) % bucket_count) + 1
                    if (target_bucket == bucket) {
                        print
                    }
                }
            '
        ;;
esac
