# PR Review: alex/db-permissions

## General Feedback

This branch adds linked-record editing, per-table access policies, a multi-table
SQLite page protocol, client connection management, and database-table search.
The remaining storage and realtime changes are not ready to merge: optimistic
mutations can be reported as failed after the server commits them, policy replicas
can preserve or restore stale grants, and the storage rewrite has both an
unbounded-growth problem and a deterministic truncate/re-extend collision.

The rollout is also unsafe for existing data and old clients. The new Durable
Object page tables do not migrate the legacy store, existing tables are absent
from both new metadata stores, and old clients reject new action shapes, realtime
events, and search variants. Reactive queries can also miss invalidations that
arrive during an in-flight refresh, while the action-definition helper discards
its declared output contract through `any`. Structurally,
`shared/databases/database.ts` is already 1,377 lines and owns several independent
subsystems. Alternative framing: treat this as a versioned storage/security
protocol migration, stage tolerant readers and data backfills first, and separate
the storage and authorization boundaries before layering the linked-record UI on
top.

---

## Bugs

Authorization findings that also appeared in the general pass are preserved in
the more detailed Security section below.

### [ ] Preserve invalidations that arrive during reactive re-execution

`client/web/databases/worker/database_client.ts:486`

```ts
const notifyIfChanged = () => {
    if (reExecuting) return;
    reExecuting = true;
    void (async () => {
        try {
            notify(
                await executeAndUpdateReactive({
                    seedUnknownDependenciesOnFailure: false,
                }),
            );
        } catch (error) {
            reportError(error);
        } finally {
            reExecuting = false;
        }
    })();
};
```

An invalidation received while `reExecuting` is true is silently dropped. More
subtly, `invalidateForPages()` first marks the tracked execution dirty, but the
in-flight run later calls `setTrackedSnapshot()`, which clears `dirty`. If that run
read its snapshot before the second write reached storage, the UI remains on the
first write until an unrelated future invalidation overlaps it.

Track a “dirtied while running” flag and schedule another execution in `finally`
when it was set, providing both leading- and trailing-edge refreshes. Add a test
where two overlapping writes land on opposite sides of an awaited re-execution.

### [ ] Wait for the realtime confirmation before returning the mutation procedure response

`server/databases/database_durable_object_connection.ts:117`

```ts
const pageDiffs = buildDatabasePageDiffs(result.changedPages, result.readPages);
if (pageDiffs.size > 0) {
    // `sendEventToAll()` is fire-and-forget while each connection asynchronously
    // transforms the event. The procedure can return before realtime confirms the
    // optimistic mutation, causing the client to report failure after the server
    // committed it.
    this._sendEventToAll(this._processContext, {
        type: "PagesChanged",
        pageDiffs,
        mutationId: input.mutationId,
    });
}
```

Make the event callbacks return promises and await
`sendEventToAllAndWait()`/`sendEvent()` before returning the procedure response.
The empty self-confirmation path needs the same ordering guarantee.

### [ ] Do not insert a tombstone and replacement page under the same primary key

`server/databases/database_server.ts:445`

```ts
for (const [databaseTableId, size] of truncates) {
    // ...collect every existing page at or past the truncate boundary...
    for (const pageIndex of pageIndexes) {
        sql`
            INSERT INTO database_table_pages
                (sqlite_id, page_index, version, data)
            VALUES (${sqliteId}, ${pageIndex}, ${version}, NULL)
        `.exec(this.sql);
    }
}

// The following loop can insert a replacement page with the same
// (sqlite_id, page_index, version) key.
for (const [databaseTableId, tablePages] of pages) {
    for (const [index, data] of tablePages) {
        sql`INSERT INTO database_table_pages /* ... */`;
    }
}
```

If one batch truncates and re-extends a previously existing page, the tombstone
and replacement use the same primary key and the mutation fails with a uniqueness
violation. Exclude page indexes present in `pages` from tombstoning, or upsert the
final state once per page. Add a regression test with an existing high page that
is truncated and rewritten in one `writePages()` call.

### [ ] Recompute access deltas for join tables when either side's policy changes

`server/databases/database_durable_object_connection.ts:341`

```ts
const tableAccess = new Map<DatabaseTableId, AccessLevel | null>();
const accountId = context.actor.getPossiblyBotAccountIdIfExists();
for (const event of events) {
    if (event.type !== "PutItem") continue;
    const tableId = event.item.model.tableId;
    // Only the directly changed user table is included.
    tableAccess.set(
        tableId,
        this._server.getTableAccessLevelForAccount(tableId, accountId),
    );
}
```

A join file's access is derived from the maximum access to its source and target,
but this delta includes only the user table whose Dynamo metadata changed. When
both sides are revoked, `purgeRevokedTables()` never receives the join ID, so its
linked-row data remains in OPFS until a later reconnect. Query joins touching each
changed table and include their newly derived levels in the delta.

### [ ] Merge loader page seeds instead of replacing earlier route data

`client/web/databases/worker/database_connection_manager.ts:108`

```ts
if (input.pages.size > 0) {
    if (state.clientPromise !== undefined) {
        const client = await state.clientPromise;
        await client.writeLoaderPages(input.pages);
    } else {
        // Each pre-client seed replaces all earlier route data.
        state.initialPages = input.pages;
    }
}
```

The layout seeds table-ID pages, the reactive action seeds schema pages, and the
query seeds row pages before the first watch creates the client. Each callback
replaces `initialPages`, so only the last seed survives. Merge by table/page while
keeping the highest version in this path and `writeInitialPages()`.

### [ ] Preserve metadata event order while resolving policies in parallel

`server/databases/data/internal/database_tables_table.ts:64`

```ts
await runAllPromises(
    events.map(async ({itemKey, eventStub, getEvent}) => {
        if (itemKey.partitionType !== "Table") return;
        const event = await getEvent(context);
        // ...await policy resolution...
        const {databaseGroupId} = event.item.model;
        getOrSetDefaultMapValue(eventsByDatabaseGroupId, databaseGroupId, () => [])
            .push(eventStub);
    }),
);
```

