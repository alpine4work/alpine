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
import type {ReadonlyDatabasePageSet} from "~/shared/databases/database_protocol_schemas.js";
import type {InstalledVfs, VfsFile} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {sql} from "~/shared/databases/sql.js";
import {trySqlite3WasmLoader} from "~/shared/databases/sqlite3_wasm_loader.js";
import {
    type InternalSqliteWriteLevel,
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
 * Read-only page storage backing a {@link Database}.
 *
 * The {@link Database} layers an in-memory write buffer
 * over this interface; writes never touch storage
 * directly. Callers drain the buffer via
 * {@link Database.getBufferedWrites} and persist it
 * however they choose — committing it server-side,
 * fanning it out to OPFS, etc. — then call
 * {@link Database.markCommitted} to acknowledge or
 * {@link Database.discardBuffer} to throw it away.
 *
 * Pages are partitioned by {@link DatabaseTableId} so a
 * single backend can host many independent SQLite
 * databases. The {@link Database} currently only opens
 * {@link databaseMainTableId}, but the partitioned shape
 * is preserved here for the per-table backends server
 * and client both run.
 *
 * All methods are synchronous because the SQLite VFS
 * calls them directly from `xRead`/`xFileSize`.
 */
export interface ReadonlyDatabaseStorage {
    /**
     * Read a single page by its zero-based index from
     * the given table.
     *
     * - `null` — no page at that index (read returns
     *   zero-filled bytes; SQLite uses {@link getFileSize}
     *   to determine EOF).
     * - `{data, version}` — the durable page and the
     *   version it was last written at.
     *
     * Implementers may also throw to signal a transient
     * failure (e.g. a missing local cache entry that
     * needs server fallback). The error propagates out
     * of the SQL execution.
     */
    readPage(tableId: DatabaseTableId, index: number): {data: Uint8Array; version: number} | null;

    /** Current size in bytes of `tableId`'s file. */
    getFileSize(tableId: DatabaseTableId): number;
}

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
    /**
     * Post-buffer logical file size in pages, keyed by
     * table. Populated for every table present in
     * {@link pages} or {@link truncates} so callers can
     * supply it as the canonical `fileSizeInPages` when
     * persisting the buffer to durable storage — without
     * a follow-up call back into {@link Database}.
     */
    readonly fileSizesInPages: ReadonlyMap<DatabaseTableId, number>;
}

/** Result of a single {@link Database.execute} call. */
export interface DatabaseExecuteResult {
    readonly rows: Array<Record<string, unknown>>;
    /**
     * Pages SQLite read while running this call. Includes
     * cache hits, captured via the page-access hook.
     */
    readonly readPages: ReadonlyDatabasePageSet;
    /** Pages buffered by writes that ran during this call. */
    readonly writtenPages: ReadonlyDatabasePageSet;
}

/** Result of a single {@link Database.executeAction} call. */
export interface DatabaseExecuteActionResult<N extends DatabaseActionName> {
    readonly output: DatabaseActionOutput<N>;
    readonly readPages: ReadonlyDatabasePageSet;
    readonly writtenPages: ReadonlyDatabasePageSet;
}

