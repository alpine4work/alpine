import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Ordered list of schema migrations for Alpine's internal
 * SQLite tables. Each entry is a SQL string executed once,
 * tracked by `PRAGMA user_version`.
 */
export const sqliteMigrations: ReadonlyArray<string> = [
    `CREATE TABLE _alpine_tables (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        table_name TEXT NOT NULL UNIQUE
    ) STRICT;

    CREATE TABLE _alpine_fields (
        id INTEGER PRIMARY KEY,
        table_id INTEGER NOT NULL REFERENCES _alpine_tables(id),
        name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        type TEXT NOT NULL,
        UNIQUE(table_id, column_name)
    ) STRICT;

    CREATE INDEX _alpine_fields_table_id ON _alpine_fields(table_id);`,
];

/**
 * Runs any pending migrations from {@link sqliteMigrations}
 * against the given database. Uses `PRAGMA user_version`
 * (defaults to 0 for new databases) to track which
 * migrations have already been applied.
 */
export function runSqliteMigrations(db: Database): void {
    const version = db.selectValue("PRAGMA user_version") as number;
    assert(
        version <= sqliteMigrations.length,
        `database user_version (${version}) is ahead of known migrations (${sqliteMigrations.length})`,
    );
    for (let i = version; i < sqliteMigrations.length; i++) {
        db.exec(sqliteMigrations[i]!);
    }
    if (version < sqliteMigrations.length) {
        db.exec(`PRAGMA user_version = ${sqliteMigrations.length}`);
    }
}