These callbacks push into shared arrays and overwrite shared maps in completion
order, not transaction order. A slower earlier event can be broadcast after a
later event, and multiple updates for one table can leave the Durable Object with
whichever policy resolves last. Resolve indexed result objects in parallel, then
build arrays and maps synchronously in original order.

`getDatabaseTableMetadataRealtimeEvent()` at
`server/databases/data/database_table_metadata.ts:228` repeats the unordered-push
pattern for `visibleEvents`/`deniedTableIds` and should be fixed with it.

### [ ] Table creation can permanently commit only half of the table

`server/databases/data/database_table_metadata.ts:39`

```ts
await DatabaseTablesTable.updateItem(
    context,
    {partitionType: "Table", sortRangeType: "Attributes", tableId},
    item => DynamoItem.createOrUpdate(item, {/* ... */}),
);

//////////////
// Database-group assignment is now atomic, but the Dynamo metadata record (and its
// realtime broadcast) still commits before the durable object's SQLite table/file
// is created. If the second step fails, the metadata stays visible but the generated
// id is lost to the caller; because the RPC is explicitly non-idempotent, retrying
// creates a second id instead of repairing the first table.
//
// Model creation as a retryable saga with an idempotency key / persisted creation
// state, or add explicit compensation and reconciliation. Whichever store commits
// first can fail independently, so merely reversing these calls moves rather than
// fixes the partial-state bug.
//////////////
const {result} = await fetchDatabaseGroupAction(context, databaseGroupId, {
    name: "createTable",
    input: {tableId, name, accessPolicy},
});
```

## Performance Issues

# Performance Review

## Summary

This change has several high-risk scaling and operating-cost regressions. The
canonical Durable Object store retains every 4 KiB page version indefinitely;
every database statement and action is logged in production; and every mutation
broadcasts page diffs to every authorized connection, including browsers that do
not cache the changed pages. On the client, each received mutation synchronously
rewrites and flushes the full OPFS page index. Reconnect validation and the linked
record picker also have work proportional to all cached pages or all rows. These
costs compound: a write creates permanent storage, log, broadcast, OPFS, and
revalidation work.

## Async Orchestration

### [ ] Open independent per-table OPFS stores in parallel

`client/web/databases/worker/database_client.ts:110`

**Callers affected:** Database worker cold-open through
`DatabaseConnectionManager.getOrCreateClient`, loader-page seeding through
`writeLoaderPages`, and server fallbacks that return pages for several tables.
**Time impact:** Cold-open and fallback latency grow linearly with the number of
cached/returned tables. `OpfsPageStore.create` performs multiple asynchronous OPFS
handle opens per table, but the stores are in distinct directories and do not
depend on one another.
**Cost impact:** Longer dedicated-worker occupancy and slower interactive database
startup; no direct RCU/WCU impact.

```ts
await storage.create(databaseMainTableId);
for await (const name of groupDir.keys()) {
    const tableId = name as DatabaseTableId;
    if (storage.get(tableId) === undefined) {
        // Every independent table waits for all OPFS opens for the prior table.
        // The same pattern appears at lines 759-760 and 833-835.
        await storage.create(tableId);
    }
}
```

**Recommendation:** Collect the table IDs, then open distinct stores with
`runAllPromises()`. Apply the same pattern to `writeLoaderPages` and
`executeActionViaServer` using the existing deduplicating `openStore()` helper.
Keep the main store creation ordered before `Database.create`, but do not serialize
the remaining independent table opens.

### [ ] Fetch table metadata alongside the dependent cursor/page chain

`app/routes/_space.databases.$spaceId.$tableOrViewId.tsx:66`

**Callers affected:** The interactive SSR loader for every database table/view.
**Time impact:** After `getViewSchema` resolves, the metadata item is independent
of the cursor lookup and page fetch, but it waits until both Durable Object calls
complete. Caleb's merge removes the redundant space-to-group lookup and permits a
`StrongWithinCache` metadata read, but site-backed policies still add another
preview fetch to the serial tail. Time-to-first-render remains the sum of the
cursor/page Durable Object chain and the metadata/site-preview chain.
**Cost impact:** No extra service calls, but avoidable App Service and Durable
Object request occupancy on every table navigation.

```ts
const cursorResult = await fetchDatabaseGroupAction(context, databaseGroupId, {
    name: "getViewRowsPageCursor",
    input: {tableOrViewId, afterCursor: null, limit: databaseViewTargetRowsPerPage},
});
const pageResult = await fetchDatabaseGroupAction(context, databaseGroupId, {
    name: "getViewRowsPage",
    input: {tableOrViewId, afterCursor: null, endCursor: cursorResult.result.endCursor},
});
// Independent once schemaResult supplies tableId, but starts only now.
const tableMetadataItem = await getDatabaseTableMetadataItemForLoader(
    context,
    schemaResult.result.tableId,
    {consistency: "StrongWithinCache"},
);
```

**Recommendation:** After the canonical-URL check, use `runAllPromises()` to run
the metadata/site-preview chain alongside the cursor-then-page chain. Keep cursor
and page ordered because the page boundary depends on the cursor. A combined
server action that returns `{endCursor, rows}` would further remove one Durable
Object round trip, but parallelizing the independent chain is the smaller change.

## Call-Site Impact

### [ ] Filter realtime page diffs by the pages each browser can actually hold

`server/databases/database_durable_object_connection.ts:317`

**Callers affected:** Every connected browser on the database-group Durable Object
for every WebSocket or server-originated mutation.
**Time impact:** `transformEvent` serializes and sends every changed page diff to
every connection with table access. Clients that never fetched the page still
deserialize and dispatch the event; if they have the table store open, they also
run the OPFS sync path even though `readPage` returns no base to patch.
**Cost impact:** WebSocket egress and Durable Object CPU scale as
`connections × changed pages`. A diff can approach the full 4 KiB SQLite page,
and one SQL mutation can dirty several pages.

