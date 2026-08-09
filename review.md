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
