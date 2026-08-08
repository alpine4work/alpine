import type {
    DatabaseReactiveActionHandle,
    DatabaseWorkerConnection,
} from "~/client/web/databases/connect_to_database.js";
import {DatabaseQueryPage, DatabaseQueryRow} from "~/client/web/databases/database_query_row.js";
import {VirtualizedTree} from "~/client/web/virtualized/helpers/virtualized_tree.js";
import {databaseViewTargetRowsPerPage} from "~/shared/databases/sqlite_constants.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import type {DatabaseFieldId, DatabaseRowId} from "~/shared/id/types/id_types.open_source.js";
import {computeStore} from "~/shared/store/compute_store.js";
import type {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

type PageWatch = {
    readonly handle: DatabaseReactiveActionHandle<"getViewRowsPage">;
    readonly removeListener: () => void;
};

/**
 * Manages cursor-based paginated queries for a database view. Each page becomes an
 * independent reactive subscription backed by `getViewRowsPage`. Uses
 * `VirtualizedTree` (pages as nodes, rows as items) for efficient indexed access
 * from `VirtualizedScrollView`.
 *
 * Pages are automatically rebalanced when they grow past 1.5x the target size
 * (split) or shrink below 0.5x (merge with a neighbor). Rebalancing is deferred to
 * an idle callback so it doesn't block reactive updates.
 *
 * Create synchronously via the constructor (safe during render), then call
 * `listen()` in an effect to start reactive subscriptions and `dispose()` to tear
 * them down.
 */
export class DatabaseQuery {
    private readonly tableOrViewId: string;
    private readonly initialEndCursor: DatabaseRowId | null;
    private readonly targetRowsPerPage: number;
    private readonly splitThreshold: number;
    private readonly mergeThreshold: number;
    private readonly scheduleRebalance: (cb: () => void) => void;
    private readonly watches = new Map<number, PageWatch>();
    private readonly mutex = new Mutex();
    private conn: DatabaseWorkerConnection | null = null;
    private disposed = false;
    private nextPageId = 0;
    private readonly hasInitialPage: boolean;
    private initialPageId: number | null = null;
    private rebalanceScheduled = false;

    readonly treeStore: ValueStore<VirtualizedTree<number, DatabaseQueryPage, DatabaseQueryRow>>;
    readonly needsMoreStore: Store<boolean>;
    readonly isLoadingMoreStore: ValueStore<boolean>;

    constructor(options: {
        tableOrViewId: string;
        initialPage?: {
            endCursor: DatabaseRowId | null;
            fieldIndexes: ReadonlyMap<DatabaseFieldId, number>;
            rows: ReadonlyArray<ReadonlyArray<unknown>>;
        };
        targetRowsPerPageForTest?: number;
        scheduleRebalanceForTest?: (cb: () => void) => void;
    }) {
        this.tableOrViewId = options.tableOrViewId;
        this.targetRowsPerPage = options.targetRowsPerPageForTest ?? databaseViewTargetRowsPerPage;
        this.splitThreshold = Math.floor(1.5 * this.targetRowsPerPage);
        this.mergeThreshold = Math.floor(0.5 * this.targetRowsPerPage);
        this.scheduleRebalance = options.scheduleRebalanceForTest ?? defaultScheduleRebalance;
        this.treeStore = new ValueStore(newEmptyTree());
        this.hasInitialPage = options.initialPage !== undefined;
        this.initialEndCursor = options.initialPage?.endCursor ?? null;
        this.isLoadingMoreStore = new ValueStore(false);

        // Derived: true when the last node has a bounded endCursor, meaning more pages can
        // be loaded.
        this.needsMoreStore = computeStore(get => {
            const tree = get(this.treeStore);
            const lastNode = tree.getLastNodeIfExists();
            return lastNode != null && lastNode.endCursor != null;
        });

        if (options.initialPage && options.initialPage.rows.length > 0) {
            const pageId = this.allocatePageId();
            this.initialPageId = pageId;
            const page = new DatabaseQueryPage({
                pageId,
                afterCursor: null,
                endCursor: options.initialPage.endCursor,
                fieldIndexes: options.initialPage.fieldIndexes,
                rows: options.initialPage.rows,
            });
            this.treeStore.set(tree => tree.insertNodesAtEnd([page]));
        }
    }

    private allocatePageId(): number {
        return this.nextPageId++;
    }

    /**
     * Start reactive subscriptions. Call from an effect after the connection is
     * available and begins watching the initial page.
     */
    listen(connection: DatabaseWorkerConnection): void {
        this.conn = connection;
        this.disposed = false;

        // If an initial page was provided, start watching the first page reactively. Reuse
        // the constructor's pageId so the watch's onUpdate updates the existing tree node
        // in-place. When the initial page had no rows there's no node to reuse, but we
        // still need the watch so newly created rows appear without a remount. Without an
        // initial page the caller drives `loadInitialPage()`.
        if (this.hasInitialPage) {
            const reusePageId = this.initialPageId;
            this.initialPageId = null;
            void this.startWatch(null, this.initialEndCursor, reusePageId ?? undefined);
        }
    }

    /**
     * Start the initial page load when no `initialPage` was provided. Discovers the
     * cursor then watches the page.
     */
    async loadInitialPage(): Promise<void> {
        if (this.disposed || this.conn == null || this.watches.size > 0) return;

        const cursor = await this.conn.executeAction("getViewRowsPageCursor", {
            tableOrViewId: this.tableOrViewId,
            afterCursor: null,
            limit: this.targetRowsPerPage,
        });
        if (this.disposed) return;

        await this.startWatch(null, cursor.endCursor);
    }

    /**
     * Load the next page. Enqueued behind any in-flight rebalance so cursors are
     * stable when we read them.
     */
    async loadMore(): Promise<void> {
        await this.mutex.withLock(async () => {
            if (this.disposed || this.conn == null) return;
            if (!this.needsMoreStore.getSnapshot()) return;

            const lastNode = this.treeStore.getSnapshot().getLastNodeIfExists();
            if (!lastNode || lastNode.endCursor == null) return;

            this.isLoadingMoreStore.set(true);

            try {
                const cursor = await this.conn.executeAction("getViewRowsPageCursor", {
                    tableOrViewId: this.tableOrViewId,
                    afterCursor: lastNode.endCursor,
                    limit: this.targetRowsPerPage,
                });
                if (this.disposed) return;

                await this.startWatch(lastNode.endCursor, cursor.endCursor);
            } finally {
                this.isLoadingMoreStore.set(false);
            }
        });
    }

    /**
     * Tear down all reactive subscriptions. The tree store retains its last value. Can
     * be followed by another `listen()` call with a new connection.
     */
    dispose(): void {
        this.disposed = true;
        for (const watch of this.watches.values()) {
            watch.removeListener();
            watch.handle.unwatch();
        }
        this.watches.clear();
        this.conn = null;
        this.rebalanceScheduled = false;
        this.isLoadingMoreStore.set(false);
    }

    // -- Watch management ----------------------------------------------------

    /**
     * Create a reactive watch for a page range. Fires the initial tree update
     * synchronously after the watch resolves, using cursor-based ordering to insert at
     * the correct position.
     */
    private async startWatch(
        afterCursor: DatabaseRowId | null,
        endCursor: DatabaseRowId | null,
        reusePageId?: number,
    ): Promise<number | null> {
        const pageId = reusePageId ?? this.allocatePageId();

        const conn = assertExists(this.conn);
        const handle = await conn.watchAction("getViewRowsPage", {
            tableOrViewId: this.tableOrViewId,
            afterCursor,
            endCursor,
        });

        if (this.disposed) {
            handle.unwatch();
            return null;
        }

        const onUpdate = () => {
            const result = handle.store.getSnapshot();
            if (!result.ok) return;
            const page = new DatabaseQueryPage({
                pageId,
                afterCursor,
                endCursor,
                fieldIndexes: result.value.fieldIndexes,
                rows: result.value.rows,
            });

            this.treeStore.set(tree => {
                const existing = tree.getNodeByKeyIfExists(pageId);
                if (existing != null) {
                    return tree.updateNode(pageId, () => page);
                }
                return insertPageInOrder(tree, page);
            });

            // Check rebalance thresholds.
            if (
                result.value.rows.length >= this.splitThreshold ||
                result.value.rows.length <= this.mergeThreshold
            ) {
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
        this.watches.set(pageId, {handle, removeListener});

        return pageId;
    }

    // -- Rebalancing ---------------------------------------------------------

    private maybeScheduleRebalance(): void {
        if (this.rebalanceScheduled) return;
        this.rebalanceScheduled = true;
        this.scheduleRebalance(() => {
            void this.mutex.withLock(() => this.rebalance());
        });
    }

    private async rebalance(): Promise<void> {
        this.rebalanceScheduled = false;
        if (this.disposed || this.conn == null) return;

        const pagesToMerge: Array<DatabaseQueryPage> = [];
        let mergeRowCount = 0;

        const flushMerge = async () => {
            if (pagesToMerge.length < 2) {
                pagesToMerge.length = 0;
                mergeRowCount = 0;
                return;
            }
            const afterCursor = assertExists(pagesToMerge.at(0)).afterCursor;
            const endCursor = assertExists(pagesToMerge.at(-1)).endCursor;
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
            if (this.disposed) return;

            // Accumulating a merge run?
            if (pagesToMerge.length > 0) {
                if (mergeRowCount <= this.mergeThreshold) {
                    // Still too small — consume this page.
                    pagesToMerge.push(node);
                    mergeRowCount += node.rowCount;
                    continue;
                }
                // Run is big enough — flush before processing the current node.
                await flushMerge();
                if (this.disposed) return;
            }

            if (node.rowCount >= this.splitThreshold) {
                // Split in half.
                const midpoint = Math.ceil(node.rowCount / 2);
                const midCursor = node.getRow(midpoint - 1).getId();

                this.tearDownWatch(node.pageId);
                this.treeStore.set(t => t.removeNode(node.pageId));

                await runAllPromises([
                    this.startWatch(node.afterCursor, midCursor),
                    this.startWatch(midCursor, node.endCursor),
                ]);
                if (this.disposed) return;
            } else if (node.rowCount <= this.mergeThreshold) {
                // Start a merge run.
                pagesToMerge.push(node);
                mergeRowCount = node.rowCount;
            }
        }

        // Flush any trailing merge run.
        await flushMerge();

        if (process.env.NODE_ENV !== "production") {
            this.assertCursorContinuity();
        }
    }

    /**
     * Dev-only invariant check: consecutive pages must have contiguous cursor ranges
     * with no gaps.
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
        const watch = this.watches.get(pageId);
        if (watch) {
            watch.removeListener();
            watch.handle.unwatch();
            this.watches.delete(pageId);
        }
    }
}

/**
 * Insert a page into the tree at the position determined by its `afterCursor`.
 * Pages are ordered by cursor range — a page with `afterCursor = null` comes
 * first, and otherwise pages sort by `afterCursor` lexicographically (which
 * matches chronological ID time ordering).
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
 * Returns true if page `a` should appear at or before page `b` in the cursor
 * ordering.
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
        getNodeItemCount: (page: DatabaseQueryPage) => page.rowCount,
        getNodeItem: (page: DatabaseQueryPage, i: number) => page.getRow(i),
    });
}

function defaultScheduleRebalance(cb: () => void): void {
    // Use setTimeout as a portable fallback. In production this could use the React
    // scheduler's unstable_scheduleCallback with IdlePriority.
    setTimeout(cb, 0);
}
