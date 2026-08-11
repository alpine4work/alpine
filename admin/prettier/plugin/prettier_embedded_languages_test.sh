#!/bin/bash

set -euo pipefail

prettier_path="$1"
input_path="$2"
expected_path="$3"
config_path="$4"

if [[ -z "${TEST_TMPDIR-}" ]]; then
    echo "Expected TEST_TMPDIR to be set by Bazel test environment." >&2
    exit 1
fi

temp_input_path="${TEST_TMPDIR}/prettier_embedded_languages_test_input.ts"
cp "${input_path}" "${temp_input_path}"

"${prettier_path}" --config "${config_path}" --write "${temp_input_path}" >/dev/null
diff -u "${expected_path}" "${temp_input_path}"
