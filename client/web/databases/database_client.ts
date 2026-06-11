import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {OpfsDatabaseStorage} from "~/client/web/databases/opfs_database_storage.js";
import type {OpfsPageStore} from "~/client/web/databases/opfs_page_store.js";
import {
    Database,
    type DatabaseExecuteActionResult,
    type DatabaseReactive,
} from "~/shared/databases/database.js";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    type DatabaseActionOutput,
    type DatabaseActionResult,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import type {
    DatabaseEnsureCacheIsUpToDateResult,
    DatabaseExecuteActionResponse,
    DatabasePageDiffs,
    DatabasePageIndexes,
    DatabasePageVersionsByIndex,
    DatabasePages,
    ReadonlyDatabasePageSet,
} from "~/shared/databases/database_protocol_schemas.js";
import {
    applyPageDiff,
    diffPage,
    shouldIgnorePageInvalidation,
} from "~/shared/databases/page_diff.js";
import {PageMissingError} from "~/shared/databases/page_missing_error.js";
import {databaseMainTableId} from "~/shared/databases/sqlite_constants.js";
import {type SqliteMigration} from "~/shared/databases/sqlite_migrations.js";
import {TableNotAttachedError} from "~/shared/databases/table_not_attached_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {Result} from "~/shared/helpers/control/result.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseMutationId, DatabaseTableId} from "~/shared/id/types/id_types.js";

interface OptimisticMutation {
    mutationId: DatabaseMutationId;
    action: DatabaseActionObject;
}

/**
 * Represents a connected tab's route to the server. Passed into {@link
 * DatabaseClient.executeAction} so server fallbacks route through the correct
 * tab's WebSocket connection.
 */
export interface DatabaseClientConnection {
    executeActionServer(
        action: DatabaseActionObject,
        options: {
            mutationId: DatabaseMutationId;
            returnResult?: boolean;
            returnPages?: boolean;
        },
    ): Promise<DatabaseExecuteActionResponse>;
    ensureCacheIsUpToDate(
        pageVersionsByIndex: DatabasePageVersionsByIndex,
    ): Promise<DatabaseEnsureCacheIsUpToDateResult>;
    acknowledgePages(pageIndexes: DatabasePageIndexes): void;
    reportError(error: unknown): void;
}

/**
 * Client-side SQLite database.
 *
 * Wraps a {@link Database} that reads through a {@link OpfsDatabaseStorage}
 * adapter over OPFS-backed page storage. Optimistic SQL writes accumulate in the
 * underlying {@link Database}'s in-memory buffer and only land on disk once the
 * server confirms them via {@link writePageDiffsFromRealtime} (or are dropped on
 * server error / discarded after a server fallback).
 *
 * Inject the result of `navigator.storage.getDirectory()` to construct. For tests,
 * pass an in-memory mock.
 */
export class DatabaseClient {
    private readonly database: Database;
    private readonly storage: OpfsDatabaseStorage;
    private optimisticQueue: Array<OptimisticMutation> = [];
    private nextTestCommitVersion = 0;

    private constructor(database: Database, storage: OpfsDatabaseStorage) {
        this.database = database;
        this.storage = storage;
    }

    /**
     * Open the SQLite database for a database group. The given `groupDir` is the
     * per-group OPFS directory: each table's page store lives in a `{tableId}/`
     * subdirectory inside it. Today only the main table is opened; future work will
     * attach additional table databases under the same SQLite connection.
     */
    static async create(groupDir: OpfsDirectoryHandle): Promise<DatabaseClient> {
        const storage = new OpfsDatabaseStorage(groupDir);
        await storage.create(databaseMainTableId);
        let database: Database;
        try {
            database = await Database.create(storage);
        } catch (error) {
            // The main store's OPFS handles are already open; release them so a retry isn't
            // blocked by OPFS's exclusive sync-access-handle lock.
            storage.close();
            throw error;
        }
        return new DatabaseClient(database, storage);
    }

