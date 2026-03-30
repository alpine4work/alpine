import type {
    DatabaseWorkerConnection,
    ReactiveActionHandle,
} from "~/client/web/databases/database_active_tab_manager.js";
import {VirtualizedTree} from "~/client/web/virtualized/helpers/virtualized_tree.js";
import type {DatabaseActionOutput} from "~/shared/databases/database_actions.js";
import {databaseViewTargetRowsPerPage} from "~/shared/databases/sqlite_constants.js";
import {PromiseQueue} from "~/shared/helpers/async/promise_queue.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseRowId} from "~/shared/id/types/id_types.js";
import {computeStore} from "~/shared/store/compute_store.js";
import type {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

type DatabaseQueryPage = {
    readonly pageId: number;
    readonly afterCursor: DatabaseRowId | null;
    readonly endCursor: DatabaseRowId | null;
    readonly rows: ReadonlyArray<Record<string, unknown>>;
};

type DatabaseQueryRow = Record<string, unknown>;

type PageWatch = {
    readonly handle: ReactiveActionHandle;
    readonly removeListener: () => void;
};

/**
 * Manages cursor-based paginated queries for a database
 * view. Each page becomes an independent reactive
 * subscription backed by `getViewRowsPage`. Uses
 * `VirtualizedTree` (pages as nodes, rows as items) for
 * efficient indexed access from `VirtualizedScrollView`.
 *
 * Pages are automatically rebalanced when they grow past
 * 1.5x the target size (split) or shrink below 0.5x
 * (merge with a neighbor). Rebalancing is deferred to an
 * idle callback so it doesn't block reactive updates.
 *
 * Create synchronously via the constructor (safe during
 * render), then call `listen()` in an effect to start
 * reactive subscriptions and `dispose()` to tear them
 * down.
 */
export class DatabaseQuery {
    private readonly tableOrViewId: string;
    private readonly _initialEndCursor: DatabaseRowId | null;
    private readonly _targetRowsPerPage: number;
    private readonly _splitThreshold: number;
    private readonly _mergeThreshold: number;
    private readonly _scheduleRebalance: (cb: () => void) => void;
    private readonly _watches = new Map<number, PageWatch>();
    private readonly _queue = new PromiseQueue();
    private conn: DatabaseWorkerConnection | null = null;
    private _disposed = false;
    private _nextPageId = 0;
    private _initialPageId: number | null = null;
    private _rebalanceScheduled = false;

    readonly treeStore: ValueStore<VirtualizedTree<number, DatabaseQueryPage, DatabaseQueryRow>>;
    readonly needsMoreStore: Store<boolean>;
    readonly isLoadingMoreStore: ValueStore<boolean>;

    constructor(options: {
        tableOrViewId: string;
        initialPage?: {
            endCursor: DatabaseRowId | null;
            rows: ReadonlyArray<unknown>;
        };
        _targetRowsPerPage?: number;
        _scheduleRebalance?: (cb: () => void) => void;
    }) {
        this.tableOrViewId = options.tableOrViewId;
        this._targetRowsPerPage = options._targetRowsPerPage ?? databaseViewTargetRowsPerPage;
        this._splitThreshold = Math.floor(1.5 * this._targetRowsPerPage);
        this._mergeThreshold = Math.floor(0.5 * this._targetRowsPerPage);
        this._scheduleRebalance = options._scheduleRebalance ?? defaultScheduleRebalance;
        this.treeStore = new ValueStore(newEmptyTree());
        this._initialEndCursor = options.initialPage?.endCursor ?? null;
        this.isLoadingMoreStore = new ValueStore(false);

        // Derived: true when the last node has a bounded
        // endCursor, meaning more pages can be loaded.
        this.needsMoreStore = computeStore(get => {
            const tree = get(this.treeStore);
            const lastNode = tree.getLastNodeIfExists();
            return lastNode != null && lastNode.endCursor != null;
        });

        if (options.initialPage && options.initialPage.rows.length > 0) {
            const pageId = this.allocatePageId();
            this._initialPageId = pageId;
            const page: DatabaseQueryPage = {
                pageId,
                afterCursor: null,
                endCursor: options.initialPage.endCursor as DatabaseRowId | null,
                rows: options.initialPage.rows as ReadonlyArray<Record<string, unknown>>,
            };
            this.treeStore.set(tree => tree.insertNodesAtEnd([page]));
        }
    }

    private allocatePageId(): number {
        return this._nextPageId++;
    }

    /**
     * Start reactive subscriptions. Call from an effect
     * after the connection is available. Seeds OPFS pages
     * from SSR data and begins watching the initial page.
     */
    listen(options: {
        conn: DatabaseWorkerConnection;
        readPages?: ReadonlyMap<number, {readonly timestamp: number; readonly data: Uint8Array}>;
    }): void {
        this.conn = options.conn;
        this._disposed = false;

        if (options.readPages && options.readPages.size > 0) {
            void this.conn.call("writeInitialPages", {
                pages: Array.from(options.readPages, ([pageIndex, {timestamp, data}]) => ({
                    pageIndex,
                    timestamp,
                    data,
                })),
            });
        }

        // If we have initial data, start watching the first
        // page reactively. Reuse the constructor's pageId
        // so the watch's onUpdate updates the existing tree
        // node in-place.
        if (this.treeStore.getSnapshot().getNodeCount() > 0) {
            const reusePageId = this._initialPageId;
            this._initialPageId = null;
            void this.startWatch(null, this._initialEndCursor, reusePageId ?? undefined);
        }
    }

    /**
     * Start the initial page load when no `initialPage`
     * was provided. Discovers the cursor then watches
     * the page.
     */
    async loadInitialPage(): Promise<void> {
        if (this._disposed || this.conn == null || this._watches.size > 0) return;

        const cursor = await this.conn.executeAction("getViewRowsPageCursor", {
            tableOrViewId: this.tableOrViewId,
            afterCursor: null,
            limit: this._targetRowsPerPage,
        });
        if (this._disposed) return;

        await this.startWatch(null, cursor.endCursor);
    }

    /**
     * Load the next page. Enqueued behind any in-flight
     * rebalance so cursors are stable when we read them.
     */
    async loadMore(): Promise<void> {
        await this._queue.enqueue(async () => {
            if (this._disposed || this.conn == null) return;
            if (!this.needsMoreStore.getSnapshot()) return;

            const lastNode = this.treeStore.getSnapshot().getLastNodeIfExists();
            if (!lastNode || lastNode.endCursor == null) return;

            this.isLoadingMoreStore.set(true);

            try {
                const cursor = await this.conn.executeAction("getViewRowsPageCursor", {
                    tableOrViewId: this.tableOrViewId,
                    afterCursor: lastNode.endCursor,
                    limit: this._targetRowsPerPage,
                });
                if (this._disposed) return;

                await this.startWatch(lastNode.endCursor, cursor.endCursor);
            } finally {
                this.isLoadingMoreStore.set(false);
            }
        });
    }

    /**
     * Tear down all reactive subscriptions. The tree
     * store retains its last value. Can be followed by
     * another `listen()` call with a new connection.
     */
    dispose(): void {
        this._disposed = true;
        for (const watch of this._watches.values()) {
            watch.removeListener();
            watch.handle.unwatch();
        }
        this._watches.clear();
        this.conn = null;
        this._rebalanceScheduled = false;
        this.isLoadingMoreStore.set(false);
    }

    // -- Watch management ----------------------------------------------------

    /**
     * Create a reactive watch for a page range. Fires
     * the initial tree update synchronously after the
     * watch resolves, using cursor-based ordering to
     * insert at the correct position.
     */
    private async startWatch(
        afterCursor: DatabaseRowId | null,
        endCursor: DatabaseRowId | null,
        reusePageId?: number,
    ): Promise<number | null> {
        const pageId = reusePageId ?? this.allocatePageId();

        const handle = await this.conn!.watchAction({
            name: "getViewRowsPage",
            input: {
                tableOrViewId: this.tableOrViewId,
                afterCursor,
                endCursor,
            },
        });

        if (this._disposed) {
            handle.unwatch();
            return null;
        }

        const onUpdate = () => {
            const result = handle.store.getSnapshot();
            if (!result.ok) return;
            const output = result.value as DatabaseActionOutput<"getViewRowsPage">;
            const rows = output.rows as ReadonlyArray<Record<string, unknown>>;
            const page: DatabaseQueryPage = {pageId, afterCursor, endCursor, rows};

            this.treeStore.set(tree => {
                const existing = tree.getNodeByKeyIfExists(pageId);
                if (existing != null) {
                    return tree.updateNode(pageId, () => page);
                }
                return insertPageInOrder(tree, page);
            });

            // Check rebalance thresholds.
            if (rows.length >= this._splitThreshold || rows.length <= this._mergeThreshold) {
                this.maybeScheduleRebalance();
            }
        };

        // Fire initial update.
        onUpdate();

        // Subscribe to future updates.
        handle.store.addListener(onUpdate);
        const removeListener = () => {
            handle.store.removeListener(onUpdate);
        };
        this._watches.set(pageId, {handle, removeListener});

        return pageId;
    }

    // -- Rebalancing ---------------------------------------------------------

    private maybeScheduleRebalance(): void {
        if (this._rebalanceScheduled) return;
        this._rebalanceScheduled = true;
        this._scheduleRebalance(() => {
            void this._queue.enqueue(() => this.rebalance());
        });
    }

    private async rebalance(): Promise<void> {
        this._rebalanceScheduled = false;
        if (this._disposed || this.conn == null) return;

        const pagesToMerge: Array<DatabaseQueryPage> = [];
        let mergeRowCount = 0;

        const flushMerge = async () => {
            if (pagesToMerge.length < 2) {
                pagesToMerge.length = 0;
                mergeRowCount = 0;
                return;
            }
            const afterCursor = pagesToMerge[0]!.afterCursor;
            const endCursor = pagesToMerge[pagesToMerge.length - 1]!.endCursor;
            for (const p of pagesToMerge) {
                this.tearDownWatch(p.pageId);
            }
            this.treeStore.set(t => {
                let updated = t;
                for (const p of pagesToMerge) {
                    updated = updated.removeNode(p.pageId);
                }
                return updated;
            });
            pagesToMerge.length = 0;
            mergeRowCount = 0;
            await this.startWatch(afterCursor, endCursor);
        };

        for (const node of this.treeStore.getSnapshot().iterateNodes()) {
            if (this._disposed) return;

            // Accumulating a merge run?
            if (pagesToMerge.length > 0) {
                if (mergeRowCount <= this._mergeThreshold) {
                    // Still too small — consume this page.
                    pagesToMerge.push(node);
                    mergeRowCount += node.rows.length;
                    continue;
                }
                // Run is big enough — flush before
                // processing the current node.
                await flushMerge();
                if (this._disposed) return;
            }

            if (node.rows.length >= this._splitThreshold) {
                // Split in half.
                const midpoint = Math.ceil(node.rows.length / 2);
                const midCursor = (node.rows[midpoint - 1] as any)._id as DatabaseRowId;

                this.tearDownWatch(node.pageId);
                this.treeStore.set(t => t.removeNode(node.pageId));

                await runAllPromises([
                    this.startWatch(node.afterCursor, midCursor),
                    this.startWatch(midCursor, node.endCursor),
                ]);
                if (this._disposed) return;
            } else if (node.rows.length <= this._mergeThreshold) {
                // Start a merge run.
                pagesToMerge.push(node);
                mergeRowCount = node.rows.length;
            }
        }

        // Flush any trailing merge run.
        await flushMerge();

        if (process.env.NODE_ENV !== "production") {
            this.assertCursorContinuity();
        }
    }

    /**
     * Dev-only invariant check: consecutive pages must
     * have contiguous cursor ranges with no gaps.
     */
    private assertCursorContinuity(): void {
        let prevEndCursor: DatabaseRowId | null | undefined;
        for (const node of this.treeStore.getSnapshot().iterateNodes()) {
            if (prevEndCursor !== undefined) {
                assert(
                    node.afterCursor === prevEndCursor,
                    `Cursor gap after rebalance: expected afterCursor ` +
                        `${String(prevEndCursor)} but got ${String(node.afterCursor)}`,
                );
            }
            prevEndCursor = node.endCursor;
        }
    }

    private tearDownWatch(pageId: number): void {
        const watch = this._watches.get(pageId);
        if (watch) {
            watch.removeListener();
            watch.handle.unwatch();
            this._watches.delete(pageId);
        }
    }
}

/**
 * Insert a page into the tree at the position determined
 * by its `afterCursor`. Pages are ordered by cursor range
 * — a page with `afterCursor = null` comes first, and
 * otherwise pages sort by `afterCursor` lexicographically
 * (which matches chronological ID time ordering).
 */
function insertPageInOrder(
    tree: VirtualizedTree<number, DatabaseQueryPage, DatabaseQueryRow>,
    page: DatabaseQueryPage,
): VirtualizedTree<number, DatabaseQueryPage, DatabaseQueryRow> {
    let predecessorId: number | null = null;
    for (const n of tree.iterateNodes()) {
        if (pageComesBeforeOrEqual(n, page)) {
            predecessorId = n.pageId;
        }
    }
    if (predecessorId != null) {
        return tree.insertNodesAfter(predecessorId, [page]);
    }
    return tree.insertNodesAtStart([page]);
}

/**
 * Returns true if page `a` should appear at or before page
 * `b` in the cursor ordering.
 */
function pageComesBeforeOrEqual(a: DatabaseQueryPage, b: DatabaseQueryPage): boolean {
    if (a.afterCursor == null && b.afterCursor == null) return true;
    if (a.afterCursor == null) return true;
    if (b.afterCursor == null) return false;
    return a.afterCursor < b.afterCursor;
}

function newEmptyTree(): VirtualizedTree<number, DatabaseQueryPage, DatabaseQueryRow> {
    return VirtualizedTree.new({
        getNodeKey: (page: DatabaseQueryPage) => page.pageId,
        getNodeItemCount: (page: DatabaseQueryPage) => page.rows.length,
        getNodeItem: (page: DatabaseQueryPage, i: number) => page.rows[i]!,
    });
}

function defaultScheduleRebalance(cb: () => void): void {
    // Use setTimeout as a portable fallback. In
    // production this could use the React scheduler's
    // unstable_scheduleCallback with IdlePriority.
    setTimeout(cb, 0);
}
