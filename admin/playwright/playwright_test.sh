#!/bin/bash

# Update XDG base directories to locations that can be written to. Trying to
# write to `/home/runner/.cache` will throw an error since when we run in a
# Bazel sandbox the rest of the file system is read-only.
export XDG_DATA_HOME="$TEST_TMPDIR/.local/share"
export XDG_CONFIG_HOME="$TEST_TMPDIR/.config"
export XDG_STATE_HOME="$TEST_TMPDIR/.local/state"
export XDG_CACHE_HOME="$TEST_TMPDIR/.cache"

# Run one project per test with no parallelism because Bazel
# handles parallelism.
"$PLAYWRIGHT_BIN" test "$PLAYWRIGHT_TEST_PATH" \
    --config "$PLAYWRIGHT_CONFIG_PATH" \
    --project "$PLAYWRIGHT_PROJECT" \
    --workers 1 \
    --output "$TEST_UNDECLARED_OUTPUTS_DIR" \
    $@
