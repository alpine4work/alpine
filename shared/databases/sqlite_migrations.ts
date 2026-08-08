import {type Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {SqlQuery, databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export type SqliteMigration = SqlQuery | ((db: Database) => void);

function sqlStringLiteral(value: string): SqlQuery {
    const quote = String.fromCharCode(39);
    return sql.raw(`${quote}${value.split(quote).join(quote + quote)}${quote}`);
}

/**
 * Ordered migrations for the **main** database — the one SQLite opens as schema
 * `main`. It is treated as public and holds **no real information**, only opaque
 * IDs:
 *
 * - `_alpine_tables(id, kind)` — registry of every table id, so clients can
 *   enumerate the group's tables and the server can validate attach-on-miss.
 * - `_alpine_views(id, table_id)` — view→table routing index so a bare view id
 *   from a URL resolves to its owning table without attaching every table.
 *
 * All human-readable, table-scoped metadata (names, fields, view layout) lives in
 * each table's own `ATTACH`-ed per-db file instead — see {@link
 * tableSqliteMigrations}. Server-only bookkeeping (each file's applied migration
 * version, its plaintext SQLite `table_name`, policy copies, join topology) lives
 * in the durable object's table store, which never replicates.
 */
export const mainSqliteMigrations: ReadonlyArray<SqliteMigration> = [
    sql`
        CREATE TABLE _alpine_tables (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            CHECK (is_id (id)),
            CHECK (kind IN ('table', 'join'))
        ) STRICT,
        WITHOUT ROWID;

        CREATE TABLE _alpine_views (
            id TEXT PRIMARY KEY,
            table_id TEXT NOT NULL REFERENCES _alpine_tables (id) DEFERRABLE INITIALLY DEFERRED,
            CHECK (is_id (id)),
            CHECK (is_id (table_id))
        ) STRICT,
        WITHOUT ROWID;
    `,
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
export function tableSqliteMigrations(tableId: DatabaseTableId): ReadonlyArray<SqliteMigration> {
    const schema = sql.identifier(databaseTableSchemaName(tableId));
    return [
        sql`
            CREATE TABLE ${schema}._alpine_fields (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                column_name TEXT NOT NULL,
                config BLOB NOT NULL,
                UNIQUE (column_name),
                CHECK (is_id (id)),
                CHECK (JSON_VALID(config, 8))
            ) STRICT,
            WITHOUT ROWID;

            CREATE TABLE ${schema}._alpine_views (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                CHECK (is_id (id))
            ) STRICT,
            WITHOUT ROWID;

            CREATE TABLE ${schema}._alpine_view_fields (
                view_id TEXT NOT NULL REFERENCES _alpine_views (id) DEFERRABLE INITIALLY DEFERRED,
                field_id TEXT NOT NULL REFERENCES _alpine_fields (id) DEFERRABLE INITIALLY DEFERRED,
                position TEXT NOT NULL,
                width INTEGER NOT NULL,
                is_visible INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (view_id, field_id),
                CHECK (is_id (view_id)),
                CHECK (is_id (field_id)),
                CHECK (is_order_key (position))
            ) STRICT,
            WITHOUT ROWID;

            CREATE INDEX ${schema}._alpine_view_fields_view_id ON _alpine_view_fields (view_id, position);

            CREATE TABLE ${schema}._alpine_table (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                table_name TEXT NOT NULL,
                name_field_id TEXT NOT NULL REFERENCES _alpine_fields (id) DEFERRABLE INITIALLY DEFERRED,
                CHECK (id = ${sqlStringLiteral(tableId)})
            ) STRICT,
            WITHOUT ROWID;
        `,
    ];
}

/**
 * Ordered migrations for a **join-table** database. Join table files are attached
 * like user-table files, but contain relation metadata and link rows instead of a
 * user-created data table.
 */
export function joinTableSqliteMigrations(
    tableId: DatabaseTableId,
): ReadonlyArray<SqliteMigration> {
    const schema = sql.identifier(databaseTableSchemaName(tableId));
    return [
        sql`
            CREATE TABLE ${schema}._alpine_join_table (
                id TEXT PRIMARY KEY,
                table_name TEXT NOT NULL,
                source_table_id TEXT NOT NULL,
                source_field_id TEXT NOT NULL,
                target_table_id TEXT NOT NULL,
                target_field_id TEXT NOT NULL,
                source_row_id_column_name TEXT NOT NULL,
                source_position_column_name TEXT NOT NULL,
                target_row_id_column_name TEXT NOT NULL,
                target_position_column_name TEXT NOT NULL,
                CHECK (id = ${sqlStringLiteral(tableId)}),
                CHECK (is_id (source_table_id)),
                CHECK (is_id (source_field_id)),
                CHECK (is_id (target_table_id)),
                CHECK (is_id (target_field_id))
            ) STRICT,
            WITHOUT ROWID
        `,
    ];
}

/**
 * Runs any pending {@link mainSqliteMigrations} against the main database. Uses
 * `PRAGMA user_version` to track which migrations have already been applied.
 *
 * Opens no transaction of its own: the caller decides whether to wrap the run in
 * one (statements autocommit otherwise). This lets migrations run inside an
 * already-open transaction — e.g. a database action's automatic transaction —
 * where a nested `BEGIN` would fail.
 */
export function runMainMigrations(db: Database, migrationLimitForTest?: number): void {
    if (migrationLimitForTest) {
        assert(import.meta.jest);
    }

    const migrationLimit = migrationLimitForTest ?? mainSqliteMigrations.length;
    const version = sql`PRAGMA user_version`.selectValue(db, Schema.integer);
    assert(
        version <= migrationLimit,
        `main user_version (${version}) is ahead of known migrations (${migrationLimit})`,
    );
    for (let i = version; i < migrationLimit; i++) {
        const migration = assertExists(mainSqliteMigrations[i]);
        if (migration instanceof SqlQuery) {
            migration.exec(db);
        } else {
            migration(db);
        }
    }
    if (version < migrationLimit) {
        db.exec(`PRAGMA user_version = ${migrationLimit}`);
        // Refresh query-planner statistics now that migrations changed the schema.
        db.exec("PRAGMA main.optimize");
    }
}

/**
 * Runs any pending {@link tableSqliteMigrations} against `tableId`'s `ATTACH`-ed
 * per-table database. Tracks progress with that schema's own
 * `PRAGMA "_{tableId}".user_version`. The durable object's table store mirrors the
 * applied version per table so server bootstrap can tell which files need
 * migrating without attaching them; keeping that mirror current is the caller's
 * job (registration stamps it, bootstrap repairs it after migrating).
 *
 * Opens no transaction of its own — see {@link runMainMigrations}.
 *
 * Runs server-side only: the server is canonical for schema, and clients trust the
 * pages it syncs.
 */
export function runTableMigrations(
    db: Database,
    tableId: DatabaseTableId,
    migrationLimitForTest?: number,
): void {
    runSchemaMigrations(db, tableId, "table", migrationLimitForTest);
}

/**
 * Runs any pending {@link joinTableSqliteMigrations} against `tableId`'s
 * `ATTACH`-ed join-table database. Version tracking mirrors {@link
 * runTableMigrations}.
 */
export function runJoinTableMigrations(
    db: Database,
    tableId: DatabaseTableId,
    migrationLimitForTest?: number,
): void {
    runSchemaMigrations(db, tableId, "join", migrationLimitForTest);
}

function runSchemaMigrations(
    db: Database,
    tableId: DatabaseTableId,
    kind: "table" | "join",
    migrationLimitForTest?: number,
): void {
    if (migrationLimitForTest) {
        assert(import.meta.jest);
    }

    const migrations =
        kind === "table" ? tableSqliteMigrations(tableId) : joinTableSqliteMigrations(tableId);
    const description = kind === "table" ? "table" : "join table";
    const migrationLimit = migrationLimitForTest ?? migrations.length;
    const schema = sql.identifier(databaseTableSchemaName(tableId));
    const version = sql`PRAGMA ${schema}.user_version`.selectValue(db, Schema.integer);
    assert(
        version <= migrationLimit,
        `${description} ${tableId} user_version (${version}) is ahead of known migrations (${migrationLimit})`,
    );

    for (let i = version; i < migrationLimit; i++) {
        const migration = assertExists(migrations[i]);
        if (migration instanceof SqlQuery) {
            migration.exec(db);
        } else {
            migration(db);
        }
    }

    if (version < migrationLimit) {
        sql` PRAGMA ${schema}.user_version = ${sql.raw(String(migrationLimit))} `.exec(db);
        // Refresh query-planner statistics now that migrations changed the schema.
        sql` PRAGMA ${schema}.optimize `.exec(db);
    }
}
