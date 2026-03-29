import type {
    DatabaseConnection,
    ReactiveActionHandle,
} from "~/client/web/databases/database_active_tab_manager.js";
import {VirtualizedTree} from "~/client/web/virtualized/helpers/virtualized_tree.js";
import type {DatabaseActionOutput} from "~/shared/databases/database_actions.js";
import {databaseViewTargetRowsPerPage} from "~/shared/databases/sqlite_constants.js";
import type {DatabaseRowId} from "~/shared/id/types/id_types.js";
import {ValueStore} from "~/shared/store/value_store.js";

type DatabaseQueryPage = {
    readonly pageIndex: number;
    readonly rows: ReadonlyArray<Record<string, unknown>>;
};

type DatabaseQueryRow = Record<string, unknown>;

type PageState = {
    readonly afterCursor: DatabaseRowId | null;
    readonly endCursor: DatabaseRowId | null;
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
 * Create synchronously via the constructor (safe during
 * render), then call `listen()` in an effect to start
 * reactive subscriptions and `dispose()` to tear them
 * down.
 */
export class DatabaseQuery {
    private readonly tableOrViewId: string;
    private readonly pages: Array<PageState> = [];
    private readonly _initialEndCursor: DatabaseRowId | null;
    private conn: DatabaseConnection | null = null;
    private _disposed = false;

    readonly treeStore: ValueStore<VirtualizedTree<number, DatabaseQueryPage, DatabaseQueryRow>>;
    readonly needsMoreStore: ValueStore<boolean>;
    readonly isLoadingMoreStore: ValueStore<boolean>;

    constructor(options: {
        tableOrViewId: string;
        initialPage?: {
            endCursor: DatabaseRowId | null;
            rows: ReadonlyArray<unknown>;
        };
    }) {
        this.tableOrViewId = options.tableOrViewId;
        this.treeStore = new ValueStore(newEmptyTree());
        this._initialEndCursor = options.initialPage?.endCursor ?? null;
        this.needsMoreStore = new ValueStore(options.initialPage?.endCursor != null);
        this.isLoadingMoreStore = new ValueStore(false);

        if (options.initialPage && options.initialPage.rows.length > 0) {
            const page: DatabaseQueryPage = {
                pageIndex: 0,
                rows: options.initialPage.rows as ReadonlyArray<Record<string, unknown>>,
            };
            this.treeStore.set(tree => tree.insertNodesAtEnd([page]));
        }
    }

    /**
     * Start reactive subscriptions. Call from an effect
     * after the connection is available. Seeds OPFS pages
     * from SSR data and begins watching the initial page.
     */
    listen(options: {
        conn: DatabaseConnection;
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
        // page reactively.
        if (this.treeStore.getSnapshot().getNodeCount() > 0) {
            void this.watchPage(0, null, this._initialEndCursor);
        }
    }

    /**
     * Start the initial page load when no `initialPage`
     * was provided. Discovers the cursor then watches
     * the page.
     */
    async loadInitialPage(): Promise<void> {
        if (this._disposed || this.conn == null || this.pages.length > 0) return;

        const cursor = await this.conn.executeAction("getViewRowsPageCursor", {
            tableOrViewId: this.tableOrViewId,
            afterCursor: null,
            limit: databaseViewTargetRowsPerPage,
        });
        if (this._disposed) return;

        await this.watchPage(0, null, cursor.endCursor);
    }

    /**
     * Load the next page. No-op if the last page is
     * open-ended or already loading.
     */
    async loadMore(): Promise<void> {
        if (this._disposed || this.conn == null) return;
        if (this.isLoadingMoreStore.getSnapshot()) return;
        if (!this.needsMoreStore.getSnapshot()) return;

        const lastPage = this.pages[this.pages.length - 1]!;
        const afterCursor = lastPage.endCursor!;
        const nextPageIndex = this.pages.length;

        this.isLoadingMoreStore.set(true);

        try {
            const cursor = await this.conn.executeAction("getViewRowsPageCursor", {
                tableOrViewId: this.tableOrViewId,
                afterCursor,
                limit: databaseViewTargetRowsPerPage,
            });
            if (this._disposed) return;

            await this.watchPage(nextPageIndex, afterCursor, cursor.endCursor);
        } finally {
            this.isLoadingMoreStore.set(false);
        }
    }

    /**
     * Tear down all reactive subscriptions. The tree
     * store retains its last value. Can be followed by
     * another `listen()` call with a new connection.
     */
    dispose(): void {
        this._disposed = true;
        for (const page of this.pages) {
            page.removeListener();
            page.handle.unwatch();
        }
        this.pages.length = 0;
        this.conn = null;
        this.isLoadingMoreStore.set(false);
    }

    private async watchPage(
        pageIndex: number,
        afterCursor: DatabaseRowId | null,
        endCursor: DatabaseRowId | null,
    ): Promise<void> {
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
            return;
        }

        const onUpdate = () => {
            const result = handle.store.getSnapshot();
            if (!result.ok) return;
            const output = result.value as DatabaseActionOutput<"getViewRowsPage">;
            const rows = output.rows as ReadonlyArray<Record<string, unknown>>;
            const page: DatabaseQueryPage = {pageIndex, rows};

            this.treeStore.set(tree => {
                const existing = tree.getNodeByKeyIfExists(pageIndex);

                // VirtualizedTree requires nodes to have at
                // least one item. Remove the node when the
                // page becomes empty; skip insert for empty.
                if (rows.length === 0) {
                    return existing != null ? tree.removeNode(pageIndex) : tree;
                }
                if (existing != null) {
                    return tree.updateNode(pageIndex, () => page);
                }
                return tree.insertNodesAtEnd([page]);
            });
        };

        // Push initial value.
        onUpdate();

        // Subscribe to future updates.
        handle.store.addListener(onUpdate);
        const removeListener = () => {
            handle.store.removeListener(onUpdate);
        };

        this.pages.push({
            afterCursor,
            endCursor,
            handle,
            removeListener,
        });

        // Update needsMore based on the new last page.
        this.needsMoreStore.set(endCursor != null);
    }
}

function newEmptyTree(): VirtualizedTree<number, DatabaseQueryPage, DatabaseQueryRow> {
    return VirtualizedTree.new({
        getNodeKey: (page: DatabaseQueryPage) => page.pageIndex,
        getNodeItemCount: (page: DatabaseQueryPage) => page.rows.length,
        getNodeItem: (page: DatabaseQueryPage, i: number) => page.rows[i]!,
    });
}
