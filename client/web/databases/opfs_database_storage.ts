import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {OpfsPageStore} from "~/client/web/databases/opfs_page_store.js";
import type {ReadonlyDatabaseStorage} from "~/shared/databases/database.js";
import {PageMissingError} from "~/shared/databases/page_missing_error.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Owns the per-table {@link OpfsPageStore}s backing one
 * {@link DatabaseClient} and adapts them to the
 * {@link ReadonlyDatabaseStorage} interface that
 * {@link Database} reads through.
 *
 * Pages requested within the table's known file size but
 * not present locally throw {@link PageMissingError} so
 * the client can fall back to the server. Pages past the
 * end of the file return `null` (zero-fill / EOF).
 */
export class OpfsDatabaseStorage implements ReadonlyDatabaseStorage {
    private readonly groupDir: OpfsDirectoryHandle;
    private readonly stores = new Map<DatabaseTableId, OpfsPageStore>();

    constructor(groupDir: OpfsDirectoryHandle) {
        this.groupDir = groupDir;
    }

    /**
     * Open the {@link OpfsPageStore} for `tableId` inside
     * the group dir's `{tableId}/` subdirectory and
     * register it.
     */
    async create(tableId: DatabaseTableId): Promise<OpfsPageStore> {
        assert(!this.stores.has(tableId), `page store for table ${tableId} already exists`);
        const tableDir = await this.groupDir.getDirectoryHandle(tableId, {create: true});
        const store = await OpfsPageStore.create(tableDir);
        this.stores.set(tableId, store);
        return store;
    }

    get(tableId: DatabaseTableId): OpfsPageStore | undefined {
        return this.stores.get(tableId);
    }

    [Symbol.iterator](): IterableIterator<[DatabaseTableId, OpfsPageStore]> {
        return this.stores.entries();
    }

    // -- ReadonlyDatabaseStorage --------------------------------------------

    readPage(tableId: DatabaseTableId, index: number): {data: Uint8Array; version: number} | null {
        const store = this.stores.get(tableId);
        assert(store !== undefined, `readPage for unknown table: ${tableId}`);

        const entry = store.readPage(index);
        if (entry !== null) return entry;

        // Page is within the file the server says exists,
        // but not in the local cache — signal a miss so
        // the client falls back to the server.
        const fileSize = store.getFileSize();
        if (index * sqlitePageSize < fileSize) {
            throw new PageMissingError(index);
        }
        return null;
    }

    getFileSize(tableId: DatabaseTableId): number {
        const store = this.stores.get(tableId);
        assert(store !== undefined, `getFileSize for unknown table: ${tableId}`);
        return store.getFileSize();
    }
}
