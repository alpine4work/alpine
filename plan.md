# Database permissions — implementation plan

Branch: `alex/db-permissions`. Design settled 2026-07-08.

## Settled design

- **Async/sync split (documents pattern).** Space access is checked asynchronously once at the
  connection/request boundary (with the `web_socket_server.ts` wrapper's ~2-minute re-auth
  giving mid-session revocation for free). Everything per-table is a synchronous evaluation of
  the DO-local resolved `LocalAccessPolicy` via `getAccountAccessLevelAssumingSpaceAccess`
  (`shared/access/access_policy.ts`) — its "assuming space access" precondition is exactly what
  the boundary check guarantees. Accepted staleness bounds (consistent with the rest of
  Alpine): ≤ ~2min on open sockets, ≤ ~15s on request paths (space-membership cache TTL).
- **Level mapping (v1).** View/Comment → read-only; Edit/Manage → `schema+data`. Access-policy
  mutation stays Manage-only via the existing `updateDatabaseTableAccessPolicy` RPC.
- **Join tables.** Access level = max(source, target). Read at ≥View on either side.
  UPDATE/DELETE at ≥Edit on either side. INSERT additionally requires ≥View on *both* sides
  (you can't add a link to a row you can't verify exists; closes the rawSql hole too).
- **Enforcement points.** (1) the SQLite authorizer, per-statement per-schema, driven by a
  per-execution access resolver (the capability-set pattern — same swap discipline as
  `writeLevel`/`currentActionAccountId`); (2) realtime filtering of `PagesChanged`,
  `ensureCacheIsUpToDate`, and metadata events; (3) relation fields degrade to ids-only when
  the account can't read the linked table (UI renders "No access" chips).
- **Pushed access map, not failure discovery.** The client learns per-table access from the
  server (`ensureCacheIsUpToDate` response + redacted `TableMetadataChanged` events). This is
  *required*, not just cleaner: `_alpine_table` (incl. `access_policy`) is a singleton row in
  each table's own file, so a no-access client physically cannot read the linked table's
  policy.
- **Bypass.** `DatabaseGroupService`/`Test` actors and internal paths (bootstrap, migrations,
  `syncTableMetadata`) run unrestricted (resolver = null).
- **Punted.** Proactive OPFS purge on revocation (best-effort anyway; the access-map plumbing
  makes it a small follow-up). Client-side authorizer enforcement is optional (milestone 6).

## Verified facts the plan relies on

- The wasm authorizer binding passes all four string args:
  `xAuth(cbArg, actionCode, arg1, arg2, arg3, arg4)` — `arg3` is the schema (db) name for
  table-scoped ops; the current callback in `shared/databases/database.ts:267` only
  destructures `arg1`. (`admin/external_types/sqlite/ext/wasm/jswasm/sqlite3.d.mts:4101`.)
- `Database.executeAction` already swaps `currentActionAccountId` per execution
  (`shared/databases/database.ts:358`); `schemaToTable` maps schema names → table ids.
- `createTable` and `syncTableMetadata` are `internalOnly: true`; `renameTable` is a *user*
  action that writes `_alpine_table.name`/`table_name` and the main registry's
  `table_name_hash` — so main and `_alpine_table` writes cannot be blanket-denied; only the
  `access_policy` column must be protected.
- `DatabaseDurableObjectConnection.authorize()` is a no-op today; `transformEvent` passes
  `PagesChanged` through unfiltered and closes the socket when metadata-event authorization
  throws.
- `addLink` / `removeLink` / `listLinkableRows` actions already exist.

---

## Milestone 1 — Authorizer plumbing (shared, no behavior change yet) — ✅ done

