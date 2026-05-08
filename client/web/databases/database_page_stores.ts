import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {
    OpfsPageStore,
    type OptimisticUpdateHandle,
} from "~/client/web/databases/opfs_page_store.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Owns the per-table {@link OpfsPageStore}s backing one
 * {@link DatabaseClient}'s SQLite connection and
 * coordinates optimistic mutations across them.
 *
 * The "are we currently inside an optimistic action?"
 * flag lives here rather than on each store: a single
 * SQL statement may write through any subset of attached
 * databases, and those writes must land atomically in
 * each store's overlay together. The persistent overlay
 * and per-call write-set both live on the per-table
 * {@link OptimisticUpdateHandle}; each store reaches its
 * handle through the callback installed at construction.
 */
export class DatabasePageStores {
    private readonly stores = new Map<DatabaseTableId, OpfsPageStore>();
    private readonly handles = new Map<DatabaseTableId, OptimisticUpdateHandle>();
    private inOptimistic = false;

    /**
     * Open the {@link OpfsPageStore} for `tableId` inside
     * `groupDir`'s `{tableId}/` subdirectory and register
     * it. Returns the new store.
     */
    async create(groupDir: OpfsDirectoryHandle, tableId: DatabaseTableId): Promise<OpfsPageStore> {
        assert(!this.stores.has(tableId), `page store for table ${tableId} already exists`);
        const tableDir = await groupDir.getDirectoryHandle(tableId, {create: true});
        const store = await OpfsPageStore.create(tableDir, () =>
            this.optimisticUpdateHandleFor(tableId),
        );
        this.stores.set(tableId, store);
        return store;
    }

    /** Look up a per-table store. */
    get(tableId: DatabaseTableId): OpfsPageStore | undefined {
        return this.stores.get(tableId);
    }

    /** Iterate every (tableId, store) pair. */
    [Symbol.iterator](): IterableIterator<[DatabaseTableId, OpfsPageStore]> {
        return this.stores.entries();
    }

    /**
     * Run `cb` with every store in optimistic mode. SQLite
     * writes performed during the callback go to each
     * store's in-memory overlay instead of its OPFS file.
     * Returns the page indices written, keyed by the
     * table whose store received them; tables that
     * weren't written to are omitted.
     */
    optimistic(cb: () => void): Map<DatabaseTableId, ReadonlySet<number>> {
        assert(!this.inOptimistic, "nested optimistic actions are not supported");
        this.inOptimistic = true;
        try {
            cb();
        } finally {
            this.inOptimistic = false;
        }
        const writtenPages = new Map<DatabaseTableId, ReadonlySet<number>>();
        for (const [tableId, handle] of this.handles) {
            if (handle.writeSet === null) continue;
            if (handle.writeSet.size > 0) {
                writtenPages.set(tableId, handle.writeSet);
            }
            handle.writeSet = null;
        }
        return writtenPages;
    }

    /** Discard every store's optimistic overlay. */
    clearOptimisticPages(): void {
        for (const handle of this.handles.values()) {
            handle.optimisticPages.clear();
        }
    }

    /**
     * Returns the {@link OptimisticUpdateHandle} for
     * `tableId`, lazily allocating it on first access.
     * Inside an optimistic action, ensures `writeSet` is
     * present so writes can record what they touch.
     */
    private optimisticUpdateHandleFor(tableId: DatabaseTableId): OptimisticUpdateHandle {
        let handle = this.handles.get(tableId);
        if (handle === undefined) {
            handle = {optimisticPages: new Map(), writeSet: null};
            this.handles.set(tableId, handle);
        }
        if (this.inOptimistic && handle.writeSet === null) {
            handle.writeSet = new Set();
        }
        return handle;
    }
}
