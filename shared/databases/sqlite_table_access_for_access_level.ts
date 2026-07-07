import type {AccessLevel} from "~/shared/access/access_policy.js";
import {
    type SqliteTableAccess,
    deniedSqliteTableAccess,
    unrestrictedSqliteTableAccess,
} from "~/shared/databases/sqlite_authorizer.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Maps an account's {@link AccessLevel} on a database table (`null` = no access)
 * to the SQLite capabilities the authorizer enforces per statement.
 *
 * The v1 mapping: `View`/`Comment` are read-only; `Edit`/`Manage` grant everything
 * including schema changes (databases have no row comments yet, and field creation
 * — DDL — is an `Edit`-level product feature).
 */
export function sqliteTableAccessForAccessLevel(level: AccessLevel | null): SqliteTableAccess {
    if (level === null) return deniedSqliteTableAccess;
    switch (level) {
        case "View":
        case "Comment":
            return {read: true, insert: false, updateDelete: false, schema: false};
        case "Edit":
        case "Manage":
            return unrestrictedSqliteTableAccess;
        default:
            throw exhaustive(level);
    }
}
