import type {Database as SqliteDatabase} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {
    type DatabaseServerStorage,
    DatabaseServerStorageAdapter,
} from "~/server/databases/database_server_storage.js";
import {Database} from "~/shared/databases/database.js";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    type DatabaseActionOutput,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import type {ReadonlyDatabasePageSet} from "~/shared/databases/database_protocol_schemas.js";
import {sql} from "~/shared/databases/sql.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {runSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";

export interface DatabaseServerPageChange {
    before: Uint8Array;
    after: Uint8Array;
}

export interface DatabaseServerResult {
    rows: Array<Record<string, unknown>>;
    readPages: Map<number, {data: Uint8Array; version: number}>;
    changedPages: Map<number, DatabaseServerPageChange>;
}

/**
 * Canonical SQLite database backed by a
 * {@link DatabaseServerStorage} implementation.
 *
 * Wraps a {@link Database}: SQL execution, page tracking,
 * authorization, and the in-memory write buffer all live
 * there. The server's job is to glue that buffer to durable
 * storage — every {@link execute}/{@link executeAction}
 * call captures pre-mutation page snapshots, drains the
 * buffer to {@link DatabaseServerStorage}, and surfaces
 * `readPages` (with full page data + version) and
 * `changedPages` (before/after) for the realtime layer to
 * broadcast.
 */
export class DatabaseServer {
    private readonly database: Database;
    private readonly storage: DatabaseServerStorage;

    private constructor(database: Database, storage: DatabaseServerStorage) {
        this.database = database;
        this.storage = storage;
    }

    static async create(storage: DatabaseServerStorage): Promise<DatabaseServer> {
        const adapter = new DatabaseServerStorageAdapter(storage);
        const database = await Database.create(adapter);
        const server = new DatabaseServer(database, storage);
        server._bootstrap();
        return server;
    }

    execute(query: string, options: {allowWrites: SqliteWriteLevel}): DatabaseServerResult {
        const {result, ...res} = this._runAndPersist(options.allowWrites, db =>
            sql.raw(query).selectAllUnknown(db),
        );
        return {rows: result, readPages: res.readPages, changedPages: res.changedPages};
    }

