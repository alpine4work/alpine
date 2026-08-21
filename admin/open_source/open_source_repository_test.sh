#!/bin/bash

set -euo pipefail

archive_path="$1"
manifest_path="$2"
npm_path="$3"
node_path="$4"
if [[ "${archive_path}" != /* ]]; then
    archive_path="${PWD}/${archive_path}"
fi
if [[ "${manifest_path}" != /* ]]; then
    manifest_path="${PWD}/${manifest_path}"
fi
if [[ "${npm_path}" != /* ]]; then
    npm_path="${PWD}/${npm_path}"
fi
if [[ "${node_path}" != /* ]]; then
    node_path="${PWD}/${node_path}"
fi

if [[ -z "${TEST_TMPDIR-}" || -z "${TEST_SRCDIR-}" || -z "${TEST_WORKSPACE-}" ]]; then
    echo "Expected the Bazel test environment to provide runfiles and a temporary directory." >&2
    exit 1
fi

test_repository_path="${TEST_TMPDIR}/repository"
mkdir -p "${test_repository_path}"
# GitHub Actions gives this ZIP to the public-repository job. Extract it here so Bazel checks the
# same files that job receives.
unzip -q "${archive_path}" -d "${test_repository_path}"

# The private YAML list selects pnpm patch files for the public CLI. The archive contains only the
# converted patch-package copies, not the private list.
test ! -e "${test_repository_path}/admin/open_source/cli_patch_list.yaml"

# The archive must contain a patch-package copy for every private patch selected in the YAML. Its
# filename follows patch-package's package-and-version convention. Public CI applies these files
# during a clean `npm ci`.
while IFS=$'\t' read -r source_file_name public_file_name; do
    test -f "${TEST_SRCDIR}/${TEST_WORKSPACE}/admin/patches/${source_file_name}"
    test -f "${test_repository_path}/packages/cli/patches/${public_file_name}"
done < <(
    "${node_path}" -e '
        const Yaml = require("yaml");
        const openSourceCliPatchList = Yaml.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
        for (const patch of openSourceCliPatchList) {
            const fileName = `${patch.packageName.replaceAll("/", "+")}+${patch.version}.dev.patch`;
            console.log(`${patch.sourceFileName}\t${fileName}`);
        }
    ' "${TEST_SRCDIR}/${TEST_WORKSPACE}/admin/open_source/cli_patch_list.yaml"
)

# Use Bazel's pinned dependency tree. The generated repository's lockfile is tested separately by
# target-repository CI with a clean `npm ci`. Build a shallow symlink tree so the test can add the
# `.bin` entry that npm scripts expect without mutating read-only runfiles.
runfiles_node_modules_path="${TEST_SRCDIR}/${TEST_WORKSPACE}/node_modules"
test_node_modules_path="${test_repository_path}/node_modules"
mkdir -p "${test_node_modules_path}/.bin"
while IFS= read -r dependency_path; do
    dependency_name="${dependency_path##*/}"
    [[ "${dependency_name}" == ".bin" ]] && continue
    ln -s "${dependency_path}" "${test_node_modules_path}/${dependency_name}"
done < <(find "${runfiles_node_modules_path}" -mindepth 1 -maxdepth 1 -print)
ln -s ../typescript/bin/tsc "${test_node_modules_path}/.bin/tsc"
ln -s "${node_path}" "${test_node_modules_path}/.bin/node"
ln -s "${npm_path}" "${test_node_modules_path}/.bin/npm"

# Prove that the public test command sees the exact test set selected by the publisher.
manifest_test_paths="${TEST_TMPDIR}/manifest_test_paths.txt"
repository_test_paths="${TEST_TMPDIR}/repository_test_paths.txt"
"${node_path}" -e '
    const manifest = require(process.argv[1]);
    for (const file of manifest.files.filter(file => file.isTest)) console.log(file.outputPath);
' "${manifest_path}" > "${manifest_test_paths}"
find "${test_repository_path}" \
    \( -path "${test_repository_path}/.git" -o -path "${test_repository_path}/node_modules" -o -path "${test_repository_path}/packages/cli/dist" \) -prune -o \
    -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.test.mts' -o -name '*.test.cts' \) -print \
    | sed "s#^${test_repository_path}/##" \
    | sort > "${repository_test_paths}"
diff -u "${manifest_test_paths}" "${repository_test_paths}"

# Bazel exposes npm package files through read-only symlinks. Run every public repository check
# without mutating those runfiles.
"${node_path}" "${test_node_modules_path}/typescript/bin/tsc" \
    --project "${test_repository_path}/tsconfig.json"
"${npm_path}" --prefix "${test_repository_path}" test
"${npm_path}" --prefix "${test_repository_path}" run build --workspace @alpine/cli

# `test:cli` creates and updates real Alpine resources with the GitHub Actions-only
# `CLI_TEST_ALPINE_API_KEY` secret. The public CI action runs it after this ZIP is published. This
# Bazel test has no production credentials.

test -x "${test_repository_path}/packages/cli/dist/alpine.js"
test -f "${test_repository_path}/packages/cli/dist/cli_tracer_background_main.js"
test ! -e "${test_repository_path}/admin"

# The generated repository must not describe the private publishing system. Keep that text in this
# repository, except for `TODO(#open-source)` entries that describe pending public release work.
published_repository_terminology="$(
    find "${test_repository_path}" \
        \( -path "${test_repository_path}/.git" -o -path "${test_repository_path}/node_modules" -o -path "${test_repository_path}/packages/cli/dist" \) -prune -o \
        -type f -exec grep -Ein 'open[ -]?source' {} + \
        | grep -Ev 'TODO\((#)?open-source\):' \
        || true
)"
if [[ -n "${published_repository_terminology}" ]]; then
    echo "The generated repository contains internal publication terminology:" >&2
    echo "${published_repository_terminology}" >&2
    exit 1
fi

if grep -Eiq 'cyberworlds|private (repository|workspace)|allowed_bazel_packages|admin/' \
    "${test_repository_path}/README.md"
then
    echo "The public README contains private repository or publication details." >&2
    exit 1
fi