```ts
for (const [tableId, diffs] of eventStub.pageDiffs) {
    if (
        tableId === databaseMainTableId ||
        this._server.getTableAccessLevelForAccount(tableId, accountId) !== null
    ) {
        // Access is checked, but page ownership is not.
        pageDiffs.set(tableId, diffs);
    }
}
```

`BrowserPageTracker.clientMightHavePage()` already exists specifically for this
decision, and its class comment currently labels realtime filtering as future work.

**Recommendation:** Filter each table's diff map through
`clientMightHavePage(browserId, tableId, pageIndex)`. Continue sending an empty
confirmation to the originating connection so its optimistic mutation dequeues.
Also cache table-access entries as described below so the remaining per-connection
filter does not query `database_tables` repeatedly. Resolve each changed table's
access once per account for the broadcast and reuse it across that account's
connections, so access fan-out scales with accounts rather than tabs/connections.

### [ ] Replace per-page reconnect validation with a bounded/batched protocol

`server/databases/database_durable_object_connection.ts:228`

**Callers affected:** Every database worker cold-open and every WebSocket reconnect
(`DatabaseConnectionManager.revalidateCacheAfterReconnect`).
**Time impact:** The client serializes every cached `(table, page, version)` entry,
then the Durable Object performs one synchronous SQL lookup per page. The
`cacheUpdateStalePageLimit` does not bound those reads: `readPage()` runs before
the `overLimit` check, so the loop continues querying every remaining page after
the response has switched to stale-index mode.
**Cost impact:** Request bytes, Durable Object CPU, and transient memory are all
O(total cached pages). The Durable Object also copies the valid page indexes into
its per-browser tracker, creating O(connections × cached pages) resident state.

```ts
for (const [pageIndex, clientVersion] of tableVersions) {
    // Still executes for every page after overLimit becomes true.
    const page = this._server.readPage(tableId, pageIndex);

    if (page !== null && page.version === clientVersion) continue;
    if (overLimit || page === null) {
        stalePageIndexes.push(pageIndex);
        continue;
    }
    // ...
}
```

**Recommendation:** First, move the over-limit branch ahead of `readPage` so it
actually bounds the current implementation. Then replace N point reads with a
batched current-version query per table. Prefer a table/group generation or
change-log cursor in OPFS so an unchanged table can validate with O(1) data and a
changed table requests only versions since its last generation; chunk a full
version-map fallback when necessary.

### [ ] Bound, debounce, and virtualize the linked-record picker

`shared/databases/database_actions.ts:653`

**Callers affected:** Opening or typing in any relation-field editor through
`DatabaseRelationGridViewCellEditorOverlay`.
**Time impact:** Opening the picker selects and sorts every unlinked row. Each
keystroke immediately registers a new reactive action, and substring search uses
a leading-wildcard `LIKE`, forcing a scan. The returned array is then materialized
as one React Aria item and one DOM `<li>` per result; the list is not virtualized.
**Cost impact:** SQLite/WASM CPU, worker-to-tab payload size, browser allocations,
and DOM/layout cost grow with the entire linked table. Large relation tables can
freeze the editor on open and on every typed character.

```ts
const rows = sql`
    SELECT linked_row._id AS id, ${linkedNameColumn} AS name
    FROM ${linkedTable.tableRef} AS linked_row
    WHERE NOT EXISTS (...) ${searchFilter}
    ORDER BY linked_row._created_at DESC, linked_row._id DESC
    // No LIMIT or cursor.
`.selectAll(db, rowSchema);
```

**Recommendation:** Add a small limit and cursor to `listLinkableRows`, debounce
search input, and virtualize rendered options. For substring semantics at scale,
use an FTS/trigram-style index; otherwise switch to an indexable prefix query and
document the changed search behavior. Do not execute the unfiltered all-row query
for large tables merely to populate the initial picker.

## Runtime Cost

### [ ] Store only the latest page image, or garbage-collect superseded versions

`server/databases/database_server.ts:473`

**Time impact:** Every page read searches the versioned primary key for the newest
row. Cold `getFileSize` uses a correlated `MAX(version)` query over the history,
and truncation scans distinct page indexes across all retained versions. These
operations slow as mutation history grows, not merely as the live database grows.
**Cost impact:** Every write permanently inserts a full 4 KiB page image (or a
tombstone) for every dirty page. There is no production deletion/compaction path,
so Durable Object SQLite storage grows without bound under routine cell edits.

```ts
CREATE TABLE database_table_pages (
    sqlite_id INTEGER NOT NULL,
    page_index INTEGER NOT NULL,
    version INTEGER NOT NULL,
    data BLOB,
    PRIMARY KEY (sqlite_id, page_index, version)
) WITHOUT ROWID;

// Every mutation appends another full image.
INSERT INTO database_table_pages (sqlite_id, page_index, version, data)
VALUES (${sqliteId}, ${index}, ${version}, ${data});
```

**Recommendation:** If historical page images are not a product requirement,
make `(sqlite_id, page_index)` the key and upsert `{version, data}` in the same
transaction. The diff builder already captures `before` and `beforeVersion`
before persistence, so realtime delivery only needs the previous image in memory.
If history is required, define a bounded retention window and compact old versions
after every write/checkpoint; add storage-growth tests.

### [ ] Cache database-table access entries instead of querying SQLite per authorizer callback

`server/databases/database_server.ts:301`

**Time impact:** SQLite's authorizer fires during statement preparation, including
per referenced column. `Database.resolveSchemaAccess` calls the provided access
resolver for each callback; on the server that reaches
`getDatabaseTableAccessEntry`, which prepares and runs a `database_tables` query.
Join access performs two additional entry queries. Realtime transformation and
cache validation invoke the same uncached resolver.
**Cost impact:** Durable Object CPU and statement latency scale with column count,
join fan-in, cache table count, and connected-client fan-out. There is no DynamoDB
capacity impact because this is local SqlStorage.

