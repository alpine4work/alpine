#!/bin/bash

set -euo pipefail

# Print a failure-focused view from downloaded shard artifacts. This script
# does not query Bazel; it only reads logs and metadata uploaded by test jobs.
if [ "$#" -ne 3 ]; then
    echo "Usage: print_ci_bazel_test_summary.sh <test_type> <artifacts_dir> <matrix_result>" >&2
    exit 1
fi

test_type="$1"
artifacts_path="$2"
matrix_result="$3"
exit_code=0

mkdir -p "$artifacts_path"

# Keep the final check red even if artifact download succeeds but the matrix
# job result was failed, cancelled, or skipped.
if [ "$matrix_result" != "success" ]; then
    exit_code=1
fi

artifact_name_from_path() {
    local artifact_path="$1"
    local relative_artifact_path

    relative_artifact_path="${artifact_path#"$artifacts_path"/}"
    printf '%s\n' "${relative_artifact_path%%/*}"
}

print_runner_heading() {
    local runner_name="$1"

    printf '%s\n' "################################################"
    printf 'Runner: %s\n' "$runner_name"
    printf '%s\n' "################################################"
    echo
}

print_failure_heading() {
    local failure_heading="$1"

    printf '%s\n' "------------------------------------------------"
    printf '%s\n' "$failure_heading"
    printf '%s\n' "------------------------------------------------"
    echo
}

# Convert a Bazel label to the path shape used under bazel-testlogs.
target_path_from_label() {
    local label="$1"
    label="${label#//}"
    printf '%s\n' "${label/://}"
}

label_for_log_path() {
    local log_path="$1"
    local relative_log_path="$2"
    local target_path
    local targets_file
    local target

    case "$relative_log_path" in
        */test.log)
            target_path=$(dirname "$relative_log_path")
            ;;
        */test_attempts/attempt_*.log)
            target_path=$(dirname "$(dirname "$relative_log_path")")
            ;;
        *)
            printf '%s\n' "$log_path"
            return
            ;;
    esac

    # Failure artifacts contain testlogs by path, not Bazel label. Use each
    # shard's target list to recover the original label for readable output.
    while IFS= read -r targets_file; do
        while IFS= read -r target; do
            if [ -n "$target" ] && [ "$(target_path_from_label "$target")" = "$target_path" ]; then
                printf '%s\n' "$target"
                return
            fi
        done < "$targets_file"
    done < <(
        find "$artifacts_path" \
            -path "*/bazel_${test_type}_*_results/targets.txt" \
            -type f \
            | sort
    )

    printf '%s\n' "$target_path"
}

relative_testlog_path() {
    local log_path="$1"
    local artifact_path

    for artifact_path in "$artifacts_path"/bazel_"$test_type"_*_testlogs; do
        [ -d "$artifact_path" ] || continue
        case "$log_path" in
            "$artifact_path"/*)
                printf '%s\n' "${log_path#"$artifact_path"/}"
                return
                ;;
        esac
    done

    printf '%s\n' "$log_path"
}

failure_log_heading() {
    local target="$1"
    local relative_log_path="$2"
    local attempt_name

    case "$relative_log_path" in
        */test.log)
            echo "FAILED: $target (Summary)"
            ;;
        */test_attempts/attempt_*.log)
            attempt_name=$(basename "$relative_log_path" .log)
            echo "FAIL: $target ($attempt_name)"
            ;;
        *)
            echo "FAILED: $target ($relative_log_path)"
            ;;
    esac
}

