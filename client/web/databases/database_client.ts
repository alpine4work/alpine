import type {ExecuteActionServerResult} from "~/client/web/databases/database_worker_rpc_methods.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {OpfsPageStore} from "~/client/web/databases/opfs_page_store.js";
import type {
    Database,
    Sqlite3Static,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    type DatabaseActionOutput,
    type DatabaseActionResult,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import type {EnsureCacheIsUpToDateResult} from "~/shared/databases/database_realtime_protocol.js";
import type {InstalledVfs} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {
    type PageDiff,
    applyPageDiff,
    diffPage,
    shouldIgnorePageInvalidation,
} from "~/shared/databases/page_diff.js";
import {PageMissingError} from "~/shared/databases/page_missing_error.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {
    isSqliteActionAllowed,
    sqliteAuthorizerActionName,
} from "~/shared/databases/sqlite_authorizer.js";
import {
    pageAccessFlagRead,
    pageAccessFlagWrite,
    sqliteOpenPragmas,
} from "~/shared/databases/sqlite_constants.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {Result} from "~/shared/helpers/control/result.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";

interface OptimisticMutation {
    mutationId: DatabaseMutationId;
    action: DatabaseActionObject;
}

const vfsNamePrefix = "alpine-client";
let vfsCounter = 0;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;

/**
 * Represents a connected tab's route to the server.
 * Passed into {@link DatabaseClient.executeAction} so
 * server fallbacks route through the correct tab's
 * WebSocket connection.
 */
export interface DatabaseClientConnection {
    executeActionServer(
        action: DatabaseActionObject,
        options: {mutationId: DatabaseMutationId},
    ): Promise<ExecuteActionServerResult>;
    ensureCacheIsUpToDate(
        pageTimestampsByIndex: ReadonlyMap<number, number>,
    ): Promise<EnsureCacheIsUpToDateResult>;
    reportError(error: unknown): void;
}

/**
 * Client-side SQLite database backed by OPFS page
 * storage. Handles server fallback transparently:
 * when a local query hits a missing page, calls
 * {@link DatabaseClientConnection.executeActionServer}
 * to fetch pages from the server, stores them locally,
 * and returns the server's result.
 *
 * Inject the result of `navigator.storage.getDirectory()`
 * to construct. For tests, pass an in-memory mock.
 */
export class DatabaseClient {
    private readonly db: Database;
    private readonly vfs: InstalledVfs;
    private readonly pageStore: OpfsPageStore;
    private optimisticQueue: Array<OptimisticMutation> = [];
    private writeLevel: SqliteWriteLevel | null = null;

    private constructor(sqlite3: Sqlite3Static, pageStore: OpfsPageStore) {
        this.pageStore = pageStore;
        const vfsName = `${vfsNamePrefix}-${vfsCounter++}`;

        this.vfs = installVfs(sqlite3, vfsName, {
            open: (_filename, flags) => {
                if (flags & sqlite3.capi.SQLITE_OPEN_MAIN_DB) {
                    return pageStore;
                }
                return new VfsTempFile();
            },
            delete: () => {},
            access: () => false,
        });

        this.db = new sqlite3.oo1.DB("/db.sqlite3", "ct", vfsName);

        const capi = sqlite3.capi;
        capi.sqlite3_set_authorizer(
            this.db.pointer!,
            (_cbArg: WasmPointer, actionCode: number) => {
                const action = sqliteAuthorizerActionName(actionCode);
                if (action === undefined) {
                    return capi.SQLITE_DENY;
                }
                return isSqliteActionAllowed(action, this.writeLevel)
                    ? capi.SQLITE_OK
                    : capi.SQLITE_DENY;
            },
            0,
        );

        for (const pragma of sqliteOpenPragmas) {
            this.db.exec(pragma);
        }
        this.db.exec("PRAGMA journal_mode = MEMORY");
    }

    static async create(dir: OpfsDirectoryHandle): Promise<DatabaseClient> {
        if (sqlite3Promise === undefined) {
            sqlite3Promise = sqlite3InitModule();
        }
        const sqlite3 = await sqlite3Promise;

        const dbDir = await dir.getDirectoryHandle("databases", {create: true});
        const pageStore = await OpfsPageStore.create(dbDir);

        return new DatabaseClient(sqlite3, pageStore);
    }

