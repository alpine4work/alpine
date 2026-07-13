/**
 * Shared SQLite authorizer logic used by both the server ({@link DatabaseServer})
 * and the client ({@link DatabaseClient}) to enforce write-level permissions on
 * SQL statements.
 */

import {type AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Controls which SQL operations are permitted in normal execution paths:
 *
 * - `"none"` — read-only: select, read, transaction, function, recursive.
 * - `"data"` — above + DML on non-`_` tables: insert, update, delete, savepoint.
 * - `"schema+data"` — above + DDL + pragma.
 *
 * `ATTACH` / `DETACH` are NOT permitted at any of these levels; they're gated
 * behind the internal {@link InternalSqliteWriteLevel} value `"attach"`, which
 * only `Database.attach()` is allowed to use.
 */
export type SqliteWriteLevel = "none" | "data" | "schema+data";

/**
 * Internal extension of {@link SqliteWriteLevel} that adds the `"attach"` mode:
 * the only mode under which the authorizer permits `SQLITE_ATTACH` /
 * `SQLITE_DETACH`. Used by `Database.attach()` to briefly authorize an ATTACH
 * around the SQL it issues itself; never exposed in public APIs.
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

/** A human-readable SQLite authorizer action name. */
export type SqliteActionName = Exclude<(typeof actionNames)[number], undefined>;

/**
 * Maps a numeric SQLite authorizer action code to its human-readable name, or
 * `undefined` if the code is unrecognized.
 */
export function sqliteAuthorizerActionName(code: number): SqliteActionName | undefined {
    return actionNames[code];
}

/**
 * Returns whether {@link action} is allowed at the given {@link writeLevel}. Pass
 * `null` for idle/setup contexts (e.g. running PRAGMAs at startup) where
 * everything except attach/detach should be allowed.
 *
 * `actionArg` is the third argument SQLite hands the authorizer. For DML it is the
 * target table name; for attach/detach it is the filename, with `""` indicating
 * VACUUM's internal attach.
 */
export function isSqliteActionAllowed(
    action: SqliteActionName,
    actionArg: string | null,
    writeLevel: InternalSqliteWriteLevel | null,
): boolean {
    switch (action) {
        case "read":
        case "select":
        case "transaction":
        case "function":
        case "recursive":
            return true;
        case "attach":
        case "detach":
            // Public ATTACH/DETACH would let SQL introduce an untracked schema. The empty
            // filename is SQLite's internal VACUUM attach, which instead inherits the
            // schema-write requirement.
            return actionArg === "" ? writeLevel === "schema+data" : writeLevel === "attach";
        case "pragma":
            // Attach mode needs schema-qualified page-size PRAGMAs, and SQLite may issue
            // PRAGMAs internally while applying DDL.
            return writeLevel === null || writeLevel === "attach" || writeLevel === "schema+data";
        case "insert":
        case "update":
        case "delete":
            // `_` tables are Alpine/SQLite metadata. Mutating one is a schema-level operation
            // even though SQLite reports it as ordinary DML.
            if (actionArg?.startsWith("_") === true) {
                return writeLevel === null || writeLevel === "schema+data";
            }
            return writeLevel === null || writeLevel === "data" || writeLevel === "schema+data";
        case "savepoint":
            return writeLevel === null || writeLevel === "data" || writeLevel === "schema+data";
        case "create-index":
        case "create-table":
        case "create-temp-index":
        case "create-temp-table":
        case "create-temp-trigger":
        case "create-temp-view":
        case "create-trigger":
        case "create-view":
        case "drop-index":
        case "drop-table":
        case "drop-temp-index":
        case "drop-temp-table":
        case "drop-temp-trigger":
        case "drop-temp-view":
        case "drop-trigger":
        case "drop-view":
        case "alter-table":
        case "reindex":
        case "analyze":
        case "create-vtable":
        case "drop-vtable":
            return writeLevel === null || writeLevel === "schema+data";
        default:
            throw exhaustive(action);
    }
}

/**
 * Per-table access enforced by the authorizer within a single execution. Resolved
 * per attached schema from the current execution's required access resolver.
 *
 * The join-table add-vs-remove asymmetry (adding a link needs `View` on the linked
 * table, removing one doesn't) is _not_ modelled here. Adding a link reads the
 * referenced row to verify it exists (`addLink`'s `rowExists` check), so the
 * linked table's `View` requirement already gates it; removing a link reads
 * nothing.
 */
export type SqliteSchemaAccessResolver = (schemaName: string) => AccessLevel | null;

/**
 * The per-table authorization layer, checked _in addition to_ {@link
 * isSqliteActionAllowed}'s global write level. Returns whether `action` is allowed
 * given the capabilities the resolver grants on the target schema.
 *
 * Internal attach/recovery SQL bypasses this layer.
 *
 * Argument mapping follows sqlite3_set_authorizer: for most table-scoped actions
 * `arg1` is the object name and `schemaName` (the callback's 5th parameter) is the
 * database name — except `alter-table`, which reports the database name in `arg1`
 * and the table name in `arg2`.
 */
export function isSqliteActionAllowedForSchemaAccess({
    action,
    arg1,
    arg2,
    schemaName,
    resolveSchemaAccess,
}: {
    action: SqliteActionName;
    arg1: string | null;
    arg2: string | null;
    schemaName: string | null;
    resolveSchemaAccess: SqliteSchemaAccessResolver;
}): boolean {
    const requirement = sqliteSchemaAccessRequirement(action);
    if (requirement === null) return true;

    const targetSchemaName = action === "alter-table" ? arg1 : schemaName;
    if (targetSchemaName === null) {
        // Two schema-scoped actions legitimately arrive without a database name;
        // everything else without one fails closed.
        //
        // - A supplementary whole-table `read` probe with an empty column name fires
        //   during statement compilation (e.g. the min/max/count optimization check in
        //   select.c). It grants nothing by itself: every real column read — and the
        //   count(\*) whole-table read on an attached schema — arrives with its schema
        //   name and is authorized above.
        // - Unqualified pragmas (SQLite's own DDL-internal pragmas, and the server's
        //   post-write `PRAGMA optimize`) aren't table-scoped. Schema-qualified pragmas
        //   (e.g. `PRAGMA "_x".integrity_check`) do carry the schema and stay restricted;
        //   and no public action path can issue arbitrary pragmas — the global write-level
        //   layer only permits pragmas at `schema+data`, which no raw-SQL action runs at.
        if (action === "read") return arg2 === "" || arg2 === null;
        return action === "pragma";
    }

    const accessLevel = resolveSchemaAccess(targetSchemaName);

    return hasAccessLevel(accessLevel, requirement);
}

/**
 * The access level an action requires on its target schema, or `null` for actions
 * that aren't schema-scoped (gated by the global write level only).
 */
function sqliteSchemaAccessRequirement(action: SqliteActionName): AccessLevel | null {
    switch (action) {
        case "read":
            return "View";
        case "insert":
        case "update":
        case "delete":
            return "Edit";
        case "create-index":
        case "create-table":
        case "create-temp-index":
        case "create-temp-table":
        case "create-temp-trigger":
        case "create-temp-view":
        case "create-trigger":
        case "create-view":
        case "create-vtable":
        case "drop-index":
        case "drop-table":
        case "drop-temp-index":
        case "drop-temp-table":
        case "drop-temp-trigger":
        case "drop-temp-view":
        case "drop-trigger":
        case "drop-view":
        case "drop-vtable":
        case "alter-table":
        case "reindex":
        case "analyze":
        case "pragma":
            return "Edit";
        case "select":
        case "transaction":
        case "savepoint":
        case "function":
        case "recursive":
        case "attach":
        case "detach":
            return null;
        default:
            throw exhaustive(action);
    }
}
