#!/bin/bash

set -euo pipefail

# Extract one status line per requested target from Bazel's console output.
# Targets missing from the summary are reported as NOT RAN.
if [ "$#" -ne 2 ]; then
    echo "Usage: write_ci_bazel_target_statuses.sh <targets> <bazel_output>" >&2
    exit 1
fi

targets_path="$1"
bazel_output_path="$2"
clean_bazel_output_path=$(mktemp)
trap 'rm -f "$clean_bazel_output_path"' EXIT

# Bazel can emit ANSI control sequences and carriage returns in CI output.
# Strip them before parsing so awk sees stable lines.
perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g; s/\r//g; s/\x{FEFF}//g' \
    "$bazel_output_path" > "$clean_bazel_output_path"

awk '
    BEGIN {
        red = sprintf("%c[31m", 27)
        green = sprintf("%c[32m", 27)
        yellow = sprintf("%c[33m", 27)
        reset = sprintf("%c[0m", 27)
    }

    function color_status_line(line, status, color, colored_status) {
        if (line ~ /FAILED TO BUILD/) {
            status = "FAILED TO BUILD"
            color = red
        } else if (line ~ /NO STATUS/) {
            status = "NO STATUS"
            color = yellow
        } else if (line ~ /NOT RAN/) {
            status = "NOT RAN"
            color = yellow
        } else if (line ~ /TIMEOUT/) {
            status = "TIMEOUT"
            color = red
        } else if (line ~ /FLAKY/) {
            status = "FLAKY"
            color = yellow
        } else if (line ~ /FAILED/) {
            status = "FAILED"
            color = red
        } else if (line ~ /PASSED/) {
            status = "PASSED"
            color = green
        } else {
            return line
        }

        colored_status = color status reset
        sub(status, colored_status, line)
        return line
    }

    # First file: preserve the requested target order and membership.
    FNR == NR {
        if ($0 != "") {
            targets[++target_count] = $0
            target_seen[$0] = 1
        }
        next
    }

    # Second file: capture Bazel summary rows for requested targets only.
    /^\/\// {
        target = $1
        if (!(target in target_seen)) {
            next
        }

        if ($0 ~ /FAILED TO BUILD/ || $0 ~ /NO STATUS/ || $0 ~ /FAILED/ || $0 ~ /TIMEOUT/ || $0 ~ /FLAKY/ || $0 ~ /PASSED/) {
            line = $0
            sub("^" target "[[:space:]]*", "", line)
            target_status_line[target] = line
        }
    }

    # Missing rows usually mean Bazel exited before reaching the target.
    END {
        for (i = 1; i <= target_count; i++) {
            target = targets[i]
            if (target in target_status_line) {
                printf "%-70s %s\n", target, color_status_line(target_status_line[target])
            } else {
                printf "%-70s %sNOT RAN%s\n", target, yellow, reset
            }
        }
    }
' "$targets_path" "$clean_bazel_output_path"
