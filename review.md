# PR Review: alex/db-permissions

## General Feedback

This branch adds linked-record editing, per-table access policies, a multi-table SQLite page
protocol, client connection management, and database-table search. The remaining storage and
realtime changes are not ready to merge: optimistic mutations can be reported as failed after the
server commits them, policy replicas can preserve or restore stale grants, and the storage rewrite
has both an unbounded-growth problem and a deterministic truncate/re-extend collision.

The rollout is also unsafe for existing data and old clients. The new Durable Object page tables do
not migrate the legacy store, existing tables are absent from both new metadata stores, and old
clients reject new action shapes, realtime events, and search variants. Reactive queries can also
miss invalidations that arrive during an in-flight refresh, while the action-definition helper
discards its declared output contract through `any`. Structurally, `shared/databases/database.ts` is
already 1,377 lines and owns several independent subsystems. Alternative framing: treat this as a
versioned storage/security protocol migration, stage tolerant readers and data backfills first, and
separate the storage and authorization boundaries before layering the linked-record UI on top.

---

## Bugs

Authorization findings that also appeared in the general pass are preserved in the more detailed
Security section below.

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

An invalidation received while `reExecuting` is true is silently dropped. More subtly,
`invalidateForPages()` first marks the tracked execution dirty, but the in-flight run later calls
`setTrackedSnapshot()`, which clears `dirty`. If that run read its snapshot before the second write
reached storage, the UI remains on the first write until an unrelated future invalidation overlaps
it.

Track a “dirtied while running” flag and schedule another execution in `finally` when it was set,
providing both leading- and trailing-edge refreshes. Add a test where two overlapping writes land on
opposite sides of an awaited re-execution.

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

Make the event callbacks return promises and await `sendEventToAllAndWait()`/`sendEvent()` before
returning the procedure response. The empty self-confirmation path needs the same ordering
guarantee.

### [ ] Do not insert a tombstone and replacement page under the same primary key

`server/databases/database_server.ts:445`

```ts
for (const [databaseTableId, size] of truncates) {
    // ...collect every existing page at or past the truncate boundary...
    for (const pageIndex of pageIndexes) {
        sql`
            INSERT INTO
                database_table_pages (sqlite_id, page_index, version, data)
            VALUES
                (
                    ${sqliteId},
                    ${pageIndex},
                    ${version},
                    NULL
                )
        `.exec(this.sql);
    }
}

// The following loop can insert a replacement page with the same (sqlite_id,
// page_index, version) key.
for (const [databaseTableId, tablePages] of pages) {
    for (const [index, data] of tablePages) {
        sql`
            INSERT INTO
                database_table_pages /* ... */
        `;
    }
}
```

If one batch truncates and re-extends a previously existing page, the tombstone and replacement use
the same primary key and the mutation fails with a uniqueness violation. Exclude page indexes
present in `pages` from tombstoning, or upsert the final state once per page. Add a regression test
with an existing high page that is truncated and rewritten in one `writePages()` call.

### [ ] Recompute access deltas for join tables when either side's policy changes

`server/databases/database_durable_object_connection.ts:341`

```ts
const tableAccess = new Map<DatabaseTableId, AccessLevel | null>();
const accountId = context.actor.getPossiblyBotAccountIdIfExists();
for (const event of events) {
    if (event.type !== "PutItem") continue;
    const tableId = event.item.model.tableId;
    // Only the directly changed user table is included.
    tableAccess.set(tableId, this._server.getTableAccessLevelForAccount(tableId, accountId));
}
```

A join file's access is derived from the maximum access to its source and target, but this delta
includes only the user table whose Dynamo metadata changed. When both sides are revoked,
`purgeRevokedTables()` never receives the join ID, so its linked-row data remains in OPFS until a
later reconnect. Query joins touching each changed table and include their newly derived levels in
the delta.

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

The layout seeds table-ID pages, the reactive action seeds schema pages, and the query seeds row
pages before the first watch creates the client. Each callback replaces `initialPages`, so only the
last seed survives. Merge by table/page while keeping the highest version in this path and
`writeInitialPages()`.

### [ ] Preserve metadata event order while resolving policies in parallel

`server/databases/data/internal/database_tables_table.ts:64`

