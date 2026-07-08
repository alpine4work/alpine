import type {Database as SqliteDatabase} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {isTrustedDatabaseServiceActor} from "~/server/databases/is_trusted_database_service_actor.js";
import {
    type AccessLevel,
    type AccessPolicy,
    getAccountAccessLevelAssumingSpaceAccess,
    maxAccessLevel,
} from "~/shared/access/access_policy.js";
import {Database, type DatabaseTrackedExecution} from "~/shared/databases/database.js";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    type DatabaseActionOutput,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import type {
    DatabaseTableAccessLevel,
    ReadonlyDatabasePageSet,
} from "~/shared/databases/database_protocol_schemas.js";
import {DatabaseTableAccessPolicySqlSchema} from "~/shared/databases/database_table_access_policy.js";
import {type SqlQuery, databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {
    type SqliteTableAccess,
    type SqliteWriteLevel,
    deniedSqliteTableAccess,
    unrestrictedSqliteTableAccess,
} from "~/shared/databases/sqlite_authorizer.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {
    joinTableSqliteMigrations,
    runJoinTableMigrations,
    runMainMigrations,
    runTableMigrations,
    tableSqliteMigrations,
} from "~/shared/databases/sqlite_migrations.js";
import {sqliteTableAccessForAccessLevel} from "~/shared/databases/sqlite_table_access_for_access_level.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {AccountId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export interface DatabaseServerPageChange {
    before: Uint8Array;
    after: Uint8Array;
    /**
     * Version of the stored page the change was computed against; 0 when the page
     * didn't exist before this batch. Carried into realtime diffs as `previousVersion`
     * so clients can verify their base before applying.
     */
    beforeVersion: number;
}

/**
 * Per-table changed-page report. `pages` carries the before/after images for each
 * page touched in the batch; `fileSizeInPages` is the post-drain canonical SQLite
 * file size for this table — sent alongside the diffs so clients can extend or
 * truncate their cache atomically with the page writes.
 */
export interface DatabaseServerTableChangedPages {
    pages: Map<number, DatabaseServerPageChange>;
    fileSizeInPages: number;
}

export type DatabaseServerReadPages = Map<
    DatabaseTableId,
    Map<number, {data: Uint8Array; version: number}>
>;

export type DatabaseServerChangedPages = Map<DatabaseTableId, DatabaseServerTableChangedPages>;

export type DatabaseServerChangedTables = ReadonlySet<DatabaseTableId>;

export interface DatabaseServerResult {
    rows: Array<Record<string, unknown>>;
    readPages: DatabaseServerReadPages;
    changedPages: DatabaseServerChangedPages;
    changedTables: DatabaseServerChangedTables;
    writeVersion: number;
}

export type DatabaseServerActionResult<N extends DatabaseActionName> = {
    result: DatabaseActionOutput<N>;
    readPages: DatabaseServerReadPages;
    changedPages: DatabaseServerChangedPages;
    changedTables: DatabaseServerChangedTables;
    writeVersion: number;
};

/**
 * Cached access metadata for one table file, sourced from the file's own
 * replicated rows (`_alpine_table.access_policy` for user tables,
 * `_alpine_join_table`'s joined-table ids for join files).
 *
 * The cache upholds the invariant _attached ⟹ cached_: entries load in the attach
 * hook — the moment a schema becomes reachable by any statement — so the
 * authorizer's synchronous resolver never has to touch SQLite. Table policies only
 * change through `syncTableMetadata` (which fires the change-capture triggers,
 * refreshing the entry post-action), and a join's table ids are immutable (the
 * authorizer denies updating them), so entries stay valid even across LRU detach.
 */
type DatabaseServerTableAccessEntry =
    | {kind: "table"; accessPolicy: AccessPolicy}
    | {kind: "join"; sourceTableId: DatabaseTableId; targetTableId: DatabaseTableId};

