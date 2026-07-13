import type {Sqlite3Static, WasmPointer} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {AccessLevel} from "~/shared/access/access_policy.js";
import type {DatabaseActionServerContext} from "~/shared/databases/database_action_context.js";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    type DatabaseActionOutput,
    createDatabaseActionContext,
    databaseActions,
    executeDatabaseAction,
} from "~/shared/databases/database_actions.js";
import type {ReadonlyDatabasePageSet} from "~/shared/databases/database_protocol_schemas.js";
import {hashWithPrivateSalt} from "~/shared/databases/hash_with_private_salt.js";
import type {InstalledVfs, VfsFile} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {
    type SqlQuery,
    databaseTableSchemaName,
    databaseTableSchemaNamePrefix,
    sql,
} from "~/shared/databases/sql.js";
import {SqliteDatabase, trySqlite3WasmLoader} from "~/shared/databases/sqlite.js";
import {
    type InternalSqliteWriteLevel,
    type SqliteWriteLevel,
    isSqliteActionAllowed,
    isSqliteActionAllowedForSchemaAccess,
    sqliteAuthorizerActionName,
} from "~/shared/databases/sqlite_authorizer.js";
import {
    databaseMainTableId,
    pageAccessFlagRead,
    sqliteAttachEvictionThreshold,
    sqliteAttachPagePragma,
    sqliteOpenPragmas,
    sqlitePageSize,
} from "~/shared/databases/sqlite_constants.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {
    joinTableSqliteMigrations,
    tableSqliteMigrations,
} from "~/shared/databases/sqlite_migrations.js";
import {installTracing} from "~/shared/databases/sqlite_tracing.js";
import {TableNotAttachedError} from "~/shared/databases/table_not_attached_error.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResult, unwrapResult} from "~/shared/helpers/control/capture_result.js";
import type {Result} from "~/shared/helpers/control/result.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import type {AccountId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const vfsNamePrefix = "alpine-database";
let vfsCounter = 0;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;

/**
 * Read-only page storage backing a {@link Database}.
 *
 * The {@link Database} layers an in-memory write buffer over this interface;
 * writes never touch storage directly. Callers drain the buffer via {@link
 * Database.getBufferedWrites} and persist it however they choose — committing it
 * server-side, fanning it out to OPFS, etc. — then call {@link
 * Database.markCommitted} to acknowledge or {@link Database.discardBuffer} to
 * throw it away.
 *
 * Pages are partitioned by {@link DatabaseTableId} so a single backend can host
 * many independent SQLite databases. The {@link Database} currently only opens
 * {@link databaseMainTableId}, but the partitioned shape is preserved here for the
 * per-table backends server and client both run.
 *
 * All methods are synchronous because the SQLite VFS calls them directly from
 * `xRead`/`xFileSize`.
 */
export interface ReadonlyDatabaseStorage {
    /**
     * Read a single page by its zero-based index from the given table.
     *
     * - `null` — no page at that index (read returns zero-filled bytes; SQLite uses
     *   {@link getFileSize} to determine EOF).
     * - `{data, version}` — the durable page and the version it was last written at.
     *
     * Implementers may also throw to signal a transient failure (e.g. a missing local
     * cache entry that needs server fallback). The error propagates out of the SQL
     * execution.
     */
    readPage(tableId: DatabaseTableId, index: number): {data: Uint8Array; version: number} | null;

    /** Current size in bytes of `tableId`'s file. */
    getFileSize(tableId: DatabaseTableId): number;
}

/**
 * The pending in-memory writes buffered by a {@link Database} since its creation
 * or its last {@link Database.markCommitted}/{@link Database.discardBuffer}.
 */
export interface DatabaseBufferedWrites {
    /**
     * Per-table page writes, keyed by zero-based page index. Each value is the page's
     * full {@link sqlitePageSize}-byte after-image.
     */
    readonly pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>;
    /**
     * Per-table file truncates, keyed by table. Each value is the new file size in
     * bytes.
     */
    readonly truncates: ReadonlyMap<DatabaseTableId, number>;
    /**
     * Post-buffer logical file size in pages, keyed by table. Populated for every
     * table present in {@link pages} or {@link truncates} so callers can supply it as
     * the canonical `fileSizeInPages` when persisting the buffer to durable storage —
     * without a follow-up call back into {@link Database}.
     */
    readonly fileSizesInPages: ReadonlyMap<DatabaseTableId, number>;
}

/** Result of a single {@link Database.execute} call. */
export interface DatabaseExecuteResult {
    readonly rows: Array<Record<string, unknown>>;
    /**
     * Pages SQLite read while running this call. Includes cache hits, captured via the
     * page-access hook.
     */
    readonly readPages: ReadonlyDatabasePageSet;
    /** Pages buffered by writes that ran during this call. */
    readonly writtenPages: ReadonlyDatabasePageSet;
}

/** Result of a single {@link Database.executeAction} call. */
export interface DatabaseExecuteActionResult<N extends DatabaseActionName> {
    readonly result: DatabaseActionOutput<N>;
    readonly readPages: ReadonlyDatabasePageSet;
    readonly writtenPages: ReadonlyDatabasePageSet;
}

export interface DatabaseTrackedExecution<Value> {
    /**
     * Seed this cached execution with a result produced by an equivalent tracked
     * database execution.
     *
     * This exists for adapters that must do asynchronous cache filling outside the
     * synchronous `fn`, such as `DatabaseClient` fetching missing pages from the
     * server. Most callers should let `getSnapshot()` run `fn` instead.
     */
    setTrackedSnapshot(result: Result<Value>, readPages: ReadonlyDatabasePageSet | null): void;
    getSnapshot(): Value;
    getCachedSnapshot(): Result<Value> | null;
    invalidateForPages(writtenPages: ReadonlyDatabasePageSet): boolean;
    destroy(): void;
}

