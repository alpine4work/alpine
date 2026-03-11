/**
 * Page size used by all Alpine SQLite databases. Set via
 * `PRAGMA page_size` when a database is first created.
 */
export const sqlitePageSize = 4096;

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
