# Review — `databases: Store table data in per-table database files` (14 commits, `409c333..HEAD`)

Scope: 22 files, +2472/−1058. Each table's data + metadata moves into its own `ATTACH`-ed SQLite
file; the main DB becomes an ID-only registry. Plus a new `SqlQuery`/`sql` tagged-template builder
adopted at all call sites. Type-check/lint pass repo-wide (only the pre-existing `NOCOMMIT` in
`database_durable_object_connection.ts` fails lint, outside this diff).

## 🔴 Correctness

**C1. Cold-open is no longer offline-tolerant, and a transient failure permanently poisons the
client for the worker's lifetime** — `client/web/databases/database_active_tab_manager.ts:223`
_(CONFIRMED, highest severity)_. The diff deletes the `try/catch` around `ensureCacheIsUpToDate` and
the best-effort `.catch(() => {})` on `ensureSchemaPagesLoaded`, and adds a mandatory
`await client.attachExistingTables(conn)`. All three are now hard awaits inside the
`getOrCreateClient` IIFE, whose promise is stored in `clientPromises` at line 239 _before_ it
resolves — and `clientPromises` is never `.delete`d (only `.get`/`.set`/`.has` exist). A tab opening
during a brief server/WebSocket blip rejects `ensureCacheIsUpToDate`; the cached promise rejects;
every later `getOrCreateClient(groupId)` returns the same rejected promise, so the group is
unopenable for the life of the worker even after the server recovers — where the old code proceeded
offline with a stale cache and fetched pages on demand.

**C2. Re-entrancy: `await ensureTableAttached` between `discardBuffer()` and `applyServerPages()`
lets a concurrent RPC re-dirty the buffer and crash the apply** —
`client/web/databases/database_client.ts:611` _(CONFIRMED mechanism, timing-dependent trigger)_.
`executeActionViaServer` now does `discardBuffer()` →
`for (...) await this.ensureTableAttached(...)` → `applyServerPages()` (which asserts
`assertBufferIsEmpty`). The new `await` is a yield point that didn't exist before. RPC handlers are
not serialized per client (`WebWorkerRpc.handleRequest` does `handler(input).then(...)` with no
mutex; the worker shares one `DatabaseClient` across tabs). A `createTable` or any
`PageMissingError` fallback reaches the attach loop; during the `storage.create` yield, a concurrent
`executeAction` (writes the buffer directly) or `writePageDiffsFromRealtime` (calls
`replayOptimisticQueue`) re-dirties the buffer → on resume `assertBufferIsEmpty` throws, losing the
server response and desyncing the optimistic queue.

**C3. Optimistic `executeAction` only falls back on `PageMissingError`; a "no such table" on an
unattached per-table file hard-rejects** — `client/web/databases/database_client.ts:192`
_(PLAUSIBLE)_. The catch routes to the server only for `PageMissingError`; any other throw rethrows.
A per-table action against a `tableId` whose per-db file isn't attached locally throws a plain
`no such table: _<tableId>._alpine_fields`, so the user-facing mutation rejects with no server
fallback. Trigger: a table the local connection hasn't attached mid-session (it only attaches at
cold-open via `attachExistingTables`).

**C4. `attach()`'s error path orphans the SQLite attachment (no `DETACH`), wedging the table for the
connection's life** — `shared/databases/database.ts:492` _(PLAUSIBLE; see also A13 below)_. The
catch is `{ this.tables.delete(tableId); throw error; }` with no `DETACH`. If `ATTACH DATABASE`
succeeds but the subsequent `page_size` PRAGMA throws (e.g. a VFS `xRead` of a
corrupted/partially-synced per-db header, which the VFS asserts on), SQLite keeps the schema bound
while the wrapper forgets it; a retry re-issues `ATTACH ... AS _<tableId>` →
`database _<tableId> is already in use`, permanently. Fix: best-effort `DETACH` in the catch.

**C5. Bare `/databases` and `/peek/databases` now 404 instead of redirecting** —
`app/routes/s.$spaceId.databases._index.tsx:6` _(CONFIRMED behavior change; may be intentional)_.
The index loader now unconditionally `throw notFoundResponse()`; the peek index re-exports it. The
deleted loader redirected to the first table or `/sql`, with a comment specifically preserving the
peek URL namespace. A `/databases/new` creator still exists, so a group isn't a dead end, but saved
links / back-nav to the bare path now 404. Confirm this is the intended new contract.

## 🟢 Cleanup / reuse / simplification

**S1. `sql` template's `.replace(/\s+/g, " ")` rewrites whitespace inside SQL string literals and
merges `--` comments** — `shared/databases/sql.ts:232`. Latent today (all multi-word values are
bound params, no `--` comments), but a sharp trap in shared infra and inconsistent with the
no-collapse `sql.raw`/`selectAllUnknown` path.

