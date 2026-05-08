/**
 * Storage backend for {@link DatabaseServer}. Decouples SQLite's
 * file I/O from the actual persistence mechanism.
 *
 * All methods are synchronous because the VFS calls them directly
 * from `xRead`/`xSync`.
 *
 * The storage is responsible for tracking file size. Calling
 * `writePages` should update the file size if any of the written
 * pages extend the file.
 */
export interface DatabaseServerStorage {
    /**
     * Read a single page by its zero-based index.
     *
     * - `null` — page never existed (no rows for this index).
     * - `{data: null, version}` — tombstone (page was
     *   truncated/deleted).
     * - `{data: Uint8Array, version}` — real page with
     *   content.
     */
    readPage(index: number): {data: Uint8Array | null; version: number} | null;

    /**
     * Write a batch of pages. Called from `xSync` with all
     * pages that were dirtied since the last sync. Returns the
     * monotonically increasing version assigned to this write.
     */
    writePages(pages: ReadonlyMap<number, Uint8Array>): number;

    /** Return the current file size in bytes. */
    getFileSize(): number;

    /** Truncate the file to the given size in bytes. */
    truncate(size: number): void;
}