/**
 * Resolves a table's access level for the current execution's account. Installed
 * per execution (see {@link Database.execute}); executions without a resolver are
 * unrestricted (internal server code and service actors).
 */
export type DatabaseTableAccessResolver = (tableId: DatabaseTableId) => AccessLevel | null;

/**
 * SQLite database that buffers writes in memory.
 *
 * Built around a {@link ReadonlyDatabaseStorage}: every write goes into an
 * in-memory buffer rather than the underlying storage, and the caller decides what
 * to do with it. Drain the buffer via {@link getBufferedWrites} and persist it
 * however you like; once the writes are durable, call {@link markCommitted} to
 * clear the buffer. To throw the buffer away instead, call {@link discardBuffer} —
 * that clears the buffer and invalidates SQLite's page cache so future reads fall
 * back to storage.
 *
 * The class does not own connection lifecycle for the underlying storage — the
 * caller stays responsible for opening/closing the storage backing and for
 * applying any externally received writes (e.g. server-pushed page diffs) before
 * resuming execution. After the caller mutates storage out from under the
 * database, call {@link discardBuffer} to make sure SQLite sees the new state on
 * the next access.
 */
export class Database {
    private readonly db: SqliteDatabase;
    private readonly vfs: InstalledVfs;
    private readonly storage: ReadonlyDatabaseStorage;
    private readonly tables = new Map<DatabaseTableId, DatabaseTableState>();
    private readonly tempFiles = new Map<string, VfsTempFile>();
    /**
     * Maps SQLite schema names (the AS-name supplied to each VFS open / ATTACH) back
     * to the table they back. Used by the page-access hook to demux events from any of
     * the currently-attached databases. The main connection is opened with the schema
     * name `"main"`, which SQLite reserves for `aDb[0]`; callers must use the table id
     * as the schema name for ATTACH-ed databases (and re-install the hook afterwards).
     */
    private readonly schemaToTable = new Map<string, DatabaseTableId>();
    private writeLevel: InternalSqliteWriteLevel | null = null;
    /**
     * Per-execution table access, installed via {@link execute}'s
     * `tableAccessResolver` option; `null` runs unrestricted. Enforced by the
     * authorizer for every statement except internal SQL (attach recovery and the
     * `"attach"` write level).
     */
    private tableAccessResolver: DatabaseTableAccessResolver | null = null;
    /**
     * The last denial issued by the per-table authorizer layer, used to convert
     * SQLite's generic "not authorized" error into a typed {@link
     * PermissionDeniedError} naming the table. Cleared at the start of each tracked
     * run.
     */
    private tableAccessDenial: {action: string; schemaName: string} | null = null;
    private currentReadSet: Map<DatabaseTableId, Set<number>> | null = null;
    private currentWriteSet: Map<DatabaseTableId, Set<number>> | null = null;
    /**
     * Monotonic clock for LRU eviction: bumped on every page access and attach,
     * stamped into {@link DatabaseTableState.lastTouchedAt}.
     */
    private touchCounter = 0;
    /** Attached-schema count at which {@link attach} starts evicting LRU tables. */
    private readonly attachEvictionThreshold: number;
    /**
     * True while {@link tryAttachUnattachedTable} runs its own SQL, so the patched
     * `prepare` (see {@link installAttachOnMiss}) doesn't recurse into recovery.
     */
    private inAttachRecovery = false;
    private readonly trackedExecutions = new Set<DatabaseTrackedExecutionImpl<any>>();
    /**
     * Server-only hook invoked after every successful {@link attach}. The durable
     * object uses it to load the freshly attached file's access-policy metadata,
     * maintaining the invariant that every attached schema has a cached policy the
     * authorizer's table-access resolver can consult synchronously.
     */
    private serverTableAttachHook: ((tableId: DatabaseTableId) => void) | null = null;
    private currentActionAccountId: AccountId | null = null;
    /**
     * Server-only action capabilities, or `null` on the client. Lets server-only
     * schema actions (e.g. createTable) attach their own per-table file mid-execute;
     * absent on the client so client-side actions can't attach.
     */
    private readonly serverContext: DatabaseActionServerContext | null;

    private constructor(
        sqlite3: Sqlite3Static,
        storage: ReadonlyDatabaseStorage,
        {
            isServer,
            attachEvictionThreshold,
            privateSalt,
        }: {isServer: boolean; attachEvictionThreshold: number; privateSalt?: Uint8Array},
    ) {
        this.storage = storage;
        this.attachEvictionThreshold = attachEvictionThreshold;
        if (isServer) {
            assert(privateSalt !== undefined, "a server database requires a private salt");
            this.serverContext = {
                attach: tableId => this.attachIfNeeded(tableId),
                getCurrentAccountId: () => this.currentActionAccountId,
                hashWithPrivateSalt: value => hashWithPrivateSalt(privateSalt, value),
            };
        } else {
            this.serverContext = null;
        }
        this.tables.set(databaseMainTableId, new DatabaseTableState());
        // SQLite reserves the schema name "main" for `aDb[0]`, so the connection's main
        // table is always reachable under that name.
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
        this.installAttachOnMiss();

        capi.sqlite3_set_authorizer(
            this.db.pointer!,
            (
                _cbArg: WasmPointer,
                actionCode: number,
                actionArg: string | 0,
                actionArg2: string | 0,
                schemaArg: string | 0,
            ) => {
                const action = sqliteAuthorizerActionName(actionCode);
                if (action === undefined) return capi.SQLITE_DENY;
                // SQLite passes the C null pointer (`0`) when an action has no string argument;
                // normalize to `null` for the authorizer.
                const arg = typeof actionArg === "string" ? actionArg : null;
                if (!isSqliteActionAllowed(action, arg, this.writeLevel)) {
                    return capi.SQLITE_DENY;
                }
                // The per-table layer. Skipped for internal SQL: the `"attach"` write level (only
                // settable by `Database` itself) and attach-on-miss recovery (registry lookups,
                // `user_version` asserts, and change-capture trigger DDL that must succeed
                // regardless of the ambient account's access).
                if (
                    this.tableAccessResolver !== null &&
                    this.writeLevel !== "attach" &&
                    !this.inAttachRecovery
                ) {
                    const schemaName = typeof schemaArg === "string" ? schemaArg : null;
                    const allowed = isSqliteActionAllowedForSchemaAccess({
                        action,
                        arg1: arg,
                        arg2: typeof actionArg2 === "string" ? actionArg2 : null,
                        schemaName,
                        resolveSchemaAccess: this.resolveSchemaAccess,
                    });
                    if (!allowed) {
                        this.tableAccessDenial = {
                            action,
                            schemaName: (action === "alter-table" ? arg : schemaName) ?? "",
                        };
                        return capi.SQLITE_DENY;
                    }
                }
                return capi.SQLITE_OK;
            },
            0,
        );

        registerSqliteCustomFunctions(sqlite3, this.db);

        for (const pragma of sqliteOpenPragmas) {
            this.db.exec(pragma);
        }

        this.installPageAccessHook();
    }

