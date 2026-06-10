import type {
    Database,
    SqlValue,
    Sqlite3Static,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {registerSqliteTableFunction} from "~/shared/databases/sqlite_table_function.js";
import {InternalError} from "~/shared/error/error.js";
import {
    type OrderKey,
    generateOrderKeyBetween,
    generateOrderKeysBetween,
    isOrderKey,
} from "~/shared/helpers/sort/order_key.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {isId} from "~/shared/id/id.js";

/**
 * Registers Alpine's custom SQL functions on a SQLite database handle. Must be
 * called before {@link runMainMigrations} since the migration DDL references these
 * functions.
 *
 * - `generate_id()` — returns a new 26-char `ChronologicalId`. Non-deterministic.
 * - `is_id(value)` — returns 1 if `value` is a well-formed Alpine ID, 0 otherwise.
 *   Deterministic.
 * - `generate_order_key(a, b)` — returns an order key between `a` and `b` (both
 *   `TEXT|NULL`). Deterministic.
 * - `is_order_key(value)` — returns 1 if `value` is a valid order key, 0
 *   otherwise. Deterministic.
 * - `generate_order_keys(a, b, n)` — table-valued function returning `n` order
 *   keys between `a` and `b`.
 */
export function registerSqliteCustomFunctions(sqlite3: Sqlite3Static, db: Database): void {
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

    db.createFunction("generate_order_key", {
        xFunc: (_ctxPtr: number, a: SqlValue, b: SqlValue) => {
            return generateOrderKeyBetween(
                toOrderKeyArg(a, "generate_order_key", "a"),
                toOrderKeyArg(b, "generate_order_key", "b"),
            );
        },
        deterministic: true,
        innocuous: true,
        arity: 2,
    });

    db.createFunction("is_order_key", {
        xFunc: (_ctxPtr: number, value: SqlValue) => {
            return typeof value === "string" && isOrderKey(value) ? 1 : 0;
        },
        deterministic: true,
        innocuous: true,
        arity: 1,
    });

    registerSqliteTableFunction(sqlite3, db, "generate_order_keys", {
        columns: ["value"],
        args: ["a", "b", "n"],
        compute: (a: SqlValue, b: SqlValue, n: SqlValue) => {
            const keys = generateOrderKeysBetween(
                toOrderKeyArg(a, "generate_order_keys", "a"),
                toOrderKeyArg(b, "generate_order_keys", "b"),
                typeof n === "number" ? n : 0,
            );
            return keys.map(key => [key]);
        },
    });
}

function toOrderKeyArg(value: SqlValue, fnName: string, argName: string): OrderKey | null {
    if (value === null) return null;
    if (typeof value === "string" && isOrderKey(value)) return value;
    throw new InternalError(
        `${fnName}(): argument \u2018${argName}\u2019 is not a valid order key: ${String(value)}`,
    );
}
