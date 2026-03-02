/**
 * Storage backend for {@link DatabaseServer}. Decouples SQLite's
 * file I/O from the actual persistence mechanism.
 *
 * All methods are synchronous because the VFS calls them directly
 * from `xRead`/`xWrite`.
 *
 * The storage is responsible for tracking file size. Calling
 * `writePage` at a given index should update the file size if the
 * write extends the file.
 */
export interface DatabaseServerStorage {
    /** Read a single page by its zero-based index. */
    readPage(index: number): Uint8Array;

    /** Write a single page by its zero-based index. */
    writePage(index: number, data: Uint8Array): void;

    /** Called from `xSync`. Flush any buffered writes. */
    flush(): void;

    /** Return the current file size in bytes. */
    getFileSize(): number;

    /** Truncate the file to the given size in bytes. */
    truncate(size: number): void;
}