/**
 * Canonical SQLite database backed by a {@link DatabaseServerStorage}
 * implementation.
 *
 * Wraps a {@link Database}: SQL execution, page tracking, authorization, and the
 * in-memory write buffer all live there. The server's job is to glue that buffer
 * to durable storage — every {@link execute}/{@link executeAction} call captures
 * pre-mutation page snapshots, drains the buffer to {@link DatabaseServerStorage},
 * and surfaces `readPages` (with full page data + version) and `changedPages`
 * (before/after, partitioned by table) for the realtime layer to broadcast.
 */
export class DatabaseServer {
    private readonly database: Database;
    private readonly storage: DatabaseServerStorage;
    private readonly changedTables = new Set<DatabaseTableId>();
    /** See {@link DatabaseServerTableAccessEntry}. */
    private readonly tableAccessCache = new Map<DatabaseTableId, DatabaseServerTableAccessEntry>();
    /**
     * Tables attached mid-action whose metadata row doesn't exist yet — a file being
     * created by the current action (`createRelationField` registers and attaches its
     * join file before inserting the `_alpine_join_table` row). The resolver treats
     * them as unrestricted so the creating action can run its migrations and metadata
     * insert; the set is re-resolved into real cache entries when the action commits
     * and cleared (entries dropped) when it fails.
     */
    private readonly pendingCreatedTableIds = new Set<DatabaseTableId>();

    private constructor(database: Database, storage: DatabaseServerStorage) {
        this.database = database;
        this.storage = storage;
    }

    /**
     * `privateSalt` is the group's secret salt (held in its durable object, never
     * replicated) keying the registry's `table_name_hash` uniqueness index.
     */
    static async create(
        storage: DatabaseServerStorage,
        privateSalt: Uint8Array,
    ): Promise<DatabaseServer> {
        const database = await Database.create(storage, {server: {privateSalt}});
        const server = new DatabaseServer(database, storage);
        // Install the attach hook before bootstrap so the migration sweep's attaches
        // populate the access cache too.
        database._installServerTableAttachHook(tableId => {
            server._loadTableAccessCacheEntry(tableId, {allowPendingCreation: true});
        });
        server._bootstrap();
        database._installServerTableChangeCapture(tableId => {
            server.changedTables.add(tableId);
        });
        return server;
    }

    execute(
        context: WorkerActionContext,
        query: SqlQuery,
        options: {allowWrites: SqliteWriteLevel},
    ): DatabaseServerResult {
        const {result, readPages, changedPages, changedTables, writeVersion} = this._runAndPersist(
            context,
            () => {
                const {rows, readPages} = this.database.executeSql(query, options);
                return {result: rows, readPages};
            },
        );
        return {rows: result, readPages, changedPages, changedTables, writeVersion};
    }

    executeAction<N extends DatabaseActionName>(
        context: WorkerActionContext,
        actionObject: DatabaseActionObject<N>,
    ): DatabaseServerActionResult<N> {
        // Trusted issuers are internal server code that authorized the operation before
        // forwarding it (see {@link isTrustedDatabaseServiceActor}); they run
        // unrestricted. Everyone else — browser traffic over the websocket protocol — may
        // not run internal actions and gets a per-table access resolver derived from the
        // replicated policies, enforced per statement by the SQLite authorizer.
        const isTrustedActor = isTrustedDatabaseServiceActor(context.actor);
        if (databaseActions[actionObject.name].internalOnly && !isTrustedActor) {
            throw new PermissionDeniedError(
                `Database action ${actionObject.name} is internal-only`,
            );
        }
        const currentAccountId = context.actor.getPossiblyBotAccountIdIfExists();
        return this._runAndPersist(context, () =>
            this.database.executeAction(actionObject, {
                currentAccountId,
                tableAccessResolver: isTrustedActor
                    ? null
                    : tableId => this.getTableAccessForAccount(tableId, currentAccountId),
            }),
        );
    }

