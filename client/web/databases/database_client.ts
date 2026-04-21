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
import {
    type SqliteWriteLevel,
    isSqliteActionAllowed,
    sqliteAuthorizerActionName,
} from "~/shared/databases/sqlite_authorizer.js";
import {
    pageAccessFlagRead,
    pageAccessFlagWrite,
    sqliteOpenPragmas,
} from "~/shared/databases/sqlite_constants.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {type SqliteMigration} from "~/shared/databases/sqlite_migrations.js";
import {installTracing} from "~/shared/databases/sqlite_tracing.js";
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
        options: {
            mutationId: DatabaseMutationId;
            returnResult?: boolean;
            returnPages?: boolean;
        },
    ): Promise<ExecuteActionServerResult>;
    ensureCacheIsUpToDate(
        pageTimestampsByIndex: ReadonlyMap<number, number>,
    ): Promise<EnsureCacheIsUpToDateResult>;
    acknowledgePages(pageIndexes: ReadonlyArray<number>): void;
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

        this.db = new sqlite3.oo1.DB("/db.sqlite3", "c", vfsName);
        installTracing(this.db);

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

        registerSqliteCustomFunctions(sqlite3, this.db);

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

        const pageTimestampsByIndex = new Map<number, number>();
        for (const entry of entries) {
            pageTimestampsByIndex.set(entry.pageIndex, entry.timestamp);
        }

        const {updatedPages, stalePageIndexes, fileSizeInPages} =
            await conn.ensureCacheIsUpToDate(pageTimestampsByIndex);

        for (const [pageIndex, {timestamp, data}] of updatedPages) {
            this.pageStore.writePageIfNewer(pageIndex, timestamp, data);
        }

        if (updatedPages.size > 0) {
            conn.acknowledgePages([...updatedPages.keys()]);
        }

        if (stalePageIndexes.length > 0) {
            this.pageStore.deletePages(new Set(stalePageIndexes));
        }

        this.pageStore.setServerFileSizeInPages(fileSizeInPages);
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
                await conn.executeActionServer(actionObject, {
                    mutationId,
                    returnResult: false,
                    returnPages: false,
                });
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
     * Execute a read-only action while tracking which
     * database pages are read. Uses `pageAccessHook` to
     * capture reads including cache hits. Asserts the
     * action's `writeLevel` is `"none"`.
     *
     * On missing pages, falls back to the server, then
     * retries locally to build an accurate read-set.
     *
     * The hook is only active during synchronous
     * `executeActionLocally` calls — never across an
     * `await` — so concurrent tracking calls cannot
     * interfere with each other.
     */
    async executeActionWithTracking<N extends DatabaseActionName>(
        conn: DatabaseClientConnection,
        actionObject: DatabaseActionObject<N>,
    ): Promise<{output: DatabaseActionOutput<N>; readPages: ReadonlySet<number>}> {
        assert(
            databaseActions[actionObject.name].writeLevel === "none",
            "executeActionWithTracking only supports read-only actions",
        );
        try {
            return this.executeActionLocallyInReadOnlyTxn(actionObject);
        } catch (error) {
            if (!(error instanceof PageMissingError)) throw error;
            await this.executeActionViaServer(
                conn,
                actionObject,
                generateId<DatabaseMutationId>(),
                {
                    returnResult: false,
                },
            );
            return this.executeActionLocallyInReadOnlyTxn(actionObject);
        }
    }

    /**
     * Executes an action inside a BEGIN/ROLLBACK
     * transaction with page-read tracking. Asserts that
     * the action does not write any pages (writes are
     * rolled back and an assertion error is thrown).
     */
    private executeActionLocallyInReadOnlyTxn<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ): {
        output: DatabaseActionOutput<N>;
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
            const output = this.executeActionLocally(actionObject);
            assert(!writeDetected, "executeActionWithTracking does not support writes");
            return {output, readPages};
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

    // -- Reactive actions ----------------------------------------------------

    private readonly reactiveActions = new Map<
        string,
        {
            readonly actionObject: DatabaseActionObject;
            readPages: ReadonlySet<number> | null;
            readonly conn: DatabaseClientConnection;
            readonly notify: (output: DatabaseActionOutput<DatabaseActionName>) => void;
            readonly reportError: (error: unknown) => void;
            reExecuting: boolean;
        }
    >();
    private pagesToInvalidate = new Set<number>();
    private invalidationScheduled = false;

    /**
     * Register a reactive action. Executes the action
     * with page tracking and returns the initial output.
     * When pages in the action's read-set are subsequently
     * written, the action re-executes and {@link notify}
     * is called with the new output. If re-execution
     * fails, {@link reportError} is called with the error.
     *
     * The action's `writeLevel` must be `"none"`.
     */
    async registerReactiveAction<N extends DatabaseActionName>(
        id: string,
        actionObject: DatabaseActionObject<N>,
        conn: DatabaseClientConnection,
        notify: (output: DatabaseActionOutput<N>) => void,
        reportError: (error: unknown) => void,
    ): Promise<Result<DatabaseActionOutput<N>>> {
        assert(
            databaseActions[actionObject.name].writeLevel === "none",
            "reactive actions must have writeLevel \u2018none\u2019",
        );
        try {
            const {output, readPages} = await this.executeActionWithTracking(conn, actionObject);
            this.reactiveActions.set(id, {
                actionObject,
                readPages,
                conn,
                notify: notify as (output: DatabaseActionOutput<DatabaseActionName>) => void,
                reportError,
                reExecuting: false,
            });
            return {ok: true, value: output};
        } catch (error) {
            this.reactiveActions.set(id, {
                actionObject,
                readPages: null,
                conn,
                notify: notify as (output: DatabaseActionOutput<DatabaseActionName>) => void,
                reportError,
                reExecuting: false,
            });
            return {ok: false, error};
        }
    }

    /**
     * Unregister a reactive action. Stops future
     * invalidation notifications.
     */
    unregisterReactiveAction(id: string): void {
        this.reactiveActions.delete(id);
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
        for (const [, reg] of this.reactiveActions) {
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
                const {output, readPages} = await this.executeActionWithTracking(
                    reg.conn,
                    reg.actionObject,
                );
                reg.readPages = readPages;
                reg.notify(output);
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
        fileSizeInPages: number,
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
        this.pageStore.setServerFileSizeInPages(fileSizeInPages);
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

    /**
     * Write loader-provided pages into the local OPFS
     * store before cache validation. No invalidation is
     * scheduled because no reactive actions exist yet.
     */
    seedPages(
        pages: ReadonlyArray<{pageIndex: number; timestamp: number; data: Uint8Array}>,
    ): void {
        for (const page of pages) {
            this.pageStore.writePageIfNewer(page.pageIndex, page.timestamp, page.data);
        }
        this.pageStore.sync();
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
            return action.run(this.db, actionObject.input as any) as DatabaseActionOutput<N>;
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
    ): Promise<DatabaseActionOutput<N>>;
    private async executeActionViaServer<N extends DatabaseActionName>(
        conn: DatabaseClientConnection,
        actionObject: DatabaseActionObject<N>,
        mutationId: DatabaseMutationId,
        options: {returnResult: false},
    ): Promise<void>;
    private async executeActionViaServer<N extends DatabaseActionName>(
        conn: DatabaseClientConnection,
        actionObject: DatabaseActionObject<N>,
        mutationId: DatabaseMutationId,
        options?: {returnResult?: boolean},
    ): Promise<DatabaseActionOutput<N> | void> {
        const returnResult = options?.returnResult ?? true;
        const serverResult = await conn.executeActionServer(actionObject, {
            mutationId,
            returnResult,
        });
        this.pageStore.clearOptimisticPages();
        if (serverResult.readPages !== null) {
            this.applyServerPages(serverResult.readPages);
            conn.acknowledgePages([...serverResult.readPages.keys()]);
        }
        this.replayOptimisticQueue();
        if (returnResult) {
            return (serverResult.result as DatabaseActionResult<N>).output;
        }
    }

    /**
     * Execute a migration locally without server
     * interaction. Writes go directly to the base OPFS
     * store (not optimistic pages). Use for test setup
     * only.
     */
    executeLocallyForTests(migration: SqliteMigration): void {
        assert(import.meta.jest, "executeLocallyForTests is test-only");
        this.writeLevel = "schema+data";
        try {
            if (typeof migration === "function") {
                migration(this.db);
            } else {
                this.db.exec(migration);
            }
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

    /** Exposed for tests only. Do not use in production code. */
    unsafeGetDbForTests(): Database {
        assert(import.meta.jest);
        return this.db;
    }
}