```ts
await runAllPromises(
    events.map(async ({itemKey, eventStub, getEvent}) => {
        if (itemKey.partitionType !== "Table") return;
        const event = await getEvent(context);
        // ...await policy resolution...
        const {databaseGroupId} = event.item.model;
        getOrSetDefaultMapValue(eventsByDatabaseGroupId, databaseGroupId, () => []).push(eventStub);
    }),
);
```

These callbacks push into shared arrays and overwrite shared maps in completion order, not
transaction order. A slower earlier event can be broadcast after a later event, and multiple updates
for one table can leave the Durable Object with whichever policy resolves last. Resolve indexed
result objects in parallel, then build arrays and maps synchronously in original order.

`getDatabaseTableMetadataRealtimeEvent()` at `server/databases/data/database_table_metadata.ts:228`
repeats the unordered-push pattern for `visibleEvents`/`deniedTableIds` and should be fixed with it.

### [ ] Table creation can permanently commit only half of the table

`server/databases/data/database_table_metadata.ts:39`

```ts
await DatabaseTablesTable.updateItem(
    context,
    {partitionType: "Table", sortRangeType: "Attributes", tableId},
    item =>
        DynamoItem.createOrUpdate(item, {
            /* ... */
        }),
);

//////////////
// Database-group assignment is now atomic, but the Dynamo metadata record (and its
// realtime broadcast) still commits before the durable object's SQLite table/file
// is created. If the second step fails, the metadata stays visible but the
// generated id is lost to the caller; because the RPC is explicitly
// non-idempotent, retrying creates a second id instead of repairing the first
// table.
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

This change has several high-risk scaling and operating-cost regressions. The canonical Durable
Object store retains every 4 KiB page version indefinitely; every database statement and action is
logged in production; and every mutation broadcasts page diffs to every authorized connection,
including browsers that do not cache the changed pages. On the client, each received mutation
synchronously rewrites and flushes the full OPFS page index. Reconnect validation and the linked
record picker also have work proportional to all cached pages or all rows. These costs compound: a
write creates permanent storage, log, broadcast, OPFS, and revalidation work.

## Async Orchestration

### [ ] Open independent per-table OPFS stores in parallel

`client/web/databases/worker/database_client.ts:110`

**Callers affected:** Database worker cold-open through
`DatabaseConnectionManager.getOrCreateClient`, loader-page seeding through `writeLoaderPages`, and
server fallbacks that return pages for several tables. **Time impact:** Cold-open and fallback
latency grow linearly with the number of cached/returned tables. `OpfsPageStore.create` performs
multiple asynchronous OPFS handle opens per table, but the stores are in distinct directories and do
not depend on one another. **Cost impact:** Longer dedicated-worker occupancy and slower interactive
database startup; no direct RCU/WCU impact.

```ts
await storage.create(databaseMainTableId);
for await (const name of groupDir.keys()) {
    const tableId = name as DatabaseTableId;
    if (storage.get(tableId) === undefined) {
        // Every independent table waits for all OPFS opens for the prior table. The same
        // pattern appears at lines 759-760 and 833-835.
        await storage.create(tableId);
    }
}
```

**Recommendation:** Collect the table IDs, then open distinct stores with `runAllPromises()`. Apply
the same pattern to `writeLoaderPages` and `executeActionViaServer` using the existing deduplicating
`openStore()` helper. Keep the main store creation ordered before `Database.create`, but do not
serialize the remaining independent table opens.

## Call-Site Impact

### [ ] Filter realtime page diffs by the pages each browser can actually hold

`server/databases/database_durable_object_connection.ts:317`

**Callers affected:** Every connected browser on the database-group Durable Object for every
WebSocket or server-originated mutation. **Time impact:** `transformEvent` serializes and sends
every changed page diff to every connection with table access. Clients that never fetched the page
still deserialize and dispatch the event; if they have the table store open, they also run the OPFS
sync path even though `readPage` returns no base to patch. **Cost impact:** WebSocket egress and
Durable Object CPU scale as `connections × changed pages`. A diff can approach the full 4 KiB SQLite
page, and one SQL mutation can dirty several pages.

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

`BrowserPageTracker.clientMightHavePage()` already exists specifically for this decision, and its
class comment currently labels realtime filtering as future work.

**Recommendation:** Filter each table's diff map through
`clientMightHavePage(browserId, tableId, pageIndex)`. Continue sending an empty confirmation to the
originating connection so its optimistic mutation dequeues. Also cache table-access entries as
described below so the remaining per-connection filter does not query `database_tables` repeatedly.
Resolve each changed table's access once per account for the broadcast and reuse it across that
account's connections, so access fan-out scales with accounts rather than tabs/connections.

### [ ] Replace per-page reconnect validation with a bounded/batched protocol

`server/databases/database_durable_object_connection.ts:228`

**Callers affected:** Every database worker cold-open and every WebSocket reconnect
(`DatabaseConnectionManager.revalidateCacheAfterReconnect`). **Time impact:** The client serializes
every cached `(table, page, version)` entry, then the Durable Object performs one synchronous SQL
lookup per page. The `cacheUpdateStalePageLimit` does not bound those reads: `readPage()` runs
before the `overLimit` check, so the loop continues querying every remaining page after the response
has switched to stale-index mode. **Cost impact:** Request bytes, Durable Object CPU, and transient
memory are all O(total cached pages). The Durable Object also copies the valid page indexes into its
per-browser tracker, creating O(connections × cached pages) resident state.

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

**Recommendation:** First, move the over-limit branch ahead of `readPage` so it actually bounds the
current implementation. Then replace N point reads with a batched current-version query per table.
Prefer a table/group generation or change-log cursor in OPFS so an unchanged table can validate with
O(1) data and a changed table requests only versions since its last generation; chunk a full
version-map fallback when necessary.

## Runtime Cost

### [ ] Store only the latest page image, or garbage-collect superseded versions

`server/databases/database_server.ts:473`

**Time impact:** Every page read searches the versioned primary key for the newest row. Cold
`getFileSize` uses a correlated `MAX(version)` query over the history, and truncation scans distinct
page indexes across all retained versions. These operations slow as mutation history grows, not
merely as the live database grows. **Cost impact:** Every write permanently inserts a full 4 KiB
page image (or a tombstone) for every dirty page. There is no production deletion/compaction path,
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

**Recommendation:** If historical page images are not a product requirement, make
`(sqlite_id, page_index)` the key and upsert `{version, data}` in the same transaction. The diff
builder already captures `before` and `beforeVersion` before persistence, so realtime delivery only
needs the previous image in memory. If history is required, define a bounded retention window and
compact old versions after every write/checkpoint; add storage-growth tests.

### [ ] Cache database-table access entries instead of querying SQLite per authorizer callback

`server/databases/database_server.ts:301`

**Time impact:** SQLite's authorizer fires during statement preparation, including per referenced
column. `Database.resolveSchemaAccess` calls the provided access resolver for each callback; on the
server that reaches `getDatabaseTableAccessEntry`, which prepares and runs a `database_tables`
query. Join access performs two additional entry queries. Realtime transformation and cache
validation invoke the same uncached resolver. **Cost impact:** Durable Object CPU and statement
latency scale with column count, join fan-in, cache table count, and connected-client fan-out. There
is no DynamoDB capacity impact because this is local SqlStorage.

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

**Recommendation:** Cache `DatabaseServerTableAccessEntry` by table ID in `DatabaseServer`, and
update/invalidate that cache in the existing registration, policy-update, and topology mutation
methods. At minimum, memoize the resolved access level for the duration of one `Database.execute`.
Reuse the cached entry in `ensureCacheIsUpToDate` instead of separately loading the entry after
resolving the access level.

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

The helper's public return type claims every action returns `Output`, but `any` allows each
implementation to return an incompatible value without a TypeScript error. The dispatcher compounds
this with `actionObject.input as any` and a result cast, making the schema-backed action pipeline
soft at both ends.

Type the definition callback as `(ctx, input: Input) => Output` and preserve each map entry's
input/output relationship through dispatch so the input and result casts can be removed. Keep
runtime schema validation at transport boundaries, but do not use it as a substitute for checking
action implementations at compile time.

### [ ] Remove underscore prefixes from TypeScript-private database members

`server/databases/database_server.ts:261`

```ts
private _getTableAccessLevelForContext(
    context: WorkerActionContext,
): (tableId: DatabaseTableId) => AccessLevel | null {
    // ...
}
```

Roughly 45 private members across the new server/client database code use leading underscores
(`_runAndPersist`, `_persistBuffer`, `_registerDatabaseTable`, `DatabaseQuery._watches`, and
others), while established TypeScript code relies on `private` alone. The new code is internally
inconsistent too: `database_server.ts` mixes underscore-private methods with
`getTableAccessLevelForAccount`.

Drop the underscores from TypeScript-private members. If a member is intentionally public despite
the prefix, make its intended API status explicit instead.

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

---

## Historical Patterns

# Historical Review

## Summary

`origin/main...HEAD` contains the entire databases feature (272 changed files), so the historical
review focused on reusable utilities and conventions in the database implementation. The merged
`calebmer/databases` changes now align the public metadata mutation/read paths with the mature
access-policy patterns. The remaining findings below concern duplicated abstractions, inconsistent
modeling patterns, and stale branch artifacts.

## Existing Utilities

### [ ] Reuse `Mutex.withLock` instead of introducing `PromiseQueue`

`client/web/databases/database_query.ts:44`

`DatabaseQuery` uses the new `shared/helpers/async/promise_queue.ts` solely to serialize
asynchronous loads and rebalancing. The established `Mutex.withLock()` already serializes async
work, releases in `finally`, lets later callers continue after a rejection, and is widely used
across the codebase. `PromiseQueue` has one production caller.

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

Reuse `Mutex`, or document and test a semantic requirement that it cannot satisfy. Both current
queue callbacks are async, so the queue's allowance for synchronous callbacks is not such a
requirement.

### [ ] Reuse the existing effective-access-policy resolver

`server/databases/data/resolve_database_table_access_policy_for_durable_object.ts:5`

`server/access/into_effective_access_policy.ts:14` already performs the same `Local`/`Site`
resolution and accepts the required consistency option. The branch itself uses it for database-table
search indexing while Durable Object paths add a second exhaustive switch. A future policy variant
can therefore be supported by one resolver and rejected by the other.

Strengthen `intoEffectiveAccessPolicy`'s return type to `LocalAccessPolicy`, call it with
`{consistency: "StrongWithinCache"}`, and delete the database-specific resolver.

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
        return await context.sitesInjection.dangerouslyGetSiteAccessPolicyWithoutAuthorization(/* ... */);
}
```

