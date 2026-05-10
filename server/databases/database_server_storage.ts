import type {ReadonlyDatabaseStorage} from "~/shared/databases/database.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Storage backend for {@link DatabaseServer}. Decouples SQLite's
 * file I/O from the actual persistence mechanism.
 *
 * All methods are synchronous because the VFS calls them directly
 * from `xRead`/`xSync`.
 *
 * Pages are partitioned by {@link DatabaseTableId} so a single
 * backend can host many independent SQLite databases. Storage
 * is responsible for tracking each table's file size; calling
 * {@link writePages} should update that table's file size if any
 * of the written pages extend it.
 */
export interface DatabaseServerStorage {
    /**
     * Read a single page by its zero-based index from the
     * given table.
     *
     * - `null` — page never existed (no rows for this index).
     * - `{data: null, version}` — tombstone (page was
     *   truncated/deleted).
     * - `{data: Uint8Array, version}` — real page with
     *   content.
     */
    readPage(
        databaseTableId: DatabaseTableId,
        index: number,
    ): {data: Uint8Array | null; version: number} | null;

    /**
     * Write a batch of pages to the given table. Called from
     * `xSync` with all pages that were dirtied since the last
     * sync. Returns the monotonically increasing version
     * assigned to this write within that table.
     */
    writePages(databaseTableId: DatabaseTableId, pages: ReadonlyMap<number, Uint8Array>): number;

    /** Return the current file size in bytes for the given table. */
    getFileSize(databaseTableId: DatabaseTableId): number;

    /** Truncate the given table's file to the given size in bytes. */
    truncate(databaseTableId: DatabaseTableId, size: number): void;
}

/**
 * Adapts a {@link DatabaseServerStorage} to the read-only
 * surface that {@link Database} reads through. Tombstones
 * (`{data: null, version}`) are surfaced as missing pages
 * (`null`) — the underlying file shrinks via
 * {@link DatabaseServerStorage.getFileSize}, so the read
 * path treats a tombstoned page the same as one that never
 * existed.
 */
export class DatabaseServerStorageAdapter implements ReadonlyDatabaseStorage {
    private readonly storage: DatabaseServerStorage;

    constructor(storage: DatabaseServerStorage) {
        this.storage = storage;
    }

    readPage(tableId: DatabaseTableId, index: number): {data: Uint8Array; version: number} | null {
        const page = this.storage.readPage(tableId, index);
        if (page === null || page.data === null) return null;
        return {data: page.data, version: page.version};
    }

    getFileSize(tableId: DatabaseTableId): number {
        return this.storage.getFileSize(tableId);
    }
}