    /**
     * Validate the local OPFS page cache against the
     * server. Sends the client's `pageIndex → timestamp`
     * map and receives back:
     *
     * - `updatedPages` — pages whose server data is
     *   newer; written directly into the local store.
     * - `stalePageIndexes` — pages the client should
     *   delete (re-fetched on demand).
     *
     * Both empty means the cache is already up to date.
     */
    async ensureCacheIsUpToDate(conn: DatabaseClientConnection): Promise<void> {
        const entries = this.pageStore.pageEntries();
        if (entries.length === 0) return;

        const pageTimestampsByIndex = new Map<number, number>();
        for (const entry of entries) {
            pageTimestampsByIndex.set(entry.pageIndex, entry.timestamp);
        }

        const {updatedPages, stalePageIndexes} =
            await conn.ensureCacheIsUpToDate(pageTimestampsByIndex);

        if (updatedPages.size === 0 && stalePageIndexes.length === 0) return;

        for (const [pageIndex, {timestamp, data}] of updatedPages) {
            this.pageStore.writePageIfNewer(pageIndex, timestamp, data);
        }

        if (stalePageIndexes.length > 0) {
            this.pageStore.deletePages(new Set(stalePageIndexes));
        }

        this.pageStore.sync();
    }

    /**
     * Execute a named action. Detects reads vs writes
     * via the optimistic page store: if the local
     * execution writes no pages, it's a read and returns
     * immediately. If pages are written, it's treated
     * as a mutation with optimistic local execution
     * and background server confirmation.
     *
     * Falls back to the server when the local store
     * is empty or missing pages.
     */
    async executeAction<N extends DatabaseActionName>(
        conn: DatabaseClientConnection,
        actionObject: DatabaseActionObject<N>,
    ): Promise<DatabaseActionOutput<N>> {
        const mutationId = generateId<DatabaseMutationId>();

        let result!: DatabaseActionOutput<N>;
        let writtenPages: ReadonlySet<number>;
        try {
            writtenPages = this.pageStore.optimistic(() => {
                result = this.executeActionLocally(actionObject);
            });
        } catch (error) {
            if (error instanceof PageMissingError) {
                return await this.executeActionViaServer(conn, actionObject, mutationId);
            }
            throw error;
        }

        if (writtenPages.size === 0) {
            // Pure read — no server round-trip needed.
            return result;
        }

        this.optimisticQueue.push({mutationId, action: actionObject});
        this.invalidateForWrittenPages(writtenPages);

        // Send to server in the background.
        void (async () => {
            try {
                await conn.executeActionServer(actionObject, {mutationId});
                assert(
                    !this.optimisticQueue.some(m => m.mutationId === mutationId),
                    "mutation not confirmed via realtime before server responded",
                );
            } catch (error) {
                this.removeOptimisticMutation(mutationId);
                conn.reportError(error);
            }
        })();

        return result;
    }

