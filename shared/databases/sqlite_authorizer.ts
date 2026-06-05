/**
 * Shared SQLite authorizer logic used by both the
 * server ({@link DatabaseServer}) and the client
 * ({@link DatabaseClient}) to enforce write-level
 * permissions on SQL statements.
 */

/**
 * Controls which SQL operations are permitted in
 * normal execution paths:
 *
 * - `"none"` — read-only: select, read, transaction,
 *   function, recursive.
 * - `"data"` — above + DML: insert, update, delete,
 *   savepoint.
 * - `"schema+data"` — above + DDL + pragma.
 *
 * `ATTACH` / `DETACH` are NOT permitted at any of
 * these levels; they're gated behind the internal
 * {@link InternalSqliteWriteLevel} value `"attach"`,
 * which only `Database.attach()` is allowed to use.
 */
export type SqliteWriteLevel = "none" | "data" | "schema+data";

/**
 * Internal extension of {@link SqliteWriteLevel} that
 * adds the `"attach"` mode: the only mode under which
 * the authorizer permits `SQLITE_ATTACH` /
 * `SQLITE_DETACH`. Used by `Database.attach()` to
 * briefly authorize an ATTACH around the SQL it issues
 * itself; never exposed in public APIs.
 */
export type InternalSqliteWriteLevel = SqliteWriteLevel | "attach";

// Mapping from SQLite authorizer action codes to
// human-readable names.
// prettier-ignore
const actionNames = [
    undefined,             // 0
    "create-index",        // 1  SQLITE_CREATE_INDEX
    "create-table",        // 2  SQLITE_CREATE_TABLE
    "create-temp-index",   // 3  SQLITE_CREATE_TEMP_INDEX
    "create-temp-table",   // 4  SQLITE_CREATE_TEMP_TABLE
    "create-temp-trigger", // 5  SQLITE_CREATE_TEMP_TRIGGER
    "create-temp-view",    // 6  SQLITE_CREATE_TEMP_VIEW
    "create-trigger",      // 7  SQLITE_CREATE_TRIGGER
    "create-view",         // 8  SQLITE_CREATE_VIEW
    "delete",              // 9  SQLITE_DELETE
    "drop-index",          // 10 SQLITE_DROP_INDEX
    "drop-table",          // 11 SQLITE_DROP_TABLE
    "drop-temp-index",     // 12 SQLITE_DROP_TEMP_INDEX
    "drop-temp-table",     // 13 SQLITE_DROP_TEMP_TABLE
    "drop-temp-trigger",   // 14 SQLITE_DROP_TEMP_TRIGGER
    "drop-temp-view",      // 15 SQLITE_DROP_TEMP_VIEW
    "drop-trigger",        // 16 SQLITE_DROP_TRIGGER
    "drop-view",           // 17 SQLITE_DROP_VIEW
    "insert",              // 18 SQLITE_INSERT
    "pragma",              // 19 SQLITE_PRAGMA
    "read",                // 20 SQLITE_READ
    "select",              // 21 SQLITE_SELECT
    "transaction",         // 22 SQLITE_TRANSACTION
    "update",              // 23 SQLITE_UPDATE
    "attach",              // 24 SQLITE_ATTACH
    "detach",              // 25 SQLITE_DETACH
    "alter-table",         // 26 SQLITE_ALTER_TABLE
    "reindex",             // 27 SQLITE_REINDEX
    "analyze",             // 28 SQLITE_ANALYZE
    "create-vtable",       // 29 SQLITE_CREATE_VTABLE
    "drop-vtable",         // 30 SQLITE_DROP_VTABLE
    "function",            // 31 SQLITE_FUNCTION
    "savepoint",           // 32 SQLITE_SAVEPOINT
    "recursive",           // 33 SQLITE_RECURSIVE
] as const;

/**
 * Maps a numeric SQLite authorizer action code to its
 * human-readable name, or `undefined` if the code is
 * unrecognized.
 */
export function sqliteAuthorizerActionName(code: number): string | undefined {
    return actionNames[code];
}

/**
 * Returns whether {@link action} is allowed at the given
 * {@link writeLevel}. Pass `null` for idle/setup contexts
 * (e.g. running PRAGMAs at startup) where everything
 * except attach/detach should be allowed.
 *
 * `actionArg` is the third argument SQLite hands the
 * authorizer (per-action context — for attach/detach
 * it's the filename, with `""` indicating VACUUM's
 * internal attach).
 */
export function isSqliteActionAllowed(
    action: string,
    actionArg: string | null,
    writeLevel: InternalSqliteWriteLevel | null,
): boolean {
    // `attach` / `detach` are reserved for the internal
    // `"attach"` write level used by `Database.attach()`.
    // Banning them everywhere else keeps user-supplied
    // SQL from sneaking in a schema we don't track. The
    // one exception is the empty-filename attach SQLite
    // performs internally during `VACUUM` — that one
    // rides on whatever `schema+data` already authorized.
    if (action === "attach" || action === "detach") {
        if (actionArg === "") {
            return writeLevel === "schema+data";
        }
        return writeLevel === "attach";
    }
    // Conversely, attach mode allows only the universally-
    // permitted set below — plus `pragma` so the caller
    // can pin per-attach configuration like page_size
    // before the new file is written. No DML/DDL, so an
    // action lifting writeLevel to "attach" can't also
    // smuggle in arbitrary writes.
    switch (action) {
        case "read":
        case "select":
        case "transaction":
        case "function":
        case "recursive":
            return true;
    }
    if (writeLevel === "attach") {
        return action === "pragma";
    }
    if (writeLevel === null) {
        return true;
    }
    if (writeLevel === "none") {
        return false;
    }
    switch (action) {
        case "insert":
        case "update":
        case "delete":
        case "savepoint":
            return true;
    }
    if (writeLevel === "data") {
        return false;
    }
    // "schema+data" — allow everything. Pragmas must be
    // allowed here because SQLite fires them internally
    // during DDL (e.g. ALTER TABLE).
    return true;
}