    /**
     * The capabilities `accountId` has on `tableId`, derived synchronously from the
     * cached replicated policies (see {@link DatabaseServerTableAccessEntry}).
     *
     * - User tables map their `LocalAccessPolicy` level through the v1 rules
     *   (`View`/`Comment` read-only, `Edit`/`Manage` everything).
     * - Join files derive from the two joined tables: the max level of either side.
     *   (The add-vs-remove asymmetry — adding a link needs `View` on the linked table —
     *   is enforced by `addLink`'s `rowExists` read, not here; see {@link
     *   SqliteTableAccess}.)
     * - Unknown/uncached tables fail closed. The realtime layer reuses this for page
     *   filtering (milestone 4).
     */
    getTableAccessForAccount(
        tableId: DatabaseTableId,
        accountId: AccountId | null,
    ): SqliteTableAccess {
        if (this.pendingCreatedTableIds.has(tableId)) {
            // Mid-creation carve-out — see {@link pendingCreatedTableIds}.
            return unrestrictedSqliteTableAccess;
        }
        const entry = this.tableAccessCache.get(tableId);
        if (entry === undefined) return deniedSqliteTableAccess;
        switch (entry.kind) {
            case "table":
                return sqliteTableAccessForAccessLevel(
                    accessLevelForPolicy(entry.accessPolicy, accountId),
                );
            case "join": {
                const sourceLevel = this._getSideTableAccessLevel(entry.sourceTableId, accountId);
                const targetLevel = this._getSideTableAccessLevel(entry.targetTableId, accountId);
                const combinedLevel =
                    sourceLevel === null
                        ? targetLevel
                        : targetLevel === null
                          ? sourceLevel
                          : maxAccessLevel(sourceLevel, targetLevel);
                return sqliteTableAccessForAccessLevel(combinedLevel);
            }
            default:
                throw exhaustive(entry);
        }
    }

    /**
     * `accountId`'s wire-level access to one table — the per-table delta shape the
     * realtime layer pushes to clients.
     */
    getTableAccessLevelForAccount(
        tableId: DatabaseTableId,
        accountId: AccountId | null,
    ): DatabaseTableAccessLevel {
        return databaseTableAccessLevelForSqliteAccess(
            this.getTableAccessForAccount(tableId, accountId),
        );
    }

    /**
     * `accountId`'s wire-level access to every table registered in the group, plus the
     * main registry (public by design). This is the complete map
     * `ensureCacheIsUpToDate` pushes to clients — their only source of "exists but no
     * access", since an inaccessible table's policy lives inside a file that never
     * replicates to them.
     *
     * Tables whose policies aren't cached yet (registered but never attached since
     * this durable object woke) are attached on demand — the attach hook loads their
     * entries, and entries survive LRU detach, so this is a one-time cost per table
     * per durable-object lifetime.
     */
    getTableAccessLevelsForAccount(
        accountId: AccountId | null,
    ): Map<DatabaseTableId, DatabaseTableAccessLevel> {
        const tableIds = this.database._runServerMetadataRead(db =>
            sql`
                SELECT
                    id
                FROM
                    main._alpine_tables
            `.selectAll(db, {id: Schema.id<DatabaseTableId>()}),
        );
        const levels = new Map<DatabaseTableId, DatabaseTableAccessLevel>();
        for (const {id} of tableIds) {
            if (!this.tableAccessCache.has(id) && !this.pendingCreatedTableIds.has(id)) {
                this.database.attachIfNeeded(id);
            }
            levels.set(id, this.getTableAccessLevelForAccount(id, accountId));
        }
        levels.set(databaseMainTableId, "write");
        return levels;
    }

    createTrackedExecution<Value>(fn: () => Value): DatabaseTrackedExecution<Value> {
        return this.database.createTrackedExecution(fn);
    }

    close(): void {
        this.database.close();
    }

    /** Test-only: raw SQLite handle. */
    unsafeGetDbForTests(): SqliteDatabase {
        assert(import.meta.jest);
        return this.database.unsafeGetDbForTests();
    }

    /**
     * Test-only: drain any buffered writes accumulated by direct {@link
     * unsafeGetDbForTests} use to durable storage. Production paths drain
     * automatically as part of {@link execute}/{@link executeAction}; tests that write
     * through the raw handle and then inspect `storage` directly need this to
     * materialize the writes first.
     */
    commitBufferForTests(): void {
        assert(import.meta.jest);
        this._persistBuffer();
    }

