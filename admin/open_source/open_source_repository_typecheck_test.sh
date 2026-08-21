#!/bin/bash

set -euo pipefail

archive_path="$1"
node_path="$2"
if [[ "${archive_path}" != /* ]]; then
    archive_path="${PWD}/${archive_path}"
fi
if [[ "${node_path}" != /* ]]; then
    node_path="${PWD}/${node_path}"
fi

if [[ -z "${TEST_SRCDIR-}" || -z "${TEST_WORKSPACE-}" || -z "${TEST_TMPDIR-}" ]]; then
    echo "Expected the Bazel test environment to provide runfiles and a temporary directory." >&2
    exit 1
fi

runfiles_path="${TEST_SRCDIR}/${TEST_WORKSPACE}"
test_repository_path="${TEST_TMPDIR}/repository"
mkdir -p "${test_repository_path}"

# Extract and type-check the public ZIP, not the private sources. This catches a broken rewritten
# import path that type-checking the private tree cannot see.
unzip -q "${archive_path}" -d "${test_repository_path}"
ln -s "${runfiles_path}/node_modules" "${test_repository_path}/node_modules"
"${node_path}" "${runfiles_path}/node_modules/typescript/bin/tsc" \
    --project "${test_repository_path}/tsconfig.json"
