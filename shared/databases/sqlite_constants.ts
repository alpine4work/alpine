import {getMinId} from "~/shared/id/id.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Page size used by all Alpine SQLite databases. Set via `PRAGMA page_size` when a
 * database is first created.
 */
export const sqlitePageSize = 4096;

/**
 * {@link DatabaseTableId} reserved for each group's main SQLite database — the one
 * that holds Alpine's metadata and acts as the connection target for
 * `ATTACH DATABASE` statements that mount per-table databases.
 */
export const databaseMainTableId = getMinId<DatabaseTableId>();

/**
 * SQLite page cache size. Negative values specify the size in kibibytes (KiB)
 * instead of pages. -20000 means roughly 20 MB of in-memory page cache.
 */
export const sqliteCacheSize = -20000;

/**
 * Maximum number of pages allowed in a single database. With a 4096-byte page
 * size, 262144 pages gives a 1 GB maximum database size (262144 \* 4096 = 1 GiB).
 */
export const sqliteMaxPageCount = 262144;

/**
 * PRAGMAs applied to every Alpine SQLite connection on open, in order.
 */
export const sqliteOpenPragmas: ReadonlyArray<string> = [
    `PRAGMA page_size = ${sqlitePageSize}`,
    `PRAGMA temp_store = memory`,
    `PRAGMA trusted_schema = false`,
    `PRAGMA cache_size = ${sqliteCacheSize}`,
    `PRAGMA max_page_count = ${sqliteMaxPageCount}`,
    `PRAGMA cell_size_check = true`,
    `PRAGMA foreign_keys = true`,
    // `journal_mode = MEMORY` keeps the rollback journal in heap rather than on disk:
    // there's no on-disk database file backing our VFS, but ROLLBACK still needs the
    // journal to undo partial writes after an error or to keep the in-memory write
    // buffer from being polluted by cache spills mid-statement. External
    // transactionality (server-side DO transaction, client-side rebase replay) is what
    // actually makes commits atomic.
    `PRAGMA journal_mode = MEMORY`,
    // we don't allow any sort of concurrent access to our database. Exclusive locking
    // mode takes advantage of this fact to significantly speed up writes.
    `PRAGMA locking_mode = EXCLUSIVE`,
];

/**
 * SQL that pins `page_size` on an ATTACH-ed schema before it's first written.
 * Connection-level `PRAGMA page_size` only applies to `main`; without this, a
 * fresh attached database picks SQLite's compile-time default which may not match
 * the {@link sqlitePageSize} the VFS asserts on.
 */
export function sqliteAttachPagePragma(schemaName: string): string {
    // eslint-disable-next-line cyberworlds/string-quotes -- SQL identifier requires `"`
    return `PRAGMA "${schemaName}".page_size = ${sqlitePageSize}`;
}

/**
 * Maximum number of `ATTACH`-ed databases per SQLite connection. This is the
 * compile-time `SQLITE_MAX_ATTACHED` value our WASM build is compiled with (see
 * `admin/patches/bazel/sqlite.patch`) — also SQLite's hard ceiling. It cannot be
 * raised at runtime.
 */
export const sqliteMaxAttachedDatabases = 125;

/**
 * Attached-schema count at which `Database.attach` starts evicting
 * least-recently-used per-table files to make room. Kept below {@link
 * sqliteMaxAttachedDatabases} so an in-flight transaction — whose touched schemas
 * are pinned and cannot be detached until commit — still has headroom to attach
 * more tables before hitting the hard limit.
 */
export const sqliteAttachEvictionThreshold = 115;

/**
 * Flag passed to `pageAccessHook` when SQLite reads a page from the pager.
 */
export const pageAccessFlagRead = 1;

/**
 * Flag passed to `pageAccessHook` when SQLite writes a page to the pager.
 */
export const pageAccessFlagWrite = 2;

/**
 * Maximum number of stale pages the server will return with inline data during
 * cache validation. Beyond this threshold the server returns only stale page
 * indexes for the client to delete.
 */
export const cacheUpdateStalePageLimit = 1000;

/**
 * Number of rows fetched per page when loading a database view with cursor-based
 * pagination.
 */
export const databaseViewTargetRowsPerPage = 100;

/**
 * Default pixel width for a new column in a database grid view, stored in
 * `_alpine_view_fields.width`.
 */
export const databaseViewDefaultColumnWidth = 200;