    // -- Internal -----------------------------------------------------------

    /**
     * A joined table's access level for `accountId`, `null` when denied/unknown.
     */
    private _getSideTableAccessLevel(
        tableId: DatabaseTableId,
        accountId: AccountId | null,
    ): AccessLevel | null {
        const entry = this.tableAccessCache.get(tableId);
        if (entry === undefined || entry.kind !== "table") return null;
        return accessLevelForPolicy(entry.accessPolicy, accountId);
    }

    /**
     * (Re)load `tableId`'s {@link tableAccessCache} entry from its replicated metadata
     * rows. Runs as an internal metadata read — outside the ambient execution's
     * authorization and page tracking.
     *
     * `allowPendingCreation` marks a metadata-less file as mid-creation (see {@link
     * pendingCreatedTableIds}); only the attach hook passes it — the post-action
     * refresh must not, or a file that persistently lacks metadata would stay
     * unrestricted forever instead of failing closed.
     */
    private _loadTableAccessCacheEntry(
        tableId: DatabaseTableId,
        options?: {allowPendingCreation?: boolean},
    ): void {
        this.database._runServerMetadataRead(db => {
            const missing = (): void => {
                this.tableAccessCache.delete(tableId);
                if (options?.allowPendingCreation === true) {
                    this.pendingCreatedTableIds.add(tableId);
                }
            };
            // `captureResult` throughout: a file mid-creation or pre-`access_policy` migration
            // is missing tables/columns, and a registry predating the tables migration
            // (test-only) can't answer at all. All of those resolve to "no entry" — fail
            // closed — rather than an error.
            const kindResult = captureResult(() =>
                sql`
                    SELECT
                        kind
                    FROM
                        main._alpine_tables
                    WHERE
                        id = ${tableId}
                `.selectValueIfExists(db, Schema.enum(["table", "join"])),
            );
            if (!kindResult.ok || kindResult.value === null) {
                // Not registered (e.g. the registering transaction rolled back after the attach):
                // drop any entry and never treat as pending — an unregistered schema must fail
                // closed.
                this.tableAccessCache.delete(tableId);
                return;
            }
            const schema = sql.identifier(databaseTableSchemaName(tableId));
            switch (kindResult.value) {
                case "table": {
                    // `JSON(...)` converts the stored JSONB blob to text for the schema.
                    const policyResult = captureResult(() =>
                        sql`
                            SELECT
                                JSON(access_policy)
                            FROM
                                ${schema}._alpine_table
                            WHERE
                                id = ${tableId}
                        `.selectValueIfExists(db, DatabaseTableAccessPolicySqlSchema),
                    );
                    if (!policyResult.ok || policyResult.value === null) {
                        missing();
                        return;
                    }
                    this.tableAccessCache.set(tableId, {
                        kind: "table",
                        accessPolicy: policyResult.value,
                    });
                    this.pendingCreatedTableIds.delete(tableId);
                    return;
                }
                case "join": {
                    const rowResult = captureResult(() =>
                        sql`
                            SELECT
                                source_table_id,
                                target_table_id
                            FROM
                                ${schema}._alpine_join_table
                            WHERE
                                id = ${tableId}
                        `.selectOneOrNone(db, {
                            sourceTableId:
                                Schema.id<DatabaseTableId>().originalPropertyKey("source_table_id"),
                            targetTableId:
                                Schema.id<DatabaseTableId>().originalPropertyKey("target_table_id"),
                        }),
                    );
                    if (!rowResult.ok || rowResult.value === null) {
                        missing();
                        return;
                    }
                    const {sourceTableId, targetTableId} = rowResult.value;
                    this.tableAccessCache.set(tableId, {
                        kind: "join",
                        sourceTableId,
                        targetTableId,
                    });
                    this.pendingCreatedTableIds.delete(tableId);
                    // A join's access derives from its two sides, so their policies must be cached
                    // alongside it. Attaching a side runs this loader for it via the attach hook; an
                    // already-attached but uncached side (shouldn't happen — attached implies cached)
                    // loads directly.
                    for (const sideTableId of [sourceTableId, targetTableId]) {
                        if (this.tableAccessCache.has(sideTableId)) continue;
                        if (this.database.isAttached(sideTableId)) {
                            this._loadTableAccessCacheEntry(sideTableId, options);
                        } else {
                            this.database.attachIfNeeded(sideTableId);
                        }
                    }
                    return;
                }
                default:
                    throw exhaustive(kindResult.value);
            }
        });
    }

