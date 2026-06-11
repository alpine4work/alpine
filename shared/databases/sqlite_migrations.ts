/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export type SqliteMigration = string | ((db: Database) => void);

/**
 * Ordered migrations for the **main** database — the one SQLite opens as schema
 * `main`. It is treated as public and holds **no real information**, only opaque
 * IDs:
 *
 * - `_alpine_tables(id, kind)` — registry of every table id; drives cold-open
 *   attach of per-table databases.
 * - `_alpine_views(id, table_id)` — view→table routing index so a bare view id
 *   from a URL resolves to its owning table without attaching every table.
 *
 * All human-readable, table-scoped metadata (names, fields, view layout) lives in
 * each table's own `ATTACH`-ed per-db file instead — see {@link
 * tableSqliteMigrations}.
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
    `ALTER TABLE _alpine_tables
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'table' CHECK (kind IN ('table', 'join'));`,
];

/**
 * A per-table migration. Unlike main migrations, these run against an `ATTACH`-ed
 * schema, so they receive the schema name (the table id) to qualify their DDL.
 */
export type TableSqliteMigration = (db: Database, tableId: DatabaseTableId) => void;

/**
 * Ordered migrations for a **per-table** database — the `ATTACH`-ed file that
 * holds one user table's data plus all of its real metadata, none of which is
 * allowed in the public main database:
 *
 * - `_alpine_table(id, name, table_name, name_field_id)` — this table's display
 *   name, SQLite identifier, and record-name field (singleton row).
 * - `_alpine_fields` / `_alpine_views` / `_alpine_view_fields` — the table's
 *   columns and grid-view layout.
 *
 * The data table itself is created by the `createTable` action, not here.
 */
export const tableSqliteMigrations: ReadonlyArray<TableSqliteMigration> = [
    function migration1(db: Database, tableId: DatabaseTableId): void {
        // `REFERENCES` parent tables stay unqualified — SQLite resolves a foreign key's
        // parent within the same database as the child. Index names carry the schema;
        // their `ON` table stays unqualified (resolved within that schema).
        sql`
            CREATE TABLE ${sql.tableRef(tableId, "_alpine_table")} (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                table_name TEXT NOT NULL,
                CHECK (is_id (id))
            ) STRICT,
            WITHOUT ROWID
        `.exec(db);
        sql`
            CREATE TABLE ${sql.tableRef(tableId, "_alpine_fields")} (
                id TEXT PRIMARY KEY,
                table_id TEXT NOT NULL REFERENCES _alpine_table (id),
                name TEXT NOT NULL,
                column_name TEXT NOT NULL,
                config TEXT NOT NULL,
                UNIQUE (table_id, column_name),
                CHECK (is_id (id)),
                CHECK (is_id (table_id))
            ) STRICT,
            WITHOUT ROWID
        `.exec(db);
        sql`
            CREATE INDEX ${sql.tableRef(
                tableId,
                "_alpine_fields_table_id",
            )} ON _alpine_fields (table_id)
        `.exec(db);
        sql`
            CREATE TABLE ${sql.tableRef(tableId, "_alpine_views")} (
                id TEXT PRIMARY KEY,
                table_id TEXT NOT NULL REFERENCES _alpine_table (id),
                name TEXT NOT NULL,
                CHECK (is_id (id)),
                CHECK (is_id (table_id))
            ) STRICT,
            WITHOUT ROWID
        `.exec(db);
        sql`
            CREATE INDEX ${sql.tableRef(
                tableId,
                "_alpine_views_table_id",
            )} ON _alpine_views (table_id)
        `.exec(db);
        sql`
            CREATE TABLE ${sql.tableRef(tableId, "_alpine_view_fields")} (
                view_id TEXT NOT NULL REFERENCES _alpine_views (id),
                field_id TEXT NOT NULL REFERENCES _alpine_fields (id),
                position TEXT NOT NULL,
                width INTEGER NOT NULL,
                hidden INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (view_id, field_id),
                CHECK (is_id (view_id)),
                CHECK (is_id (field_id)),
                CHECK (is_order_key (position))
            ) STRICT,
            WITHOUT ROWID
        `.exec(db);
    },
    function migration2(db: Database, tableId: DatabaseTableId): void {
        sql`
            ALTER TABLE ${sql.tableRef(tableId, "_alpine_table")}
            ADD COLUMN name_field_id TEXT
        `.exec(db);
        sql`
            UPDATE ${sql.tableRef(tableId, "_alpine_table")}
            SET
                name_field_id = (
                    SELECT
                        MIN(id)
                    FROM
                        ${sql.tableRef(tableId, "_alpine_fields")}
                )
            WHERE
                name_field_id IS NULL
        `.exec(db);
    },
];

