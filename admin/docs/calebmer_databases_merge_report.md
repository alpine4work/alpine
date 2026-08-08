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