## Pattern Consistency

### [ ] Use one composition-based field-provider pattern on shared and client code

`shared/databases/fields/base/database_field_provider_base.ts:13`

The feature introduces two provider registries with opposite designs. Shared code uses an
abstract-class/template-method hierarchy (`DatabaseFieldProviderBase` →
`ColumnBackedDatabaseFieldProvider`), while client code uses a plain object returned by
`defineDatabaseFieldComponentProvider()`. The project guideline prefers composition over
inheritance, and the client factory already demonstrates that model for the same domain concept.

Replace the shared abstract hierarchy with an object/factory provider definition. Keep invariant
checks in the public factory/wrapper rather than protected underscore methods so shared and client
provider registries follow the same composition pattern.

### [ ] Distinguish SQLite row accessors from schema-backed `*Model` types

`shared/databases/model/database_field_model.ts:12`

Established `*Model` types such as `ChatModel`, `PostModel`, `SpaceModel`, and `InboxModel` extend
the `Model(schema)` mixin and provide schema-backed serialization. `DatabaseFieldModel`,
`DatabaseTableModel`, `DatabaseViewModel`, and `DatabaseJoinTableModel` instead wrap live SQLite
rows and extend custom scoped base classes. That is a legitimate implementation, but the common
suffix implies the wrong contract.