/**
 * Ordered migrations for a **join-table** database. Join table files are attached
 * like user-table files, but contain relation metadata and link rows instead of a
 * user-created data table.
 */
export const joinTableSqliteMigrations: ReadonlyArray<TableSqliteMigration> = [
    function migration1(db: Database, tableId: DatabaseTableId): void {
        sql`
            CREATE TABLE ${sql.tableRef(tableId, "_alpine_join_table")} (
                id TEXT PRIMARY KEY,
                source_table_id TEXT NOT NULL,
                source_field_id TEXT NOT NULL,
                target_table_id TEXT NOT NULL,
                target_field_id TEXT NOT NULL,
                CHECK (is_id (id)),
                CHECK (is_id (source_table_id)),
                CHECK (is_id (source_field_id)),
                CHECK (is_id (target_table_id)),
                CHECK (is_id (target_field_id))
            ) STRICT,
            WITHOUT ROWID
        `.exec(db);
        sql`
            CREATE TABLE ${sql.tableRef(tableId, "_alpine_links")} (
                source_row_id TEXT NOT NULL,
                target_row_id TEXT NOT NULL,
                _created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
                UNIQUE (source_row_id, target_row_id),
                CHECK (is_id (source_row_id)),
                CHECK (is_id (target_row_id)),
                CHECK (DATETIME(_created_at) IS NOT NULL)
            ) STRICT
        `.exec(db);
        sql`
            CREATE INDEX ${sql.tableRef(
                tableId,
                "_alpine_links_source",
            )} ON _alpine_links (source_row_id)
        `.exec(db);
        sql`
            CREATE INDEX ${sql.tableRef(
                tableId,
                "_alpine_links_target",
            )} ON _alpine_links (target_row_id)
        `.exec(db);
    },
];

/**
 * Runs any pending {@link mainSqliteMigrations} against the main database. Uses
 * `PRAGMA user_version` to track which migrations have already been applied.
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
 * Runs any pending {@link tableSqliteMigrations} against `tableId`'s `ATTACH`-ed
 * per-table database. Tracks progress with that schema's own
 * `PRAGMA "_{tableId}".user_version`.
 *
 * Runs server-side only: the server is canonical for schema, and clients trust the
 * pages it syncs.
 */
export function runTableMigrations(db: Database, tableId: DatabaseTableId): void {
    runSchemaMigrations(db, tableId, tableSqliteMigrations, "table");
}

/**
 * Runs any pending {@link joinTableSqliteMigrations} against `tableId`'s
 * `ATTACH`-ed join-table database.
 */
export function runJoinTableMigrations(db: Database, tableId: DatabaseTableId): void {
    runSchemaMigrations(db, tableId, joinTableSqliteMigrations, "join table");
}

function runSchemaMigrations(
    db: Database,
    tableId: DatabaseTableId,
    migrations: ReadonlyArray<TableSqliteMigration>,
    description: string,
): void {
    const schema = sql.identifier(databaseTableSchemaName(tableId));
    const version = sql`PRAGMA ${schema}.user_version`.selectValue(db, Schema.integer);
    assert(
        version <= migrations.length,
        `${description} ${tableId} user_version (${version}) is ahead of known migrations (${migrations.length})`,
    );
    for (let i = version; i < migrations.length; i++) {
        migrations[i]!(db, tableId);
    }
    if (version < migrations.length) {
        // PRAGMA values can't be bound, so the (trusted) migration count is inlined with
        // `sql.raw`.
        sql` PRAGMA ${schema}.user_version = ${sql.raw(String(migrations.length))} `.exec(db);
    }
}
