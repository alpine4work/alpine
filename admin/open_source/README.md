# Open-source publishing

This package owns the private build that produces Alpine's public repository. Nothing below `admin`
is eligible for publication.

TODO(#open-source): Add the approved open-source license before using the generated repository for a
production release.

## How Bazel builds the public repository

Bazel builds a ZIP containing the public repository. It does not copy files into a second checkout.
The `open_source_repository()` macro creates these targets:

- `//admin/open_source:open_source_repository_sources` — the exact tagged source filegroup;
- `//admin/open_source:open_source_repository_ci_inputs` — the workspace sources that can change the
  archive or its validation, including producers of generated public files;
- `//admin/open_source:open_source_repository` — the ZIP plus a private manifest listing the files
  and imports it contains;
- `//admin/open_source:open_source_repository_typescript_test` — type-checks the unzipped public
  ZIP; and
- `//admin/open_source:open_source_repository_test` — runs the public typecheck, tests, and CLI
  build against that same ZIP.

The archive action receives every selected file as a declared Bazel input. The TypeScript publisher
only reads, validates, rewrites, and archives those inputs. It never searches the worktree. Bazel
therefore rebuilds the ZIP only when an input or the publication code changes, and can reuse a prior
ZIP when neither has changed.

The source filegroup is assembled in two parts:

1. Root-level repository metadata, such as `README.open_source.md` and `.open_source.github`, is
   declared in the root `BUILD` file.
2. The public-source aspect follows the reviewed TypeScript package targets and their same-package
   wrappers. This includes tagged implementation files, tagged tests, and generated public outputs
   without maintaining a per-file list.

The `ts_project()` macro also checks tagged TypeScript paths as Bazel loads their package. A
`.open_source` file in a package absent from the central allowlist fails analysis immediately,
before that package can build. This is intentionally separate from archive collection. The archive
only traverses reviewed packages, so an unrelated private package never becomes an archive input.

## Selection and package approval

Public files remain next to their private counterparts. Add `.open_source` to a file or directory
component to select it; the output removes the tag from the path and parsed module references.

The `OPEN_SOURCE_ALLOWED_BAZEL_PACKAGES` constant in
[`open_source_configuration.bzl`](./open_source_configuration.bzl) is the sole package opt-in
policy. To add public files in a new package, review that package and add its `//package/path` label
there. Do not add individual file paths to a second list.

The archive validator additionally rejects untagged inputs, private `admin` paths, output conflicts,
unsafe paths, symbolic links, non-literal module loading, imports of unpublished workspace files,
and npm imports absent from the public package manifests.

## Stub files

`*.open_source.stub.*` is not a one-to-one public copy. It overwrites the corresponding untagged
file in the generated repository while private development continues to use the real implementation.
The central `stub_destination_files` target list declares the private files that stubs may replace.
Bazel resolves those file labels during analysis to prove the destinations exist, but the private
files themselves are not archive inputs.

For example, `shared/tracer/types/tracer_service_name.open_source.stub.ts` replaces the private
service-name union with the public CLI-only service name. This prevents internal service names from
reaching the public repository while preserving the regular import path for callers. Validation
requires every declared destination to have exactly one stub and forbids public source from
importing stub filenames directly.

## Public layout

The archive preserves the workspace directory layout; there is no generated `src/` directory or
template repository. Examples:

- `README.open_source.md` becomes `README.md`;
- `package.open_source.json` becomes `package.json`;
- `packages/cli/package.open_source.json` becomes `packages/cli/package.json`; and
- `.open_source.github/actions/test/action.yml` becomes `.github/actions/test/action.yml`.

Use `name.open_source.test.ts` for a public test. It becomes `name.test.ts` and is picked up by the
public test glob after packaging.

## CLI dependency patches

Private development uses pnpm patches from `admin/patches`. The public repository uses npm and
`patch-package`, so the archive converts only the patches needed by the public CLI. It writes them
to `packages/cli/patches` and rewrites their diff headers from package-relative paths to
`node_modules/<package>` paths. The CLI's `postinstall` script applies those patches whether the CLI
is installed as a workspace or from its npm tarball.

`cli_patch_list.yaml` and the public root package's npm overrides are generated from the public CLI
manifest and lockfile. When CLI dependencies or private patches change, refresh generated inputs in
this order:

```sh
bazel run //admin/open_source:write_open_source_cli_patch_list
bazel run //:write_open_source_cli_patch_files
bazel run //:write_open_source_package_lock
```

## CI

The first unit-test runner asks Bazel for `open_source_repository_ci_inputs` after restoring its
Bazel cache in both the pull request's base and current worktrees. It compares the union of those
declared source inputs with the pull request diff, so additions, changes, and deletions all schedule
the public jobs. The filegroup includes the archive's direct public sources, the source producers
for generated public files, and the publication package's TypeScript, test, Starlark, and shell
inputs. It schedules no public jobs for a pull request without a public-repository change. Comparing
to the base also means a CI-only follow-up commit cannot skip a still-unpublished public change from
an earlier commit in the same pull request.

When scheduled, the CI chain is:

1. **Open source archive** runs `bazel build` on the ZIP on an ASG runner. Import and stub
   validation run while Bazel builds the ZIP, then CI uploads that same ZIP unchanged.
2. **Open source test** downloads and extracts only that ZIP on a GitHub-hosted runner. It does not
   check out this private repository, then executes the public `test` action from inside the
   extracted tree.
3. **Open source publish** runs only after that public CI and the private aggregate checks pass. It
   replaces the target mirror's worktree while retaining its Git history, then commits with the
   current UTC timestamp.

The generated repository's CI stops before npm publication. npm publishing will be added separately
and is expected to publish at most once per day when public changes exist.

## Local development

Build the archive or inspect its source filegroup:

```sh
bazel build //admin/open_source:open_source_repository
bazel cquery --output=files //admin/open_source:open_source_repository_sources
bazel cquery --output=files //admin/open_source:open_source_repository_ci_inputs
```

Unpack the exact ZIP Bazel built into the ignored test directory:

```sh
bazel run //admin/open_source:publish_open_source_repository
```

This writes `admin/open_source/result`, which has the same layout as the public repository but no
Git history. To verify the public output locally:

```sh
bazel test \
  //admin/open_source:open_source_repository_typescript_test \
  //admin/open_source:open_source_repository_test
```

The patch list, public npm overrides, and public lockfile are generated source files. Their
`write_source_files` diff tests run in the open-source archive CI job and print the update command
when a checked-in file is stale.
