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
 * PRAGMAs applied to every Alpine SQLite connection on open, in order. The locking
 * mode is applied separately — see {@link sqliteLockingModePragma} — because it
 * differs between the server and the client.
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
];

/**
 * The `locking_mode` PRAGMA to apply on open, which depends on whether the
 * connection is the canonical server database or a client replica.
 *
 * On the **server** the durable object's SQLite connection is the only writer of
 * its file, so `EXCLUSIVE` is both valid and a meaningful speedup: SQLite keeps
 * its lock across transactions and skips per-transaction revalidation.
 *
 * On the **client** that assumption is false by construction — the sync layer
 * writes replicated pages into the store out of band, so SQLite is _not_ the only
 * writer. `EXCLUSIVE` would let SQLite cache a file's page count (and schema)
 * across transactions and never notice out-of-band growth, desyncing local reads
 * until the connection is torn down. `NORMAL` re-reads each file's header change
 * counter at transaction start and resets its pager cache (and re-stats via
 * `xFileSize`) when a replicated write bumped it, so out-of-band page and schema
 * changes are observed.
 */
export function sqliteLockingModePragma({isServer}: {isServer: boolean}): string {
    return `PRAGMA locking_mode = ${isServer ? "EXCLUSIVE" : "NORMAL"}`;
}

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
 * Maximum number of changed held pages the server will inline during table
 * registration catch-up. The legacy cache-validation path temporarily shares this
 * threshold until that protocol is removed.
 */
export const registrationCatchUpInlinePageLimit = 1000;

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
