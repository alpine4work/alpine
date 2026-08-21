#!/bin/bash

set -euo pipefail

archive_path="$1"
npm_path="$2"
output_lock_path="$3"
temporary_directory_path="$(mktemp -d)"
trap 'rm -rf "${temporary_directory_path}"' EXIT

# Resolve from the archive rather than this checkout. That keeps the source lockfile aligned with
# the public repository's stripped paths, manifests, and workspace layout.
public_repository_path="${temporary_directory_path}/public-repository"
mkdir -p "${public_repository_path}"
unzip -q "${archive_path}" -d "${public_repository_path}"

# The generated public package JSON pins every version with a patch. Remove the old lockfile so npm
# resolves those pinned versions instead of retaining compatible versions from the previous lock.
rm "${public_repository_path}/package-lock.json"

(
    cd "${public_repository_path}"
    "${npm_path}" install --package-lock-only --ignore-scripts --no-audit --no-fund
)

cp "${public_repository_path}/package-lock.json" "${output_lock_path}"
