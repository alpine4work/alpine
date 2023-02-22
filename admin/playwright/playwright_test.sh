#!/bin/bash

# Run one project per test with no parallelism because Bazel
# handles parallelism.
"$PLAYWRIGHT_BIN" test "$PLAYWRIGHT_TEST_PATH" \
    --config "$PLAYWRIGHT_CONFIG_PATH" \
    --project "$PLAYWRIGHT_PROJECT" \
    --workers 1 \
    --output "$TEST_UNDECLARED_OUTPUTS_DIR" \
    $@
