import {sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

type DatabaseDurableObjectSqlMigration = (db: SqlStorage) => void;

/**
 * Ordered migrations for the database-group durable object's built-in SQLite.
 */
export const databaseDurableObjectSqlMigrations: ReadonlyArray<DatabaseDurableObjectSqlMigration> =
    [
        db => {
            // A `database_tables` row exists for every table id pages have been written for.
            // The CHECK spells out the three row shapes: unregistered (kind NULL — created by
            // a bare page write for the main registry file, or a policy pushed ahead of the
            // table's creation; access resolution fails closed on these), user tables (policy
            // copy, no topology), and join files (topology, whose access derives from the two
            // sides, so no policy of their own). `schema_version` mirrors the file's
            // `user_version` so server bootstrap can tell which files need migrating without
            // attaching them.
            sql`
                CREATE TABLE database_tables (
                    sqlite_id INTEGER PRIMARY KEY,
                    table_id TEXT NOT NULL UNIQUE,
                    kind TEXT,
                    table_name TEXT UNIQUE,
                    schema_version INTEGER,
                    access_policy TEXT,
                    source_table_id TEXT,
                    target_table_id TEXT,
                    file_size_in_pages INTEGER NOT NULL DEFAULT 0,
                    last_version INTEGER NOT NULL DEFAULT 0,
                    CHECK (
                        CASE kind
                            WHEN 'table' THEN table_name IS NOT NULL
                            AND schema_version IS NOT NULL
                            AND source_table_id IS NULL
                            AND target_table_id IS NULL
                            WHEN 'join' THEN table_name IS NOT NULL
                            AND schema_version IS NOT NULL
                            AND access_policy IS NULL
                            AND source_table_id IS NOT NULL
                            AND target_table_id IS NOT NULL
                            ELSE kind IS NULL
                            AND table_name IS NULL
                            AND schema_version IS NULL
                            AND source_table_id IS NULL
                            AND target_table_id IS NULL
                        END
                    )
                )
            `.exec(db);
            sql`
                CREATE TABLE database_table_pages (
                    sqlite_id INTEGER NOT NULL,
                    page_index INTEGER NOT NULL,
                    version INTEGER NOT NULL,
                    data BLOB,
                    PRIMARY KEY (sqlite_id, page_index),
                    FOREIGN KEY (sqlite_id) REFERENCES database_tables (sqlite_id)
                ) WITHOUT ROWID
            `.exec(db);
            sql`
                CREATE INDEX database_table_pages_by_version ON database_table_pages (sqlite_id, version)
            `.exec(db);
        },
    ];

export function runDatabaseDurableObjectSqlMigrations(storage: DurableObjectStorage): void {
    storage.transactionSync(() => {
        sql`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`.exec(storage.sql);
        const version =
            sql`
                SELECT
                    MAX(version)
                FROM
                    _migrations
            `.selectValue(storage.sql, Schema.integer.nullable()) ?? 0;
        assert(
            version <= databaseDurableObjectSqlMigrations.length,
            `database durable object SQL migration version (${version}) is ahead of known migrations (${databaseDurableObjectSqlMigrations.length})`,
        );

        for (let i = version; i < databaseDurableObjectSqlMigrations.length; i++) {
            assertExists(databaseDurableObjectSqlMigrations[i])(storage.sql);
            sql`
                INSERT INTO
                    _migrations (version)
                VALUES
                    (${i + 1})
            `.exec(storage.sql);
        }

        // Refresh query-planner statistics when migrations changed the schema.
        if (version < databaseDurableObjectSqlMigrations.length) {
            sql`PRAGMA optimize`.exec(storage.sql);
        }
    });
}
