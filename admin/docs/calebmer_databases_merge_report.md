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

## `worktree-3`

- Source commit: `7d3f64d6c28b4bf5fefec2ca4404f74b4dd883e0`
- Merge commit: `517324cd312cdf938c81c3ea07c7261992dc91d0`
- Conflicts:
    - `app/databases_test/database_client_server_protocol.test.ts`: retained the explicit metadata
      event delivery from `alex/style-fixes`, including distinct revoked and restored policies with
      increasing manager generations. This preserves policy-revision ordering in the subscription
      revocation test.
    - `app/routes/_space.database.$tableOrViewId.tsx`: adopted `worktree-3`'s table-scoped route and
      database-group connection provider. Retained the target branch's concurrent loader work and
      strong-within-cache metadata read, but removed its view-ID redirect because the new route is
      intentionally canonicalized on the table ID until views have first-class metadata.
    - `app/routes/_space.database.query.$spaceId.tsx`: adopted the source branch's loader schema,
      authorization, metadata, and database-group connection provider. Removed the obsolete loader
      left by the renamed route and converted imports to `.open_source.js` paths.
    - `client/web/databases/grid_view/database_grid_view.tsx`: accepted removal of the route-level
      `SpaceId` dependency while retaining `.open_source.js` imports.
    - `server/databases/data/database_table_metadata.ts`: retained the target branch's
      database-group assignment, access-policy validation transaction, configurable strong read
      consistency, backing-table-first creation, and policy-revision synchronization. These are
      later safety changes than the overlapping implementations in `worktree-3`.
    - `server/databases/data/internal/database_tables_table.ts`: retained revision-bearing policy
      replicas and `.open_source.js` imports from `alex/style-fixes`.
    - `server/rpc/database_tables_rpc_implementations.ts`: retained the explicit strong metadata
      read required by the target branch's authorization API.
    - `server/search/data/index/internal/get_search_entity.ts`: retained the existing table search
      entity implementation instead of adding the source branch's older duplicate without policy
      revision data.
    - Accepted deletion of the two modify/delete-conflicted legacy `databases` route modules. Their
      behavior is replaced by the new singular `database` route topology and peek-route wrappers.
    - Updated the new database-group connection provider to use this branch's `.open_source.js`
      error and ID imports.
- Verification:
    - `dev check` passed all 981 selected checks after the import and formatting fixes.
    - `bazel test //app/databases_test:database_client_server_protocol_test` built but stopped
      before running tests because of the same generated Dynamo schema `reuseReferenceId` error
      recorded above.
    - Scoped `dev format` passed for the manually combined table route and new connection provider.
      The initial branch-wide format run reported only the ignored vendored declaration warning
      recorded above.