    /**
     * Open a {@link Database} backed by `storage`. Pass `server` (with the group's
     * private salt) to grant server-only action capabilities — attaching per-table
     * files and salted name hashing; the client leaves it off so its actions can't
     * attach.
     */
    static async create(
        storage: ReadonlyDatabaseStorage,
        options?: {
            server?: {privateSalt: Uint8Array};
            attachEvictionThresholdForTests?: number;
        },
    ): Promise<Database> {
        if (options?.attachEvictionThresholdForTests !== undefined) {
            assert(import.meta.jest, "attachEvictionThresholdForTests is test-only");
        }
        if (sqlite3Promise === undefined) {
            const instantiateWasm = trySqlite3WasmLoader();
            sqlite3Promise = sqlite3InitModule(instantiateWasm ? {instantiateWasm} : undefined);
        }
        const sqlite3 = await sqlite3Promise;
        return new Database(sqlite3, storage, {
            isServer: options?.server !== undefined,
            attachEvictionThreshold:
                options?.attachEvictionThresholdForTests ?? sqliteAttachEvictionThreshold,
            privateSalt: options?.server?.privateSalt,
        });
    }

    /**
     * Run an arbitrary callback against the underlying SQLite handle with read/write
     * tracking and authorizer enforcement. The callback is the lowest-level entry
     * point; {@link executeSql} and {@link executeAction} are thin wrappers.
     *
     * `allowWrites` controls which classes of statement the authorizer permits while
     * `fn` runs. `tableAccessResolver` additionally restricts which attached table
     * files those statements may touch (see {@link DatabaseTableAccessResolver}); omit
     * it to inherit the ambient resolver, pass `null` to run unrestricted. On the
     * canonical (server) database, a schema change also triggers `PRAGMA optimize`
     * inside the same tracked call (see {@link maybeOptimizeAfterWrites}).
     */
    execute<T>(
        fn: (db: SqliteDatabase) => T,
        options: {
            allowWrites: SqliteWriteLevel;
            tableAccessResolver?: DatabaseTableAccessResolver | null;
        },
    ): {result: T; readPages: ReadonlyDatabasePageSet; writtenPages: ReadonlyDatabasePageSet} {
        const previousResolver = this.tableAccessResolver;
        if (options.tableAccessResolver !== undefined) {
            this.tableAccessResolver = options.tableAccessResolver;
        }
        try {
            return this.runTracked(options.allowWrites, db => {
                const result = fn(db);
                this.maybeOptimizeAfterWrites(options.allowWrites);
                return result;
            });
        } finally {
            this.tableAccessResolver = previousResolver;
        }
    }

    /**
     * Run a {@link SqlQuery} (built with the {@link sql} tagged template) against the
     * database. `allowWrites` controls which classes of statement the authorizer
     * permits; `tableAccessResolver` restricts which attached table files it may touch
     * (see {@link execute}).
     */
    executeSql(
        query: SqlQuery,
        options: {
            allowWrites: SqliteWriteLevel;
            tableAccessResolver?: DatabaseTableAccessResolver | null;
        },
    ): DatabaseExecuteResult {
        const {result, readPages, writtenPages} = this.execute(
            db => query.selectAllUnknown(db),
            options,
        );
        return {rows: result, readPages, writtenPages};
    }