    /**
     * Post-action cache maintenance: reload entries for tables whose `_alpine_table`
     * rows the action wrote (captured by the change triggers) and resolve mid-creation
     * tables into real entries now that their metadata rows are committed.
     */
    private _refreshTableAccessCache(changedTableIds: ReadonlySet<DatabaseTableId>): void {
        const tableIds = new Set([...changedTableIds, ...this.pendingCreatedTableIds]);
        this.pendingCreatedTableIds.clear();
        for (const tableId of tableIds) {
            this._loadTableAccessCacheEntry(tableId);
        }
    }

    /**
     * Failure-path cache maintenance: a failed action's transaction rolled back, so
     * any files it was creating have no metadata (and possibly no registry row). Drop
     * their carve-out and entries — fail closed.
     */
    private _dropPendingCreatedTableAccess(): void {
        for (const tableId of this.pendingCreatedTableIds) {
            this.tableAccessCache.delete(tableId);
        }
        this.pendingCreatedTableIds.clear();
    }

    private _bootstrap(): void {
        // Bootstrap writes flow through the buffer like any other execute; each batch
        // drains to storage right after. ATTACH is legal mid-execute (no explicit
        // transaction is open), so per-table files attach + migrate inline.
        const {result: tables} = this.database.execute(
            db => {
                db.exec("PRAGMA quick_check");
                runMainMigrations(db);
                return sql`
                    SELECT
                        id,
                        kind,
                        schema_version
                    FROM
                        _alpine_tables
                `.selectAll(db, {
                    id: Schema.id<DatabaseTableId>(),
                    kind: Schema.enum(["table", "join"]),
                    schemaVersion: Schema.integer.originalPropertyKey("schema_version"),
                });
            },
            {allowWrites: "schema+data"},
        );
        this._persistBuffer();

        // Migrate stale per-table files, one execute + persist per table. The registry's
        // schema_version mirrors each file's user_version, so a current table is skipped
        // without ever attaching it — bootstrap costs O(stale tables), and cold starts
        // after a no-migration deploy attach nothing. Attach-on-miss assumes every
        // registered file is migration-current, so this sweep must finish before any
        // action runs. Persisting per table keeps migrated files' buffered writes drained
        // — Database only evicts tables with an empty buffer, and for groups with more
        // stale tables than the attach threshold the sweep relies on that LRU eviction to
        // stay under SQLite's limit.
        for (const table of tables) {
            const migrationCount =
                table.kind === "table"
                    ? tableSqliteMigrations(table.id).length
                    : joinTableSqliteMigrations(table.id).length;
            if (table.schemaVersion === migrationCount) continue;
            // The migration runner also repairs the registry's schema_version mirror, in the
            // same buffer batch as the migrations themselves.
            this.database.execute(
                db => {
                    this.database.attachIfNeeded(table.id);
                    switch (table.kind) {
                        case "table":
                            runTableMigrations(db, table.id);
                            break;
                        case "join":
                            runJoinTableMigrations(db, table.id);
                            break;
                        default:
                            throw exhaustive(table.kind);
                    }
                },
                {allowWrites: "schema+data"},
            );
            this._persistBuffer();
            // The attach hook loaded this table's access entry against its pre-migration
            // schema — which may predate the `access_policy` column. Reload now that the file
            // is current. (No change-capture triggers exist yet during bootstrap.)
            this._loadTableAccessCacheEntry(table.id);
        }
        this.pendingCreatedTableIds.clear();
    }