    executeAction<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ): {
        result: DatabaseActionOutput<N>;
        readPages: Map<number, {data: Uint8Array; version: number}>;
        changedPages: Map<number, DatabaseServerPageChange>;
    } {
        const action = databaseActions[actionObject.name];
        const {result, readPages, changedPages} = this._runAndPersist(action.writeLevel, db =>
            action.run(db, actionObject.input as never),
        );
        return {
            result: result as DatabaseActionOutput<N>,
            readPages,
            changedPages,
        };
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
     * Test-only: drain any buffered writes accumulated by
     * direct {@link unsafeGetDbForTests} use to durable
     * storage. Production paths drain automatically as part
     * of {@link execute}/{@link executeAction}; tests that
     * write through the raw handle and then inspect
     * `storage` directly need this to materialize the
     * writes first.
     */
    commitBufferForTests(): void {
        assert(import.meta.jest);
        this._persistBuffer();
    }

    // -- Internal -----------------------------------------------------------

    private _bootstrap(): void {
        // Bootstrap runs as one privileged "execute" so its
        // writes flow through the buffer like any other
        // action; we drain to storage immediately after.
        this.database.execute(
            db => {
                db.exec("PRAGMA quick_check");
                runSqliteMigrations(db);
                const tableCount = sql`
                    SELECT
                        COUNT(*)
                    FROM
                        _alpine_tables
                `.selectValue(db, Schema.integer);
                if (tableCount === 0) {
                    databaseActions.createTable.run(db, {name: "Table"});
                }
                db.exec("PRAGMA optimize");
            },
            {allowWrites: "schema+data"},
        );
        this._persistBuffer();
    }

    private _runAndPersist<T>(
        writeLevel: SqliteWriteLevel,
        fn: (db: SqliteDatabase) => T,
    ): {
        result: T;
        readPages: Map<number, {data: Uint8Array; version: number}>;
        changedPages: Map<number, DatabaseServerPageChange>;
    } {
        let inner: {
            result: T;
            readPages: ReadonlyDatabasePageSet;
            writtenPages: ReadonlyDatabasePageSet;
        };
        try {
            inner = this.database.execute(
                db => {
                    const result = fn(db);
                    // Run optimize inside the same tracked
                    // call so any ANALYZE updates are
                    // captured in the buffer (and broadcast
                    // via realtime) alongside the action's
                    // own writes.
                    if (writeLevel === "schema+data") {
                        db.exec("PRAGMA optimize");
                    }
                    return result;
                },
                {allowWrites: writeLevel},
            );
        } catch (error) {
            // Drop any partial buffered writes so storage
            // and SQLite's pager cache stay in sync.
            this.database.discardBuffer();
            throw error;
        }
        return this._finalize(inner.result, inner.readPages);
    }

    private _finalize<T>(
        result: T,
        readPagesSet: ReadonlyDatabasePageSet,
    ): {
        result: T;
        readPages: Map<number, {data: Uint8Array; version: number}>;
        changedPages: Map<number, DatabaseServerPageChange>;
    } {
        const tableId = databaseMainTableId;
        const buffered = this.database.getBufferedWrites();

        // Capture the pre-mutation `before` image for every
        // buffered page from storage *before* draining.
        const changedPages = new Map<number, DatabaseServerPageChange>();
        const tablePages = buffered?.pages.get(tableId);
        if (tablePages !== undefined) {
            for (const [pageIndex, after] of tablePages) {
                const stored = this.storage.readPage(tableId, pageIndex);
                const before =
                    stored !== null && stored.data !== null
                        ? stored.data
                        : new Uint8Array(sqlitePageSize);
                changedPages.set(pageIndex, {
                    before: new Uint8Array(before),
                    after: new Uint8Array(after),
                });
            }
        }

        const postWriteVersion = this._persistBuffer();

        // Build the readPages map with full page data +
        // version. For pages that were just written, use
        // the after-image plus the freshly-assigned write
        // version; for the rest, fetch from storage.
        const readPages = new Map<number, {data: Uint8Array; version: number}>();
        const readIndexes = readPagesSet.get(tableId) ?? new Set<number>();
        for (const pageIndex of readIndexes) {
            const change = changedPages.get(pageIndex);
            if (change !== undefined) {
                readPages.set(pageIndex, {
                    data: new Uint8Array(change.after),
                    version: postWriteVersion,
                });
            } else {
                const page = this.storage.readPage(tableId, pageIndex);
                const data =
                    page !== null && page.data !== null
                        ? page.data
                        : new Uint8Array(sqlitePageSize);
                readPages.set(pageIndex, {
                    data: new Uint8Array(data),
                    version: page?.version ?? 0,
                });
            }
        }

        // The realtime layer pulls the version for each
        // changed page out of `readPages`, so make sure
        // every changed page is represented there even if
        // SQLite never read it back during execution.
        for (const [pageIndex, change] of changedPages) {
            if (!readPages.has(pageIndex)) {
                readPages.set(pageIndex, {
                    data: new Uint8Array(change.after),
                    version: postWriteVersion,
                });
            }
        }

        return {result, readPages, changedPages};
    }

    /**
     * Drain the buffer's truncates and page writes into
     * durable storage and clear it. Returns the version
     * stamped on the page writes (0 if no pages were
     * written).
     */
    private _persistBuffer(): number {
        const buffered = this.database.getBufferedWrites();
        if (buffered === null) return 0;
        const tableId = databaseMainTableId;
        const truncate = buffered.truncates.get(tableId);
        if (truncate !== undefined) {
            this.storage.truncate(tableId, truncate);
        }
        let version = 0;
        const tablePages = buffered.pages.get(tableId);
        if (tablePages !== undefined && tablePages.size > 0) {
            version = this.storage.writePages(tableId, tablePages);
        }
        this.database.markCommitted();
        return version;
    }
}