    /**
     * Close the SQLite connection and release every OPFS sync-access handle held by
     * the page stores. Call when discarding this client (e.g. after a failed
     * cold-open) so a later re-open of the same group isn't blocked by OPFS's
     * exclusive sync-access-handle lock.
     */
    close(): void {
        this.database.close();
        this.storage.close();
    }

    /**
     * Validate the local OPFS page cache against the server, across every open table.
     * Sends the `tableId → pageIndex → version` map the client has cached and receives
     * back, per table:
     *
     * - `updatedPages` — pages whose server data is newer; written directly into that
     *   table's store.
     * - `stalePageIndexes` — pages the client should delete (re-fetched on demand).
     *
     * Both empty for a table means its cache is already up to date.
     */
    async ensureCacheIsUpToDate(conn: DatabaseClientConnection): Promise<void> {
        // Called once at startup before any executeAction, so the buffer must be empty and
        // SQLite's pager cache holds no user pages — meaning we can write straight to
        // durable storage without invalidating the cache.
        this.database.assertBufferIsEmpty("ensureCacheIsUpToDate");

        const pageVersionsByIndex = new Map<DatabaseTableId, Map<number, number>>();
        for (const [tableId, store] of this.storage) {
            const tableVersions = new Map<number, number>();
            for (const entry of store.pageEntries()) {
                tableVersions.set(entry.pageIndex, entry.version);
            }
            pageVersionsByIndex.set(tableId, tableVersions);
        }

        const {tables} = await conn.ensureCacheIsUpToDate(pageVersionsByIndex);

        const acknowledgedPageIndexes = new Map<DatabaseTableId, Array<number>>();
        for (const [tableId, {updatedPages, stalePageIndexes, fileSizeInPages}] of tables) {
            const store = this.storage.get(tableId);
            assert(
                store !== undefined,
                `ensureCacheIsUpToDate response references unknown table ${tableId}`,
            );

            for (const [pageIndex, {version, data}] of updatedPages) {
                store.writePageIfNewer(pageIndex, version, data);
            }
            if (updatedPages.size > 0) {
                acknowledgedPageIndexes.set(tableId, [...updatedPages.keys()]);
            }
            if (stalePageIndexes.length > 0) {
                store.deletePages(new Set(stalePageIndexes));
            }
            store.setServerFileSizeInPages(fileSizeInPages);
            store.sync();
        }

        if (acknowledgedPageIndexes.size > 0) {
            conn.acknowledgePages(acknowledgedPageIndexes);
        }
    }

    /**
     * Execute a named action. Detects reads vs writes via the action's effect on
     * storage: if local execution writes no pages, the result is returned immediately.
     * If pages are written, the action is treated as a mutation with optimistic local
     * execution and background server confirmation.
     *
     * Falls back to the server when the local store is empty or missing pages. Actions
     * defined with `serverOnly: true` skip the local optimistic path entirely and go
     * straight to the server.
     */
    async executeAction<N extends DatabaseActionName>(
        conn: DatabaseClientConnection,
        actionObject: DatabaseActionObject<N>,
    ): Promise<DatabaseActionOutput<N>> {
        const mutationId = generateId<DatabaseMutationId>();

        // Server-only actions (e.g. createTable) never run optimistically: they mint ids
        // and attach new per-table files server-side, so the client just routes them
        // straight to the server and applies the resulting pages (attaching any new
        // table).
        if (databaseActions[actionObject.name].serverOnly) {
            return await this.executeActionViaServer(conn, actionObject, mutationId);
        }

        let output: DatabaseActionOutput<N>;
        let writtenPages: ReadonlyDatabasePageSet;
        try {
            const executed = await this.executeActionAttachingTables(actionObject);
            output = executed.result;
            writtenPages = executed.writtenPages;
        } catch (error) {
            if (error instanceof PageMissingError) {
                return await this.executeActionViaServer(conn, actionObject, mutationId);
            }
            throw error;
        }

        if (writtenPages.size === 0) {
            // Pure read — no server round-trip needed.
            return output;
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

        return output;
    }

    /**
     * Execute a read-only action while tracking which database pages are read. Asserts
     * the action's `writeLevel` is `"none"`.
     *
     * On missing pages, falls back to the server, then retries locally to build an
     * accurate read-set.
     */
    async executeActionWithTracking<N extends DatabaseActionName>(
        conn: DatabaseClientConnection,
        actionObject: DatabaseActionObject<N>,
    ): Promise<{output: DatabaseActionOutput<N>; readPages: ReadonlyDatabasePageSet}> {
        assert(
            databaseActions[actionObject.name].writeLevel === "none",
            "executeActionWithTracking only supports read-only actions",
        );
        try {
            const {result, readPages, writtenPages} =
                await this.executeActionAttachingTables(actionObject);
            assert(writtenPages.size === 0, "executeActionWithTracking does not support writes");
            return {output: result, readPages};
        } catch (error) {
            if (!(error instanceof PageMissingError)) throw error;
            await this.executeActionViaServer(
                conn,
                actionObject,
                generateId<DatabaseMutationId>(),
                {returnResult: false},
            );
            return this.executeReadOnly(actionObject);
        }
    }

    private executeReadOnly<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ): {output: DatabaseActionOutput<N>; readPages: ReadonlyDatabasePageSet} {
        const {result, readPages, writtenPages} = this.database.executeAction(actionObject);
        assert(writtenPages.size === 0, "executeActionWithTracking does not support writes");
        return {output: result, readPages};
    }

