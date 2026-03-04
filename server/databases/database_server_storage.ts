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
     * Read a single page by its zero-based index. Returns the
     * page data and the server-authoritative timestamp of the
     * last write to this page (0 if the page doesn't exist).
     */
    readPage(index: number): {data: Uint8Array; timestamp: number};

    /**
     * Write a batch of pages. Called from `xSync` with all
     * pages that were dirtied since the last sync. Returns the
     * monotonically increasing timestamp assigned to this write.
     */
    writePages(pages: ReadonlyMap<number, Uint8Array>): number;

    /** Return the current file size in bytes. */
    getFileSize(): number;

    /** Truncate the file to the given size in bytes. */
    truncate(size: number): void;
}
