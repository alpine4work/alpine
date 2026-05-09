import type {
    Sqlite3Static,
    Database as SqliteDatabase,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    type DatabaseActionOutput,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import type {DatabaseStorage} from "~/shared/databases/database_storage.js";
import type {InstalledVfs, VfsFile} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {sql} from "~/shared/databases/sql.js";
import {trySqlite3WasmLoader} from "~/shared/databases/sqlite3_wasm_loader.js";
import {
    type SqliteWriteLevel,
    isSqliteActionAllowed,
    sqliteAuthorizerActionName,
} from "~/shared/databases/sqlite_authorizer.js";
import {
    databaseMainTableId,
    pageAccessFlagRead,
    sqliteOpenPragmas,
    sqlitePageSize,
} from "~/shared/databases/sqlite_constants.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {installTracing} from "~/shared/databases/sqlite_tracing.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

const vfsNamePrefix = "alpine-database";
let vfsCounter = 0;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;

/**
 * The pending in-memory writes buffered by a
 * {@link Database} since its creation or its last
 * {@link Database.markCommitted}/{@link Database.discardBuffer}.
 */
export interface DatabaseBufferedWrites {
    /**
     * Per-table page writes, keyed by zero-based page
     * index. Each value is the page's full
     * {@link sqlitePageSize}-byte after-image.
     */
    readonly pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>;
    /**
     * Per-table file truncates, keyed by table. Each
     * value is the new file size in bytes.
     */
    readonly truncates: ReadonlyMap<DatabaseTableId, number>;
}

/** Result of a single {@link Database.execute} call. */
export interface DatabaseExecuteResult {
    readonly rows: Array<Record<string, unknown>>;
    /**
     * Pages SQLite read while running this call. Includes
     * cache hits, captured via the page-access hook.
     */
    readonly readPages: ReadonlyMap<DatabaseTableId, ReadonlySet<number>>;
    /** Pages buffered by writes that ran during this call. */
    readonly writtenPages: ReadonlyMap<DatabaseTableId, ReadonlySet<number>>;
}

/** Result of a single {@link Database.executeAction} call. */
export interface DatabaseExecuteActionResult<N extends DatabaseActionName> {
    readonly output: DatabaseActionOutput<N>;
    readonly readPages: ReadonlyMap<DatabaseTableId, ReadonlySet<number>>;
    readonly writtenPages: ReadonlyMap<DatabaseTableId, ReadonlySet<number>>;
}

/**
 * SQLite database that buffers writes in memory.
 *
 * Built around a read-only {@link DatabaseStorage}: every
 * write goes into an in-memory buffer rather than the
 * underlying storage, and the caller decides what to do
 * with it. Drain the buffer via {@link bufferedWrites}
 * and persist it however you like; once the writes are
 * durable, call {@link markCommitted} to clear the
 * buffer. To throw the buffer away instead, call
 * {@link discardBuffer} — that clears the buffer and
 * invalidates SQLite's page cache so future reads fall
 * back to storage.
 *
 * Multi-table model: each {@link DatabaseTableId} given
 * at construction is `ATTACH`ed as a separate SQLite
 * database. The first table id must be
 * {@link databaseMainTableId}. The table id appears as
 * the SQLite filename so the VFS can route reads and
 * writes to the right per-table state.
 *
 * The class does not own connection lifecycle for the
 * underlying storage — the caller stays responsible for
 * opening/closing the storage backing and for applying
 * any externally received writes (e.g. server-pushed
 * page diffs) before resuming execution. After the
 * caller mutates storage out from under the database,
 * call {@link discardBuffer} to make sure SQLite sees
 * the new state on the next access.
 */
export class Database {
    private readonly db: SqliteDatabase;
    private readonly vfs: InstalledVfs;
    private readonly storage: DatabaseStorage;
    private readonly tables = new Map<DatabaseTableId, DatabaseTableState>();
    private readonly tempFiles = new Map<string, VfsTempFile>();
    private writeLevel: SqliteWriteLevel | null = null;
    private currentReadSet: Map<DatabaseTableId, Set<number>> | null = null;
    private currentWriteSet: Map<DatabaseTableId, Set<number>> | null = null;

    private constructor(
        sqlite3: Sqlite3Static,
        storage: DatabaseStorage,
        tableIds: ReadonlyArray<DatabaseTableId>,
    ) {
        this.storage = storage;

        assert(tableIds.length > 0, "Database requires at least one tableId");
        assert(tableIds[0] === databaseMainTableId, "first tableId must be databaseMainTableId");
        for (const tableId of tableIds) {
            assert(
                !this.tables.has(tableId),
                `duplicate tableId in Database constructor: ${tableId}`,
            );
            this.tables.set(tableId, new DatabaseTableState());
        }

        const capi = sqlite3.capi;
        const vfsName = `${vfsNamePrefix}-${vfsCounter++}`;

        this.vfs = installVfs(sqlite3, vfsName, {
            open: (filename, flags) => {
                if (flags & capi.SQLITE_OPEN_MAIN_DB) {
                    assert(
                        filename !== null && filename.startsWith("/"),
                        `MAIN_DB open with unexpected filename: ${filename}`,
                    );
                    const tableId = filename.slice(1) as DatabaseTableId;
                    const state = this.tables.get(tableId);
                    assert(state !== undefined, `MAIN_DB open for unknown table: ${tableId}`);
                    return this.makeVfsFile(tableId, state);
                }
                const file = new VfsTempFile();
                if (filename !== null) {
                    this.tempFiles.set(filename, file);
                }
                return file;
            },
            delete: filename => {
                this.tempFiles.delete(filename);
            },
            access: filename => this.tempFiles.has(filename),
        });

        this.db = new sqlite3.oo1.DB(`/${databaseMainTableId}`, "c", vfsName);
        installTracing(this.db);

        capi.sqlite3_set_authorizer(
            this.db.pointer!,
            (_cbArg: WasmPointer, actionCode: number) => {
                const action = sqliteAuthorizerActionName(actionCode);
                if (action === undefined) return capi.SQLITE_DENY;
                return isSqliteActionAllowed(action, this.writeLevel)
                    ? capi.SQLITE_OK
                    : capi.SQLITE_DENY;
            },
            0,
        );

        registerSqliteCustomFunctions(sqlite3, this.db);

        for (const pragma of sqliteOpenPragmas) {
            this.db.exec(pragma);
        }
        // Rollback journal lives in memory: with a
        // read-only storage backing there is no on-disk
        // journal to write anyway, and external
        // transactionality (server-side DO transaction,
        // client-side rebase replay) is what actually
        // makes commits atomic.
        this.db.exec("PRAGMA journal_mode = MEMORY");

        // Attach every additional table as its own
        // database. Each ATTACH path matches the VFS
        // open routing above.
        for (let i = 1; i < tableIds.length; i++) {
            const tableId = tableIds[i]!;
            // eslint-disable-next-line cyberworlds/string-quotes -- SQL literal
            this.db.exec(`ATTACH DATABASE '/${tableId}' AS "${tableId}"`);
        }

        // Capture cache-hit reads via the page access hook
        // so {@link execute} returns a complete read set
        // even when SQLite serves pages from its pager
        // cache without going through `xRead`.
        this.db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags !== pageAccessFlagRead) return;
            const readSet = this.currentReadSet;
            if (readSet === null) return;
            // The hook fires only on the main database's
            // pager; attached databases are tracked via
            // their own VFS file's read path.
            this.addToTablePageSet(readSet, databaseMainTableId, pgno - 1);
        });
    }

    /**
     * Open a {@link Database}. Initializes SQLite if
     * needed and attaches every given table as its own
     * SQLite database. The first id in `tableIds` must
     * be {@link databaseMainTableId}.
     */
    static async create(opts: {
        storage: DatabaseStorage;
        tableIds?: ReadonlyArray<DatabaseTableId>;
    }): Promise<Database> {
        if (sqlite3Promise === undefined) {
            const instantiateWasm = trySqlite3WasmLoader();
            sqlite3Promise = sqlite3InitModule(instantiateWasm ? {instantiateWasm} : undefined);
        }
        const sqlite3 = await sqlite3Promise;
        return new Database(sqlite3, opts.storage, opts.tableIds ?? [databaseMainTableId]);
    }

    /**
     * Run an arbitrary SQL string against the database.
     * `allowWrites` controls which classes of statement
     * the authorizer permits.
     */
    execute(query: string, options: {allowWrites: SqliteWriteLevel}): DatabaseExecuteResult {
        const {result, readPages, writtenPages} = this.runTracked(options.allowWrites, db =>
            sql.raw(query).selectAllUnknown(db),
        );
        return {rows: result, readPages, writtenPages};
    }

    /**
     * Run a named {@link DatabaseActionObject}. Uses the
     * action's declared `writeLevel` for authorization.
     */
    executeAction<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ): DatabaseExecuteActionResult<N> {
        const action = databaseActions[actionObject.name];
        const {result, readPages, writtenPages} = this.runTracked(action.writeLevel, db =>
            action.run(db, actionObject.input as never),
        );
        return {output: result as DatabaseActionOutput<N>, readPages, writtenPages};
    }

    /**
     * Snapshot of every write buffered since the last
     * {@link markCommitted} or {@link discardBuffer}. The
     * returned maps reference live state; do not mutate
     * them.
     */
    bufferedWrites(): DatabaseBufferedWrites {
        const pages = new Map<DatabaseTableId, ReadonlyMap<number, Uint8Array>>();
        const truncates = new Map<DatabaseTableId, number>();
        for (const [tableId, state] of this.tables) {
            if (state.bufferedPages.size > 0) {
                pages.set(tableId, state.bufferedPages);
            }
            if (state.bufferedTruncate !== null) {
                truncates.set(tableId, state.bufferedTruncate);
            }
        }
        return {pages, truncates};
    }

    /** Whether anything is currently buffered. */
    hasBufferedWrites(): boolean {
        for (const state of this.tables.values()) {
            if (state.bufferedPages.size > 0 || state.bufferedTruncate !== null) {
                return true;
            }
        }
        return false;
    }

    /**
     * Acknowledge that the current buffer has been
     * persisted to storage. Clears the buffer; subsequent
     * reads will see the durable post-commit state via
     * the read-only storage. No SQLite cache invalidation
     * is needed because the pager cache already holds the
     * same after-image the caller just persisted.
     */
    markCommitted(): void {
        for (const state of this.tables.values()) {
            state.bufferedPages.clear();
            state.bufferedTruncate = null;
            state.bufferedMaxPageIndex = -1;
        }
    }

    /**
     * Throw away the in-memory buffer and invalidate
     * SQLite's page cache so future reads fall back to
     * storage. Call this after the caller has changed
     * `storage` out from under the database (e.g.
     * applied externally received page diffs) or after
     * a failed action whose buffered writes should not
     * be persisted.
     *
     * SQLite's pager may be holding the buffered
     * after-images in its own cache; without this call
     * those would still be served by the next read.
     * `PRAGMA shrink_memory` releases the pager cache —
     * subsequent reads re-issue `xRead` and pick up the
     * underlying storage.
     */
    discardBuffer(): void {
        for (const state of this.tables.values()) {
            state.bufferedPages.clear();
            state.bufferedTruncate = null;
            state.bufferedMaxPageIndex = -1;
        }
        this.db.exec("PRAGMA shrink_memory");
    }

    close(): void {
        this.db.close();
    }

    /** Test-only: raw SQLite handle. */
    unsafeGetDbForTests(): SqliteDatabase {
        assert(import.meta.jest);
        return this.db;
    }

    // -- Internal -----------------------------------------------------------

    private runTracked<T>(
        writeLevel: SqliteWriteLevel,
        fn: (db: SqliteDatabase) => T,
    ): {
        result: T;
        readPages: Map<DatabaseTableId, Set<number>>;
        writtenPages: Map<DatabaseTableId, Set<number>>;
    } {
        assert(this.writeLevel === null, "nested execute calls are not supported");
        const readPages = new Map<DatabaseTableId, Set<number>>();
        const writtenPages = new Map<DatabaseTableId, Set<number>>();
        this.writeLevel = writeLevel;
        this.currentReadSet = readPages;
        this.currentWriteSet = writtenPages;
        try {
            const result = fn(this.db);
            return {result, readPages, writtenPages};
        } catch (error) {
            const stashed = this.vfs.takeError();
            if (stashed !== null) {
                if (stashed instanceof Error) {
                    stashed.cause = error;
                }
                throw stashed;
            }
            throw error;
        } finally {
            this.writeLevel = null;
            this.currentReadSet = null;
            this.currentWriteSet = null;
            this.vfs.takeError();
            this.tempFiles.clear();
        }
    }

    private makeVfsFile(tableId: DatabaseTableId, state: DatabaseTableState): VfsFile {
        return {
            read: (data, offset) => {
                const fileSize = this.getFileSizeForTable(tableId, state);
                if (offset >= fileSize) {
                    data.fill(0);
                    return false;
                }
                const pageIndex = Math.floor(offset / sqlitePageSize);
                assert(
                    Math.floor((offset + data.byteLength - 1) / sqlitePageSize) === pageIndex,
                    `read spans pages: offset=${offset} amount=${data.byteLength}`,
                );
                const pageOffset = offset % sqlitePageSize;

                const buffered = state.bufferedPages.get(pageIndex);
                if (buffered !== undefined) {
                    data.set(buffered.subarray(pageOffset, pageOffset + data.byteLength));
                    if (this.currentReadSet !== null) {
                        this.addToTablePageSet(this.currentReadSet, tableId, pageIndex);
                    }
                    return true;
                }

                // Page is in the gap created by a buffered
                // truncate that a later write past the truncate
                // re-extended over. Treat as missing so storage
                // doesn't return pre-truncate data.
                if (state.bufferedTruncate !== null && offset >= state.bufferedTruncate) {
                    data.fill(0);
                    return false;
                }

                const page = this.storage.readPage(tableId, pageIndex);
                if (page === null) {
                    data.fill(0);
                    return false;
                }
                data.set(page.data.subarray(pageOffset, pageOffset + data.byteLength));
                if (this.currentReadSet !== null) {
                    this.addToTablePageSet(this.currentReadSet, tableId, pageIndex);
                }
                return true;
            },

            write: (data, offset) => {
                assert(offset % sqlitePageSize === 0, `write offset ${offset} not page-aligned`);
                assert(
                    data.byteLength === sqlitePageSize,
                    `write amount ${data.byteLength} !== ${sqlitePageSize}`,
                );
                const pageIndex = offset / sqlitePageSize;
                state.bufferedPages.set(pageIndex, new Uint8Array(data));
                if (pageIndex > state.bufferedMaxPageIndex) {
                    state.bufferedMaxPageIndex = pageIndex;
                }
                // A write past a buffered truncate is fine —
                // the consumer drains truncate first, so the
                // post-truncate file is what this write
                // extends. The truncate stays buffered so its
                // shrinking effect (zeroing pages between the
                // truncate boundary and this write) is
                // preserved.
                if (this.currentWriteSet !== null) {
                    this.addToTablePageSet(this.currentWriteSet, tableId, pageIndex);
                }
            },

            truncate: size => {
                state.bufferedTruncate = size;
                let newMax = -1;
                for (const pageIndex of [...state.bufferedPages.keys()]) {
                    if ((pageIndex + 1) * sqlitePageSize > size) {
                        state.bufferedPages.delete(pageIndex);
                    } else if (pageIndex > newMax) {
                        newMax = pageIndex;
                    }
                }
                state.bufferedMaxPageIndex = newMax;
            },

            // No-op: the buffer is what `bufferedWrites`
            // returns. Persistence is the caller's job.
            sync: () => {},

            fileSize: () => this.getFileSizeForTable(tableId, state),

            close: () => {},
        };
    }

    private getFileSizeForTable(tableId: DatabaseTableId, state: DatabaseTableState): number {
        const baseSize =
            state.bufferedTruncate !== null
                ? state.bufferedTruncate
                : this.storage.getFileSize(tableId);
        const bufferedExtent =
            state.bufferedMaxPageIndex >= 0 ? (state.bufferedMaxPageIndex + 1) * sqlitePageSize : 0;
        return baseSize > bufferedExtent ? baseSize : bufferedExtent;
    }

    private addToTablePageSet(
        target: Map<DatabaseTableId, Set<number>>,
        tableId: DatabaseTableId,
        pageIndex: number,
    ): void {
        let set = target.get(tableId);
        if (set === undefined) {
            set = new Set();
            target.set(tableId, set);
        }
        set.add(pageIndex);
    }
}

class DatabaseTableState {
    /** Buffered writes, keyed by zero-based page index. */
    readonly bufferedPages = new Map<number, Uint8Array>();
    /**
     * Buffered truncate-to-size in bytes, or `null` if
     * no truncate is currently buffered.
     */
    bufferedTruncate: number | null = null;
    /**
     * Highest page index in {@link bufferedPages}, or `-1`
     * if empty. Tracked incrementally so {@link Database}
     * can compute file size in O(1) instead of scanning
     * the buffer on every read.
     */
    bufferedMaxPageIndex = -1;
}
