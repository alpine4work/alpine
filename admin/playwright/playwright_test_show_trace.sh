#!/bin/bash

test_outputs_path="$BUILD_WORKING_DIRECTORY/bazel-testlogs/$TEST_PACKAGE_NAME/$TEST_TARGET_NAME/test.outputs"

if [ ! -d "$test_outputs_path/outputs" ]; then
    unzip -o "$test_outputs_path/outputs.zip" -d "$test_outputs_path/outputs"
fi

"$PLAYWRIGHT_BIN" show-trace "$test_outputs_path/outputs/$1"