```ts
private readonly resolveSchemaAccess = (schemaName: string): AccessLevel | null => {
    const tableId = this.schemaToTable.get(schemaName);
    if (tableId === undefined) return null;
    return this.getTableAccessLevel(tableId);
};

getDatabaseTableAccessEntry(tableId: DatabaseTableId) {
    // Re-executed for repeated callbacks against the same table.
    return sql`SELECT ... FROM database_tables WHERE table_id = ${tableId}`
        .selectOneOrNone(this.sql, databaseTableRowSchema);
}
```

**Recommendation:** Cache `DatabaseServerTableAccessEntry` by table ID in
`DatabaseServer`, and update/invalidate that cache in the existing registration,
policy-update, and topology mutation methods. At minimum, memoize the resolved
access level for the duration of one `Database.execute`. Reuse the cached entry in
`ensureCacheIsUpToDate` instead of separately loading the entry after resolving
the access level.

### [ ] Disable statement/action console tracing in production

`shared/databases/database.ts:320`

**Time impact:** Every database instance monkey-patches `prepare`/`exec`; every SQL
run takes timers, normalizes the full SQL text with a regex, formats numbers, and
calls `console.log`. Every action additionally opens a console group and logs its
duration. This applies to both browser workers and the Durable Object hot path.
**Cost impact:** The deployed Worker has observability logs enabled with sampling
rate 1, so per-statement logs are exported to `honeycomb-logs`. Log ingestion and
egress scale with SQL statement count, while console I/O adds runtime CPU.

```ts
this.db = new sqlite3.oo1.DB(`/${databaseMainTableId}`, "c", vfsName);
// Unconditional in every environment.
installTracing(this.db);

console.group(`[executeDatabaseAction] ${actionObject.name}`);
// ...
console.log(`[executeDatabaseAction] Time: ${(now() - start).toFixed(2)}ms`);
```

**Recommendation:** Compile tracing out of production or gate it behind an
explicit debug flag. For production visibility, emit sampled/aggregated tracer
metrics (action name and duration) without SQL text and without one log record per
statement. Removing the action timing wrapper also removes its duplicated `now()`
helper; if timing remains, reuse one shared clock helper instead of maintaining the
same `performance.now()`/`Date.now()` fallback in both `database_actions.ts` and
`sqlite_tracing.ts`.

### [ ] Stop rewriting the complete OPFS index for every realtime mutation

`client/web/databases/worker/opfs_page_store.ts:234`

**Time impact:** `writePageDiffsFromRealtime` calls `store.sync()` once per table
in every event, even when none of the diffs could be applied locally. `sync()`
flushes page data, serializes the entire page-index `Map` as pretty-printed JSON,
truncates and rewrites `index.json`, flushes it, and flushes the dirty marker. The
work is O(all cached pages in the table) for an O(changed pages) mutation and runs
synchronously in the one database worker shared by all tabs.
**Cost impact:** Browser CPU, allocations, and OPFS writes grow with cache size;
the serialized worker blocks unrelated database actions for other tabs/groups.

```ts
sync(): void {
    this.pagesHandle.flush();
    this.flushIndex();
    this.markClean();
}

private flushIndex(): void {
    const serialized = indexSchema.serialize({pages: this.index, ...});
    const json = JSON.stringify(serialized, null, 2);
    this.indexHandle.truncate(0);
    this.indexHandle.write(new TextEncoder().encode(json), {at: 0});
    this.indexHandle.flush();
}
```

**Recommendation:** Skip syncing a table when no page/tombstone/file-size state
changed. Replace the full JSON rewrite with a compact binary index plus an
append-only delta journal/checkpoint, or batch several realtime mutations before
checkpointing while retaining the dirty-marker crash guarantee. Remove pretty
printing from any remaining persisted representation.

## Code Style

### [ ] Preserve the database action output contract in `defineDatabaseAction`

`shared/databases/database_actions.ts:53`

```ts
function defineDatabaseAction<Input, Output>(def: {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
    internalOnly?: boolean;
    // The returned type advertises Output, but implementations are unchecked.
    run: (ctx: DatabaseActionContext, input: Input) => any;
}): {
    // ...
    run: (ctx: DatabaseActionContext, input: Input) => Output;
} {
    return {internalOnly: false, ...def};
}
```

The helper's public return type claims every action returns `Output`, but `any`
allows each implementation to return an incompatible value without a TypeScript
error. The dispatcher compounds this with `actionObject.input as any` and a result
cast, making the schema-backed action pipeline soft at both ends.

Type the definition callback as `(ctx, input: Input) => Output` and preserve each
map entry's input/output relationship through dispatch so the input and result
casts can be removed. Keep runtime schema validation at transport boundaries, but
do not use it as a substitute for checking action implementations at compile time.

### [ ] The central Database module starts above the 1k-line limit and mixes four subsystems

`shared/databases/database.ts:223`

```ts
export class Database {
    // This is a new 1,377-line file, so the PR moves it from zero to well above the
    // project's explicit 1k-line threshold. The class currently owns VFS/page-buffer
    // I/O, attach-on-miss and LRU eviction, authorizer/execution scope, and reactive
    // tracked-execution caching. Decompose before merging: extract the attachment/
    // schema manager, per-table page buffer/VFS adapter, and tracked-execution/page-
    // set helpers. Keep `Database` as the orchestration boundary.
    private readonly db: SqliteDatabase;
    private readonly vfs: InstalledVfs;
    // ...
}
```

### [ ] Remove underscore prefixes from TypeScript-private database members

`server/databases/database_server.ts:261`

```ts
private _getTableAccessLevelForContext(
    context: WorkerActionContext,
): (tableId: DatabaseTableId) => AccessLevel | null {
    // ...
}
```