    private _runAndPersist<T>(
        context: WorkerActionContext,
        run: () => {result: T; readPages: ReadonlyDatabasePageSet},
    ): {
        result: T;
        readPages: DatabaseServerReadPages;
        changedPages: DatabaseServerChangedPages;
        changedTables: DatabaseServerChangedTables;
        writeVersion: number;
    } {
        // The error path below clears the buffer to recover from a partial write; assert
        // up front that we're not silently throwing away pre-existing buffered writes
        // belonging to a prior (forgotten) drain.
        this.database.assertBufferIsEmpty("_runAndPersist");
        this.changedTables.clear();
        let persisted: {
            result: T;
            readPages: DatabaseServerReadPages;
            changedPages: DatabaseServerChangedPages;
            changedTables: DatabaseServerChangedTables;
            writeVersion: number;
        };
        try {
            persisted = this.storage.transactionSync(() => {
                const {result, readPages} = run();
                const changedTables = new Set(this.changedTables);
                const persistedResult = this._persistAndBuildResult(result, readPages);
                this.database.refreshServerTableChangeTriggers();
                this._refreshTableAccessCache(changedTables);
                return {...persistedResult, changedTables};
            });
        } catch (error) {
            // Drop any partial buffered writes — whether the tracked execute or the drain
            // failed — so storage and SQLite's pager cache stay in sync and the next execute
            // starts from an empty buffer. `discardBuffer` is a safe no-op if the drain
            // already committed.
            this.database.discardBuffer();
            this._dropPendingCreatedTableAccess();
            throw error;
        } finally {
            this.changedTables.clear();
        }
        return persisted;
    }

