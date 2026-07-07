import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import {OpfsDatabaseStorage} from "~/client/web/databases/worker/opfs_database_storage.js";
import type {OpfsPageStore} from "~/client/web/databases/worker/opfs_page_store.js";
import {Database, type DatabaseTrackedExecution} from "~/shared/databases/database.js";
import {DatabaseActionRequiresServerError} from "~/shared/databases/database_action_requires_server_error.js";
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
import {databaseMainTableId} from "~/shared/databases/sqlite_constants.js";
import {type SqliteMigration} from "~/shared/databases/sqlite_migrations.js";
import {TableNotAttachedError} from "~/shared/databases/table_not_attached_error.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
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
    close(): void;
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
     * subdirectory inside it. Every cached table's store is opened up front so
     * cold-open cache validation covers all of them and {@link ensureCacheIsUpToDate}
     * can attach every known table.
     */
    static async create(groupDir: OpfsDirectoryHandle): Promise<DatabaseClient> {
        const storage = new OpfsDatabaseStorage(groupDir);
        try {
            await storage.create(databaseMainTableId);
            for await (const name of groupDir.keys()) {
                const tableId = name as DatabaseTableId;
                if (storage.get(tableId) === undefined) {
                    await storage.create(tableId);
                }
            }
            const database = await Database.create(storage);
            return new DatabaseClient(database, storage);
        } catch (error) {
            // Any already-opened OPFS handles must be released so a retry isn't blocked by
            // OPFS's exclusive sync-access-handle lock.
            storage.close();
            throw error;
        }
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
     *
     * Once every store is validated, attaches all known tables (see {@link
     * attachKnownTables}) so subsequent actions run locally without any on-demand
     * attach step.
     *
     * Safe to call on a live database, not just at cold open: pending optimistic
     * writes and SQLite's pager cache are dropped before the validated pages land, the
     * optimistic queue is replayed on top of the fresh cache, and overlapping reactive
     * actions re-execute. The realtime layer relies on this after a reconnect, since
     * events broadcast while the socket was down are gone for good.
     */
    async ensureCacheIsUpToDate(conn: DatabaseClientConnection): Promise<void> {
        const pageVersionsByIndex = new Map<DatabaseTableId, Map<number, number>>();
        for (const [tableId, store] of this.storage) {
            const tableVersions = new Map<number, number>();
            for (const entry of store.pageEntries()) {
                tableVersions.set(entry.pageIndex, entry.version);
            }
            pageVersionsByIndex.set(tableId, tableVersions);
        }

        const {tables} = await conn.ensureCacheIsUpToDate(pageVersionsByIndex);

        // From here through `replayOptimisticQueue()` runs synchronously — no `await` — so
        // a concurrent handler can't re-dirty the buffer between the discard and the
        // replay. Dropping the buffer also drops SQLite's pager cache, so the pages
        // written below are observed on the next read.
        this.database.discardBuffer();

        let anyChanged = false;
        const acknowledgedPageIndexes = new Map<DatabaseTableId, Array<number>>();
        for (const [tableId, {updatedPages, stalePageIndexes, fileSizeInPages}] of tables) {
            const store = this.storage.get(tableId);
            assert(
                store !== undefined,
                `ensureCacheIsUpToDate response references unknown table ${tableId}`,
            );

            for (const [pageIndex, {version, data}] of updatedPages) {
                if (store.writePageIfNewer(pageIndex, version, data)) {
                    this.addPageToInvalidate(tableId, pageIndex);
                    anyChanged = true;
                }
            }
            if (updatedPages.size > 0) {
                acknowledgedPageIndexes.set(tableId, [...updatedPages.keys()]);
            }
            if (stalePageIndexes.length > 0) {
                store.deletePages(new Set(stalePageIndexes));
                for (const pageIndex of stalePageIndexes) {
                    this.addPageToInvalidate(tableId, pageIndex);
                }
                anyChanged = true;
            }
            store.setServerFileSizeInPages(fileSizeInPages);
            store.sync();
        }

        if (acknowledgedPageIndexes.size > 0) {
            conn.acknowledgePages(acknowledgedPageIndexes);
        }

        this.attachKnownTables();
        this.replayOptimisticQueue();
        if (anyChanged) {
            this.scheduleInvalidation();
        }
    }

    /**
     * Attach every open per-table store whose header page is cached. Runs after cache
     * validation — attaching before validation would let SQLite parse a schema from
     * pages about to be replaced, and (under `locking_mode = EXCLUSIVE`) attaching a
     * store with no header would permanently cache an empty schema.
     *
     * A cached table whose header page was discarded as stale stays unattached; its
     * first action falls back to the server, whose response re-populates and attaches
     * it (see {@link executeActionViaServer}).
     */
    private attachKnownTables(): void {
        for (const [tableId, store] of this.storage) {
            if (tableId === databaseMainTableId) continue;
            if (this.database.isAttached(tableId)) continue;
            if (store.readPage(0) === null) continue;
            this.database.attach(tableId);
        }
    }

    /**
     * Execute a named action. Detects reads vs writes via the action's effect on
     * storage: if local execution writes no pages, the result is returned immediately.
     * If pages are written, the action is treated as a mutation with optimistic local
     * execution and background server confirmation.
     *
     * Falls back to the server when the local store is missing pages or the action
     * references a table this client doesn't know about (every known table is attached
     * up front — see {@link attachKnownTables}). Actions that call `ctx.server()` for
     * server-only work (e.g. allocating an ID via `generateChronologicalId()`) throw
     * {@link DatabaseActionRequiresServerError} on the client, which routes them
     * straight to the server the same way.
     */
    async executeAction<N extends DatabaseActionName>(
        conn: DatabaseClientConnection,
        actionObject: DatabaseActionObject<N>,
    ): Promise<DatabaseActionOutput<N>> {
        if (databaseActions[actionObject.name].internalOnly) {
            throw new PermissionDeniedError(
                `Database action ${actionObject.name} is internal-only`,
            );
        }

        const mutationId = generateId<DatabaseMutationId>();

        let output: DatabaseActionOutput<N>;
        let writtenPages: ReadonlyDatabasePageSet;
        try {
            const executed = this.database.executeAction(actionObject);
            output = executed.result;
            writtenPages = executed.writtenPages;
        } catch (error) {
            if (isServerFallbackError(error)) {
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
     * On missing pages or unknown tables, falls back to the server, then retries
     * locally to build an accurate read-set.
     */
    async executeActionWithTracking<N extends DatabaseActionName>(
        conn: DatabaseClientConnection,
        actionObject: DatabaseActionObject<N>,
    ): Promise<{output: DatabaseActionOutput<N>; readPages: ReadonlyDatabasePageSet}> {
        if (databaseActions[actionObject.name].internalOnly) {
            throw new PermissionDeniedError(
                `Database action ${actionObject.name} is internal-only`,
            );
        }

        assert(
            databaseActions[actionObject.name].writeLevel === "none",
            "executeActionWithTracking only supports read-only actions",
        );
        try {
            return this.executeReadOnly(actionObject);
        } catch (error) {
            if (!isServerFallbackError(error)) throw error;
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

    // -- Reactive actions ----------------------------------------------------

    private readonly reactiveActions = new Map<
        string,
        {
            readonly execution: DatabaseTrackedExecution<DatabaseActionOutput<DatabaseActionName>>;
            readonly notify: () => void;
        }
    >();
    private pagesToInvalidate = new Map<DatabaseTableId, Set<number>>();
    private invalidationScheduled = false;

    /**
     * Register a reactive action. The shared {@link Database.createTrackedExecution}
     * object owns the cached result and read-page set. The client owns notifications
     * because only the client needs Store/RPC-style "tell me when to send a new value"
     * behavior.
     *
     * The result of each tracked execution is seeded into the shared object with
     * `setTrackedSnapshot()`. That preserves the old execution count: one execution to
     * register, one execution for each overlapping invalidation, and none for
     * non-overlapping invalidations.
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
            "reactive actions must have writeLevel none",
        );
        this.unregisterReactiveAction(id);

        const execution = this.database.createTrackedExecution(
            () => this.executeReadOnly(actionObject).output,
        );
        let reExecuting = false;

        const executeAndUpdateReactive = async (options: {
            seedUnknownDependenciesOnFailure: boolean;
        }): Promise<DatabaseActionOutput<N>> => {
            try {
                const {output, readPages} = await this.executeActionWithTracking(
                    conn,
                    actionObject,
                );
                execution.setTrackedSnapshot({ok: true, value: output}, readPages);
                return output;
            } catch (error) {
                if (options.seedUnknownDependenciesOnFailure) {
                    // Initial failures behave like the previous implementation: we retain an unknown
                    // dependency set so any future page write can retry the action.
                    execution.setTrackedSnapshot({ok: false, error}, null);
                }
                throw error;
            }
        };

        const notifyIfChanged = () => {
            if (reExecuting) return;
            reExecuting = true;
            void (async () => {
                try {
                    // We only call this after `execution.invalidateForPages()` returned true, meaning
                    // the previous read set overlapped written pages (or the previous execution failed
                    // and has an unknown dependency set). This matches the old `checkInvalidation()`
                    // behavior without putting listener semantics in `Database`.
                    notify(
                        await executeAndUpdateReactive({
                            seedUnknownDependenciesOnFailure: false,
                        }),
                    );
                } catch (error) {
                    reportError(error);
                } finally {
                    reExecuting = false;
                }
            })();
        };

        try {
            const output = await executeAndUpdateReactive({
                seedUnknownDependenciesOnFailure: true,
            });
            this.reactiveActions.set(id, {execution, notify: notifyIfChanged});
            return {ok: true, value: output};
        } catch (error) {
            this.reactiveActions.set(id, {execution, notify: notifyIfChanged});
            return {ok: false, error};
        }
    }

    /**
     * Unregister a reactive action. Stops future invalidation notifications.
     */
    unregisterReactiveAction(id: string): void {
        const reactiveAction = this.reactiveActions.get(id);
        if (reactiveAction === undefined) return;
        reactiveAction.execution.destroy();
        this.reactiveActions.delete(id);
    }

    private scheduleInvalidation(): void {
        if (this.invalidationScheduled) return;
        this.invalidationScheduled = true;
        queueMicrotask(() => {
            this.invalidationScheduled = false;
            const pages = this.pagesToInvalidate;
            this.pagesToInvalidate = new Map();
            for (const reactiveAction of this.reactiveActions.values()) {
                if (reactiveAction.execution.invalidateForPages(pages)) {
                    reactiveAction.notify();
                }
            }
        });
    }

    // -- Page writes ---------------------------------------------------------

    /**
     * Write page diffs received from realtime events into the local OPFS stores,
     * skipping pages already at a newer version and deleting pages whose cached
     * version doesn't match the diff's `previousVersion` (the base it was computed
     * against) so they're re-fetched instead of corrupted. If the `mutationId` matches
     * a queued optimistic mutation, removes it from the queue and replays the
     * remaining mutations. Automatically schedules invalidation for any reactive
     * queries whose read-set overlaps the written pages.
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
            const pagesToTombstone = new Map<number, number>();
            for (const [pageIndex, {previousVersion, version, diff}] of tableDiffs.diffs) {
                const base = store.readPage(pageIndex);
                if (base === null) continue;
                // Already at (or past) this diff's result — e.g. the full page arrived in an
                // earlier `executeAction` response.
                if (base.version >= version) continue;
                if (base.version !== previousVersion) {
                    // The diff was computed against a version this client never saw (an intervening
                    // update was missed, e.g. across a reconnect). Applying it here would fabricate a
                    // page state that never existed on the server, so drop the page instead — the next
                    // read misses and re-fetches it. The tombstone remembers `version` so a
                    // late-arriving older write (e.g. an in-flight `ensureCacheIsUpToDate` response
                    // snapshotted before this diff) can't resurrect the stale page.
                    pagesToTombstone.set(pageIndex, version);
                    this.addPageToInvalidate(tableId, pageIndex);
                    anyWritten = true;
                    continue;
                }
                const full = applyPageDiff(base.data, diff);
                if (store.writePageIfNewer(pageIndex, version, full)) {
                    if (!shouldIgnorePageInvalidation(pageIndex, diff)) {
                        this.addPageToInvalidate(tableId, pageIndex);
                        anyWritten = true;
                    }
                }
            }
            if (pagesToTombstone.size > 0) {
                store.tombstonePages(pagesToTombstone);
            }
            store.setServerFileSizeInPages(tableDiffs.fileSizeInPages);
            store.sync();
        }
        if (anyWritten) {
            this.scheduleInvalidation();
        }

        this.replayOptimisticQueue();
    }

    private applyServerPages(
        readPages: DatabasePages,
        fileSizesInPages: ReadonlyMap<DatabaseTableId, number> | null,
    ): void {
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
            // The response's pages may be a sparse subset of the table file, so the store must
            // serve the canonical file size rather than deriving one from the highest cached
            // page index (SQLite treats a file shorter than its header claims as corrupt).
            const fileSizeInPages = fileSizesInPages?.get(tableId);
            if (fileSizeInPages !== undefined) {
                store.setServerFileSizeInPages(fileSizeInPages);
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
     * invalidation is scheduled because no reactive actions exist yet. Seeded tables
     * are attached by the {@link ensureCacheIsUpToDate} call that follows at cold
     * open.
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
     * Write loader-provided pages into the local stores after the client is already
     * running, opening per-table stores on demand for tables that haven't been seen
     * yet. Unlike {@link seedPages} this may run while optimistic mutations are
     * buffered, so it drops the buffer, writes the newer pages, replays the optimistic
     * queue, and schedules invalidation for affected reactive actions.
     */
    async writeLoaderPages(pages: DatabasePages): Promise<void> {
        this.database.discardBuffer();
        let anyWritten = false;
        for (const [tableId, tablePages] of pages) {
            const store = await this.openStore(tableId);
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
        this.replayOptimisticQueue();
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

        // Open a page store for any table the server just told us about (e.g. a table this
        // client created) before touching the buffer. `openStore` can await (it creates
        // the OPFS store), and there must be no `await` between `discardBuffer()` and
        // `replayOptimisticQueue()` below: worker RPC handlers aren't serialized, so a
        // concurrent handler could re-dirty the buffer in that window and trip
        // `assertBufferIsEmpty`. Opening a store is safe while the optimistic buffer is
        // still live — it performs no reads or writes.
        //
        // The ATTACH itself is deferred until after `applyServerPages()`: attaching while
        // the local store is still empty makes SQLite parse (and, under
        // `locking_mode = EXCLUSIVE`, permanently cache) an empty schema, breaking every
        // later local reference to the table.
        if (serverResult.readPages !== null) {
            for (const tableId of serverResult.readPages.keys()) {
                await this.openStore(tableId);
            }
        }

        // Writes from any pending optimistic mutations still live in the buffer; drop them
        // so the server pages we're about to apply are visible before we replay the queue
        // on top. From here through `replayOptimisticQueue()` runs synchronously — no
        // `await` — so the buffer can't be re-dirtied underneath us.
        this.database.discardBuffer();
        if (serverResult.readPages !== null) {
            this.applyServerPages(serverResult.readPages, serverResult.fileSizesInPages);
            const acknowledged = new Map<DatabaseTableId, Array<number>>();
            for (const [tableId, tablePages] of serverResult.readPages) {
                if (tablePages.size > 0) {
                    acknowledged.set(tableId, [...tablePages.keys()]);
                }
            }
            if (acknowledged.size > 0) {
                conn.acknowledgePages(acknowledged);
            }

            // Attach new tables now that their pages are on disk, so SQLite parses the real
            // schema. `attach` is synchronous, keeping the no-await window intact. Skip a
            // table whose header page still isn't cached (the server response didn't cover
            // it): attaching would poison the schema cache, while leaving it unattached just
            // routes its next action through the server again.
            for (const tableId of serverResult.readPages.keys()) {
                if (this.database.isAttached(tableId)) continue;
                const store = this.storage.get(tableId);
                if (store !== undefined && store.readPage(0) !== null) {
                    this.database.attach(tableId);
                }
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
            migration.exec(db);
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

/**
 * Whether a local execution error means "route this action to the server": the
 * store is missing a cached page, the action references a table this client holds
 * no pages for (so it was never attached — see {@link
 * DatabaseClient.ensureCacheIsUpToDate}), or the action explicitly requires the
 * server (e.g. it calls `ctx.server()` for server-only work). The server response
 * supplies any missing pages, attaching any new table, so later executions run
 * locally.
 */
function isServerFallbackError(error: unknown): boolean {
    return (
        error instanceof DatabaseActionRequiresServerError || error instanceof TableNotAttachedError
    );
}