Roughly 45 private members across the new server/client database code use leading
underscores (`_runAndPersist`, `_persistBuffer`, `_registerDatabaseTable`,
`DatabaseQuery._watches`, and others), while established TypeScript code relies on
`private` alone. The new code is internally inconsistent too: `database_server.ts`
mixes underscore-private methods with `getTableAccessLevelForAccount`.

Drop the underscores from TypeScript-private members. If a member is intentionally
public despite the prefix, make its intended API status explicit instead.

### [ ] Replace every added production non-null assertion with an explicit invariant

`shared/databases/database.ts:575`

```ts
if (hasTruncate) {
    // Use `assertExists()` or restructure so TypeScript narrows instead of silently
    // erasing the nullable type with `!`.
    truncates.set(tableId, state.bufferedTruncate!);
}
```

Occurrences to change:

- `app/routes/_space.databases.$spaceId.$tableOrViewId.tsx:49`
- `app/routes/_space.databases.$spaceId.sql.tsx:70`
- `client/web/databases/database_field_visibility_menu.tsx:255,263,273-277`
- `client/web/databases/database_query.ts:202,277-278`
- `client/web/databases/database_query_row.ts:39`
- `client/web/databases/database_raw_result_table.tsx:20`
- `client/web/databases/fields/database_relation_field_component.tsx:267,498-502`
- `client/web/databases/grid_view/database_grid_view.tsx:224,655-656`
- `client/web/databases/use_grid_view_fields.ts:257`
- `client/web/databases/worker/database_client.ts:766,868`
- `client/web/helpers/workers/unique_worker_broker.ts:12`
- `client/web/helpers/workers/unique_worker_client.ts:177`
- `client/web/helpers/workers/unique_worker_host.ts:143`
- `client/web/helpers/workers/web_worker_rpc.ts:69,79,86`
- `client/web/helpers/workers/web_worker_rpc_method.ts:58`
- `client/web/spaces/layout/create_widget_secondary_menu_bar.tsx:371`
- `client/web/virtualized/helpers/virtualized_tree.ts:427,435,437`
- `server/databases/build_database_page_diffs.ts:38` (both assertions)
- `server/databases/data/database_table_metadata.ts:210`
- `server/databases/database_durable_object_sql_migrations.ts:80`
- `server/databases/database_server.ts:131`
- `server/search/data/index/internal/search_entity_keyword_index.ts:49`
- `shared/databases/database.ts:324,575,1304`
- `shared/databases/database_actions.ts:325,355-356`
- `shared/databases/fields/database_relation_field.ts:212`
- `shared/databases/install_vfs.ts:237`
- `shared/databases/sql.ts:94,179,230,299,313`
- `shared/databases/sqlite_migrations.ts:171,241`
- `shared/databases/sqlite_table_function.ts:52,160,174`

### [ ] New-row controls are not keyboard-operable buttons

`client/web/databases/grid_view/database_grid_view.tsx:778`

```tsx
function DatabaseGridViewAddRowButton({onCreateRow}: {onCreateRow: () => void}) {
    return (
        // A clickable div is absent from the accessibility tree and tab order and
        // has no keyboard activation or focus ring. Use the native/design-system
        // Button primitive. The relation create-row control has role+tabIndex but no
        // key handler; make it a button or actual combobox option too.
        <Box display="flex" alignItems="center" cursor="pointer" onClick={onCreateRow}>
            {/* ... */}
        </Box>
    );
}
```

---

## Historical Patterns

# Historical Review

## Summary

`origin/main...HEAD` contains the entire databases feature (272 changed files),
so the historical review focused on reusable utilities and conventions in the
database implementation. The merged `calebmer/databases` changes now align the
public metadata mutation/read paths with the mature access-policy patterns. The
remaining findings below concern duplicated abstractions, inconsistent modeling
patterns, and stale branch artifacts.

## Existing Utilities

### [ ] Reuse `Mutex.withLock` instead of introducing `PromiseQueue`

`client/web/databases/database_query.ts:44`

`DatabaseQuery` uses the new `shared/helpers/async/promise_queue.ts` solely to
serialize asynchronous loads and rebalancing. The established `Mutex.withLock()`
already serializes async work, releases in `finally`, lets later callers continue
after a rejection, and is widely used across the codebase. `PromiseQueue` has one
production caller.

```ts
// New one-caller abstraction
private readonly _queue = new PromiseQueue();
await this._queue.enqueue(async () => {
    // ...
});

// Existing convention
private readonly mutex = new Mutex();
await this.mutex.withLock(async () => {
    // ...
});
```

Reuse `Mutex`, or document and test a semantic requirement that it cannot satisfy.
Both current queue callbacks are async, so the queue's allowance for synchronous
callbacks is not such a requirement.

### [ ] Reuse the existing effective-access-policy resolver

`server/databases/data/resolve_database_table_access_policy_for_durable_object.ts:5`

`server/access/into_effective_access_policy.ts:14` already performs the same
`Local`/`Site` resolution and accepts the required consistency option. The branch
itself uses it for database-table search indexing while Durable Object paths add a
second exhaustive switch. A future policy variant can therefore be supported by
one resolver and rejected by the other.

Strengthen `intoEffectiveAccessPolicy`'s return type to `LocalAccessPolicy`, call
it with `{consistency: "StrongWithinCache"}`, and delete the database-specific
resolver.

```ts
// Existing utility
return await intoEffectiveAccessPolicy(context, accessPolicy, {
    consistency: "StrongWithinCache",
});

// Duplicated by the diff
switch (accessPolicy.type) {
    case "Local":
        return accessPolicy;
    case "Site":
        return await context.sitesInjection
            .dangerouslyGetSiteAccessPolicyWithoutAuthorization(/* ... */);
}
```

## Pattern Consistency

### [ ] Use one composition-based field-provider pattern on shared and client code

`shared/databases/fields/base/database_field_provider_base.ts:13`