    /**
     * Convenience wrapper: execute raw SQL via the
     * `rawSql` action.
     */
    async execute(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<ReadonlyArray<Record<string, unknown>>> {
        const {rows} = await this.executeAction(conn, {name: "rawSql", input: {sql}});
        return rows as ReadonlyArray<Record<string, unknown>>;
    }

    /**
     * Execute a read-only query while tracking which
     * database pages are read. Uses `pageAccessHook` to
     * capture reads including cache hits. Throws if the
     * SQL attempts to write.
     *
     * On missing pages, falls back to the server, then
     * retries locally to build an accurate read-set.
     *
     * The hook is only active during synchronous
     * `executeLocally` calls — never across an
     * `await` — so concurrent tracking calls cannot
     * interfere with each other.
     */
    async executeWithTracking(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<{rows: ReadonlyArray<Record<string, unknown>>; readPages: ReadonlySet<number>}> {
        try {
            return this.executeLocallyInReadOnlyTxn(sql);
        } catch (error) {
            if (!(error instanceof PageMissingError)) throw error;
            await this.executeActionViaServer(
                conn,
                {name: "rawSql", input: {sql}},
                generateId<DatabaseMutationId>(),
            );
            return this.executeLocallyInReadOnlyTxn(sql);
        }
    }

    /**
     * Executes SQL inside a BEGIN/ROLLBACK transaction
     * with page-read tracking. Asserts that the SQL does
     * not write any pages (writes are rolled back and an
     * assertion error is thrown).
     */
    private executeLocallyInReadOnlyTxn(sql: string): {
        rows: ReadonlyArray<Record<string, unknown>>;
        readPages: ReadonlySet<number>;
    } {
        const readPages = new Set<number>();
        let writeDetected = false;

        this.db.exec("BEGIN");
        this.db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === pageAccessFlagRead) readPages.add(pgno - 1);
            if (flags === pageAccessFlagWrite) writeDetected = true;
        });
        try {
            const rows = this.executeLocally(sql, "none");
            assert(!writeDetected, "executeWithTracking does not support writes");
            return {rows, readPages};
        } finally {
            this.db.pageAccessHook(null);
            try {
                this.db.exec("ROLLBACK");
            } catch {
                // VFS errors (e.g. PageMissingError) may
                // leave SQLite's pager in a state where
                // ROLLBACK fails. Swallow so the original
                // exception propagates.
            }
        }
    }

    // -- Reactive queries ----------------------------------------------------

    private readonly reactiveQueries = new Map<
        string,
        {
            readonly sql: string;
            readPages: ReadonlySet<number> | null;
            readonly conn: DatabaseClientConnection;
            readonly notify: (rows: ReadonlyArray<Record<string, unknown>>) => void;
            readonly reportError: (error: unknown) => void;
            reExecuting: boolean;
        }
    >();
    private pagesToInvalidate = new Set<number>();
    private invalidationScheduled = false;

    /**
     * Register a reactive query. Executes the query with
     * page tracking and returns the initial rows. When
     * pages in the query's read-set are subsequently
     * written, the query re-executes and {@link notify}
     * is called with the new rows. If re-execution fails,
     * {@link reportError} is called with the error.
     */
    async registerReactiveQuery(
        queryId: string,
        sql: string,
        conn: DatabaseClientConnection,
        notify: (rows: ReadonlyArray<Record<string, unknown>>) => void,
        reportError: (error: unknown) => void,
    ): Promise<Result<ReadonlyArray<Record<string, unknown>>>> {
        try {
            const {rows, readPages} = await this.executeWithTracking(conn, sql);
            this.reactiveQueries.set(queryId, {
                sql,
                readPages,
                conn,
                notify,
                reportError,
                reExecuting: false,
            });
            return {ok: true, value: rows};
        } catch (error) {
            this.reactiveQueries.set(queryId, {
                sql,
                readPages: null,
                conn,
                notify,
                reportError,
                reExecuting: false,
            });
            return {ok: false, error};
        }
    }

    /**
     * Unregister a reactive query. Stops future
     * invalidation notifications.
     */
    unregisterReactiveQuery(queryId: string): void {
        this.reactiveQueries.delete(queryId);
    }

    private scheduleInvalidation(): void {
        if (this.invalidationScheduled) return;
        this.invalidationScheduled = true;
        queueMicrotask(() => {
            this.invalidationScheduled = false;
            const pages = this.pagesToInvalidate;
            this.pagesToInvalidate = new Set();
            void this.checkInvalidation(pages);
        });
    }

    private async checkInvalidation(writtenPages: ReadonlySet<number>): Promise<void> {
        for (const [, reg] of this.reactiveQueries) {
            if (reg.reExecuting) continue;

            let overlaps = false;
            if (reg.readPages === null) {
                overlaps = true;
            } else {
                for (const page of writtenPages) {
                    if (reg.readPages.has(page)) {
                        overlaps = true;
                        break;
                    }
                }
            }
            if (!overlaps) continue;

            reg.reExecuting = true;
            try {
                const {rows, readPages} = await this.executeWithTracking(reg.conn, reg.sql);
                reg.readPages = readPages;
                reg.notify(rows);
            } catch (error) {
                reg.reportError(error);
            } finally {
                reg.reExecuting = false;
            }
        }
    }

    // -- Page writes ---------------------------------------------------------

    /**
     * Write pages received from realtime events into the
     * local OPFS store, skipping pages that are already at
     * a newer timestamp. If the `mutationId` matches a
     * queued optimistic mutation, removes it from the
     * queue and replays the remaining mutations.
     * Automatically schedules invalidation for any
     * reactive queries whose read-set overlaps the
     * written pages.
     */
    writePagesFromRealtime(
        pages: ReadonlyArray<{pageIndex: number; timestamp: number; diff: PageDiff}>,
        mutationId: DatabaseMutationId,
    ): void {
        const headIndex = this.optimisticQueue.findIndex(m => m.mutationId === mutationId);
        assert(
            headIndex === 0 || headIndex === -1,
            `unexpected mutation confirmation order: ${headIndex}`,
        );

        if (headIndex === 0) {
            this.optimisticQueue.shift();
        }

        this.pageStore.clearOptimisticPages();

        let anyWritten = false;
        for (const page of pages) {
            const base = this.pageStore.readPage(page.pageIndex);
            if (base === null) continue;
            const full = applyPageDiff(base, page.diff);
            if (this.pageStore.writePageIfNewer(page.pageIndex, page.timestamp, full)) {
                if (!shouldIgnorePageInvalidation(page.pageIndex, page.diff)) {
                    this.pagesToInvalidate.add(page.pageIndex);
                    anyWritten = true;
                }
            }
        }
        this.pageStore.sync();
        if (anyWritten) {
            this.scheduleInvalidation();
        }

        this.replayOptimisticQueue();
    }

    private applyServerPages(
        readPages: ReadonlyMap<number, {timestamp: number; data: Uint8Array}>,
    ): void {
        let anyWritten = false;
        for (const [pageIndex, {timestamp, data}] of readPages) {
            if (this.pageStore.writePageIfNewer(pageIndex, timestamp, data)) {
                this.pagesToInvalidate.add(pageIndex);
                anyWritten = true;
            }
        }
        this.pageStore.sync();
        if (anyWritten) {
            this.scheduleInvalidation();
        }
    }

    private removeOptimisticMutation(mutationId: DatabaseMutationId): void {
        this.optimisticQueue = this.optimisticQueue.filter(m => m.mutationId !== mutationId);
        this.pageStore.clearOptimisticPages();
        this.replayOptimisticQueue();
    }

    private replayOptimisticQueue(): void {
        let anyInvalidated = false;
        this.optimisticQueue = this.optimisticQueue.filter(mutation => {
            try {
                const writtenPages = this.pageStore.optimistic(() => {
                    this.executeActionLocally(mutation.action);
                });
                if (this.markWrittenPages(writtenPages)) {
                    anyInvalidated = true;
                }
                return true;
            } catch {
                return false;
            }
        });
        if (anyInvalidated) {
            this.scheduleInvalidation();
        }
    }

    /**
     * Adds optimistically written pages to
     * {@link pagesToInvalidate}, filtering out noise-only
     * changes on page 0. Returns true if any pages were
     * marked.
     */
    private markWrittenPages(writtenPages: ReadonlySet<number>): boolean {
        let anyMarked = false;
        for (const pageIndex of writtenPages) {
            if (pageIndex === 0) {
                const base = this.pageStore.readPage(0);
                const overlay = this.pageStore.getOptimisticPage(0);
                if (base !== null && overlay !== undefined) {
                    const diff = diffPage(base, overlay);
                    if (shouldIgnorePageInvalidation(0, diff)) continue;
                }
            }
            this.pagesToInvalidate.add(pageIndex);
            anyMarked = true;
        }
        return anyMarked;
    }

    private invalidateForWrittenPages(writtenPages: ReadonlySet<number>): void {
        if (this.markWrittenPages(writtenPages)) {
            this.scheduleInvalidation();
        }
    }

    isEmpty(): boolean {
        return this.pageStore.isEmpty();
    }

    /**
     * Run an action's `run()` function locally with
     * proper write-level authorization and VFS error
     * handling.
     */
    private executeActionLocally<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ): DatabaseActionOutput<N> {
        const action = databaseActions[actionObject.name];
        this.writeLevel = action.writeLevel;
        try {
            return action.run(this.db, actionObject.input) as DatabaseActionOutput<N>;
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
        }
    }

    private executeLocally(
        sql: string,
        writeLevel: SqliteWriteLevel = "data",
    ): ReadonlyArray<Record<string, unknown>> {
        this.writeLevel = writeLevel;
        try {
            return this.db.exec(sql, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as ReadonlyArray<Record<string, unknown>>;
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
        }
    }

    private async executeActionViaServer<N extends DatabaseActionName>(
        conn: DatabaseClientConnection,
        actionObject: DatabaseActionObject<N>,
        mutationId: DatabaseMutationId,
    ): Promise<DatabaseActionOutput<N>> {
        const serverResult = await conn.executeActionServer(actionObject, {mutationId});
        this.pageStore.clearOptimisticPages();
        this.applyServerPages(serverResult.readPages);
        this.replayOptimisticQueue();
        return (serverResult.result as DatabaseActionResult<N>).output;
    }

    /**
     * Execute SQL locally without server interaction.
     * Writes go directly to the base OPFS store (not
     * optimistic pages). Use for test setup only.
     */
    executeLocallyForTests(sql: string): ReadonlyArray<Record<string, unknown>> {
        assert(import.meta.jest, "executeLocallyForTests is test-only");
        return this.executeLocally(sql, "schema+data");
    }

    /** Exposed for tests only. Do not use in production code. */
    unsafeGetDbForTests(): Database {
        assert(import.meta.jest);
        return this.db;
    }
}
