import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";

export type SqliteMigration = string | ((db: Database) => void);

/**
 * Ordered migrations for the **main** database — the one
 * SQLite opens as schema `main`. It is treated as public
 * and holds **no real information**, only opaque IDs:
 *
 * - `_alpine_tables(id)` — registry of every table id;
 *   drives cold-open attach of per-table databases.
 * - `_alpine_views(id, table_id)` — view→table routing
 *   index so a bare view id from a URL resolves to its
 *   owning table without attaching every table.
 *
 * All human-readable, table-scoped metadata (names,
 * fields, view layout) lives in each table's own
 * `ATTACH`-ed per-db file instead — see
 * {@link tableSqliteMigrations}.
 */
export const mainSqliteMigrations: ReadonlyArray<SqliteMigration> = [
    `CREATE TABLE _alpine_tables (
        id TEXT PRIMARY KEY,
        CHECK(is_id(id))
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE _alpine_views (
        id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL REFERENCES _alpine_tables(id),
        CHECK(is_id(id)),
        CHECK(is_id(table_id))
    ) STRICT, WITHOUT ROWID;

    CREATE INDEX _alpine_views_table_id ON _alpine_views(table_id);`,
];

/**
 * A per-table migration. Unlike main migrations, these run
 * against an `ATTACH`-ed schema, so they receive the schema
 * name (the table id) to qualify their DDL.
 */
export type TableSqliteMigration = (db: Database, schema: string) => void;

/**
 * Ordered migrations for a **per-table** database — the
 * `ATTACH`-ed file that holds one user table's data plus
 * all of its real metadata, none of which is allowed in
 * the public main database:
 *
 * - `_alpine_table(id, name, table_name)` — this table's
 *   display name and SQLite identifier (singleton row).
 * - `_alpine_fields` / `_alpine_views` / `_alpine_view_fields`
 *   — the table's columns and grid-view layout.
 *
 * The data table itself is created by the `createTable`
 * action, not here.
 */
export const tableSqliteMigrations: ReadonlyArray<TableSqliteMigration> = [
    function migration1(db: Database, schema: string): void {
        // `REFERENCES` parent tables stay unqualified — SQLite
        // resolves a foreign key's parent within the same
        // database as the child. Index names carry the schema;
        // their `ON` table stays unqualified (resolved within
        // that schema).
        db.exec(`CREATE TABLE ${ref(schema, "_alpine_table")} (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            table_name TEXT NOT NULL,
            CHECK(is_id(id))
        ) STRICT, WITHOUT ROWID;

        CREATE TABLE ${ref(schema, "_alpine_fields")} (
            id TEXT PRIMARY KEY,
            table_id TEXT NOT NULL REFERENCES _alpine_table(id),
            name TEXT NOT NULL,
            column_name TEXT NOT NULL,
            config TEXT NOT NULL,
            UNIQUE(table_id, column_name),
            CHECK(is_id(id)),
            CHECK(is_id(table_id))
        ) STRICT, WITHOUT ROWID;

        CREATE INDEX ${ref(schema, "_alpine_fields_table_id")} ON _alpine_fields(table_id);

        CREATE TABLE ${ref(schema, "_alpine_views")} (
            id TEXT PRIMARY KEY,
            table_id TEXT NOT NULL REFERENCES _alpine_table(id),
            name TEXT NOT NULL,
            CHECK(is_id(id)),
            CHECK(is_id(table_id))
        ) STRICT, WITHOUT ROWID;

        CREATE INDEX ${ref(schema, "_alpine_views_table_id")} ON _alpine_views(table_id);

        CREATE TABLE ${ref(schema, "_alpine_view_fields")} (
            view_id TEXT NOT NULL REFERENCES _alpine_views(id),
            field_id TEXT NOT NULL REFERENCES _alpine_fields(id),
            position TEXT NOT NULL,
            width INTEGER NOT NULL,
            hidden INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (view_id, field_id),
            CHECK(is_id(view_id)),
            CHECK(is_id(field_id)),
            CHECK(is_order_key(position))
        ) STRICT, WITHOUT ROWID;`);
    },
];

/**
 * Runs any pending {@link mainSqliteMigrations} against the
 * main database. Uses `PRAGMA user_version` to track which
 * migrations have already been applied.
 */
export function runMainMigrations(db: Database): void {
    const version = sql`PRAGMA user_version`.selectValue(db, Schema.integer);
    assert(
        version <= mainSqliteMigrations.length,
        `main user_version (${version}) is ahead of known migrations (${mainSqliteMigrations.length})`,
    );
    for (let i = version; i < mainSqliteMigrations.length; i++) {
        const migration = mainSqliteMigrations[i]!;
        if (typeof migration === "string") {
            db.exec(migration);
        } else {
            migration(db);
        }
    }
    if (version < mainSqliteMigrations.length) {
        db.exec(`PRAGMA user_version = ${mainSqliteMigrations.length}`);
    }
}

/**
 * Runs any pending {@link tableSqliteMigrations} against the
 * `ATTACH`-ed per-table database named `schema` (the table
 * id). Tracks progress with that schema's own
 * `PRAGMA "{schema}".user_version`.
 *
 * Runs server-side only: the server is canonical for schema,
 * and clients trust the pages it syncs.
 */
export function runTableMigrations(db: Database, schema: string): void {
    const userVersionPragma = `PRAGMA ${sql.identifier(schema).query}.user_version`;
    const version = sql.raw(userVersionPragma).selectValue(db, Schema.integer);
    assert(
        version <= tableSqliteMigrations.length,
        `table ${schema} user_version (${version}) is ahead of known migrations (${tableSqliteMigrations.length})`,
    );
    for (let i = version; i < tableSqliteMigrations.length; i++) {
        tableSqliteMigrations[i]!(db, schema);
    }
    if (version < tableSqliteMigrations.length) {
        db.exec(`${userVersionPragma} = ${tableSqliteMigrations.length}`);
    }
}

/** Build a `"schema"."name"` identifier for migration DDL. */
function ref(schema: string, name: string): string {
    return sql.tableRef(schema, name).query;
}