**S2. `sql` template JSON-stringifies any object bind, including `Uint8Array`** —
`shared/databases/sql.ts:228`. `value && typeof value === "object" ? JSON.stringify(value) : value`
turns a BLOB bind into `'{"0":12,...}'`, despite `BindableValue` including `Uint8Array`. Latent.

**S3. `getViewRowsPage` encodes two independent cursor bounds as a 4-branch if/else cascade, and
builds its SELECT list by poking `.query` + `sql.raw`-rejoining** —
`shared/databases/database_actions.ts:618` and `:602`. Collect fragments into an array and add a
`sql.join(fragments, ", ")` helper; the `.map(c => c.query).join(", ")` path silently drops any
`bind` a fragment carries.

**S4. `addPageToInvalidate` hand-rolls the get-or-create-Set pattern** —
`client/web/databases/database_client.ts:503`. Exactly
`getOrSetDefaultMapValue(this.pagesToInvalidate, tableId, () => new Set())`; the helper is already
imported in this file (used at line 552).

**S5. `sql.tableRef` re-implements `sql.identifier`'s `" → ""` escaping inline (twice)** —
`shared/databases/sql.ts:270`. Escaping now lives in three places. Compose
`sql.identifier(databaseTableSchemaName(schema))` + `sql.identifier(name)` instead.

**S6. `ensureSchemaPagesLoaded` duplicates `listTableIds`'s `SELECT id FROM _alpine_tables`** —
`shared/databases/database_actions.ts:291` (called at `database_active_tab_manager.ts:232`).
Cold-open does `attachExistingTables` (→ `listTableIds`) then `ensureSchemaPagesLoaded`, two
round-trips warming the same registry pages. Fold the warm into the attach step.

## ⚪ Altitude (additions)

**A14. Cold-open attaches tables one-at-a-time and reinstalls the page-access hook per attach → O(N)
serial OPFS I/O and O(N²) hook installs** — `client/web/databases/database_client.ts:575`,
`shared/databases/database.ts:502`, `server/databases/database_server.ts:143`. Each
`ensureTableAttached` serializes ~5 OPFS round-trips; each `attach()` reinstalls the hook over all
attached pagers. Startup latency scales with table count. Create the stores concurrently
(`runAllPromises`), serialize only the synchronous `ATTACH`es, and reinstall the hook once after the
batch.

**A15. The main table is keyed in `schemaToTable` as `"main"`, diverging from
`databaseTableSchemaName(mainId)` (`_<mainId>`)** — `shared/databases/database.ts:198`. Latent trap:
`sql.tableRef(databaseMainTableId, …)` yields a never-attached schema → `no such table`. Holds only
because main is always referenced unqualified today.

---

## 🟡 Efficiency (hot paths)

**8. `server/databases/database_durable_object_storage.ts:88,131` — per-row work on the
write/truncate path.** The truncate path runs `SELECT DISTINCT page_index … >= ?` then one
`INSERT … NULL` per row; `_persistAndBuildResult` issues one `storage.readPage` per changed page for
before-images. Both scale linearly with page count via separate SqlStorage round-trips. Batch the
tombstone insert (`INSERT … SELECT …`) and the before-image reads (`… page_index IN (…)`).

**9. `shared/databases/database.ts:~398` + `admin/patches/bazel/sqlite.patch` (OO1 wrapper) —
per-page-read overhead.** The hook now does `wasm.cstrToJs(zSchemaPtr)` (allocates a JS string)
_and_ `schemaToTable.get(schemaName)` (string hash) on **every** page read, where the old hook used
an ignored integer `pArg`. For the common no-ATTACH case this hashes the constant `"main"` per page.
Consider memoizing by pointer value or short-circuiting the single-table case.

## ⚪ Altitude

**13. `shared/databases/database.ts:402` — `attach()` failure handling is incomplete and the design
rests on un-enforced contracts.** If `sqliteAttachPagePragma` throws _after_ `ATTACH` succeeds, the
catch deletes the `tables` entry but the schema stays attached in SQLite — now untracked,
un-detachable (authorizer bans `DETACH`), and a retry hits "already attached," wedging that
`tableId`. More broadly: the "re-install the hook after every ATTACH" rule and the `schemaToTable`
map (never pruned, no `detach()`) are manual contracts whose safety currently depends entirely on
the authorizer ban + VACUUM's specific behavior. The `actionArg === ""` VACUUM detection
(`sqlite_authorizer.ts:107`) also rides on an undocumented SQLite internal that no test pins. Worth
an explicit assertion/test rather than convention.
