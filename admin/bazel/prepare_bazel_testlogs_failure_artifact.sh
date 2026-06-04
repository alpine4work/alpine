#!/bin/bash

set -eo pipefail

if [ -z "$1" ]; then
    this=$(realpath "$0")
    workspace_root=$(readlink -f "$(dirname "$0")/../..")
    testlogs_link="$workspace_root/bazel-testlogs"

    if [ -e "$testlogs_link" ]; then
        testlogs=$(readlink -f "$testlogs_link")
    else
        testlogs="$testlogs_link"
        mkdir -p "$testlogs"
    fi

    # 1. Make sure all `testlogs` files are writable. Bazel creates some `testlogs`
    #    files without the write permissions.
    find "$testlogs" -exec chmod +w {} \;

    # 2. Call this script for every test result. Every test creates a `test.xml`
    #    file. Will delete files for passing tests.
    find "$testlogs" -name test.xml -exec "$this" {} \;

    # 3. Delete all flaky test attempt `.xml` files. This has the same content as
    #    `test.xml` but for a failed flaky test attempt.
    find "$testlogs" -name "attempt_*.xml" -type f -exec rm {} \;

    # 4. Copy CI helper logs into the artifact so we can inspect failures that
    #    happened outside an individual Bazel test target.
    if [ -n "$BAZEL_REMOTE_CACHE_LOG_PATH" ] && [ -f "$BAZEL_REMOTE_CACHE_LOG_PATH" ]; then
        ci_logs_path="$testlogs/ci"
        mkdir -p "$ci_logs_path"
        cp "$BAZEL_REMOTE_CACHE_LOG_PATH" "$ci_logs_path/bazel_remote_cache.log"
    fi

    # 5. Recursively cleanup empty directories.
    find "$testlogs" -type d -empty -delete
else
    # Determine whether the test was successful or not by parsing the JUnit
    # `test.xml` file.
    failures_and_errors=$(head -3 "$1" | grep "<testsuite name=\"" | sed -E "s/.*failures=\"([0-9]+)\" errors=\"([0-9]+)\".*/\1 \2/")

    if [ "$failures_and_errors" == "0 0" ]; then
        # If the test passed remove all files related to the test. We can't
        # `rm -rf "$(dirname $1)"` since this will break `find`'s iteration since
        # `find` wants to iterate into sub-directories of this test folder.
        find "$(dirname $1)" -type f -exec rm {} \;
    else
        # If this test failed, we want to keep the `test.log` file and `test.outputs`
        # folder but we can remove redundant files like `test.xml` (which contains the
        # log a file a second time).
        rm "$(dirname $1)/test.xml"
        rm "$(dirname $1)/test.cache_status"
    fi
fi