Use a distinct suffix such as `Record`, `Handle`, or `Node` for the row-backed database types, and
rename the scoped base types consistently.

### [ ] Keep the `Test` service bypass test-only

`server/databases/is_internal_database_service_actor.ts:22`

The new provenance gate always treats `serviceName === "Test"` as trusted for internal database
actions and metadata broadcasts. The established RPC gate at
`server/rpc/internal/implement_rpcs.ts:169` constrains that bypass to
`process.env.NODE_ENV === "test"`. Relying on the claim that `Test` is unreachable in production
leaves the database gate weaker if token or context construction changes.

Require the test environment in this case, or omit `Test` and arrange tests through an already
trusted service.

```ts
// Existing RPC convention
process.env.NODE_ENV === "test" && context.actor.serviceName === "Test"

// New database convention
case "Test":
    return true;
```

---

## Security

# Security Review

## Summary

The merged changes now require `Manage` plus canonical policy validation for ACL updates, authorize
metadata reads at `View`, and enforce space membership at the Durable Object HTTP action boundary.
The remaining High-severity risk is the unversioned, asynchronously refreshed access-policy replica:
a stale or reordered broadcast can preserve or restore a revoked grant. Loader-only group lookups
still omit an explicit space check, but their remaining exposure is limited to existence probing
rather than table data. Overall residual risk is **High**.

