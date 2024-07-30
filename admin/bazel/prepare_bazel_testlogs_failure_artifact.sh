#!/bin/bash

set -eo pipefail

if [ -z "$1" ]; then
    this=$(realpath "$0")
    testlogs=$(readlink -f "$(dirname "$0")/../../bazel-testlogs")

    # 1. Make sure all `testlogs` files are writable. Bazel creates some `testlogs`
    #    files without the write permissions.
    find "$testlogs" -exec chmod +w {} \;

    # 2. Call this script for every test result. Every test creates a `test.xml`
    #    file. Will delete files for passing tests.
    find "$testlogs" -name test.xml -exec "$this" {} \;

    # 3. Recursively cleanup empty directories.
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
        rm "$(dirname $1)/test_attempts/attempt_"*".xml"
    fi
fi