The feature introduces two provider registries with opposite designs. Shared code
uses an abstract-class/template-method hierarchy
(`DatabaseFieldProviderBase` → `ColumnBackedDatabaseFieldProvider`), while client
code uses a plain object returned by `defineDatabaseFieldComponentProvider()`. The
project guideline prefers composition over inheritance, and the client factory
already demonstrates that model for the same domain concept.

Replace the shared abstract hierarchy with an object/factory provider definition.
Keep invariant checks in the public factory/wrapper rather than protected
underscore methods so shared and client provider registries follow the same
composition pattern.

### [ ] Distinguish SQLite row accessors from schema-backed `*Model` types

`shared/databases/model/database_field_model.ts:12`

Established `*Model` types such as `ChatModel`, `PostModel`, `SpaceModel`, and
`InboxModel` extend the `Model(schema)` mixin and provide schema-backed
serialization. `DatabaseFieldModel`, `DatabaseTableModel`, `DatabaseViewModel`,
and `DatabaseJoinTableModel` instead wrap live SQLite rows and extend custom scoped
base classes. That is a legitimate implementation, but the common suffix implies
the wrong contract.

Use a distinct suffix such as `Record`, `Handle`, or `Node` for the row-backed
database types, and rename the scoped base types consistently.

### [ ] Keep the `Test` service bypass test-only

`server/databases/is_internal_database_service_actor.ts:22`

The new provenance gate always treats `serviceName === "Test"` as trusted for
internal database actions and metadata broadcasts. The established RPC gate at
`server/rpc/internal/implement_rpcs.ts:169` constrains that bypass to
`process.env.NODE_ENV === "test"`. Relying on the claim that `Test` is unreachable
in production leaves the database gate weaker if token or context construction
changes.

Require the test environment in this case, or omit `Test` and arrange tests
through an already trusted service.

```ts
// Existing RPC convention
process.env.NODE_ENV === "test" && context.actor.serviceName === "Test"

// New database convention
case "Test":
    return true;
```

## Historical Context

### [ ] Remove the completed root implementation plan

`plan.md:1`

All milestones in this 216-line branch document are marked done, and parts of its
“Settled design” already contradict the final code: it calls
`DatabaseGroupService` an unrestricted bypass while
`is_internal_database_service_actor.ts` deliberately excludes it. The linked-
records history previously added and then deleted the same path once its plan had
served its purpose. Delete this stale branch artifact; move only durable rationale
into maintained documentation near the implementation.

---

## Security

# Security Review

## Summary

The merged changes now require `Manage` plus canonical policy validation for ACL
updates, authorize metadata reads at `View`, and enforce space membership at the
Durable Object HTTP action boundary. The remaining High-severity risk is the
unversioned, asynchronously refreshed access-policy replica: a stale or reordered
broadcast can preserve or restore a revoked grant. Loader-only group lookups still
omit an explicit space check, but their remaining exposure is limited to existence
probing rather than table data. Overall residual risk is **High**.

## Authorization & Permissions

### [ ] Authorize loader-only database-group lookups

`app/routes/_space.databases.$spaceId.tsx:28`
**Severity: Low**

```ts
export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const databaseGroupId = await getDatabaseGroupIdForSpaceIfExists(context, spaceId);

    if (databaseGroupId === null) {
        return jsonWithSchema(LoaderSchema, {databaseGroupId: null, pages: new Map()});
    }
```

The Durable Object `/action` boundary now re-authorizes the forwarded actor, so
the previous cross-tenant schema/row read is fixed. However, the parent loader
returns the no-database state before any authorized action, and the SQL loader
only calls `getDatabaseGroupIdForSpace()` before returning. Direct Remix data
requests can therefore distinguish a valid space with/without a database group
from an unknown space without being a member. The child loader similarly resolves
the group before its first protected action.

**Recommendation:** Call `authorizeSpaceAccess(context, spaceId)` at the start of
all database loaders. This closes the remaining existence probe and makes the
route boundary explicit even though all data-bearing Durable Object actions are
now independently protected.

### [ ] Synchronize and version the durable object's policy replica

`server/databases/data/resolve_database_table_access_policy_for_durable_object.ts:5`
**Severity: High**

```ts
export async function resolveDatabaseTableAccessPolicyForDurableObject(
    context: ServerActionContext,
    accessPolicy: AccessPolicy,
): Promise<LocalAccessPolicy> {
    switch (accessPolicy.type) {
        case "Local":
            return accessPolicy;
        case "Site":
            return await context.sitesInjection
                .dangerouslyGetSiteAccessPolicyWithoutAuthorization(
                    accessPolicy.siteId,
                    {consistency: "StrongWithinCache"},
                );
    }
}
```

The durable object stores a resolved `Local` snapshot and uses it for every SQL
and realtime permission decision. Updating a site's policy does not update the
database-table metadata item, so it emits no `DatabaseTablesTable` event. The only
observed refresh path is an eventual search-dependent reindex job, whose additional
write calls `syncDatabaseTableMetadataToDurableObject()`. Until that asynchronous
pipeline runs—and indefinitely if it fails—an account revoked from the site retains
read/write access through the stale durable-object copy. The connection's periodic
authorization only checks space membership, so it cannot catch a table/site-level
revocation.

Local table-policy replacement has a smaller version of the same problem: Rynamo
schedules its broadcast with `context.process.waitUntil()`, while the mutation RPC
can return before the durable object applies the new policy.

The broadcast protocol also discards the Rynamo item versions before updating the
replica:

`server/databases/database_durable_object.ts:165`

```ts
const {events, resolvedAccessPolicyByTableId} =
    DatabaseTableMetadataBroadcastRealtimeEventsSchema.deserialize(await request.json());

this._server.transactionSync(() => {
    for (const [tableId, accessPolicy] of resolvedAccessPolicyByTableId) {
        this._server.setDatabaseTableAccessPolicy(tableId, accessPolicy);
    }
});
```

