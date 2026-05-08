import type {OpfsPageStore} from "~/client/web/databases/opfs_page_store.js";
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
 * databases, and those writes have to land atomically in
 * each store's overlay together. {@link optimistic}
 * installs a fresh per-table write-set on every store,
 * runs the callback, and returns the captured writes
 * keyed by table.
 */
export class DatabasePageStores {
    private readonly stores: Map<DatabaseTableId, OpfsPageStore>;
    private inOptimistic = false;

    constructor(stores: Map<DatabaseTableId, OpfsPageStore>) {
        this.stores = stores;
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
     * Returns the set of page indices touched, keyed by
     * the table whose store received them.
     */
    optimistic(cb: () => void): Map<DatabaseTableId, ReadonlySet<number>> {
        assert(!this.inOptimistic, "nested optimistic actions are not supported");
        this.inOptimistic = true;
        const writeSets = new Map<DatabaseTableId, Set<number>>();
        for (const [tableId, store] of this.stores) {
            const writeSet = new Set<number>();
            writeSets.set(tableId, writeSet);
            store.setOptimisticWriteSet(writeSet);
        }
        try {
            cb();
        } finally {
            this.inOptimistic = false;
            for (const store of this.stores.values()) {
                store.setOptimisticWriteSet(null);
            }
        }
        return writeSets;
    }

    /** Discard every store's optimistic overlay. */
    clearOptimisticPages(): void {
        for (const store of this.stores.values()) {
            store.clearOptimisticPages();
        }
    }
}