    private _persistAndBuildResult<T>(
        result: T,
        readPagesSet: ReadonlyDatabasePageSet,
    ): {
        result: T;
        readPages: DatabaseServerReadPages;
        changedPages: DatabaseServerChangedPages;
        writeVersion: number;
    } {
        const buffered = this.database.getBufferedWrites();

        // Capture the pre-mutation `before` image for every buffered page from storage
        // _before_ draining.
        //
        // `changedPages` is built from `buffered.pages` only, so a table with a buffered
        // truncate but no buffered page write would be dropped from the realtime broadcast
        // (its shrunk `fileSizeInPages` never sent). That can't happen today: SQLite
        // rewrites a low page (the header / change counter) on every transaction that also
        // truncates, so every truncated table also has a buffered page write. Assert that
        // invariant rather than handle a truncate-only table that no SQL path can
        // currently produce — if this ever fires, the build-from-`pages`-only logic below
        // needs to fold in `buffered.truncates` too.
        const changedPages: DatabaseServerChangedPages = new Map();
        if (buffered !== null) {
            for (const tableId of buffered.truncates.keys()) {
                assert(
                    buffered.pages.has(tableId),
                    `truncate-only table ${tableId} would be dropped from changedPages`,
                );
            }
            for (const [tableId, tablePages] of buffered.pages) {
                const pages = new Map<number, DatabaseServerPageChange>();
                for (const [pageIndex, after] of tablePages) {
                    const stored = this.storage.readPage(tableId, pageIndex);
                    const before = stored !== null ? stored.data : new Uint8Array(sqlitePageSize);
                    pages.set(pageIndex, {
                        before: new Uint8Array(before),
                        after: new Uint8Array(after),
                        beforeVersion: stored !== null ? stored.version : 0,
                    });
                }
                // `fileSizesInPages` already reflects the post-drain logical size (Database folds
                // in buffered truncates + max page index), so we can stamp it in pre-drain.
                const fileSizeInPages = buffered.fileSizesInPages.get(tableId);
                assert(
                    fileSizeInPages !== undefined,
                    `missing fileSizeInPages for table ${tableId}`,
                );
                changedPages.set(tableId, {pages, fileSizeInPages});
            }
        }

        const postWriteVersion = this._persistBuffer();

        // Build the readPages map with full page data + version per table. For pages that
        // were just written, use the after-image plus the freshly- assigned write version;
        // for the rest, fetch from storage.
        const readPages: DatabaseServerReadPages = new Map();
        for (const [tableId, indexes] of readPagesSet) {
            const tableMap = new Map<number, {data: Uint8Array; version: number}>();
            const tableChanges = changedPages.get(tableId)?.pages;
            for (const pageIndex of indexes) {
                const change = tableChanges?.get(pageIndex);
                if (change !== undefined) {
                    tableMap.set(pageIndex, {
                        data: new Uint8Array(change.after),
                        version: postWriteVersion,
                    });
                } else {
                    const page = this.storage.readPage(tableId, pageIndex);
                    // A read page that reads back `null` post-drain was truncated away by this same
                    // batch: the VFS only adds a page to the read set when the read returned real
                    // data, so `null` here means the batch's truncate tombstoned it. The server
                    // considers it gone — omit it rather than fabricating a zero-filled, version-0
                    // page for an index past the new end of file. Clients learn of the shrink via
                    // `fileSizeInPages`.
                    if (page === null) continue;
                    tableMap.set(pageIndex, {
                        data: new Uint8Array(page.data),
                        version: page.version,
                    });
                }
            }
            readPages.set(tableId, tableMap);
        }

        // The realtime layer pulls the version for each changed page out of `readPages`,
        // so make sure every changed page is represented there even if SQLite never read
        // it back during execution.
        for (const [tableId, entry] of changedPages) {
            let tableMap = readPages.get(tableId);
            if (tableMap === undefined) {
                tableMap = new Map();
                readPages.set(tableId, tableMap);
            }
            for (const [pageIndex, change] of entry.pages) {
                if (!tableMap.has(pageIndex)) {
                    tableMap.set(pageIndex, {
                        data: new Uint8Array(change.after),
                        version: postWriteVersion,
                    });
                }
            }
        }

        // Always include page 0 for every table in the result, mirroring
        // `ensureCacheIsUpToDate`. SQLite usually serves the header/schema page from its
        // pager cache (and skips schema-cookie reads entirely in exclusive locking mode),
        // so the tracked read set rarely contains it — but a client can't ATTACH a table
        // it fetched over the wire without the header page.
        for (const [tableId, tableMap] of readPages) {
            if (tableMap.has(0)) continue;
            const page0 = this.storage.readPage(tableId, 0);
            if (page0 !== null) {
                tableMap.set(0, {
                    data: new Uint8Array(page0.data),
                    version: page0.version,
                });
            }
        }

        return {result, readPages, changedPages, writeVersion: postWriteVersion};
    }

    /**
     * Drain the buffer's truncates and page writes into durable storage and clear it.
     * Returns the version stamped on the batch (0 if the buffer was empty).
     */
    private _persistBuffer(): number {
        const buffered = this.database.getBufferedWrites();
        if (buffered === null) return 0;
        const version = this.storage.writePages(buffered.pages, buffered.truncates);
        this.database.markCommitted();
        return version;
    }
}

/**
 * Evaluate a replicated table policy for an account. The durable object only ever
 * receives `Local` policies (`syncTableMetadata` resolves `Site` policies before
 * syncing — see `resolveDatabaseTableAccessPolicyForDurableObjectSync`); an
 * unresolved `Site` policy fails closed. Space membership was authorized at the
 * connection/request boundary, which is exactly the assumption
 * `getAccountAccessLevelAssumingSpaceAccess` requires.
 */
function accessLevelForPolicy(
    accessPolicy: AccessPolicy,
    accountId: AccountId | null,
): AccessLevel | null {
    if (accessPolicy.type !== "Local") return null;
    return getAccountAccessLevelAssumingSpaceAccess(accessPolicy, accountId);
}

/**
 * Collapse per-statement capabilities into the coarser wire shape clients consume.
 * `write` and `schema` both report `"write"` — the authoritative per-statement
 * enforcement stays server-side.
 */
function databaseTableAccessLevelForSqliteAccess(
    access: SqliteTableAccess,
): DatabaseTableAccessLevel {
    if (access.write || access.schema) return "write";
    if (access.read) return "read";
    return "none";
}
