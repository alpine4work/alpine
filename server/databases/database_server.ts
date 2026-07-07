import type {Database as SqliteDatabase} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {Database, type DatabaseTrackedExecution} from "~/shared/databases/database.js";
import type {
    DatabaseActionName,
    DatabaseActionObject,
    DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import type {ReadonlyDatabasePageSet} from "~/shared/databases/database_protocol_schemas.js";
import {hashWithPrivateSalt} from "~/shared/databases/hash_with_private_salt.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {
    joinTableSqliteMigrations,
    runJoinTableMigrations,
    runMainMigrations,
    runTableMigrations,
    tableSqliteMigrations,
} from "~/shared/databases/sqlite_migrations.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {DatabaseGroupId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {enqueueDatabaseTableReplicationJob} from "~/shared/rpc/database_replication_rpc_definitions.js";
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
    private readonly databaseGroupId: DatabaseGroupId;
    private readonly changedTables = new Set<DatabaseTableId>();
    /** Salted name hasher for the bootstrap `table_name_hash` backfill. */
    private readonly hashTableName: (tableName: string) => string;

    private constructor(
        database: Database,
        storage: DatabaseServerStorage,
        databaseGroupId: DatabaseGroupId,
        privateSalt: Uint8Array,
    ) {
        this.database = database;
        this.storage = storage;
        this.databaseGroupId = databaseGroupId;
        this.hashTableName = tableName => hashWithPrivateSalt(privateSalt, tableName);
    }

    /**
     * `privateSalt` is the group's secret salt (held in its durable object, never
     * replicated) keying the registry's `table_name_hash` uniqueness index.
     */
    static async create(
        storage: DatabaseServerStorage,
        databaseGroupId: DatabaseGroupId,
        privateSalt: Uint8Array,
    ): Promise<DatabaseServer> {
        const database = await Database.create(storage, {server: {privateSalt}});
        const server = new DatabaseServer(database, storage, databaseGroupId, privateSalt);
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
        return this._runAndPersist(context, () =>
            this.database.executeAction(actionObject, {
                currentAccountId: context.actor.getPossiblyBotAccountIdIfExists(),
            }),
        );
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
                        schema_version,
                        table_name_hash
                    FROM
                        _alpine_tables
                `.selectAll(db, {
                    id: Schema.id<DatabaseTableId>(),
                    kind: Schema.enum(["table", "join"]),
                    schemaVersion: Schema.integer.originalPropertyKey("schema_version"),
                    tableNameHash: Schema.string.nullable().originalPropertyKey("table_name_hash"),
                });
            },
            {allowWrites: "schema+data"},
        );
        this._persistBuffer();

        // Repair stale per-table files, one execute + persist per table. The registry
        // mirrors each file's migration state (schema_version) and salted name hash
        // (table_name_hash), so a table needing neither is skipped without ever
        // attaching it — bootstrap costs O(stale tables), and cold starts after a
        // no-migration deploy attach nothing. Actions assume both mirrors are
        // complete (attach-on-miss requires migration-current files; the
        // name-uniqueness probe can't see NULL hashes), so this sweep must finish
        // before any action runs. Persisting per table keeps repaired files' buffered
        // writes drained — Database only evicts tables with an empty buffer, and for
        // groups with more stale tables than the attach threshold the sweep relies on
        // that LRU eviction to stay under SQLite's limit.
        for (const table of tables) {
            const migrationCount =
                table.kind === "table"
                    ? tableSqliteMigrations(table.id).length
                    : joinTableSqliteMigrations(table.id).length;
            const needsMigrations = table.schemaVersion !== migrationCount;
            const needsTableNameHash = table.tableNameHash === null;
            if (!needsMigrations && !needsTableNameHash) continue;
            this.database.execute(
                db => {
                    this.database.attachIfNeeded(table.id);
                    if (needsMigrations) {
                        // The migration runner also repairs the registry's schema_version mirror, in
                        // the same buffer batch as the migrations themselves.
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
                    }
                    if (needsTableNameHash) {
                        const tableName = sql`
                            SELECT
                                table_name
                            FROM
                                ${sql.tableRef(
                                    table.id,
                                    table.kind === "table" ? "_alpine_table" : "_alpine_join_table",
                                )}
                        `.selectValue(db, Schema.string);
                        sql`
                            UPDATE _alpine_tables
                            SET
                                table_name_hash = ${this.hashTableName(tableName)}
                            WHERE
                                id = ${table.id}
                        `.exec(db);
                    }
                },
                {allowWrites: "schema+data"},
            );
            this._persistBuffer();
        }
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
                return {...persistedResult, changedTables};
            });
        } catch (error) {
            // Drop any partial buffered writes — whether the tracked execute or the drain
            // failed — so storage and SQLite's pager cache stay in sync and the next execute
            // starts from an empty buffer. `discardBuffer` is a safe no-op if the drain
            // already committed.
            this.database.discardBuffer();
            throw error;
        } finally {
            this.changedTables.clear();
        }
        this.scheduleReplication(context, {
            tableIds: persisted.changedTables,
        });
        return persisted;
    }

    private scheduleReplication(
        context: WorkerActionContext,
        {
            tableIds,
        }: {
            tableIds: DatabaseServerChangedTables;
        },
    ): void {
        if (tableIds.size === 0) return;

        context.process.waitUntil(
            enqueueDatabaseTableReplicationJob(context, {
                databaseGroupId: this.databaseGroupId,
                tableIds,
            }),
        );
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
