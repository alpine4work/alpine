/**
 * Storage backend for {@link DatabaseServer}. Decouples SQLite's
 * file I/O from the actual persistence mechanism.
 *
 * All methods are synchronous because the VFS calls them directly
 * from `xRead`/`xWrite`.
 */
export interface DatabaseServerStorage {
    getPages(indexes: Array<number>): Array<Uint8Array>;
    setPages(pages: Map<number, Uint8Array>): void;
}
