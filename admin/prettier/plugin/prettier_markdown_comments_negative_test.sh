#!/bin/bash

set -euo pipefail

prettier_path="$1"
input_path="$2"
config_path="$3"

if [[ -z "${TEST_TMPDIR-}" ]]; then
    echo "Expected TEST_TMPDIR to be set by Bazel test environment." >&2
    exit 1
fi

temp_input_path="${TEST_TMPDIR}/prettier_markdown_comments_negative_test_input.ts"
cp "${input_path}" "${temp_input_path}"

set +e
check_output="$("${prettier_path}" --config "${config_path}" --check "${temp_input_path}" 2>&1)"
check_exit_code="$?"
set -e

if [[ "${check_exit_code}" -eq 0 ]]; then
    echo "Expected 'prettier --check' to fail, but it passed." >&2
    exit 1
fi

if [[ "${check_output}" != *"Code style issues found"* ]]; then
    echo "Expected formatting failure from Prettier, got:" >&2
    echo "${check_output}" >&2
    exit 1
fi