Concurrent broadcasts can arrive out of order. A delayed grant applied after a
revocation unconditionally restores access, even if clients reject the stale
Rynamo event by version. SQL authorization and page filtering then keep using the
stale grant indefinitely.

**Recommendation:** Treat permission propagation as part of the authorization
transaction, not as search/realtime maintenance. Either resolve and version-check
the effective site policy at the action/connection boundary, or synchronously fan
out site-policy changes to every dependent database group and await durable
application before reporting success. Include a monotonically increasing policy
version in every replica update; apply it only when newer than the stored version,
and fail closed when the Durable Object's version is stale. Deletions need the same
monotonic comparison. Add reversed-delivery and dropped-broadcast revocation tests.

## API & Network Security

### [ ] Bound arbitrary SQL and cache-sync work on the single-threaded durable object

`shared/databases/database_actions.ts:117`
**Severity: Medium**

```ts
rawSql: defineDatabaseAction({
    input: Schema.object({sql: Schema.string}),
    output: Schema.object({rows: Schema.array(Schema.unknown())}),
    writeLevel: "data",
    run({db}, input) {
        const rows = sql.raw(input.sql).selectAllUnknown(db);
        return {rows};
    },
}),
```

Every authorized WebSocket client can submit unrestricted SQL text, and the
durable object materializes the complete result without a statement time/step
budget or row/byte limit. A recursive CTE or very large result can monopolize or
exhaust the database group's single-threaded durable object, denying service to
the entire space. `ensureCacheIsUpToDate()` similarly accepts unbounded
client-supplied table/page maps and loops over every entry.

**Recommendation:** Add protocol limits for SQL length, result rows/bytes, table
count, page count, and page indexes. Install a SQLite progress handler or
equivalent per-statement step/deadline budget and interrupt over-budget queries.
Reject oversized cache-sync requests during schema deserialization before
iterating or reading storage.

---

## Backwards Compatibility

# Backwards Compatibility Review

## Summary

This branch is not backwards compatible with existing database data, older app
clients, or old server instances during a rolling deployment/rollback. The Durable
Object storage rewrite does not migrate legacy page rows and has no rollback bridge;
existing tables are absent from both new metadata stores; and old clients reject
the new action requests, realtime event, and search variant. Search entities also
persist incompatible IDs in OpenSearch and DynamoDB. Treat this as a versioned
protocol and data migration: deploy tolerant readers and compatibility adapters,
backfill and verify storage, wait out the compatibility window, and only then enable
new producers and fail-closed enforcement.

## Data Shape Changes

### [ ] Do not return the new search-result variant to old clients

`shared/search/search_entity_model.ts:173`
**Risk: Breaking**

```ts
const SearchAffinityEntityModelDataUnionSchema = {
    Static: /* ... */,
    Channel: SearchChannelEntityModelDataSchema,
    Chat: SearchChatEntityModelDataSchema,
    DatabaseTable: SearchDatabaseTableEntityModelDataSchema,
    Document: SearchDocumentEntityModelDataSchema,
    // ...
} as const;
```

`searchByKeywords` still returns `SearchEntityResultModel.schema()`, whose inner
model is deserialized with `SearchEntityModel.schema`. The new indexer makes
database tables eligible for that unrestricted keyword query. An old client's
closed union does not contain `DatabaseTable`, so deserializing a response
containing one throws `Unknown type`; one matching table therefore rejects the
entire search RPC rather than merely hiding an unsupported row. The explicit
`DatabaseTable => null` handling in `intoApiSearchResult` protects the external
API, but there is no equivalent protection for the app-client RPC.

**Impact on old clients:** Searching for text that matches a database table name
makes the global search request fail and surfaces the search error state. The same
model can also reach the existing affinity response once an interaction has been
recorded.

**Recommendation:** Keep `DatabaseTable` out of the existing generic search RPCs
until the oldest supported client understands the variant. The immediate safe
option is to filter `type = DatabaseTable` from `searchByKeywords` and
`searchByAffinity`; a more durable option is a versioned/new RPC used only by
database-capable clients. Add a compatibility test that serializes the new server
response and attempts to deserialize it with the `origin/main` search schema.

## API Changes

### [ ] Preserve adapters for the old database action request shapes

`shared/databases/database_actions.ts:137`
**Risk: Breaking**

```ts
createTable: defineDatabaseAction({
    input: Schema.object({
        tableId: Schema.id<DatabaseTableId>(),
        name: LabelStringSchema,
        accessPolicy: LocalAccessPolicySchema,
    }),
    internalOnly: true,
    // ...
}),

createRelationField: defineDatabaseAction({
    input: Schema.object({
        joinTableId: Schema.id<DatabaseTableId>(),
        // ...
    }),
    // ...
}),
```

The shipped database creator sends `createTable({name})`, and the shipped relation
creator omits `joinTableId`; the server generated those IDs. The new WebSocket
schema requires both fields, marks `createTable` internal-only, and removes the
`renameTable` discriminator in favor of `syncTableMetadata`.

**Impact on old clients:** Table creation and relation-field creation fail schema
deserialization against the new server. Legacy `renameTable` calls are rejected as
unknown, and a socket-level schema error may disrupt the whole connection.

**Recommendation:** Keep legacy variants through the supported old-client window.
Adapt old payloads to the new workflows, generating missing IDs and initial policy
server-side. If the Durable Object cannot safely create Dynamo metadata, put the
adapter in an authenticated server endpoint selected by protocol version. Add an
integration test running the request schemas and payloads from `336479be9` against
`HEAD`.

## Realtime Changes

### [ ] Negotiate the new table-metadata event before broadcasting it

`shared/databases/database_realtime_protocol.ts:47`
**Risk: Breaking**

```ts
events: {
    PagesChanged: /* ... */,
    TableMetadataChanged: Schema.object({
        type: Schema.value("TableMetadataChanged"),
        events: Schema.array(DatabaseTableMetadataRealtimeEventSchema),
        tableAccess: DatabaseTableAccessLevelsSchema,
    }),
}
```

