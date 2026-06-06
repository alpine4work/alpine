import type {Database as SqliteDatabase} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {Database} from "~/shared/databases/database.js";
import type {
    DatabaseActionName,
    DatabaseActionObject,
    DatabaseActionOutput,
} from "~/shared/databases/database_actions.js";
import type {ReadonlyDatabasePageSet} from "~/shared/databases/database_protocol_schemas.js";
import {sql} from "~/shared/databases/sql.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {runMainMigrations, runTableMigrations} from "~/shared/databases/sqlite_migrations.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export interface DatabaseServerPageChange {
    before: Uint8Array;
    after: Uint8Array;
}

/**
 * Per-table changed-page report. `pages` carries the
 * before/after images for each page touched in the batch;
 * `fileSizeInPages` is the post-drain canonical SQLite file
 * size for this table — sent alongside the diffs so clients
 * can extend or truncate their cache atomically with the
 * page writes.
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

export interface DatabaseServerResult {
    rows: Array<Record<string, unknown>>;
    readPages: DatabaseServerReadPages;
    changedPages: DatabaseServerChangedPages;
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
 * `changedPages` (before/after, partitioned by table) for
 * the realtime layer to broadcast.
 */
export class DatabaseServer {
    private readonly database: Database;
    private readonly storage: DatabaseServerStorage;

    private constructor(database: Database, storage: DatabaseServerStorage) {
        this.database = database;
        this.storage = storage;
    }

    static async create(storage: DatabaseServerStorage): Promise<DatabaseServer> {
        const database = await Database.create(storage, {server: true});
        const server = new DatabaseServer(database, storage);
        server._bootstrap();
        return server;
    }

    execute(query: string, options: {allowWrites: SqliteWriteLevel}): DatabaseServerResult {
        const {result, readPages, changedPages} = this._runAndPersist(() => {
            const {rows, readPages} = this.database.executeSql(query, options);
            return {result: rows, readPages};
        });
        return {rows: result, readPages, changedPages};
    }

    executeAction<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ): {
        result: DatabaseActionOutput<N>;
        readPages: DatabaseServerReadPages;
        changedPages: DatabaseServerChangedPages;
    } {
        return this._runAndPersist(() => {
            const {output: result, readPages} = this.database.executeAction(actionObject);
            return {result, readPages};
        });
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
        // ATTACH is legal mid-execute (no explicit
        // transaction is open), so we can attach + migrate
        // every per-table file inline.
        this.database.execute(
            db => {
                db.exec("PRAGMA quick_check");
                runMainMigrations(db);

                // Attach + migrate each existing table's per-db
                // file so its data and metadata are reachable.
                const tableIds = sql`
                    SELECT
                        id
                    FROM
                        _alpine_tables
                `.selectValues(db, Schema.id<DatabaseTableId>());
                for (const tableId of tableIds) {
                    this.database.attachIfNeeded(tableId);
                    runTableMigrations(db, tableId);
                }
            },
            {allowWrites: "schema+data"},
        );
        this._persistBuffer();
    }

    private _runAndPersist<T>(run: () => {result: T; readPages: ReadonlyDatabasePageSet}): {
        result: T;
        readPages: DatabaseServerReadPages;
        changedPages: DatabaseServerChangedPages;
    } {
        // The error path below clears the buffer to recover
        // from a partial write; assert up front that we're
        // not silently throwing away pre-existing buffered
        // writes belonging to a prior (forgotten) drain.
        this.database.assertBufferIsEmpty("_runAndPersist");
        try {
            const {result, readPages} = run();
            return this._persistAndBuildResult(result, readPages);
        } catch (error) {
            // Drop any partial buffered writes — whether the
            // tracked execute or the drain failed — so storage
            // and SQLite's pager cache stay in sync and the
            // next execute starts from an empty buffer.
            // `discardBuffer` is a safe no-op if the drain
            // already committed.
            this.database.discardBuffer();
            throw error;
        }
    }

    private _persistAndBuildResult<T>(
        result: T,
        readPagesSet: ReadonlyDatabasePageSet,
    ): {
        result: T;
        readPages: DatabaseServerReadPages;
        changedPages: DatabaseServerChangedPages;
    } {
        const buffered = this.database.getBufferedWrites();

        // Capture the pre-mutation `before` image for every
        // buffered page from storage *before* draining.
        //
        // `changedPages` is built from `buffered.pages` only,
        // so a table with a buffered truncate but no buffered
        // page write would be dropped from the realtime
        // broadcast (its shrunk `fileSizeInPages` never sent).
        // That can't happen today: SQLite rewrites a low page
        // (the header / change counter) on every transaction
        // that also truncates, so every truncated table also
        // has a buffered page write. Assert that invariant
        // rather than handle a truncate-only table that no SQL
        // path can currently produce — if this ever fires, the
        // build-from-`pages`-only logic below needs to fold in
        // `buffered.truncates` too.
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
                    });
                }
                // `fileSizesInPages` already reflects the
                // post-drain logical size (Database folds in
                // buffered truncates + max page index), so
                // we can stamp it in pre-drain.
                const fileSizeInPages = buffered.fileSizesInPages.get(tableId);
                assert(
                    fileSizeInPages !== undefined,
                    `missing fileSizeInPages for table ${tableId}`,
                );
                changedPages.set(tableId, {pages, fileSizeInPages});
            }
        }

        const postWriteVersion = this._persistBuffer();

        // Build the readPages map with full page data +
        // version per table. For pages that were just
        // written, use the after-image plus the freshly-
        // assigned write version; for the rest, fetch from
        // storage.
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
                    // A read page that reads back `null` post-drain
                    // was truncated away by this same batch: the VFS
                    // only adds a page to the read set when the read
                    // returned real data, so `null` here means the
                    // batch's truncate tombstoned it. The server
                    // considers it gone — omit it rather than
                    // fabricating a zero-filled, version-0 page for
                    // an index past the new end of file. Clients
                    // learn of the shrink via `fileSizeInPages`.
                    if (page === null) continue;
                    tableMap.set(pageIndex, {
                        data: new Uint8Array(page.data),
                        version: page.version,
                    });
                }
            }
            readPages.set(tableId, tableMap);
        }

        // The realtime layer pulls the version for each
        // changed page out of `readPages`, so make sure
        // every changed page is represented there even if
        // SQLite never read it back during execution.
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

        return {result, readPages, changedPages};
    }

    /**
     * Drain the buffer's truncates and page writes into
     * durable storage and clear it. Returns the version
     * stamped on the batch (0 if the buffer was empty).
     */
    private _persistBuffer(): number {
        const buffered = this.database.getBufferedWrites();
        if (buffered === null) return 0;
        const version = this.storage.writePages(buffered.pages, buffered.truncates);
        this.database.markCommitted();
        return version;
    }
}
