import {type Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {sql} from "~/shared/databases/sql.js";

/**
 * Run `fn` inside a SQLite `BEGIN`/`COMMIT`, rolling back on error so a failed
 * `fn` doesn't leave the transaction open — which would make every subsequent
 * `BEGIN` on this connection fail.
 *
 * SQLite has no nested transactions, so callers must not already hold one open.
 */
export function executeSqliteTransaction<T>(db: Database, fn: () => T): T {
    sql`BEGIN`.exec(db);
    let result;
    try {
        result = fn();
    } catch (error) {
        sql`ROLLBACK`.exec(db);
        throw error;
    }
    sql`COMMIT`.exec(db);
    return result;
}
