import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Read-only page storage backing a {@link Database}.
 *
 * The {@link Database} layers an in-memory write buffer
 * over this interface; writes never touch storage
 * directly. Callers drain the buffer via
 * {@link Database.bufferedWrites} and persist it however
 * they choose — committing it server-side, fanning it out
 * to OPFS, etc. — then call {@link Database.markCommitted}
 * to acknowledge or {@link Database.discardBuffer} to
 * throw it away.
 *
 * Pages are partitioned by {@link DatabaseTableId} so a
 * single `Database` can host many independent SQLite
 * databases via `ATTACH`.
 *
 * All methods are synchronous because the SQLite VFS
 * calls them directly from `xRead`/`xFileSize`.
 */
export interface DatabaseStorage {
    /**
     * Read a single page by its zero-based index from
     * the given table.
     *
     * - `null` — no page at that index (read returns
     *   zero-filled bytes; SQLite uses {@link getFileSize}
     *   to determine EOF).
     * - `{data, version}` — the durable page and the
     *   version it was last written at.
     *
     * Implementers may also throw to signal a transient
     * failure (e.g. a missing local cache entry that
     * needs server fallback). The error propagates out
     * of the SQL execution.
     */
    readPage(
        tableId: DatabaseTableId,
        index: number,
    ): {data: Uint8Array; version: number} | null;

    /** Current size in bytes of `tableId`'s file. */
    getFileSize(tableId: DatabaseTableId): number;
}
