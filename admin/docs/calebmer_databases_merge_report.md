# `calebmer/databases` merge report

This report records branches merged into `calebmer/databases`, including manual conflict resolutions
and verification performed after each merge.

## `alex/wasm-execution`

- Source commit: `6cb4bfb95e9d10cf174fbf39f6a37a6a8f439d00`
- Merge commit: `fe0bb9006432a68460e99161bf4810a9dc8a1a64`
- Conflicts:
    - `server/databases/data/database_table_metadata.test.ts`: kept the target branch's
      `.open_source.js` import paths while incorporating the source branch's backing-table failure
      setup and test.
    - `server/databases/sqlite3_wasm_init_worker.ts`: adopted the source branch's direct bundled
      WASM module import and removed the target branch's `globalThis.__sqlite3WasmModule` lookup and
      assertion. This matches the source branch's associated esbuild, Miniflare, and Wrangler module
      configuration.
- Verification:
    - `dev check` passed all 981 selected checks.
    - `bazel test //server/databases/data:database_table_metadata_test` built but the suite stopped
      before running tests because the generated Dynamo schema description contained an invalid
      `reuseReferenceId`. No merged test assertion ran.
    - `dev format` found no formatting changes. It exited nonzero only because ESLint warned that
      the vendored `admin/external_types/sqlite/ext/wasm/jswasm/sqlite3.d.mts` file matched an
      ignore pattern.

## `alex/style-fixes`

- Source commit: `87564e0dde077d7852b1dd2d25629d43a84841f2`
- Merge commit: `d56cd48053de87bf269c0a2a48e02c32e40b6d19`
- Conflicts:
    - `server/databases/data/database_table_metadata.ts`: preserved the backing-table-first ordering
      from `alex/wasm-execution` so a failed Durable Object create does not publish unusable
      metadata, while passing the initial metadata version required by `alex/style-fixes`
      policy-revision tracking. The subsequent Dynamo write asserts that its initial version matches
      the revision.
    - `server/search/data/index/internal/get_search_entity.ts`: retained the target branch's
      existing database-table search entity function instead of adding the source branch's
      duplicate, and added the metadata version to its Durable Object synchronization input.
    - Updated the new policy-revision modules to use this branch's `.open_source.js` import paths
      for `Schema` and `exhaustive`.
- Verification:
    - `dev check` passed all 981 selected checks after the import-path compatibility fixes.
    - `bazel test //shared/databases:database_actions_test //server/databases:database_server_test`
      passed.
    - `bazel test //app/databases_test:database_client_server_protocol_test` built but stopped
      before running tests because of the same generated Dynamo schema `reuseReferenceId` error
      recorded above.
    - `dev format` found no formatting changes. It reported the same ignored vendored declaration
      warning recorded above.
