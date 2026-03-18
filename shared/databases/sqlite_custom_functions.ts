import type {Database, SqlValue} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {isId} from "~/shared/id/id.js";

/**
 * Registers Alpine's custom SQL functions on a SQLite
 * database handle. Must be called before
 * {@link runSqliteMigrations} since the migration DDL
 * references these functions.
 *
 * - `generate_id()` — returns a new 26-char
 *   `ChronologicalId`. Non-deterministic.
 * - `is_id(value)` — returns 1 if `value` is a
 *   well-formed Alpine ID, 0 otherwise. Deterministic.
 */
export function registerSqliteCustomFunctions(db: Database): void {
    db.createFunction("generate_id", {
        xFunc: () => generateChronologicalId(),
        arity: 0,
        innocuous: true,
    });

    db.createFunction("is_id", {
        xFunc: (_ctxPtr: number, value: SqlValue) => {
            return typeof value === "string" && isId(value) ? 1 : 0;
        },
        deterministic: true,
        innocuous: true,
        arity: 1,
    });
}
