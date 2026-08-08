import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import {OpfsDatabaseStorage} from "~/client/web/databases/worker/opfs_database_storage.js";
import type {OpfsPageStore} from "~/client/web/databases/worker/opfs_page_store.js";
import type {AccessLevel} from "~/shared/access/access_policy.js";
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
    DatabaseExecuteActionResponse,
    DatabasePageDiffs,
    DatabasePages,
    DatabaseRegisterTablesResult,
    DatabaseTableRegistration,
    DatabaseTableRegistrationResults,
    DatabaseTableRegistrations,
    ReadonlyDatabasePageSet,
} from "~/shared/databases/database_protocol_schemas.js";
import {
    applyPageDiff,
    diffPage,
    shouldIgnorePageInvalidation,
} from "~/shared/databases/page_diff.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {type SqliteMigration} from "~/shared/databases/sqlite_migrations.js";
import {DatabaseTableNotAttachedError} from "~/shared/databases/table_not_attached_error.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import type {Result} from "~/shared/helpers/control/result.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {DatabaseMutationId, DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

interface OptimisticMutation {
    mutationId: DatabaseMutationId;
    action: DatabaseActionObject;
}

const emptyDatabasePage = new Uint8Array(sqlitePageSize);

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
            registerTables: DatabaseTableRegistrations;
        },
    ): Promise<DatabaseExecuteActionResponse>;
    registerTables(tables: DatabaseTableRegistrations): Promise<DatabaseRegisterTablesResult>;
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
    // The wrapped SQLite database. Every read and optimistic write routes through it;
    // it reaches pages through `storage` via the OPFS-backed VFS.
    private readonly database: Database;
    // Durable OPFS-backed page storage the `Database` reads through, and the handle
    // used to open and enumerate per-table stores.
    private readonly storage: OpfsDatabaseStorage;
    // The group's OPFS directory. Each table's page store lives in a `{tableId}/`
    // subdirectory inside it.
    private readonly groupDir: OpfsDirectoryHandle;
    // Tables the server has confirmed this client may serve locally in the current
    // connection epoch. `storage`'s read gate rejects any unregistered table,
    // diverting its reads to a server fallback.
    private readonly registeredTables: Set<DatabaseTableId>;
    // Memoized cached-table registration for the current connection epoch (reset in
    // `beginDisconnectedConnectionEpoch`). See {@link ensureCachedTablesRegistered}.
    private pendingRegistration: Promise<void> | undefined;
    // Bumped on every disconnect. Async work captures it up front and bails if it no
    // longer matches, so results that span a reconnect are discarded, not applied.
    private connectionEpoch = 0;
    // Memoizes the one-time lazy enumeration of the group dir's cached table stores.
    private cachedTableIdsPromise: Promise<ReadonlySet<DatabaseTableId>> | undefined;
    // Optimistic mutations executed locally but not yet confirmed by the server, in
    // apply order. Replayed on top of realtime page diffs and removed as the server
    // confirms or rejects each one.
    private optimisticQueue: Array<OptimisticMutation> = [];
    // Test-only monotonic page version for `commitOptimisticPagesForTests`.
    private nextTestCommitVersion = 0;
    /**
     * The account's per-table access map, pushed by the server: merged from table
     * registration responses (including joined sides) and from deltas carried on
     * `TableMetadataChanged` events (see {@link applyTableAccessLevels}). Advisory —
     * the server's per-statement authorizer is the enforcement — but it's the client's
     * only source of "exists but no access", e.g. for rendering a relation into a
     * table this account can't read.
     */
    private tableAccessLevelByTableId = new Map<DatabaseTableId, AccessLevel | null>();

    private constructor(
        database: Database,
        storage: OpfsDatabaseStorage,
        groupDir: OpfsDirectoryHandle,
        registeredTables: Set<DatabaseTableId>,
    ) {
        this.database = database;
        this.storage = storage;
        this.groupDir = groupDir;
        this.registeredTables = registeredTables;
    }

    /**
     * Open the SQLite database for a database group. The given `groupDir` is the
     * per-group OPFS directory: each table's page store lives in a `{tableId}/`
     * subdirectory inside it. Only the main store is opened here; the remaining cached
     * stores are enumerated once, lazily, when local execution first needs
     * registration or a server fallback.
     */
    static async create(groupDir: OpfsDirectoryHandle): Promise<DatabaseClient> {
        const registeredTables = new Set<DatabaseTableId>();
        let enforceRegistration = false;
        const storage = new OpfsDatabaseStorage(
            groupDir,
            tableId => !enforceRegistration || registeredTables.has(tableId),
        );
        try {
            await storage.create(databaseMainTableId);
            const database = await Database.create(storage);
            const client = new DatabaseClient(database, storage, groupDir, registeredTables);
            enforceRegistration = true;
            // `Database.create` necessarily touched the main pager while registration
            // enforcement was disabled. Drop that bootstrap cache so the first real table read
            // re-enters storage and observes the per-table gate.
            database.discardBuffer();
            return client;
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
     * Invalidate the current connection epoch. Local reads are gated immediately and
     * optimistic writes remain queued, but their buffer is removed until the new
     * connection catches the durable cache up.
     */
    beginDisconnectedConnectionEpoch(): void {
        this.connectionEpoch++;
        this.pendingRegistration = undefined;
        this.registeredTables.clear();
        this.database.discardBuffer();
        for (const [tableId] of this.storage) {
            if (tableId !== databaseMainTableId) {
                this.database.detachTableIfAttached(tableId);
            }
        }
    }

    /**
     * Register every cached table with the server for the current connection epoch so
     * local reads can be trusted, catching each table up on any realtime events missed
     * while the socket was down (events broadcast while disconnected are gone for
     * good).
     *
     * Memoized per epoch (reset in {@link beginDisconnectedConnectionEpoch}): the
     * connection manager primes it on every (re)connect and every action execution
     * awaits the same promise, so a burst of cold reads collapses into a single
     * registration round trip instead of each racing ahead into its own server
     * fallback. The connection retries transient transport failures. A terminal
     * registration failure is reported and swallowed so the promise never rejects; the
     * tables stay unregistered and the next action's server fallback re-registers them
     * alongside the action. Callers await this to close the connect race, not to gate
     * on its success.
     */
    ensureCachedTablesRegistered(conn: DatabaseClientConnection): Promise<void> {
        return (this.pendingRegistration ??= this.registerCachedTables(conn).catch(error => {
            conn.reportError(error);
        }));
    }

    private async registerCachedTables(conn: DatabaseClientConnection): Promise<void> {
        await this.openCachedStores();
        const connectionEpoch = this.connectionEpoch;
        const registrations = this.getUnregisteredCachedTables();
        if (registrations.size === 0) return;
        const result = await conn.registerTables(registrations);
        await this.applyStandaloneRegistrationResult(result, connectionEpoch);
    }

    /**
     * Merge a `TableMetadataChanged` access delta into the map (see {@link
     * tableAccessLevelByTableId}) and purge any table the delta revoked. Registration
     * catch-up disables immediate optimistic replay so it can replay once, after all
     * requested tables have been marked registered.
     */
    async applyTableAccessLevels(
        tableAccess: ReadonlyMap<DatabaseTableId, AccessLevel | null>,
        options: {replayOptimisticQueue?: boolean} = {},
    ): Promise<void> {
        for (const [tableId, level] of tableAccess) {
            this.tableAccessLevelByTableId.set(tableId, level);
            if (level === null) {
                this.registeredTables.delete(tableId);
            }
        }
        await this.purgeRevokedTables({
            replayOptimisticQueue: options.replayOptimisticQueue ?? true,
        });
    }

    /**
     * Best-effort local purge of every cached table the access map now reports `null`
     * for: detach its per-table file from SQLite (dropping buffered writes to it),
     * delete its pages from OPFS, and re-run reactive queries that read them. The
     * server stops replicating a revoked table on its own; this removes the copies
     * that already reached this device.
     *
     * Best-effort by nature — the account may simply never come back online — so a
     * table whose schema an open transaction has locked is skipped and retried on the
     * next access-map push.
     */
    private async purgeRevokedTables(options: {replayOptimisticQueue: boolean}): Promise<void> {
        const dirRemovals: Array<Promise<void>> = [];
        let hasRevokedStore = false;
        for (const [tableId, store] of [...this.storage]) {
            if (tableId === databaseMainTableId) continue;
            if (this.getTableAccessLevel(tableId) !== null) continue;
            hasRevokedStore = true;
            for (const {pageIndex} of store.pageEntries()) {
                this.addPageToInvalidate(tableId, pageIndex);
            }
            if (!this.database.detachTableIfAttached(tableId)) continue;
            dirRemovals.push(this.storage.delete(tableId));
        }
        if (!hasRevokedStore) return;

        // Queued optimistic mutations may have written to a purged table. Always drop
        // their current buffer; realtime access deltas replay immediately so denied
        // mutations fall out, while registration callers defer replay until catch-up has
        // marked the surviving tables registered.
        this.database.discardBuffer();
        if (options.replayOptimisticQueue) {
            this.replayOptimisticQueue();
        }
        this.scheduleInvalidation();
        await runAllPromises(dirRemovals);
    }

    /**
     * The account's access to `tableId` per the server-pushed map. Tables absent from
     * the map report `Manage`: trusted internal connections (tests, tools) receive
     * empty maps, and a real client's map covers every table it has cached or been
     * told about — so absence means the client never touched the table, an attempt is
     * the way to learn, and the server's authorizer is the enforcement either way.
     */
    readonly getTableAccessLevel = (tableId: DatabaseTableId): AccessLevel | null => {
        if (tableId === databaseMainTableId) return "Manage";
        const accessLevel = this.tableAccessLevelByTableId.get(tableId);
        return accessLevel === undefined ? "Manage" : accessLevel;
    };

    /**
     * Execute a named action. Detects reads vs writes via the action's effect on
     * storage: if local execution writes no pages, the result is returned immediately.
     * If pages are written, the action is treated as a mutation with optimistic local
     * execution and background server confirmation.
     *
     * Falls back to the server when the local store is missing pages or the action
     * references a table with no locally cached pages (registered tables attach
     * eagerly up to capacity and on demand past it). Actions that call `ctx.server()`
     * for server-only work (e.g. allocating an ID via `generateChronologicalId()`)
     * throw {@link DatabaseActionRequiresServerError} on the client, which routes them
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

        // Await the epoch's cached-table registration so an action issued right after
        // connect runs locally instead of racing ahead into a redundant server fallback
        // (resolves instantly once primed).
        await this.ensureCachedTablesRegistered(conn);

        let output: DatabaseActionOutput<N>;
        let writtenPages: ReadonlyDatabasePageSet;
        try {
            const executed = this.executeActionLocally(actionObject);
            output = executed.result;
            writtenPages = executed.writtenPages;
        } catch (error) {
            // Cached tables are registered above, so a local miss here means the action needs
            // a table this client has no cached pages for (or needs server-only work). Route
            // it to the server, which registers any newly discovered tables in the same round
            // trip.
            if (!isServerFallbackError(error)) throw error;
            return await this.executeActionViaServer(conn, actionObject, mutationId);
        }

        if (writtenPages.size === 0) {
            // Pure read — no server round-trip needed.
            return output;
        }

        this.optimisticQueue.push({mutationId, action: actionObject});
        if (this.markWrittenPages(writtenPages)) {
            this.scheduleInvalidation();
        }

        // Send to server in the background.
        void (async () => {
            try {
                await conn.executeActionServer(actionObject, {
                    mutationId,
                    returnResult: false,
                    returnPages: false,
                    registerTables: new Map(),
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
        // Await the epoch's cached-table registration so a read issued right after connect
        // runs locally instead of racing ahead into a redundant server fallback (resolves
        // instantly once primed).
        await this.ensureCachedTablesRegistered(conn);
        let serverFallbackCount = 0;
        for (;;) {
            try {
                return this.executeActionLocallyReadOnly(actionObject);
            } catch (error) {
                if (!isServerFallbackError(error)) throw error;
                // A server execution can discover only the first edge of a join/table dependency
                // graph. Permit one additional round for the local retry to name the newly exposed
                // dependency, but fail after that bounded fan-out.
                if (serverFallbackCount >= 2) throw error;
                serverFallbackCount++;
                await this.executeActionViaServer(
                    conn,
                    actionObject,
                    generateId<DatabaseMutationId>(),
                    {returnResult: false},
                );
            }
        }
    }

    private executeActionLocallyReadOnly<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ): {output: DatabaseActionOutput<N>; readPages: ReadonlyDatabasePageSet} {
        assert(
            databaseActions[actionObject.name].writeLevel === "none",
            "read-only actions must have writeLevel none",
        );
        const {result, readPages, writtenPages} = this.executeActionLocally(actionObject);
        assert(writtenPages.size === 0, "executeActionWithTracking does not support writes");
        return {output: result, readPages};
    }

    private executeActionLocally<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ) {
        return this.database.executeAction(actionObject, {
            getTableAccessLevel: this.getTableAccessLevel,
        });
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
            () => this.executeActionLocallyReadOnly(actionObject).output,
            {getTableAccessLevel: this.getTableAccessLevel},
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
                let baseData: Uint8Array;
                if (base === null) {
                    // The server diffs a newly allocated page against a zero-filled SQLite page.
                    // Materialize that exact base so inserts which append/split a page land in the
                    // sparse cache directly from realtime. Older pages with an unknown base still wait
                    // for a full-page fallback.
                    if (previousVersion !== 0) continue;
                    baseData = emptyDatabasePage;
                } else {
                    // Already at (or past) this diff's result — e.g. the full page arrived in an
                    // earlier `executeAction` response.
                    if (base.version >= version) continue;
                    if (base.version !== previousVersion) {
                        // The diff was computed against a version this client never saw (an intervening
                        // update was missed, e.g. across a reconnect). Applying it here would fabricate a
                        // page state that never existed on the server, so drop the page instead — the next
                        // read misses and re-fetches it. The tombstone remembers `version` so a
                        // late-arriving older write (e.g. an in-flight action response snapshotted before
                        // this diff) can't resurrect the stale page.
                        pagesToTombstone.set(pageIndex, version);
                        this.addPageToInvalidate(tableId, pageIndex);
                        anyWritten = true;
                        continue;
                    }
                    baseData = base.data;
                }
                const full = applyPageDiff(baseData, diff);
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
            // Advance even when every diff was skipped or the batch is an event stub: the
            // event version still proves the cache observed that server snapshot.
            this.advanceStoreSnapshot(store, tableDiffs.version, tableDiffs.fileSizeInPages);
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
        // Capture every page in the current overlay before throwing it away. Replaying the
        // remaining queue marks its new after-images, but pages changed only by the failed
        // mutation are reverting to durable storage and must invalidate reactive reads
        // too.
        const buffered = this.database.getBufferedWrites();
        let anyRevertedPageMarked = false;
        if (buffered !== null) {
            const revertedPages = new Map<DatabaseTableId, Set<number>>();
            for (const [tableId, pages] of buffered.pages) {
                revertedPages.set(tableId, new Set(pages.keys()));
            }
            anyRevertedPageMarked = this.markWrittenPages(revertedPages);
        }
        this.optimisticQueue = this.optimisticQueue.filter(m => m.mutationId !== mutationId);
        // The buffer still holds writes from the failed mutation (and any subsequent
        // queued mutations that ran on top of it). Drop it and rebuild from the remaining
        // queue.
        this.database.discardBuffer();
        this.replayOptimisticQueue();
        if (anyRevertedPageMarked) {
            this.scheduleInvalidation();
        }
    }

    private replayOptimisticQueue(): void {
        let anyInvalidated = false;
        this.optimisticQueue = this.optimisticQueue.filter(mutation => {
            try {
                const {writtenPages} = this.database.executeAction(mutation.action, {
                    getTableAccessLevel: this.getTableAccessLevel,
                });
                if (this.markWrittenPages(writtenPages)) {
                    anyInvalidated = true;
                }
                return true;
            } catch (error) {
                if (
                    error instanceof DatabaseTableNotAttachedError &&
                    !this.registeredTables.has(error.tableId) &&
                    this.getTableAccessLevel(error.tableId) !== null
                ) {
                    return true;
                }
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

    /** Open every store found in the one-time lazy group-directory enumeration. */
    private async openCachedStores(): Promise<void> {
        if (this.cachedTableIdsPromise === undefined) {
            this.cachedTableIdsPromise = (async () => {
                const tableIds = new Set<DatabaseTableId>();
                for await (const name of this.groupDir.keys()) {
                    tableIds.add(name as DatabaseTableId);
                }
                return tableIds;
            })();
        }
        const tableIds = await this.cachedTableIdsPromise;
        await runAllPromises([...tableIds].map(tableId => this.openStore(tableId)));
    }

    private getUnregisteredCachedTables(): DatabaseTableRegistrations {
        const registrations = new Map<DatabaseTableId, DatabaseTableRegistration>();
        for (const [tableId, store] of this.storage) {
            if (this.registeredTables.has(tableId)) continue;
            const heldPages = store.getHeldPagesBitset();
            if (heldPages.isEmpty()) continue;
            registrations.set(tableId, {
                watermark: store.getWatermark(),
                heldPages,
            });
        }
        return registrations;
    }

    private async applyStandaloneRegistrationResult(
        result: DatabaseRegisterTablesResult,
        connectionEpoch: number,
    ): Promise<boolean> {
        if (connectionEpoch !== this.connectionEpoch) return false;
        await this.applyTableAccessLevels(result.tableAccess, {replayOptimisticQueue: false});
        if (connectionEpoch !== this.connectionEpoch) return false;
        this.database.discardBuffer();
        this.applyRegistrationResults(result.tables);
        this.replayOptimisticQueue();
        return true;
    }

    /**
     * Apply table-level snapshot metadata without allowing an older response to roll
     * file size backward after a newer realtime event.
     */
    private advanceStoreSnapshot(
        store: OpfsPageStore,
        watermark: number,
        fileSizeInPages: number,
    ): void {
        if (watermark < store.getWatermark()) return;
        store.setServerFileSizeInPages(fileSizeInPages);
        store.setWatermark(watermark);
    }

    /**
     * Apply registration catch-up while the database buffer is empty. This method is
     * synchronous so no action can interleave between the cache update and optimistic
     * replay.
     */
    private applyRegistrationResults(results: DatabaseTableRegistrationResults): void {
        this.database.assertBufferIsEmpty("applyRegistrationResults");
        let anyChanged = false;
        for (const [tableId, result] of results) {
            const store = this.storage.get(tableId);
            assert(
                store !== undefined,
                `registration response references unknown table ${tableId}`,
            );
            switch (result.catchUp.type) {
                case "current":
                    break;
                case "pages":
                    for (const [pageIndex, {version, data}] of result.catchUp.pages) {
                        if (store.writePageIfNewer(pageIndex, version, data)) {
                            this.addPageToInvalidate(tableId, pageIndex);
                            anyChanged = true;
                        }
                    }
                    break;
                case "stale": {
                    // Unlike inline pages, stale page indexes have no versions with which to resolve a
                    // race against a newer realtime event.
                    if (result.watermark < store.getWatermark()) break;
                    const pages = new Map<number, number>();
                    for (const pageIndex of result.catchUp.pageIndexes) {
                        const page = store.readPage(pageIndex);
                        if (page !== null) {
                            // `stale` only names pages the registration said it held. The next canonical image
                            // must be newer than that held version, but can legitimately be older than the
                            // table's global watermark.
                            pages.set(pageIndex, page.version + 1);
                        }
                        this.addPageToInvalidate(tableId, pageIndex);
                    }
                    if (pages.size > 0) {
                        store.tombstonePages(pages);
                        anyChanged = true;
                    }
                    break;
                }
                default:
                    throw exhaustive(result.catchUp);
            }
            this.advanceStoreSnapshot(store, result.watermark, result.fileSizeInPages);
            store.sync();
            this.registeredTables.add(tableId);
            this.attachRegisteredTableIfPossible(tableId, store);
        }
        if (anyChanged) this.scheduleInvalidation();
    }

    private attachRegisteredTableIfPossible(tableId: DatabaseTableId, store: OpfsPageStore): void {
        if (tableId === databaseMainTableId || this.database.isAttached(tableId)) return;
        if (store.readPage(0) !== null) this.database.attach(tableId);
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
        await this.openCachedStores();
        const registerTables = this.getUnregisteredCachedTables();
        const connectionEpoch = this.connectionEpoch;
        const serverResult = await conn.executeActionServer(actionObject, {
            mutationId,
            returnResult,
            registerTables,
        });
        if (connectionEpoch !== this.connectionEpoch) {
            if (returnResult) {
                return (serverResult.result as DatabaseActionResult<N>).output;
            }
            return;
        }

        // Open every newly discovered table before the synchronous discard/apply/replay
        // window below.
        const tablesToOpen = new Set<DatabaseTableId>(serverResult.registeredTables.tables.keys());
        if (serverResult.readPages !== null) {
            for (const tableId of serverResult.readPages.keys()) {
                tablesToOpen.add(tableId);
            }
        }
        for (const tableId of serverResult.readPagesSnapshotVersion.keys()) {
            tablesToOpen.add(tableId);
        }
        await runAllPromises([...tablesToOpen].map(tableId => this.openStore(tableId)));
        if (connectionEpoch !== this.connectionEpoch) {
            if (returnResult) {
                return (serverResult.result as DatabaseActionResult<N>).output;
            }
            return;
        }
        await this.applyTableAccessLevels(serverResult.registeredTables.tableAccess, {
            replayOptimisticQueue: false,
        });
        if (connectionEpoch !== this.connectionEpoch) {
            if (returnResult) {
                return (serverResult.result as DatabaseActionResult<N>).output;
            }
            return;
        }

        this.database.discardBuffer();
        this.applyRegistrationResults(serverResult.registeredTables.tables);
        if (serverResult.readPages !== null) {
            this.applyServerPages(serverResult.readPages);
        }
        for (const [tableId, watermark] of serverResult.readPagesSnapshotVersion) {
            const store = this.storage.get(tableId);
            assert(store !== undefined, `action response references unknown table ${tableId}`);
            const fileSizeInPages = serverResult.fileSizesInPages?.get(tableId);
            if (fileSizeInPages !== undefined) {
                this.advanceStoreSnapshot(store, watermark, fileSizeInPages);
            }
            store.sync();
            this.registeredTables.add(tableId);
            this.attachRegisteredTableIfPossible(tableId, store);
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
        this.registeredTables.add(databaseMainTableId);
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
                store.setServerFileSizeInPages(
                    assertExists(buffered.fileSizesInPages.get(tableId)),
                );
                store.sync();
                this.registeredTables.add(tableId);
            }
        }
        this.database.markCommitted({skipReactiveInvalidationForTests: true});
    }

    /**
     * Open a page store for `tableId` and attach its (empty) per-table file, so tests
     * can populate it via {@link executeLocallyForTests}. Test-only.
     */
    async attachTableForTests(tableId: DatabaseTableId): Promise<void> {
        assert(import.meta.jest, "attachTableForTests is test-only");
        await this.storage.create(tableId);
        this.registeredTables.add(databaseMainTableId);
        this.registeredTables.add(tableId);
        this.database.attach(tableId);
    }

    /** Mark an existing store registered without touching SQLite. Tests only. */
    registerTableForTests(tableId: DatabaseTableId): void {
        assert(import.meta.jest, "registerTableForTests is test-only");
        assert(this.storage.get(tableId) !== undefined, `unknown test table ${tableId}`);
        this.registeredTables.add(tableId);
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
 * no pages for (so it was never attached), or the action explicitly requires the
 * server (e.g. it calls `ctx.server()` for server-only work). The server response
 * supplies any missing pages, attaching any new table, so later executions run
 * locally.
 */
function isServerFallbackError(error: unknown): boolean {
    return (
        error instanceof DatabaseActionRequiresServerError ||
        error instanceof DatabaseTableNotAttachedError
    );
}
