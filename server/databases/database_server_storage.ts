import type {ReadonlyDatabaseStorage} from "~/shared/databases/database.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Storage backend for {@link DatabaseServer}. Decouples
 * SQLite's file I/O from the actual persistence mechanism.
 *
 * Read methods come from {@link ReadonlyDatabaseStorage}
 * and are called synchronously by the SQLite VFS during
 * `xRead`/`xFileSize`. The write side is server-only — the
 * server drains its in-memory buffer through
 * {@link writePages} after each successful execute.
 *
 * Pages are partitioned by {@link DatabaseTableId} so a
 * single backend can host many independent SQLite
 * databases.
 */
export interface DatabaseServerStorage extends ReadonlyDatabaseStorage {
    /**
     * Apply a batch of buffered writes atomically.
     *
     * - `pages` — page after-images keyed by table, then by
     *   zero-based page index.
     * - `truncates` — post-truncate file sizes in bytes,
     *   keyed by table. Every page at or past the boundary
     *   becomes a tombstone (or is otherwise removed) at
     *   the same version stamped on the batch's writes.
     *
     * Truncates are applied before page writes so a write
     * past a truncate boundary correctly re-extends the
     * file. Returns the monotonically increasing version
     * stamped on every row touched in this batch.
     */
    writePages(
        pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
        truncates: ReadonlyMap<DatabaseTableId, number>,
    ): number;
}
