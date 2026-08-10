# PR Review: alex/db-permissions

## General Feedback

This branch adds linked-record editing, per-table access policies, a multi-table SQLite page
protocol, client connection management, and database-table search. The remaining storage and
realtime changes are not ready to merge: optimistic mutations can be reported as failed after the
server commits them, policy replicas can preserve or restore stale grants, and the storage rewrite
has both an unbounded-growth problem and a deterministic truncate/re-extend collision.

Reactive queries can also miss invalidations that arrive during an in-flight refresh, while the
action-definition helper discards its declared output contract through `any`. Structurally,
`shared/databases/database.ts` is already 1,377 lines and owns several independent subsystems.
Alternative framing: separate the storage and authorization boundaries before layering the
linked-record UI on top.

---

## Bugs

Authorization findings that also appeared in the general pass are preserved in the more detailed
Security section below.

### [x] Preserve invalidations that arrive during reactive re-execution

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

### [x] Wait for the realtime confirmation before returning the mutation procedure response

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

### [x] Recompute access deltas for join tables when either side's policy changes

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

### [x] Preserve metadata event order while resolving policies in parallel

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

## Runtime Cost

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

## Historical Patterns

# Historical Review

## Summary

`origin/main...HEAD` contains the entire databases feature (272 changed files), so the historical
review focused on reusable utilities and conventions in the database implementation. The merged
`calebmer/databases` changes now align the public metadata mutation/read paths with the mature
access-policy patterns. The remaining findings below concern duplicated abstractions, inconsistent
modeling patterns, and stale branch artifacts.

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

### [x] Authorize loader-only database-group lookups

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
