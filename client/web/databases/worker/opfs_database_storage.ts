import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import {OpfsPageStore} from "~/client/web/databases/worker/opfs_page_store.js";
import type {ReadonlyDatabaseStorage} from "~/shared/databases/database.js";
import {DatabaseActionRequiresServerError} from "~/shared/databases/database_action_requires_server_error.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {DatabaseTableNotAttachedError} from "~/shared/databases/table_not_attached_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Owns the per-table {@link OpfsPageStore}s backing one {@link DatabaseClient} and
 * adapts them to the {@link ReadonlyDatabaseStorage} interface that {@link
 * Database} reads through.
 *
 * Pages requested within the table's known file size but not present locally throw
 * {@link DatabaseActionRequiresServerError} so the client can fall back to the
 * server. Pages past the end of the file return `null` (zero-fill / EOF).
 */
export class OpfsDatabaseStorage implements ReadonlyDatabaseStorage {
    private readonly groupDir: OpfsDirectoryHandle;
    private readonly stores = new Map<DatabaseTableId, OpfsPageStore>();
    private readonly isTableRegistered: (tableId: DatabaseTableId) => boolean;

    constructor(
        groupDir: OpfsDirectoryHandle,
        isTableRegistered: (tableId: DatabaseTableId) => boolean = () => true,
    ) {
        this.groupDir = groupDir;
        this.isTableRegistered = isTableRegistered;
    }

    /**
     * Open the {@link OpfsPageStore} for `tableId` inside the group dir's `{tableId}/`
     * subdirectory and register it.
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

    /**
     * Close `tableId`'s page store, unregister it, and delete its `{tableId}/`
     * subdirectory from the group dir. Used to purge a table the account lost access
     * to; the closed sync-access handles free the directory for removal.
     */
    async delete(tableId: DatabaseTableId): Promise<void> {
        const store = this.stores.get(tableId);
        assert(store !== undefined, `delete for unknown table: ${tableId}`);
        store.close();
        this.stores.delete(tableId);
        await this.groupDir.removeEntry(tableId, {recursive: true});
    }

    /**
     * Close every open page store, releasing their OPFS sync-access handles. Call when
     * discarding the owning {@link DatabaseClient} (e.g. a failed cold-open) so a
     * later re-open isn't blocked by OPFS's exclusive sync-access-handle lock.
     */
    close(): void {
        for (const store of this.stores.values()) {
            store.close();
        }
        this.stores.clear();
    }

    [Symbol.iterator](): IterableIterator<[DatabaseTableId, OpfsPageStore]> {
        return this.stores.entries();
    }

    // -- ReadonlyDatabaseStorage --------------------------------------------

    readPage(tableId: DatabaseTableId, index: number): {data: Uint8Array; version: number} | null {
        if (!this.isTableRegistered(tableId)) {
            throw new DatabaseTableNotAttachedError(tableId);
        }
        const store = this.stores.get(tableId);
        assert(store !== undefined, `readPage for unknown table: ${tableId}`);

        const entry = store.readPage(index);
        if (entry !== null) return entry;

        // Page is within the file the server says exists, but not in the local cache —
        // signal a miss so the client falls back to the server.
        const fileSize = store.getFileSize();
        if (index * sqlitePageSize < fileSize) {
            throw new DatabaseActionRequiresServerError("page missing from local store");
        }
        return null;
    }

    getFileSize(tableId: DatabaseTableId): number {
        if (!this.isTableRegistered(tableId)) {
            throw new DatabaseTableNotAttachedError(tableId);
        }
        const store = this.stores.get(tableId);
        assert(store !== undefined, `getFileSize for unknown table: ${tableId}`);
        return store.getFileSize();
    }
}