The server sends this new discriminator to every database-group socket after a
metadata write. The old event union contains only `PagesChanged` and cannot discard
an unknown union variant.

**Impact on old clients:** An already-open client reports a protocol/schema error
and may close or reconnect continuously, then stops receiving page changes.

**Recommendation:** Include a protocol version/capability in the socket handshake
and suppress `TableMetadataChanged` for legacy connections while continuing to send
legacy `PagesChanged` events. Add a mixed-version test in which a current client
changes metadata while a `336479be9` client stays connected.

## Schema & Serialization

### [ ] Migrate the legacy Durable Object page tables instead of starting a parallel empty store

`server/databases/database_durable_object_sql_migrations.ts:21`
**Risk: Breaking**

```ts
CREATE TABLE database_tables (...);
CREATE TABLE database_table_pages (...);
```

The base implementation stores canonical data in `database_table_ids` and `pages`.
The new migration only creates parallel `database_tables` and
`database_table_pages`; it never copies or renames legacy rows. New code reads only
the new page table, so the first post-deploy cold start sees no main page and
bootstraps an empty database. New writes also go only to the new table, while a
rolled-back binary reads only the legacy table.

**Impact on old clients:** Existing groups appear empty after upgrade. A rollback
resurrects pre-deploy state and hides writes accepted by the new server.

**Recommendation:** Detect and transactionally migrate legacy IDs, pages, versions,
and tombstones. Define a rollback window with dual read/write or a reversible
table/view bridge; do not accept new-only writes until rollback preserves them.
Add upgrade and rollback tests using a populated `336479be9` storage image.

### [ ] Backfill the renamed Dynamo metadata store and Durable Object registrations

`server/databases/data/internal/database_tables_table.ts:16`
**Risk: Breaking**

```ts
export const DatabaseTablesTable = RynamoTableSchema.new({
    name: "DatabaseTableMetadata",
    partitions: [{name: "Table", /* keyed directly by tableId */}],
});
```

The merged changes replace the prior `DatabaseTables` group-keyed table with a
`DatabaseTableMetadata` table keyed directly by table ID, but provide no migration
for items written by the earlier branch implementation. More broadly, metadata is
still populated only by the new create flow. The Durable Object registration table
also needs table kind/name/schema, policy, and join topology, but its migration
creates no rows for legacy page IDs. A page-only migration is insufficient:
unknown registrations fail closed, and the new loader throws when metadata is
absent.

**Impact on old clients:** Old and new clients cannot open or mutate pre-existing
user and join tables after enforcement is enabled.

**Recommendation:** Migrate any group-keyed `DatabaseTables` items into the new
table-ID-keyed `DatabaseTableMetadata` store, then reconstruct missing Durable
Object registrations and metadata for every legacy table with an explicit
transitional policy. Verify counts and IDs before enabling fail-closed enforcement.
Keep any legacy space-member fallback strictly bounded to the migration window.
Add upgrade tests covering prior metadata items plus user and join tables through
both old page access and the new loader.

### [ ] Stage writes of `DatabaseTable` documents to the shared OpenSearch index

`server/search/data/index/index_database_table_search_entity.ts:52`
**Risk: Breaking**

```ts
await context.opensearch.indexDocIfVersion(SearchEntityKeywordIndex, spaceId, {
    id,
    // ...
    type: "DatabaseTable",
    title: name,
    // ...
});
```

This writes a new ID prefix and type into the existing
`search_entity_keywords` index. Old server code sharing that index cannot parse
`DatabaseTable:<id>` in `parseSearchDynamicEntityId`. In the old
`searchByKeywords` path, every returned hit is passed to
`spotCheckSearchEntityAccess`, so a matching database hit throws before a response
can be produced. The documents survive a rollback, making this more than a
transient mixed-fleet race.

**Impact on old clients:** During a rolling deploy, an old server instance selected
by the load balancer fails otherwise valid keyword-search requests after a new
instance has indexed a matching table. A rollback continues failing for as long as
those documents remain in the shared index.

**Recommendation:** Use a two-phase rollout. First deploy reader code that
recognizes and safely skips the future OpenSearch type without emitting it to
legacy clients; after all old server instances are gone, enable indexing. Preserve
that tolerant reader through rollback, or explicitly remove all `DatabaseTable`
documents before rolling back. Cover a mixed-version query against an index
containing the new type.

### [ ] Do not persist database-table affinity IDs before old readers tolerate them

`shared/search/search_entity_id.ts:497`
**Risk: Breaking**

```ts
const searchAffinityEntityIdTestMap = {
    Account: true,
    Document: true,
    Channel: true,
    Chat: true,
    DatabaseTable: true,
    // ...
};
```

The generic search selection handler records affinity for every ID accepted by
this map. Selecting a table therefore writes `DatabaseTable:<id>` into the existing
`SearchEntities` DynamoDB table. Its key schema validates only that the value is a
label string, so an old server can read the item, but the old
`parseSearchDynamicEntityId` has no corresponding case. `searchByAffinity` treats
every ID except `TaskPersonal` as dynamic and attempts that parse, causing the
whole affinity request to fail. Unlike an ephemeral response, this incompatible
value can outlive both the new client and the deployment that wrote it.

**Impact on old clients:** After the same account selects a database result in a
new client, an older client/tab can no longer load its affinity/favorites response
when it is served by an old instance. A server rollback has the same failure until
the stored item expires or is deleted; a favorited item would not expire.

**Recommendation:** For the initial rollout, classify database tables as
non-affinity entities (or explicitly suppress affinity writes for them). Separately
deploy an old-reader-compatible filter for unknown affinity IDs, wait for the
server compatibility window, and only then enable persistence. If writes have
already occurred, include a cleanup/migration or retain the tolerant reader as
part of the rollback plan. Add a test that reads a `DatabaseTable:<id>` affinity
item using the previous reader behavior.