/**
 * SQLite database that buffers writes in memory.
 *
 * Built around a {@link ReadonlyDatabaseStorage}: every
 * write goes into an in-memory buffer rather than the
 * underlying storage, and the caller decides what to do
 * with it. Drain the buffer via
 * {@link getBufferedWrites} and persist it however you
 * like; once the writes are durable, call
 * {@link markCommitted} to clear the buffer. To throw
 * the buffer away instead, call {@link discardBuffer} —
 * that clears the buffer and invalidates SQLite's page
 * cache so future reads fall back to storage.
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
    private readonly storage: ReadonlyDatabaseStorage;
    private readonly tables = new Map<DatabaseTableId, DatabaseTableState>();
    private readonly tempFiles = new Map<string, VfsTempFile>();
    /**
     * Maps SQLite schema names (the AS-name supplied to
     * each VFS open / ATTACH) back to the table they back.
     * Used by the page-access hook to demux events from
     * any of the currently-attached databases. The main
     * connection is opened with the schema name `"main"`,
     * which SQLite reserves for `aDb[0]`; callers must use
     * the table id as the schema name for ATTACH-ed
     * databases (and re-install the hook afterwards).
     */
    private readonly schemaToTable = new Map<string, DatabaseTableId>();
    private writeLevel: InternalSqliteWriteLevel | null = null;
    private currentReadSet: Map<DatabaseTableId, Set<number>> | null = null;
    private currentWriteSet: Map<DatabaseTableId, Set<number>> | null = null;

    private constructor(sqlite3: Sqlite3Static, storage: ReadonlyDatabaseStorage) {
        this.storage = storage;
        this.tables.set(databaseMainTableId, new DatabaseTableState());
        // SQLite reserves the schema name "main" for
        // `aDb[0]`, so the connection's main table is
        // always reachable under that name.
        this.schemaToTable.set("main", databaseMainTableId);

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

        this.installPageAccessHook();
    }

    /** Open a {@link Database} backed by `storage`. */
    static async create(storage: ReadonlyDatabaseStorage): Promise<Database> {
        if (sqlite3Promise === undefined) {
            const instantiateWasm = trySqlite3WasmLoader();
            sqlite3Promise = sqlite3InitModule(instantiateWasm ? {instantiateWasm} : undefined);
        }
        const sqlite3 = await sqlite3Promise;
        return new Database(sqlite3, storage);
    }

    /**
     * Run an arbitrary callback against the underlying
     * SQLite handle with read/write tracking and authorizer
     * enforcement. The callback is the lowest-level entry
     * point; {@link executeSql} and {@link executeAction}
     * are thin wrappers.
     *
     * `allowWrites` controls which classes of statement
     * the authorizer permits while `fn` runs.
     */
    execute<T>(
        fn: (db: SqliteDatabase) => T,
        options: {allowWrites: SqliteWriteLevel},
    ): {result: T; readPages: ReadonlyDatabasePageSet; writtenPages: ReadonlyDatabasePageSet} {
        return this.runTracked(options.allowWrites, fn);
    }

    /**
     * Run an arbitrary SQL string against the database.
     * `allowWrites` controls which classes of statement
     * the authorizer permits.
     */
    executeSql(query: string, options: {allowWrites: SqliteWriteLevel}): DatabaseExecuteResult {
        const {result, readPages, writtenPages} = this.execute(
            db => sql.raw(query).selectAllUnknown(db),
            options,
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
        const {result, readPages, writtenPages} = this.execute(
            db => action.run(db, actionObject.input as never),
            {allowWrites: action.writeLevel},
        );
        return {output: result as DatabaseActionOutput<N>, readPages, writtenPages};
    }

    /**
     * Snapshot of every write buffered since the last
     * {@link markCommitted} or {@link discardBuffer}, or
     * `null` if nothing is currently buffered. The
     * returned maps reference live state; do not mutate
     * them.
     */
    getBufferedWrites(): DatabaseBufferedWrites | null {
        const pages = new Map<DatabaseTableId, ReadonlyMap<number, Uint8Array>>();
        const truncates = new Map<DatabaseTableId, number>();
        const fileSizesInPages = new Map<DatabaseTableId, number>();
        for (const [tableId, state] of this.tables) {
            const hasPages = state.bufferedPages.size > 0;
            const hasTruncate = state.bufferedTruncate !== null;
            if (hasPages) {
                pages.set(tableId, state.bufferedPages);
            }
            if (hasTruncate) {
                truncates.set(tableId, state.bufferedTruncate!);
            }
            if (hasPages || hasTruncate) {
                const sizeInBytes = this.getFileSizeForTable(tableId, state);
                fileSizesInPages.set(tableId, Math.ceil(sizeInBytes / sqlitePageSize));
            }
        }
        if (pages.size === 0 && truncates.size === 0) return null;
        return {pages, truncates, fileSizesInPages};
    }

    /**
     * Throw if any writes are currently buffered. Callers
     * that mutate the underlying storage out from under
     * the database (e.g. applying server-pushed pages)
     * must clear the buffer first via
     * {@link markCommitted} or {@link discardBuffer};
     * otherwise the next read will serve a stale mix of
     * SQLite's pager cache, the buffer, and the just-
     * mutated storage.
     */
    assertBufferIsEmpty(reason: string): void {
        for (const state of this.tables.values()) {
            assert(
                state.bufferedPages.size === 0 &&
                    state.bufferedTruncate === null &&
                    state.bufferedMaxPageIndex === null,
                `${reason} requires an empty buffer`,
            );
        }
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
            state.reset();
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
    discardBuffer(options?: {skipClearCacheForTests?: boolean}): void {
        for (const state of this.tables.values()) {
            state.reset();
        }
        // `skipClearCacheForTests` exists so the cache-
        // invalidation regression test can prove this
        // pragma is load-bearing — never set it in
        // production code.
        if (options?.skipClearCacheForTests === true) {
            assert(import.meta.jest, "skipClearCacheForTests is test-only");
            return;
        }
        this.db.exec("PRAGMA shrink_memory");
    }

    /**
     * Attach an additional per-table SQLite database to
     * this connection so its pages flow through the same
     * VFS / page-access hook plumbing as the main table.
     *
     * The patched authorizer denies `ATTACH` at every
     * normal write level; this method briefly flips
     * `writeLevel` to the internal `"attach"` value so
     * the SQL it issues itself is permitted, then restores
     * it. Schema name and VFS filename are both `tableId`,
     * so `schemaToTable` maps `tableId → tableId`.
     *
     * The caller is responsible for ensuring the backing
     * `storage` already has a page store for `tableId`
     * before this is invoked. Must be called when no
     * `execute()` is in flight.
     */
    attach(tableId: DatabaseTableId): void {
        assert(!this.tables.has(tableId), `attach: table already attached: ${tableId}`);
        assert(this.writeLevel === null, "attach is not supported during an in-flight execute");

        // The VFS open callback runs synchronously during
        // ATTACH and looks up state by tableId, so the
        // entry must exist before the SQL runs.
        this.tables.set(tableId, new DatabaseTableState());

        this.writeLevel = "attach";
        try {
            // Our table ids are 26-char alphanumerics, so
            // safe to inline as both an identifier and a
            // path without escaping.
            this.db.exec(`ATTACH DATABASE '/${tableId}' AS "${tableId}"`);
            this.schemaToTable.set(tableId, tableId);
        } catch (error) {
            this.tables.delete(tableId);
            throw error;
        } finally {
            this.writeLevel = null;
        }

        // The new pager exists now; re-install the hook so
        // the C side loops over the updated `aDb[]` and
        // covers it too.
        this.installPageAccessHook();
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

    /**
     * Captures cache-hit reads via the page access hook
     * so {@link execute} returns a complete read set even
     * when SQLite serves pages from its pager cache
     * without going through `xRead`. The hook fires for
     * every attached database; demux on schema name.
     * Reads from schemas we don't own (e.g. SQLite's
     * `temp`) are ignored.
     *
     * Stored as an arrow-function field so re-installs
     * pass the same JS reference and the FuncPtrAdapter
     * doesn't churn wasm thunks.
     */
    private readonly handlePageAccess = (
        schemaName: string,
        pgno: number,
        flags: number,
    ): void => {
        if (flags !== pageAccessFlagRead) return;
        const readSet = this.currentReadSet;
        if (readSet === null) return;
        const tableId = this.schemaToTable.get(schemaName);
        if (tableId === undefined) return;
        addToTablePageSet(readSet, tableId, pgno - 1);
    };

    /**
     * (Re-)install the page-access hook on every
     * currently-attached database's pager. Call after any
     * operation that grows `db->aDb[]` (i.e. ATTACH).
     */
    private installPageAccessHook(): void {
        this.db.pageAccessHook(this.handlePageAccess);
    }

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
                        addToTablePageSet(this.currentReadSet, tableId, pageIndex);
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
                    addToTablePageSet(this.currentReadSet, tableId, pageIndex);
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
                if (state.bufferedMaxPageIndex === null || pageIndex > state.bufferedMaxPageIndex) {
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
                    addToTablePageSet(this.currentWriteSet, tableId, pageIndex);
                }
            },

            truncate: size => {
                state.bufferedTruncate = size;
                let newMax: number | null = null;
                for (const pageIndex of state.bufferedPages.keys()) {
                    if ((pageIndex + 1) * sqlitePageSize > size) {
                        state.bufferedPages.delete(pageIndex);
                    } else if (newMax === null || pageIndex > newMax) {
                        newMax = pageIndex;
                    }
                }
                state.bufferedMaxPageIndex = newMax;
            },

            // No-op: the buffer is what `getBufferedWrites`
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
            state.bufferedMaxPageIndex !== null
                ? (state.bufferedMaxPageIndex + 1) * sqlitePageSize
                : 0;
        return baseSize > bufferedExtent ? baseSize : bufferedExtent;
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
     * Highest page index in {@link bufferedPages}, or
     * `null` if empty. Tracked incrementally so
     * {@link Database} can compute file size in O(1)
     * instead of scanning the buffer on every read.
     */
    bufferedMaxPageIndex: number | null = null;

    reset(): void {
        this.bufferedPages.clear();
        this.bufferedTruncate = null;
        this.bufferedMaxPageIndex = null;
    }
}

function addToTablePageSet(
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
