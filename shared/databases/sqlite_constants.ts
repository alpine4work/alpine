/**
 * Page size used by all Alpine SQLite databases. Set via
 * `PRAGMA page_size` when a database is first created.
 */
export const sqlitePageSize = 4096;

/**
 * SQLite page cache size. Negative values specify the
 * size in kibibytes (KiB) instead of pages. -20000 means
 * roughly 20 MB of in-memory page cache.
 */
export const sqliteCacheSize = -20000;

/**
 * Maximum number of pages allowed in a single database.
 * With a 4096-byte page size, 262144 pages gives a
 * 1 GB maximum database size (262144 * 4096 = 1 GiB).
 */
export const sqliteMaxPageCount = 262144;

/**
 * PRAGMAs applied to every Alpine SQLite connection on
 * open, in order. `journal_mode` is excluded because it
 * differs between client and server.
 */
export const sqliteOpenPragmas: ReadonlyArray<string> = [
    `PRAGMA page_size = ${sqlitePageSize}`,
    `PRAGMA temp_store = memory`,
    `PRAGMA trusted_schema = false`,
    `PRAGMA cache_size = ${sqliteCacheSize}`,
    `PRAGMA max_page_count = ${sqliteMaxPageCount}`,
    `PRAGMA cell_size_check = true`,
    `PRAGMA foreign_keys = true`,
];

/**
 * Flag passed to `pageAccessHook` when SQLite reads a
 * page from the pager.
 */
export const pageAccessFlagRead = 1;

/**
 * Flag passed to `pageAccessHook` when SQLite writes a
 * page to the pager.
 */
export const pageAccessFlagWrite = 2;

/**
 * Maximum number of stale pages the server will
 * return with inline data during cache validation.
 * Beyond this threshold the server returns only
 * stale page indexes for the client to delete.
 */
export const cacheUpdateStalePageLimit = 1000;

/**
 * Number of rows fetched per page when loading a
 * database view with cursor-based pagination.
 */
export const databaseViewTargetRowsPerPage = 100;

/**
 * Default pixel width for a new column in a database
 * grid view, stored in `_alpine_view_fields.width`.
 */
export const databaseViewDefaultColumnWidth = 200;
