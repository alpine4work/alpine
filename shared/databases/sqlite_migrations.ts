import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Ordered list of schema migrations for Alpine's internal
 * SQLite tables. Each entry is a SQL string executed once,
 * tracked by `PRAGMA user_version`.
 */
export const sqliteMigrations: ReadonlyArray<string> = [
    `CREATE TABLE _alpine_tables (
        id TEXT PRIMARY KEY DEFAULT (generate_id()),
        name TEXT NOT NULL,
        table_name TEXT NOT NULL UNIQUE,
        CHECK(is_id(id))
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE _alpine_fields (
        id TEXT PRIMARY KEY DEFAULT (generate_id()),
        table_id TEXT NOT NULL REFERENCES _alpine_tables(id),
        name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        type TEXT NOT NULL,
        UNIQUE(table_id, column_name),
        CHECK(is_id(id)),
        CHECK(is_id(table_id))
    ) STRICT, WITHOUT ROWID;

    CREATE INDEX _alpine_fields_table_id ON _alpine_fields(table_id);

    CREATE TABLE _alpine_views (
        id TEXT PRIMARY KEY DEFAULT (generate_id()),
        table_id TEXT NOT NULL REFERENCES _alpine_tables(id),
        name TEXT NOT NULL,
        CHECK(is_id(id)),
        CHECK(is_id(table_id))
    ) STRICT, WITHOUT ROWID;

    CREATE INDEX _alpine_views_table_id ON _alpine_views(table_id);

    CREATE TABLE _alpine_view_fields (
        view_id TEXT NOT NULL REFERENCES _alpine_views(id),
        field_id TEXT NOT NULL REFERENCES _alpine_fields(id),
        position INTEGER NOT NULL,
        width INTEGER NOT NULL,
        PRIMARY KEY (view_id, field_id),
        CHECK(is_id(view_id)),
        CHECK(is_id(field_id))
    ) STRICT, WITHOUT ROWID;`,
];

/**
 * Runs any pending migrations from {@link sqliteMigrations}
 * against the given database. Uses `PRAGMA user_version`
 * (defaults to 0 for new databases) to track which
 * migrations have already been applied.
 */
export function runSqliteMigrations(db: Database): void {
    const version = sql`PRAGMA user_version`.selectValue(db, Schema.integer);
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