    /**
     * Run an action against the local database, attaching any referenced per-db file
     * we have cached locally and retrying. A table whose pages aren't cached surfaces
     * as {@link PageMissingError} so callers fall back to the server, which attaches
     * and populates it.
     *
     * Assumes a failed attempt left no buffered writes: every action targets a single
     * per-db file and references it before writing, so an unattached table throws
     * before any write — making the retry safe to re-run from scratch.
     */
    private async executeActionAttachingTables<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ): Promise<DatabaseExecuteActionResult<N>> {
        for (;;) {
            try {
                return this.database.executeAction(actionObject);
            } catch (error) {
                if (!(error instanceof TableNotAttachedError)) throw error;
                if (!(await this.tryAttachCachedTable(error.tableId))) {
                    // We hold none of this table's pages locally, so we can't attach it (ATTACH reads
                    // the header page). Signal a page miss so the caller routes to the server, which
                    // attaches and populates the table.
                    throw new PageMissingError(0, error.tableId);
                }
            }
        }
    }

    /**
     * Attach `tableId`'s per-db file from the local cache so the current action can
     * read it without a server round-trip. Returns `false` — leaving the table
     * unattached — when the header page (page 0) isn't cached locally, since ATTACH
     * reads it.
     */
    private async tryAttachCachedTable(tableId: DatabaseTableId): Promise<boolean> {
        if (this.database.isAttached(tableId)) return true;
        const store = await this.openStore(tableId);
        // Re-check: a concurrent action may have attached it while we awaited the store
        // open.
        if (this.database.isAttached(tableId)) return true;
        if (store.readPage(0) === null) return false;
        this.database.attach(tableId);
        return true;
    }

    // -- Reactive actions ----------------------------------------------------

    private readonly reactiveActions = new Map<
        string,
        {
            readonly reactive: DatabaseReactive<DatabaseActionOutput<DatabaseActionName>>;
        }
    >();
    private pagesToInvalidate = new Map<DatabaseTableId, Set<number>>();
    private invalidationScheduled = false;

    /**
     * Register a reactive action. Executes the action with page tracking and returns
     * the initial output. When pages in the action's read-set are subsequently
     * written, the action re-executes and {@link notify} is called with the new
     * output. If re-execution fails, {@link reportError} is called with the error.
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
        this.unregisterReactiveAction(id);

        const reactive = this.database.createReactive(
            () => this.executeReadOnly(actionObject).output,
        );
        let reExecuting = false;
        const listener = () => {
            if (reExecuting) return;
            reExecuting = true;
            void (async () => {
                try {
                    notify(reactive.getSnapshot() as DatabaseActionOutput<N>);
                } catch {
                    try {
                        const {readPages} = await this.executeActionWithTracking(
                            conn,
                            actionObject,
                        );
                        this.database.invalidatePages(readPages);
                        notify(reactive.getSnapshot() as DatabaseActionOutput<N>);
                    } catch (error) {
                        reportError(error);
                    }
                } finally {
                    reExecuting = false;
                }
            })();
        };

        try {
            // Use the existing async fallback path to fetch missing pages and attach cached
            // per-table files before the synchronous reactive function runs.
            await this.executeActionWithTracking(conn, actionObject);
        } catch {
            // The reactive store still registers failed computations with an unknown
            // dependency set, so any later page write retries the action.
        }

        reactive.addListener(listener);
        this.reactiveActions.set(id, {reactive});

        try {
            return {ok: true, value: reactive.getSnapshot() as DatabaseActionOutput<N>};
        } catch (error) {
            return {ok: false, error};
        }
    }

    /**
     * Unregister a reactive action. Stops future invalidation notifications.
     */
    unregisterReactiveAction(id: string): void {
        const reactiveAction = this.reactiveActions.get(id);
        if (reactiveAction === undefined) return;
        reactiveAction.reactive.destroy();
        this.reactiveActions.delete(id);
    }

    private scheduleInvalidation(): void {
        if (this.invalidationScheduled) return;
        this.invalidationScheduled = true;
        queueMicrotask(() => {
            this.invalidationScheduled = false;
            const pages = this.pagesToInvalidate;
            this.pagesToInvalidate = new Map();
            this.database.invalidatePages(pages);
        });
    }

    // -- Page writes ---------------------------------------------------------

    /**
     * Write page diffs received from realtime events into the local OPFS stores,
     * skipping pages already at a newer version. If the `mutationId` matches a queued
     * optimistic mutation, removes it from the queue and replays the remaining
     * mutations. Automatically schedules invalidation for any reactive queries whose
     * read-set overlaps the written pages.
     */
    writePageDiffsFromRealtime(pageDiffs: DatabasePageDiffs, mutationId: DatabaseMutationId): void {
        const headIndex = this.optimisticQueue.findIndex(m => m.mutationId === mutationId);
        assert(
            headIndex === 0 || headIndex === -1,
            `unexpected mutation confirmation order: ${headIndex}`,
        );

        if (headIndex === 0) {
            this.optimisticQueue.shift();
        }

        // Drop the buffer (and SQLite's pager cache) so the pages we're about to write to
        // durable storage are observed on the next read.
        this.database.discardBuffer();

        let anyWritten = false;
        for (const [tableId, tableDiffs] of pageDiffs) {
            const store = this.storage.get(tableId);
            if (store === undefined) continue;
            for (const [pageIndex, {version, diff}] of tableDiffs.diffs) {
                const base = store.readPage(pageIndex);
                if (base === null) continue;
                const full = applyPageDiff(base.data, diff);
                if (store.writePageIfNewer(pageIndex, version, full)) {
                    if (!shouldIgnorePageInvalidation(pageIndex, diff)) {
                        this.addPageToInvalidate(tableId, pageIndex);
                        anyWritten = true;
                    }
                }
            }
            store.setServerFileSizeInPages(tableDiffs.fileSizeInPages);
            store.sync();
        }
        if (anyWritten) {
            this.scheduleInvalidation();
        }

        this.replayOptimisticQueue();
    }

    private applyServerPages(readPages: DatabasePages): void {
        // Caller is expected to have cleared the buffer (executeActionViaServer calls
        // discardBuffer before us) so storage mutations don't conflict with stale buffered
        // writes.
        this.database.assertBufferIsEmpty("applyServerPages");
        let anyWritten = false;
        for (const [tableId, tablePages] of readPages) {
            const store = this.storage.get(tableId);
            assert(
                store !== undefined,
                `executeActionServer response references unknown table ${tableId}`,
            );
            for (const [pageIndex, {version, data}] of tablePages) {
                if (store.writePageIfNewer(pageIndex, version, data)) {
                    this.addPageToInvalidate(tableId, pageIndex);
                    anyWritten = true;
                }
            }
            store.sync();
        }
        if (anyWritten) {
            this.scheduleInvalidation();
        }
    }

    private removeOptimisticMutation(mutationId: DatabaseMutationId): void {
        this.optimisticQueue = this.optimisticQueue.filter(m => m.mutationId !== mutationId);
        // The buffer still holds writes from the failed mutation (and any subsequent
        // queued mutations that ran on top of it). Drop it and rebuild from the remaining
        // queue.
        this.database.discardBuffer();
        this.replayOptimisticQueue();
    }

    private replayOptimisticQueue(): void {
        let anyInvalidated = false;
        this.optimisticQueue = this.optimisticQueue.filter(mutation => {
            try {
                const {writtenPages} = this.database.executeAction(mutation.action);
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
     * Adds optimistically written pages to {@link pagesToInvalidate}, filtering out
     * noise-only changes on page 0. Returns true if any pages were marked.
     */
    private markWrittenPages(writtenPages: ReadonlyDatabasePageSet): boolean {
        let anyMarked = false;
        const buffered = this.database.getBufferedWrites();
        for (const [tableId, tablePages] of writtenPages) {
            const store = this.storage.get(tableId);
            if (store === undefined) continue;
            for (const pageIndex of tablePages) {
                if (pageIndex === 0) {
                    const base = store.readPage(0);
                    const overlay = buffered?.pages.get(tableId)?.get(0);
                    if (base !== null && overlay !== undefined) {
                        const diff = diffPage(base.data, overlay);
                        if (shouldIgnorePageInvalidation(0, diff)) continue;
                    }
                }
                this.addPageToInvalidate(tableId, pageIndex);
                anyMarked = true;
            }
        }
        return anyMarked;
    }

    private addPageToInvalidate(tableId: DatabaseTableId, pageIndex: number): void {
        getOrSetDefaultMapValue(this.pagesToInvalidate, tableId, () => new Set()).add(pageIndex);
    }

    private invalidateForWrittenPages(writtenPages: ReadonlyDatabasePageSet): void {
        if (this.markWrittenPages(writtenPages)) {
            this.scheduleInvalidation();
        }
    }

    /**
     * Write loader-provided pages into the local OPFS stores before cache validation,
     * opening per-table stores on demand for tables that haven't been seen yet. No
     * invalidation is scheduled because no reactive actions exist yet.
     */
    async seedPages(pages: DatabasePages): Promise<void> {
        // seedPages runs at startup before ensureCacheIsUpToDate and any executeAction, so
        // the buffer must be empty.
        this.database.assertBufferIsEmpty("seedPages");
        for (const [tableId, tablePages] of pages) {
            const store = this.storage.get(tableId) ?? (await this.storage.create(tableId));
            for (const [pageIndex, {version, data}] of tablePages) {
                store.writePageIfNewer(pageIndex, version, data);
            }
            store.sync();
        }
    }

    /**
     * Open `tableId`'s per-db page store, registering it on the storage if it isn't
     * already. Deduped so concurrent callers share one async `storage.create` (which
     * yields).
     */
    private readonly openingStores = new Map<DatabaseTableId, Promise<OpfsPageStore>>();

    private openStore(tableId: DatabaseTableId): Promise<OpfsPageStore> {
        const existing = this.storage.get(tableId);
        if (existing !== undefined) return Promise.resolve(existing);
        return getOrSetDefaultMapValue(this.openingStores, tableId, () =>
            this.storage.create(tableId).finally(() => {
                this.openingStores.delete(tableId);
            }),
        );
    }

    /**
     * Ensure `tableId`'s per-db file has a local page store and is attached to the
     * SQLite connection. No-op if it is already attached. Used by the server-fallback
     * path, which supplies the table's pages, so it attaches unconditionally (unlike
     * {@link tryAttachCachedTable}, which only attaches when the header page is
     * already cached).
     */
    private readonly attachingTables = new Map<DatabaseTableId, Promise<void>>();

    private ensureTableAttached(tableId: DatabaseTableId): Promise<void> {
        if (this.database.isAttached(tableId)) return Promise.resolve();
        // Dedupe concurrent attaches of the same table: `openStore` yields, so without
        // this two callers could both pass the `isAttached` check and the second `attach`
        // would throw "already attached".
        return getOrSetDefaultMapValue(this.attachingTables, tableId, () =>
            (async () => {
                await this.openStore(tableId);
                if (!this.database.isAttached(tableId)) {
                    this.database.attach(tableId);
                }
            })().finally(() => {
                this.attachingTables.delete(tableId);
            }),
        );
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

        // Attach any table the server just told us about (e.g. a table this client
        // created) before touching the buffer. `ensureTableAttached` can await (it creates
        // the OPFS store), and there must be no `await` between `discardBuffer()` and
        // `applyServerPages()` below: a concurrent RPC handler (RPC handlers aren't
        // serialized, see DatabaseActiveTabWorker) could re-dirty the buffer in that
        // window and trip `assertBufferIsEmpty`. Attaching here is safe while the
        // optimistic buffer is still live — attach only adds the new table's empty page
        // store, never writes.
        if (serverResult.readPages !== null) {
            for (const tableId of serverResult.readPages.keys()) {
                await this.ensureTableAttached(tableId);
            }
        }

        // Writes from any pending optimistic mutations still live in the buffer; drop them
        // so the server pages we're about to apply are visible before we replay the queue
        // on top. From here through `replayOptimisticQueue()` runs synchronously — no
        // `await` — so the buffer can't be re-dirtied underneath us.
        this.database.discardBuffer();
        if (serverResult.readPages !== null) {
            this.applyServerPages(serverResult.readPages);
            const acknowledged = new Map<DatabaseTableId, Array<number>>();
            for (const [tableId, tablePages] of serverResult.readPages) {
                if (tablePages.size > 0) {
                    acknowledged.set(tableId, [...tablePages.keys()]);
                }
            }
            if (acknowledged.size > 0) {
                conn.acknowledgePages(acknowledged);
            }
        }
        this.replayOptimisticQueue();
        if (returnResult) {
            return (serverResult.result as DatabaseActionResult<N>).output;
        }
    }

    /**
     * Execute a migration locally without server interaction. Writes land in the
     * {@link Database} buffer; pair with {@link commitOptimisticPagesForTests} to
     * materialize them on disk. Use for test setup only.
     */
    executeLocallyForTests(migration: SqliteMigration): void {
        assert(import.meta.jest, "executeLocallyForTests is test-only");
        // The Database authorizer is permissive while idle (writeLevel === null), so
        // calling SQL directly on the underlying handle works for setup. Writes route
        // through the VFS and accumulate in the Database buffer — same as a real action
        // would.
        const db = this.database.unsafeGetDbForTests();
        if (typeof migration === "function") {
            migration(db);
        } else {
            db.exec(migration);
        }
    }

    /**
     * Drain the buffered writes onto disk so subsequent realtime/server events don't
     * clear test-setup writes and {@link extractOpfsPages}-style helpers can see them.
     * Test-only counterpart to {@link executeLocallyForTests}.
     */
    commitOptimisticPagesForTests(): void {
        assert(import.meta.jest, "commitOptimisticPagesForTests is test-only");
        const buffered = this.database.getBufferedWrites();
        if (buffered !== null) {
            const version = ++this.nextTestCommitVersion;
            for (const [tableId, pages] of buffered.pages) {
                const store = this.storage.get(tableId);
                if (store === undefined) continue;
                for (const [pageIndex, data] of pages) {
                    store.unsafeWritePageForTests(pageIndex, version, new Uint8Array(data));
                }
                store.setServerFileSizeInPages(buffered.fileSizesInPages.get(tableId)!);
                store.sync();
            }
        }
        this.database.markCommitted({skipReactiveInvalidationForTests: true});
    }

    /** Exposed for tests only. Do not use in production code. */
    unsafeGetDbForTests(): ReturnType<Database["unsafeGetDbForTests"]> {
        assert(import.meta.jest);
        return this.database.unsafeGetDbForTests();
    }
}