print_failed_logs() {
    local log_paths_path
    local log_path
    local relative_log_path
    local artifact_name
    local current_artifact_name=""
    local target

    # The test jobs upload only failed testlogs, so printing every downloaded
    # log gives us assertion output without replaying noisy passing logs.
    log_paths_path=$(mktemp)
    find "$artifacts_path" \
        -path "*/bazel_${test_type}_*_testlogs/*" \
        -type f \
        \( -name test.log -o -name "attempt_*.log" \) \
        | sort > "$log_paths_path"

    if [ ! -s "$log_paths_path" ]; then
        echo "No failed test logs found."
        rm -f "$log_paths_path"
        return
    fi

    while IFS= read -r log_path; do
        artifact_name=$(artifact_name_from_path "$log_path")
        relative_log_path=$(relative_testlog_path "$log_path")
        target=$(label_for_log_path "$log_path" "$relative_log_path")

        if [ "$artifact_name" != "$current_artifact_name" ]; then
            print_runner_heading "$artifact_name"
            current_artifact_name="$artifact_name"
        else
            echo
        fi

        print_failure_heading "$(failure_log_heading "$target" "$relative_log_path")"
        cat "$log_path"
        echo
    done < "$log_paths_path"

    rm -f "$log_paths_path"
}

status_file_has_failure() {
    local result_path="$1"
    local clean_result_path

    clean_result_path=$(mktemp)
    perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g; s/\r//g; s/\x{FEFF}//g' \
        "$result_path" > "$clean_result_path"

    if grep -Eq '(^|[[:space:]])(FAILED TO BUILD|NO STATUS|FAILED|TIMEOUT|NOT RAN)([[:space:]]|$)' \
        "$clean_result_path"; then
        rm -f "$clean_result_path"
        return 0
    fi

    rm -f "$clean_result_path"
    return 1
}

sort_target_statuses() {
    local target_statuses_path="$1"

    awk '
        BEGIN {
            esc = sprintf("%c", 27)
        }

        function clean_status_line(line, clean) {
            clean = line
            gsub(esc "\\[[0-9;?]*[ -/]*[@-~]", "", clean)
            gsub(/\r/, "", clean)
            gsub(/\xef\xbb\xbf/, "", clean)
            return clean
        }

        function target_label(line, parts) {
            split(line, parts, /[[:space:]]+/)
            return parts[1]
        }

        function status_order(line) {
            if (line ~ /(^|[[:space:]])PASSED([[:space:]]|$)/) {
                return 0
            }
            if (line ~ /(^|[[:space:]])FLAKY([[:space:]]|$)/) {
                return 1
            }
            if (line ~ /(^|[[:space:]])NOT RAN([[:space:]]|$)/) {
                return 2
            }
            if (line ~ /(^|[[:space:]])NO STATUS([[:space:]]|$)/) {
                return 3
            }
            if (line ~ /(^|[[:space:]])TIMEOUT([[:space:]]|$)/) {
                return 4
            }
            if (line ~ /(^|[[:space:]])FAILED TO BUILD([[:space:]]|$)/) {
                return 5
            }
            if (line ~ /(^|[[:space:]])FAILED([[:space:]]|$)/) {
                return 6
            }
            return 7
        }

        {
            clean = clean_status_line($0)
            printf "%02d\t%s\t%s\n", status_order(clean), target_label(clean), $0
        }
    ' "$target_statuses_path" | LC_ALL=C sort | cut -f3-
}

print_target_statuses() {
    local result_path
    local result_paths_path
    local target_statuses_path

    # Each shard uploads a status table for its requested targets. Merge the
    # shard tables and sort by status first, then Bazel label.
    result_paths_path=$(mktemp)
    target_statuses_path=$(mktemp)
    find "$artifacts_path" \
        -path "*/bazel_${test_type}_*_results/target_statuses.txt" \
        -type f \
        | sort > "$result_paths_path"

    if [ ! -s "$result_paths_path" ]; then
        echo "No uploaded target statuses found."
        exit_code=1
        rm -f "$result_paths_path"
        rm -f "$target_statuses_path"
        return
    fi

    while IFS= read -r result_path; do
        cat "$result_path" >> "$target_statuses_path"
        if status_file_has_failure "$result_path"; then
            exit_code=1
        fi
    done < "$result_paths_path"

    sort_target_statuses "$target_statuses_path"
    echo
    echo

    rm -f "$result_paths_path"
    rm -f "$target_statuses_path"
}

print_target_statuses
print_failed_logs
exit "$exit_code"
