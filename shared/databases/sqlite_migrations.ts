import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateOrderKeysBetween} from "~/shared/helpers/sort/order_key.js";
import {Schema} from "~/shared/schema/schema.js";

export type SqliteMigration = string | ((db: Database) => void);

/**
 * Ordered list of schema migrations for Alpine's internal
 * SQLite tables. Each entry is either a SQL string
 * executed once or a function receiving the database
 * handle. Tracked by `PRAGMA user_version`.
 */
export const sqliteMigrations: ReadonlyArray<SqliteMigration> = [
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

    // Migration 2: rename type -> config, position INTEGER -> TEXT order key
    function migration2(db: Database): void {
        // 1. Rename _alpine_fields.type -> config
        db.exec(`ALTER TABLE _alpine_fields RENAME COLUMN type TO config`);

        // 2. Create new view fields table with TEXT position
        db.exec(`CREATE TABLE _alpine_view_fields_new (
            view_id TEXT NOT NULL REFERENCES _alpine_views(id),
            field_id TEXT NOT NULL REFERENCES _alpine_fields(id),
            position TEXT NOT NULL,
            width INTEGER NOT NULL,
            PRIMARY KEY (view_id, field_id),
            CHECK(is_id(view_id)),
            CHECK(is_id(field_id)),
            CHECK(is_order_key(position))
        ) STRICT, WITHOUT ROWID`);

        // 3. Migrate data: read old rows grouped by view_id,
        //    generate order keys, insert into new table.
        const rows = sql`
            SELECT
                view_id,
                field_id,
                position,
                width
            FROM
                _alpine_view_fields
            ORDER BY
                view_id,
                position
        `.selectAll(db, {
            viewId: Schema.string.originalPropertyKey("view_id"),
            fieldId: Schema.string.originalPropertyKey("field_id"),
            position: Schema.integer,
            width: Schema.integer,
        });

        // Group by view_id
        const groups = new Map<string, Array<{fieldId: string; width: number}>>();
        for (const row of rows) {
            let group = groups.get(row.viewId);
            if (group == null) {
                group = [];
                groups.set(row.viewId, group);
            }
            group.push({fieldId: row.fieldId, width: row.width});
        }

        for (const [viewId, group] of groups) {
            const keys = generateOrderKeysBetween(null, null, group.length);
            for (let i = 0; i < group.length; i++) {
                sql`
                    INSERT INTO
                        _alpine_view_fields_new (view_id, field_id, position, width)
                    VALUES
                        (
                            ${viewId},
                            ${group[i]!.fieldId},
                            ${keys[i] as string},
                            ${group[i]!.width}
                        )
                `.exec(db);
            }
        }

        // 4. Drop old table, rename new
        db.exec(`DROP TABLE _alpine_view_fields`);
        db.exec(`ALTER TABLE _alpine_view_fields_new RENAME TO _alpine_view_fields`);
    },

    // Migration 3: add hidden column to _alpine_view_fields
    `ALTER TABLE _alpine_view_fields ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`,
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
        const migration = sqliteMigrations[i]!;
        if (typeof migration === "string") {
            db.exec(migration);
        } else {
            migration(db);
        }
    }
    if (version < sqliteMigrations.length) {
        db.exec(`PRAGMA user_version = ${sqliteMigrations.length}`);
    }
}