**`shared/databases/sqlite_authorizer.ts`**
- Add `SqliteTableAccess = {read: boolean; insert: boolean; updateDelete: boolean;
  schema: boolean}` and `SqliteTableAccessResolver = (schemaName: string) =>
  SqliteTableAccess | "unrestricted"`. (`"unrestricted"` covers `main`, `temp`, and unknown
  schemas resolved by the caller's policy — see resolver rules below.)
- Extend the decision function (new arg: `schemaName: string | null` from `arg3`, plus the
  resolver) layered *on top of* the existing global `writeLevel` check: an op must pass both.
  Table-scoped action codes map as: `read`/`select` → `.read`; `insert` → `.insert`;
  `update`/`delete` → `.updateDelete`; DDL codes (`create-*`, `drop-*`, `alter-table`,
  `reindex`, `analyze`) → `.schema`. Non-table-scoped codes (`transaction`, `function`,
  `savepoint`, `pragma`, …) stay global-only.
- Protect the policy replica in restricted executions: deny `update` where
  `arg1 === "_alpine_table" && arg2 === "access_policy"`, and deny `insert`/`delete` on
  `_alpine_table` entirely (only `internalOnly` actions create/delete tables). `renameTable`'s
  `UPDATE _alpine_table SET name, table_name` still passes (column-granular).

**`shared/databases/database.ts`**
- Authorizer callback: destructure `arg1..arg3`; pass schema name through.
- New per-execution field `tableAccessResolver: SqliteTableAccessResolver | null` (null =
  unrestricted), threaded through `execute`/`executeSql`/`executeAction` options and swapped in
  `runTracked` exactly like `writeLevel`. Memoize per execution.
- Typed denial: when the resolver denies, record `{schemaName, action}` on the instance; in
  `execute`'s error path, convert SQLite's "not authorized" error into
  `PermissionDeniedError` naming the table id (via `schemaToTable`) and the denied operation.
  Clear the marker per execution.
- Resolver rules inside `Database`: schema `"main"` and `temp`/unknown-internal schemas →
  `"unrestricted"` (registry is public by design; global `writeLevel` still applies); attached
  schemas → look up table id via `schemaToTable`, delegate to the installed resolver.

**`shared/databases/database_action_context.ts`**
- Add `getTableAccess(tableId: DatabaseTableId): SqliteTableAccess` to
  `DatabaseActionContext` (NOT server-gated — milestone 5 needs it on both sides). Backed by
  the same per-execution resolver; returns all-true when unrestricted.

**Tests:** extend the authorizer unit tests (table-scoped codes vs resolver; `access_policy`
column denial; VACUUM/attach interplay unchanged); `database.test.ts` coverage for the
per-execution swap and the typed `PermissionDeniedError`.

## Milestone 2 — Server policy cache + enforcement on the server DO — ✅ done

**`server/databases/database_server.ts`**
- In-memory cache `Map<DatabaseTableId, {kind: "table"; policy: LocalAccessPolicy} |
  {kind: "join"; sourceTableId; targetTableId}>`:
  - Populate during `_bootstrap()` (it already sweeps `_alpine_tables` and attaches/migrates
    every file — read the `_alpine_table` policy row / join endpoints there).
  - Keep fresh via the existing table-change capture (`_installServerTableChangeCapture`
    triggers fire on `_alpine_table` writes): after each action, re-read policy rows for
    changed tables. `createTable`/`createRelationField` insert into the cache when they run.
- `getTableAccessForAccount(tableId, accountId | null): SqliteTableAccess`:
  - `kind: "table"` → `getAccountAccessLevelAssumingSpaceAccess(policy, accountId)` mapped per
    v1 (View/Comment → read; Edit/Manage → all flags). `accountId === null` (anonymous):
    urlGrant-only.
  - `kind: "join"` → recurse on both sides; `read` = either side ≥View; `updateDelete`/`schema`
    = either side ≥Edit; `insert` = (either ≥Edit) && (both ≥View).
  - Unknown table id → deny (registry-unknown files are already refused by attach-on-miss).
- `executeAction`: actor `DatabaseGroupService`/`Test` → resolver null; otherwise install a
  memoized resolver closing over `context.actor.getPossiblyBotAccountIdIfExists()`.

**New helper** `shared/databases/database_table_access_policy.ts` (or a sibling file):
`sqliteTableAccessForAccessLevel(level: AccessLevel | null): SqliteTableAccess` — the single
place the v1 level mapping lives.

**Tests:** `database_server` tests — per-account read/write denial via `rawSql` and typed error
messages; join-table INSERT vs DELETE matrix; service-actor bypass; cache refresh after
`syncTableMetadata` changes a policy mid-session.

## Milestone 3 — Connection/request space authorization — ✅ done

- New RPC `authorizeDatabaseGroupAccess({databaseGroupId})` in
  `shared/rpc/database_tables_rpc_definitions.ts` + `server/rpc/…_implementations.ts`: query
  the group's table-metadata partition, take `spaceId` from any item, `authorizeSpaceAccess`;
  empty group → allow. (Documents precedent: `authorize()` → RPC → full async evaluation.)
- `DatabaseDurableObjectConnection.authorize(context)`: replace the no-op with that RPC call.
  The wrapper's 2-minute re-auth + close-on-fail covers mid-session membership revocation;
  document the staleness bound in a comment here.
- Audit the HTTP `/action` route (`database_durable_object.ts` `_handleAction`) and any other
  DO entry points: same space check + real actor threading before `executeAction`.

**Tests:** connection tests for authorize pass/fail; revoked-membership socket close (mirror
the documents test shape).

## Milestone 4 — Realtime filtering, access map, redacted metadata events — ✅ done

**`server/databases/database_durable_object_connection.ts`**
- `transformEvent` `PagesChanged`: filter `pageDiffs` to tables where
  `getTableAccessForAccount(tableId, connectionAccountId).read` (main always passes). Send the
  event even when the map filters to empty — `mutationId` confirmation must still flow.
- `ensureCacheIsUpToDate`: skip page reads + tracker seeding for requested tables the account
  can't read. Extend the response with `tableAccess: Map<DatabaseTableId, wire-level>` covering
  **all registered tables** (from the milestone-2 cache), so the client can distinguish
  "no access" from "not yet synced" — it cannot derive this locally (policy rows live inside
  the inaccessible files). Schema work in `shared/databases/database_protocol_schemas.ts`.

**Redacted metadata events** (`server/databases/data/database_table_metadata.ts`,
`shared/databases/database_realtime_protocol.ts`)
- `getDatabaseTableMetadataRealtimeEvent`: replace throw-on-deny with a redacted event variant
  `{tableId, redacted: true}` (no name, no policy); `DeleteItem` → redacted likewise. Fixes the
  mixed-access socket-teardown bug and doubles as the access-map delta channel (a redacted
  event = revocation signal; a full event where the client previously had a redacted one =
  grant signal). Extend `DatabaseTableMetadataRealtimeEventSchema` with the variant; update the
  route component's `useRynamoItem` forwarding to ignore/handle redacted events.

**Client worker** (`client/web/databases/worker/database_client.ts`,
`database_connection_manager.ts`)
- Hold the access map; initialize from `ensureCacheIsUpToDate`, update from
  `TableMetadataChanged` (the worker's page socket already speaks the protocol; it currently
  ignores metadata events). Invalidate/re-run live queries on map deltas.

**Tests:** connection tests — mixed-access page filtering, empty-diff mutation confirmation,
`ensureCacheIsUpToDate` withholding + access map contents; metadata redaction (update the two
existing tests that assert socket close).

## Milestone 5 — Relation-field degradation + UI — ✅ done

Note: client-side authorizer enforcement (M6 first bullet) was pulled into M5 — the worker
installs a `tableAccessResolver` from the pushed access map on every local execution.

- `shared/databases/fields/database_relation_field.ts`: `_selectColumn` /
  `_selectColumnAsString` consult `ctx.getTableAccess(relation.linkedTableId).read` (server:
  DO cache resolver; client: access map threaded into action-context creation by the worker).
  No read → emit ids-only (`name` = NULL, skip the `JOIN` into the linked table's file so the
  statement never touches it). Make `name` nullable in the relation value schema; check
  backwards compatibility for older clients receiving `name: null`.
- Client/server determinism: both sides decide from the same server-computed access state, so
  local execution and server fallback of `getViewRowsPage` return the same shape.
- `listLinkableRows` reads the target table → authorizer denies naturally (hard error); the UI
  must disable link-adding when the map says no access (and render `name: null` chips as
  "No access") — grid cell rendering + `client/web/databases/use_grid_view_fields.ts`.
- `addLink`: server authorizer enforces the both-sides-View INSERT rule; `removeLink` works at
  Edit-on-either.

**Tests:** relation field unit tests for ids-only SQL (no reference to the linked schema);
action tests for addLink denial / removeLink success under one-sided access; a UI story/test
for the "No access" chip.

## Milestone 6 (optional, post-v1)

- ✅ Client-side authorizer enforcement from the access map (fail optimistic writes fast instead
  of rebase-discarding them). Landed in M5: the worker installs a `tableAccessResolver` on every
  local execution.
- ✅ OPFS purge on revocation. `DatabaseClient.purgeRevokedTables()` runs on both access-map
  entry points (`ensureCacheIsUpToDate` full-map replacement and `applyTableAccessLevels`
  event deltas): detaches the per-table file (`Database.detachTableIfAttached`, dropping
  buffered writes), deletes the OPFS subdirectory (`OpfsDatabaseStorage.delete`), invalidates
  overlapping reactive queries, and discards + replays the optimistic queue so now-denied
  mutations drop out. Best-effort: a schema locked by an open transaction is skipped and
  retried on the next push.
- Membership-driven policy re-push (product-wide gap: `removeSpaceAccount` triggers nothing;
  a `Space:*` search-entity dependency would close the ≤2min window). Remains open — needs a
  product-wide membership-propagation mechanism, not databases-specific.

## Known limitations / open items

- **Main registry writes:** any user with Edit on any table can `rawSql` into `main`
  (`renameTable` legitimately writes `table_name_hash`, so main can't be read-only for user
  executions). Registry corruption is a self-DoS of the group, not a data leak (registry is
  ID-only + salted hashes). Optional hardening later: column/table allowlist for main writes.
- **Anonymous / urlGrant** scope for v1: resolver supports urlGrant-only evaluation, but the
  connection-level space check must decide what anonymous connections are allowed at all —
  follow whatever `authorizeSpaceAccess` does for documents' urlGrant flow.
- **Comment level** maps to read-only in v1 (no row comments yet).
- Verify during M3 which non-WebSocket DO entry points exist beyond `/action`.