## Authorization & Permissions

### [ ] Authorize loader-only database-group lookups

`app/routes/_space.databases.$spaceId.tsx:28` **Severity: Low**

```ts
export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const databaseGroupId = await getDatabaseGroupIdForSpaceIfExists(context, spaceId);

    if (databaseGroupId === null) {
        return jsonWithSchema(LoaderSchema, {databaseGroupId: null, pages: new Map()});
    }
```

The Durable Object `/action` boundary now re-authorizes the forwarded actor, so the previous
cross-tenant schema/row read is fixed. However, the parent loader returns the no-database state
before any authorized action, and the SQL loader only calls `getDatabaseGroupIdForSpace()` before
returning. Direct Remix data requests can therefore distinguish a valid space with/without a
database group from an unknown space without being a member. The child loader similarly resolves the
group before its first protected action.

**Recommendation:** Call `authorizeSpaceAccess(context, spaceId)` at the start of all database
loaders. This closes the remaining existence probe and makes the route boundary explicit even though
all data-bearing Durable Object actions are now independently protected.

### [ ] Synchronize and version the durable object's policy replica

`server/databases/data/resolve_database_table_access_policy_for_durable_object.ts:5` **Severity:
High**

```ts
export async function resolveDatabaseTableAccessPolicyForDurableObject(
    context: ServerActionContext,
    accessPolicy: AccessPolicy,
): Promise<LocalAccessPolicy> {
    switch (accessPolicy.type) {
        case "Local":
            return accessPolicy;
        case "Site":
            return await context.sitesInjection.dangerouslyGetSiteAccessPolicyWithoutAuthorization(
                accessPolicy.siteId,
                {consistency: "StrongWithinCache"},
            );
    }
}
```

The durable object stores a resolved `Local` snapshot and uses it for every SQL and realtime
permission decision. Updating a site's policy does not update the database-table metadata item, so
it emits no `DatabaseTablesTable` event. The only observed refresh path is an eventual
search-dependent reindex job, whose additional write calls
`syncDatabaseTableMetadataToDurableObject()`. Until that asynchronous pipeline runs—and indefinitely
if it fails—an account revoked from the site retains read/write access through the stale
durable-object copy. The connection's periodic authorization only checks space membership, so it
cannot catch a table/site-level revocation.

Local table-policy replacement has a smaller version of the same problem: Rynamo schedules its
broadcast with `context.process.waitUntil()`, while the mutation RPC can return before the durable
object applies the new policy.

The broadcast protocol also discards the Rynamo item versions before updating the replica:

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

Concurrent broadcasts can arrive out of order. A delayed grant applied after a revocation
unconditionally restores access, even if clients reject the stale Rynamo event by version. SQL
authorization and page filtering then keep using the stale grant indefinitely.

**Recommendation:** Treat permission propagation as part of the authorization transaction, not as
search/realtime maintenance. Either resolve and version-check the effective site policy at the
action/connection boundary, or synchronously fan out site-policy changes to every dependent database
group and await durable application before reporting success. Include a monotonically increasing
policy version in every replica update; apply it only when newer than the stored version, and fail
closed when the Durable Object's version is stale. Deletions need the same monotonic comparison. Add
reversed-delivery and dropped-broadcast revocation tests.