    /**
     * Run a named {@link DatabaseActionObject}. Uses the action's declared
     * `writeLevel` for authorization.
     */
    executeAction<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
        options?: {
            currentAccountId?: AccountId | null;
            tableAccessResolver?: DatabaseTableAccessResolver | null;
        },
    ): DatabaseExecuteActionResult<N> {
        const previousActionAccountId = this.currentActionAccountId;
        this.currentActionAccountId = options?.currentAccountId ?? null;
        try {
            const action = databaseActions[actionObject.name];
            const ctx = createDatabaseActionContext(
                this.db,
                this.serverContext,
                this.getTableAccessForCurrentExecution,
            );
            const {result, readPages, writtenPages} = this.execute(
                () => executeDatabaseAction(actionObject, ctx),
                {
                    allowWrites: action.writeLevel,
                    tableAccessResolver: options?.tableAccessResolver,
                },
            );
            return {result: result as DatabaseActionOutput<N>, readPages, writtenPages};
        } finally {
            this.currentActionAccountId = previousActionAccountId;
        }
    }

    /**
     * The current execution's access level on `tableId`, resolved from the installed
     * {@link DatabaseTableAccessResolver} (`Manage` when none is installed). Handed to
     * action contexts so shared action code — e.g. relation fields deciding whether
     * they may join into a linked table — sees the same verdicts the authorizer
     * enforces.
     */
    readonly getTableAccessForCurrentExecution = (tableId: DatabaseTableId): AccessLevel | null => {
        const resolver = this.tableAccessResolver;
        return resolver === null ? "Manage" : resolver(tableId);
    };

    /**
     * Server-only: install a hook invoked after every successful {@link attach} with
     * the attached table's id. See {@link serverTableAttachHook}. The hook may run its
     * own SQL via {@link \_runServerMetadataRead} and may attach further tables (e.g.
     * a join file's two joined tables).
     */
    _installServerTableAttachHook(hook: (tableId: DatabaseTableId) => void): void {
        assert(this.serverContext !== null, "table attach hook is server-only");
        this.serverTableAttachHook = hook;
    }

    /**
     * Server-only: run internal metadata reads against the raw SQLite handle, outside
     * the current execution's authorization and page tracking. The per-table
     * authorizer layer is bypassed (the reads consult metadata the ambient account may
     * not have access to — that's the point) and page reads stay out of the tracked
     * read set so they never leak into a user execution's `readPages` broadcast.
     */
    _runServerMetadataRead<T>(fn: (db: SqliteDatabase) => T): T {
        assert(this.serverContext !== null, "server metadata reads are server-only");
        const previousInAttachRecovery = this.inAttachRecovery;
        const previousReadSet = this.currentReadSet;
        const previousWriteSet = this.currentWriteSet;
        // `inAttachRecovery` doubles as the authorizer's internal-SQL bypass and disables
        // attach-on-miss recursion in the patched `prepare`.
        this.inAttachRecovery = true;
        this.currentReadSet = null;
        this.currentWriteSet = null;
        try {
            return fn(this.db);
        } finally {
            this.inAttachRecovery = previousInAttachRecovery;
            this.currentReadSet = previousReadSet;
            this.currentWriteSet = previousWriteSet;
        }
    }

    /**
     * Create a cached execution backed by database page dependencies.
     *
     * The function runs under read-only database permissions when `getSnapshot()` is
     * first called or when a previous read set has been invalidated by overlapping
     * page writes. This object deliberately has no listener API: clients that need
     * notifications can wrap it in a Store, while server callers can use it directly
     * as an always-fresh cached computation.
     */
    createTrackedExecution<Value>(fn: () => Value): DatabaseTrackedExecution<Value> {
        const execution = new DatabaseTrackedExecutionImpl(
            fn,
            this.runTrackedExecution,
            this.recordTrackedReadPages,
            value => {
                this.trackedExecutions.delete(value);
            },
        );
        this.trackedExecutions.add(execution);
        return execution;
    }

    /**
     * Notify tracked executions that pages changed outside this `Database`'s VFS write
     * path, for example when a client applies realtime page diffs directly to its
     * storage cache.
     */
    invalidatePages(writtenPages: ReadonlyDatabasePageSet): void {
        this.invalidateTrackedExecutions(writtenPages);
    }

    /**
     * Refresh query-planner statistics after a schema change. Only the canonical
     * (server) database does this — a client running `PRAGMA optimize` would just
     * produce `sqlite_stat` writes that diverge from the server and create rebase
     * churn. Runs inside {@link execute} so any stat updates ride along in the same
     * buffer and broadcast.
     */
    private maybeOptimizeAfterWrites(writeLevel: SqliteWriteLevel): void {
        if (writeLevel === "schema+data" && this.serverContext !== null) {
            this.db.exec("PRAGMA optimize");
        }
    }

    /**
     * Snapshot of every write buffered since the last {@link markCommitted} or {@link
     * discardBuffer}, or `null` if nothing is currently buffered. The returned maps
     * reference live state; do not mutate them.
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
     * Throw if any writes are currently buffered. Callers that mutate the underlying
     * storage out from under the database (e.g. applying server-pushed pages) must
     * clear the buffer first via {@link markCommitted} or {@link discardBuffer};
     * otherwise the next read will serve a stale mix of SQLite's pager cache, the
     * buffer, and the just- mutated storage.
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
     * Acknowledge that the current buffer has been persisted to storage. Clears the
     * buffer; subsequent reads will see the durable post-commit state via the
     * read-only storage. No SQLite cache invalidation is needed because the pager
     * cache already holds the same after-image the caller just persisted.
     */
    markCommitted(options?: {skipReactiveInvalidationForTests?: boolean}): void {
        const buffered = this.getBufferedWrites();
        for (const state of this.tables.values()) {
            state.reset();
        }
        if (options?.skipReactiveInvalidationForTests === true) {
            assert(import.meta.jest, "skipReactiveInvalidationForTests is test-only");
            return;
        }
        if (buffered !== null) {
            this.invalidateTrackedExecutions(pageIndexesForBufferedPages(buffered.pages));
        }
    }

    /**
     * Throw away the in-memory buffer and invalidate SQLite's page cache so future
     * reads fall back to storage. Call this after the caller has changed `storage` out
     * from under the database (e.g. applied externally received page diffs) or after a
     * failed action whose buffered writes should not be persisted.
     *
     * SQLite's pager may be holding the buffered after-images in its own cache;
     * without this call those would still be served by the next read.
     * `PRAGMA shrink_memory` releases the pager cache — subsequent reads re-issue
     * `xRead` and pick up the underlying storage.
     */
    discardBuffer(options?: {skipClearCacheForTests?: boolean}): void {
        for (const state of this.tables.values()) {
            state.reset();
        }
        // `skipClearCacheForTests` exists so the cache- invalidation regression test can
        // prove this pragma is load-bearing — never set it in production code.
        if (options?.skipClearCacheForTests === true) {
            assert(import.meta.jest, "skipClearCacheForTests is test-only");
            return;
        }
        this.db.exec("PRAGMA shrink_memory");
    }

    /** Whether `tableId`'s per-db file is currently attached. */
    isAttached(tableId: DatabaseTableId): boolean {
        return this.tables.has(tableId);
    }

    /** {@link attach} the table unless it is already attached. */
    attachIfNeeded(tableId: DatabaseTableId): void {
        if (!this.tables.has(tableId)) {
            this.attach(tableId);
        }
    }

    /**
     * Attach an additional per-table SQLite database to this connection so its pages
     * flow through the same VFS / page-access hook plumbing as the main table.
     *
     * The patched authorizer denies `ATTACH` at every normal write level; this method
     * briefly flips `writeLevel` to the internal `"attach"` value so the SQL it issues
     * itself is permitted, then restores whatever level was in effect. Schema name and
     * VFS filename are both `tableId`, so `schemaToTable` maps `tableId → tableId`.
     *
     * Safe to call mid-`execute()` (e.g. from a server-only action that creates a new
     * table): `execute()` opens no explicit transaction, so `ATTACH` between
     * statements is legal, and the surrounding write level is saved and restored. The
     * caller is responsible for ensuring the backing `storage` already has a page
     * store for `tableId` before this is invoked.
     *
     * At {@link sqliteAttachEvictionThreshold} attached schemas, the
     * least-recently-used per-table files are detached first to stay under SQLite's
     * compile-time `SQLITE_MAX_ATTACHED` limit. A statement that later references an
     * evicted file re-attaches it via {@link installAttachOnMiss}.
     */
    attach(tableId: DatabaseTableId): void {
        assert(!this.tables.has(tableId), `attach: table already attached: ${tableId}`);

        // Make room before inserting the new entry — evicting after could pick the
        // not-yet-opened table itself as a victim.
        this.evictForAttachCapacity();

        // The VFS open callback runs synchronously during ATTACH and looks up state by
        // tableId, so the entry must exist before the SQL runs. Stamp the new table
        // warmest: a statement referencing several unattached schemas re-attaches them one
        // at a time, and a cold stamp would let each recovery evict the previous one.
        const state = new DatabaseTableState();
        state.lastTouchedAt = ++this.touchCounter;
        this.tables.set(tableId, state);

        // The VFS filename is the raw table id; the SQLite schema name is `_`-prefixed to
        // mark it internal (see {@link databaseTableSchemaName}).
        const schemaName = databaseTableSchemaName(tableId);
        const previousWriteLevel = this.writeLevel;
        this.writeLevel = "attach";
        try {
            // The filename is the raw table id, bound as a parameter; the schema name is
            // quoted via `sql.identifier`. Pin page_size on the fresh schema immediately so
            // its first write matches the VFS's per-page contract.
            sql`ATTACH DATABASE ${`/${tableId}`} AS ${sql.identifier(schemaName)}`.exec(this.db);
            this.db.exec(sqliteAttachPagePragma(schemaName));
            this.schemaToTable.set(schemaName, tableId);
        } catch (error) {
            this.tables.delete(tableId);
            throw error;
        } finally {
            this.writeLevel = previousWriteLevel;
        }

        // The new pager exists now; re-install the hook so the C side loops over the
        // updated `aDb[]` and covers it too.
        this.installPageAccessHook();

        // Let the server load the new file's access-policy metadata while the attach is
        // fresh — before any statement can touch the schema under a restricted resolver.
        this.serverTableAttachHook?.(tableId);
    }

    /**
     * `DETACH` `tableId`'s per-table file if it is attached, dropping any buffered
     * writes to it. Returns `false` without detaching when SQLite reports the schema
     * locked (the open transaction touched it) — the caller should retry later. Used
     * by the client to purge a table the account lost access to.
     */
    detachTableIfAttached(tableId: DatabaseTableId): boolean {
        if (!this.tables.has(tableId)) return true;
        return this.tryDetachTable(tableId);
    }

    /**
     * Whether attaching another per-table file would trigger LRU eviction. Callers
     * that eagerly attach tables as an optimization (e.g. the client's
     * `attachKnownTables`) should stop here — past this point eager attaches just
     * churn the working set, since any table they evict re-attaches on first use
     * anyway.
     */
    isAtAttachCapacity(): boolean {
        return this.tables.size >= this.attachEvictionThreshold;
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
     * Read-and-clear the last per-table authorizer denial. A method (rather than a
     * direct field read) so TypeScript doesn't narrow the field to the `null` it was
     * reset to before the statement ran — the authorizer callback mutates it out of
     * band.
     */
    private takeTableAccessDenial(): {action: string; schemaName: string} | null {
        const denial = this.tableAccessDenial;
        this.tableAccessDenial = null;
        return denial;
    }

    /**
     * Maps an authorizer schema name to the current execution's access level. `main`
     * (the public ID-only registry) and SQLite's `temp` schema sit outside the
     * per-table permission model; unknown schemas fail closed.
     */
    private readonly resolveSchemaAccess = (schemaName: string): AccessLevel | null => {
        if (schemaName === "main" || schemaName === "temp") return "Manage";
        const tableId = this.schemaToTable.get(schemaName);
        if (tableId === undefined) return null;
        const resolver = this.tableAccessResolver;
        assert(resolver !== null, "resolveSchemaAccess requires an installed resolver");
        return resolver(tableId);
    };

    /**
     * Captures cache-hit reads via the page access hook so {@link execute} returns a
     * complete read set even when SQLite serves pages from its pager cache without
     * going through `xRead`. The hook fires for every attached database; demux on
     * schema name. Reads from schemas we don't own (e.g. SQLite's `temp`) are ignored.
     *
     * Stored as an arrow-function field so re-installs pass the same JS reference and
     * the FuncPtrAdapter doesn't churn wasm thunks.
     */
    private readonly handlePageAccess = (schemaName: string, pgno: number, flags: number): void => {
        const tableId = this.schemaToTable.get(schemaName);
        if (tableId === undefined) return;
        // Both reads and writes count as LRU touches for eviction.
        const state = this.tables.get(tableId);
        if (state !== undefined) {
            state.lastTouchedAt = ++this.touchCounter;
        }
        if (flags !== pageAccessFlagRead) return;
        const readSet = this.currentReadSet;
        if (readSet === null) return;
        addToTablePageSet(readSet, tableId, pgno - 1);
    };

    /**
     * (Re-)install the page-access hook on every currently-attached database's pager.
     * Call after any operation that grows `db->aDb[]` (i.e. ATTACH).
     */
    private installPageAccessHook(): void {
        this.db.pageAccessHook(this.handlePageAccess);
    }

    /**
     * Monkey-patches `db.prepare` so a statement referencing an unattached per-table
     * schema attaches the file and retries instead of failing. The `oo1` `exec()`
     * implementation prepares its statements through this same patched `prepare`, so
     * multi-statement batches recover too — and because "no such table" fires at
     * prepare time (before the statement has any effect) and the retry happens
     * _inside_ `prepare`, statements the batch already executed are never re-run.
     *
     * Each `prepare` call attaches any given schema at most once: a second miss on the
     * same schema means the reference is genuinely broken (or the statement references
     * more schemas than the attach limit allows) and the original error surfaces.
     */
    private installAttachOnMiss(): void {
        const originalPrepare = this.db.prepare.bind(this.db);
        (this.db as any).prepare = (sqlArg: any) => {
            let recoveredTableIds: Set<DatabaseTableId> | null = null;
            for (;;) {
                try {
                    return originalPrepare(sqlArg as string);
                } catch (error) {
                    if (this.inAttachRecovery || !(error instanceof Error)) throw error;
                    const tableId = parseUnattachedTableMessage(error.message);
                    // Bail when the named schema is already attached — then it's a missing inner
                    // table, not an unattached file.
                    if (
                        tableId === null ||
                        this.tables.has(tableId) ||
                        recoveredTableIds?.has(tableId) === true ||
                        !this.tryAttachUnattachedTable(tableId)
                    ) {
                        throw error;
                    }
                    (recoveredTableIds ??= new Set()).add(tableId);
                }
            }
        };
    }

    /**
     * Attempt to recover from a statement referencing `tableId`'s unattached per-db
     * file by attaching it. Returns whether the caller should retry.
     *
     * Server: the table must exist in main's `_alpine_tables` registry — attaching an
     * unregistered name would create a phantom empty file through the VFS. Every
     * registered file is migration-current (the bootstrap sweep migrates existing
     * files before actions run; `createTable` migrates new ones at creation), which is
     * asserted rather than repaired here: running migrations mid-statement would
     * buffer writes inside whatever read/write context triggered the miss.
     * Change-capture triggers are recreated for user tables since eviction drops them.
     *
     * Client: only attaches files whose header page is locally cached — under
     * `locking_mode = EXCLUSIVE`, attaching a headerless store would permanently cache
     * an empty schema. An unrecoverable miss keeps the original error, which {@link
     * runTracked} converts to {@link TableNotAttachedError} for the server-fallback
     * path.
     */
    private tryAttachUnattachedTable(tableId: DatabaseTableId): boolean {
        this.inAttachRecovery = true;
        try {
            if (this.serverContext !== null) {
                // captureResult: a server database whose main file predates the registry (only
                // reachable in tests that skip runMainMigrations) can't recover anything, and the
                // original statement's error should surface — not the registry lookup's.
                const kindResult = captureResult(() =>
                    sql`
                        SELECT
                            kind
                        FROM
                            main._alpine_tables
                        WHERE
                            id = ${tableId}
                    `.selectValueIfExists(this.db, Schema.enum(["table", "join"])),
                );
                if (!kindResult.ok || kindResult.value === null) return false;
                const kind = kindResult.value;
                this.attach(tableId);
                this.assertAttachedTableMigrationsAreCurrent(tableId, kind);
                return true;
            }
            const headerPage = captureResult(() => this.storage.readPage(tableId, 0));
            if (!headerPage.ok || headerPage.value === null) return false;
            this.attach(tableId);
            return true;
        } finally {
            this.inAttachRecovery = false;
        }
    }

    /**
     * Detach least-recently-used per-table files until the attached-schema count is
     * back under {@link attachEvictionThreshold}. Skips `main`, tables with buffered
     * writes (their pages would be lost with the {@link DatabaseTableState} entry),
     * and tables the open transaction has touched (SQLite holds a btree transaction on
     * those until commit, so `DETACH` reports them locked). When every candidate is
     * pinned, gives up and relies on the headroom between the threshold and the hard
     * `SQLITE_MAX_ATTACHED` limit.
     */
    private evictForAttachCapacity(): void {
        const pinned = new Set<DatabaseTableId>();
        while (this.tables.size >= this.attachEvictionThreshold) {
            const victim = this.findAttachEvictionVictim(pinned);
            if (victim === null) return;
            if (!this.tryDetachTable(victim)) {
                pinned.add(victim);
            }
        }
    }

    /** Least-recently-touched evictable table, or `null` if none qualifies. */
    private findAttachEvictionVictim(pinned: ReadonlySet<DatabaseTableId>): DatabaseTableId | null {
        let victimId: DatabaseTableId | null = null;
        let victimTouchedAt = Infinity;
        for (const [tableId, state] of this.tables) {
            if (tableId === databaseMainTableId || pinned.has(tableId)) continue;
            if (state.bufferedPages.size > 0 || state.bufferedTruncate !== null) continue;
            if (state.lastTouchedAt < victimTouchedAt) {
                victimId = tableId;
                victimTouchedAt = state.lastTouchedAt;
            }
        }
        return victimId;
    }

    /**
     * `DETACH` a per-table file and forget its state. Returns `false` without
     * detaching when SQLite reports the schema locked (the open transaction touched
     * it); the caller should pick another victim.
     */
    private tryDetachTable(tableId: DatabaseTableId): boolean {
        const schemaName = databaseTableSchemaName(tableId);
        const previousWriteLevel = this.writeLevel;
        this.writeLevel = "attach";
        try {
            sql`DETACH DATABASE ${sql.identifier(schemaName)}`.exec(this.db);
        } catch (error) {
            if (error instanceof Error && error.message.includes("is locked")) return false;
            throw error;
        } finally {
            this.writeLevel = previousWriteLevel;
        }
        this.tables.delete(tableId);
        this.schemaToTable.delete(schemaName);
        return true;
    }

    /**
     * Assert an attach-on-miss'd file has all known migrations applied. The
     * `user_version` read needs the internal `"attach"` level so the authorizer
     * permits the PRAGMA regardless of the ambient write level.
     */
    private assertAttachedTableMigrationsAreCurrent(
        tableId: DatabaseTableId,
        kind: "table" | "join",
    ): void {
        const migrationCount =
            kind === "table"
                ? tableSqliteMigrations(tableId).length
                : joinTableSqliteMigrations(tableId).length;
        const schema = sql.identifier(databaseTableSchemaName(tableId));
        const previousWriteLevel = this.writeLevel;
        this.writeLevel = "attach";
        let version: number;
        try {
            version = sql`PRAGMA ${schema}.user_version`.selectValue(this.db, Schema.integer);
        } finally {
            this.writeLevel = previousWriteLevel;
        }
        assert(
            version === migrationCount,
            `attach-on-miss found ${kind} ${tableId} with user_version ${version}, expected ${migrationCount}`,
        );
    }

    private runTracked<T>(
        writeLevel: SqliteWriteLevel,
        fn: (db: SqliteDatabase) => T,
    ): {
        result: T;
        readPages: Map<DatabaseTableId, Set<number>>;
        writtenPages: Map<DatabaseTableId, Set<number>>;
    } {
        assertNestedWriteLevelIsAllowed(this.writeLevel, writeLevel);
        const readPages = new Map<DatabaseTableId, Set<number>>();
        const writtenPages = new Map<DatabaseTableId, Set<number>>();
        const parentReadSet = this.currentReadSet;
        const parentWriteSet = this.currentWriteSet;
        const previousWriteLevel = this.writeLevel;
        const isTopLevel = previousWriteLevel === null;
        this.writeLevel = writeLevel;
        this.currentReadSet = readPages;
        this.currentWriteSet = writtenPages;
        this.tableAccessDenial = null;
        try {
            const result = fn(this.db);
            if (parentReadSet !== null) {
                mergeTablePageSets(parentReadSet, readPages);
            }
            if (parentWriteSet !== null) {
                mergeTablePageSets(parentWriteSet, writtenPages);
            }
            return {result, readPages, writtenPages};
        } catch (error) {
            const stashed = this.vfs.takeError();
            if (stashed !== null) {
                if (stashed instanceof Error) {
                    stashed.cause = error;
                }
                throw stashed;
            }
            // A statement the per-table authorizer layer rejected fails with SQLite's
            // authorization error ("not authorized", or "access to X is prohibited" for read
            // denials at prepare time); convert it into a typed error naming the table so
            // callers (and tests) can distinguish a permission denial from other SQL failures.
            // Global write-level denials leave no marker and surface as-is.
            const denial = this.takeTableAccessDenial();
            if (
                denial !== null &&
                error instanceof Error &&
                (error.message.includes("not authorized") ||
                    error.message.includes("is prohibited"))
            ) {
                const tableId = this.schemaToTable.get(denial.schemaName) ?? denial.schemaName;
                const permissionError = new PermissionDeniedError(
                    `Permission denied for ${denial.action} on database table ${tableId}`,
                );
                permissionError.cause = error;
                throw permissionError;
            }
            // A query against an unattached per-db file fails at statement preparation with
            // "no such table" / "unknown database". The patched `prepare` (see
            // `installAttachOnMiss`) already attached-and-retried where it could; an error
            // reaching this catch means recovery wasn't possible. On the client that's a table
            // with no locally cached header page — rethrow as TableNotAttachedError so the
            // client falls back to the server, whose response supplies the table's pages and
            // attaches it.
            //
            // Client-only: the server can attach any registered table on miss, so the same
            // error there is a genuine bug and must surface as-is. Bail too when the named
            // schema _is_ attached — then it's a missing inner table, not an unattached file.
            if (this.serverContext === null && error instanceof Error) {
                const tableId = parseUnattachedTableMessage(error.message);
                if (tableId !== null && !this.tables.has(tableId)) {
                    const notAttached = new TableNotAttachedError(tableId);
                    notAttached.cause = error;
                    throw notAttached;
                }
            }
            throw error;
        } finally {
            this.writeLevel = previousWriteLevel;
            this.currentReadSet = parentReadSet;
            this.currentWriteSet = parentWriteSet;
            if (isTopLevel) {
                this.vfs.takeError();
                this.tempFiles.clear();
            }
        }
    }

    private readonly runTrackedExecution = <Value>(
        fn: () => Value,
    ): {result: Result<Value>; readPages: ReadonlyDatabasePageSet} => {
        const {result, readPages, writtenPages} = this.runTracked("none", () => captureResult(fn));
        assert(writtenPages.size === 0, "tracked database executions must be read-only");
        return {result, readPages};
    };

    private readonly recordTrackedReadPages = (readPages: ReadonlyDatabasePageSet | null): void => {
        if (readPages !== null && this.currentReadSet !== null) {
            mergeTablePageSets(this.currentReadSet, readPages);
        }
    };

    private invalidateTrackedExecutions(writtenPages: ReadonlyDatabasePageSet): void {
        if (writtenPages.size === 0) return;
        for (const execution of this.trackedExecutions) {
            execution.invalidateForPages(writtenPages);
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

                // Page is in the gap created by a buffered truncate that a later write past the
                // truncate re-extended over. Treat as missing so storage doesn't return
                // pre-truncate data.
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
                // A write past a buffered truncate is fine — the consumer drains truncate first,
                // so the post-truncate file is what this write extends. The truncate stays
                // buffered so its shrinking effect (zeroing pages between the truncate boundary
                // and this write) is preserved.
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

            // No-op: the buffer is what `getBufferedWrites` returns. Persistence is the
            // caller's job.
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
     * Buffered truncate-to-size in bytes, or `null` if no truncate is currently
     * buffered.
     */
    bufferedTruncate: number | null = null;
    /**
     * Highest page index in {@link bufferedPages}, or `null` if empty. Tracked
     * incrementally so {@link Database} can compute file size in O(1) instead of
     * scanning the buffer on every read.
     */
    bufferedMaxPageIndex: number | null = null;
    /**
     * {@link Database}'s touch counter value at this table's last page access (read or
     * write) or attach. Lowest value = least recently used, first evicted when the
     * attach threshold is hit.
     */
    lastTouchedAt = 0;

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
    getOrSetDefaultMapValue(target, tableId, () => new Set<number>()).add(pageIndex);
}

function mergeTablePageSets(
    target: Map<DatabaseTableId, Set<number>>,
    source: ReadonlyDatabasePageSet,
): void {
    for (const [tableId, pages] of source) {
        const targetPages = getOrSetDefaultMapValue(target, tableId, () => new Set<number>());
        for (const page of pages) {
            targetPages.add(page);
        }
    }
}

function pageSetsOverlap(
    readPages: ReadonlyDatabasePageSet,
    writtenPages: ReadonlyDatabasePageSet,
): boolean {
    for (const [tableId, readSet] of readPages) {
        const writes = writtenPages.get(tableId);
        if (writes === undefined) continue;
        for (const page of readSet) {
            if (writes.has(page)) return true;
        }
    }
    return false;
}

function pageIndexesForBufferedPages(
    pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
): ReadonlyDatabasePageSet {
    const result = new Map<DatabaseTableId, Set<number>>();
    for (const [tableId, tablePages] of pages) {
        result.set(tableId, new Set(tablePages.keys()));
    }
    return result;
}

function assertNestedWriteLevelIsAllowed(
    outerWriteLevel: InternalSqliteWriteLevel | null,
    innerWriteLevel: SqliteWriteLevel,
): void {
    if (outerWriteLevel === null) return;
    assert(
        writeLevelRank(innerWriteLevel) <= writeLevelRank(outerWriteLevel),
        "nested execute cannot use broader write permissions than its parent",
    );
}

function writeLevelRank(writeLevel: InternalSqliteWriteLevel): number {
    switch (writeLevel) {
        case "none":
            return 0;
        case "data":
            return 1;
        case "schema+data":
            return 2;
        case "attach":
            return 3;
    }
}

class DatabaseTrackedExecutionImpl<Value> implements DatabaseTrackedExecution<Value> {
    private valueResult: Result<Value> | null = null;
    private readPages: ReadonlyDatabasePageSet | null = null;
    private dirty = false;
    private computing = false;
    private destroyed = false;

    constructor(
        private readonly fn: () => Value,
        private readonly run: (fn: () => Value) => {
            result: Result<Value>;
            readPages: ReadonlyDatabasePageSet;
        },
        private readonly recordReadPages: (readPages: ReadonlyDatabasePageSet | null) => void,
        private readonly unregister: (value: DatabaseTrackedExecutionImpl<Value>) => void,
    ) {}

    getSnapshot(): Value {
        this.assertNotDestroyed();

        if (this.valueResult === null || this.dirty) {
            this.recompute();
        } else {
            this.recordReadPages(this.readPages);
        }

        return unwrapResult(this.valueResult!);
    }

    getCachedSnapshot(): Result<Value> | null {
        this.assertNotDestroyed();
        return this.valueResult;
    }

    setTrackedSnapshot(result: Result<Value>, readPages: ReadonlyDatabasePageSet | null): void {
        this.assertNotDestroyed();
        this.valueResult = result;
        this.readPages = result.ok ? readPages : null;
        this.dirty = false;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.unregister(this);
    }

    invalidateForPages(writtenPages: ReadonlyDatabasePageSet): boolean {
        if (this.destroyed || this.valueResult === null) return false;
        if (this.readPages !== null && !pageSetsOverlap(this.readPages, writtenPages)) return false;
        this.dirty = true;
        return true;
    }

    private recompute(): void {
        assert(!this.computing, "tracked database execution cannot read itself");
        this.computing = true;
        try {
            const {result, readPages} = this.run(this.fn);
            this.valueResult = result;
            this.readPages = result.ok ? readPages : null;
            this.dirty = false;
        } finally {
            this.computing = false;
        }
    }

    private assertNotDestroyed(): void {
        assert(!this.destroyed, "tracked database execution has been destroyed");
    }
}

// SQLite reports a reference to an unattached per-db file in one of two shapes,
// both naming the schema we generated via `databaseTableSchemaName`:
//
// - `no such table: _alpine_schema_<tableId>.<inner>` — for DML/SELECT/ALTER.
// - `unknown database "_alpine_schema_<tableId>"` — for some DDL (e.g. CREATE
//   INDEX).
//
// Ids are 26-char Crockford base-32; matching `[0-9a-z]+` up to the `.`/`"`
// boundary recovers the id without depending on its exact length. These message
// formats are stable across SQLite versions and not localized.
const unattachedSchemaErrorPatterns = [
    new RegExp(`no such table: ${databaseTableSchemaNamePrefix}([0-9a-z]+)\\.`),
    // eslint-disable-next-line cyberworlds/string-quotes -- matches SQLite error text
    new RegExp(`unknown database "${databaseTableSchemaNamePrefix}([0-9a-z]+)"`),
];

/**
 * Recover the {@link DatabaseTableId} of an unattached per-db file from a SQLite
 * name-resolution error message, or `null` if the message isn't one of those
 * errors.
 */
function parseUnattachedTableMessage(message: string): DatabaseTableId | null {
    for (const pattern of unattachedSchemaErrorPatterns) {
        const match = pattern.exec(message);
        if (match !== null) return match[1] as DatabaseTableId;
    }
    return null;
}
