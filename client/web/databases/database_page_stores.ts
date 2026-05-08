import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {OpfsPageStore, type OptimisticUpdate} from "~/client/web/databases/opfs_page_store.js";
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
 * each store's overlay together. While inside
 * {@link optimistic}, each store's
 * `getCurrentOptimisticUpdate` callback returns the
 * per-table {@link OptimisticUpdate} this wrapper
 * allocates lazily on first access; outside, the
 * callback returns `null` and writes go straight to
 * OPFS.
 */
export class DatabasePageStores {
    private readonly groupDir: OpfsDirectoryHandle;
    private readonly stores = new Map<DatabaseTableId, OpfsPageStore>();
    /**
     * Per-table writes captured during the current
     * {@link optimistic} call. `null` outside an
     * optimistic action.
     */
    private currentWriteSets: Map<DatabaseTableId, Set<number>> | null = null;
    /**
     * Auto-incrementing version assigned by
     * {@link commitOptimisticPagesForTests} so test-setup
     * writes land on disk with strictly increasing
     * versions across calls.
     */
    private nextTestCommitVersion = 0;

    constructor(groupDir: OpfsDirectoryHandle) {
        this.groupDir = groupDir;
    }

    /**
     * Open the {@link OpfsPageStore} for `tableId` inside
     * the group dir's `{tableId}/` subdirectory and
     * register it. Returns the new store.
     */
    async create(tableId: DatabaseTableId): Promise<OpfsPageStore> {
        assert(!this.stores.has(tableId), `page store for table ${tableId} already exists`);
        const tableDir = await this.groupDir.getDirectoryHandle(tableId, {create: true});
        const store = await OpfsPageStore.create(tableDir, () =>
            this.getCurrentOptimisticUpdate(tableId),
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
        assert(this.currentWriteSets === null, "nested optimistic actions are not supported");
        const writeSets = new Map<DatabaseTableId, Set<number>>();
        this.currentWriteSets = writeSets;
        try {
            cb();
        } finally {
            this.currentWriteSets = null;
        }
        return writeSets;
    }

    /** Discard every store's optimistic overlay. */
    clearOptimisticPages(): void {
        for (const store of this.stores.values()) {
            store.clearOptimisticPages();
        }
    }

    /**
     * Drain every store's optimistic overlay onto disk at a
     * fresh, monotonically increasing version. Pairs with
     * {@link DatabaseClient.executeLocallyForTests} to
     * persist test-setup writes as if a server had
     * confirmed them.
     */
    commitOptimisticPagesForTests(): void {
        assert(import.meta.jest);
        const version = ++this.nextTestCommitVersion;
        for (const store of this.stores.values()) {
            store.commitOptimisticPagesForTests(version);
        }
    }

    /**
     * Returns the current call's {@link OptimisticUpdate}
     * for `tableId`. Returns `null` outside an optimistic
     * action. The per-table write-set itself is allocated
     * lazily on the first `markPageAsWritten`, so tables
     * that are only read inside the action stay out of
     * the result.
     */
    private getCurrentOptimisticUpdate(tableId: DatabaseTableId): OptimisticUpdate | null {
        const writeSets = this.currentWriteSets;
        if (writeSets === null) return null;
        return {
            markPageAsWritten(pageIndex: number): void {
                let writeSet = writeSets.get(tableId);
                if (writeSet === undefined) {
                    writeSet = new Set();
                    writeSets.set(tableId, writeSet);
                }
                writeSet.add(pageIndex);
            },
        };
    }
}
