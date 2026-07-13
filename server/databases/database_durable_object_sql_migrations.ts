import {assert} from "~/shared/helpers/control/assert.js";

type DatabaseDurableObjectSqlMigration = (sql: SqlStorage) => void;

/**
 * Ordered migrations for the database-group durable object's built-in SQLite.
 */
export const databaseDurableObjectSqlMigrations: ReadonlyArray<DatabaseDurableObjectSqlMigration> =
    [
        sql => {
            // A `database_tables` row exists for every table id pages have been written for.
            // The CHECK spells out the three row shapes: unregistered (kind NULL — created by
            // a bare page write for the main registry file, or a policy pushed ahead of the
            // table's creation; access resolution fails closed on these), user tables (policy
            // copy, no topology), and join files (topology, whose access derives from the two
            // sides, so no policy of their own). `schema_version` mirrors the file's
            // `user_version` so server bootstrap can tell which files need migrating without
            // attaching them.
            /* eslint-disable cyberworlds/string-quotes -- SQL string literals */
            sql.exec(`CREATE TABLE database_tables (
            sqlite_id INTEGER PRIMARY KEY,
            table_id TEXT NOT NULL UNIQUE,
            kind TEXT,
            table_name TEXT UNIQUE,
            schema_version INTEGER,
            access_policy TEXT,
            source_table_id TEXT,
            target_table_id TEXT,
            CHECK (
                CASE kind
                    WHEN 'table' THEN
                        table_name IS NOT NULL
                        AND schema_version IS NOT NULL
                        AND source_table_id IS NULL
                        AND target_table_id IS NULL
                    WHEN 'join' THEN
                        table_name IS NOT NULL
                        AND schema_version IS NOT NULL
                        AND access_policy IS NULL
                        AND source_table_id IS NOT NULL
                        AND target_table_id IS NOT NULL
                    ELSE
                        kind IS NULL
                        AND table_name IS NULL
                        AND schema_version IS NULL
                        AND source_table_id IS NULL
                        AND target_table_id IS NULL
                END
            )
        )`);
            /* eslint-enable cyberworlds/string-quotes */
            sql.exec(`CREATE TABLE database_table_pages (
            sqlite_id INTEGER NOT NULL,
            page_index INTEGER NOT NULL,
            version INTEGER NOT NULL,
            data BLOB,
            PRIMARY KEY (sqlite_id, page_index, version),
            FOREIGN KEY (sqlite_id) REFERENCES database_tables(sqlite_id)
        ) WITHOUT ROWID`);
        },
    ];

export function runDatabaseDurableObjectSqlMigrations(storage: DurableObjectStorage): void {
    storage.transactionSync(() => {
        storage.sql.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)");
        const result = storage.sql.exec<{version: number | null}>(
            "SELECT MAX(version) AS version FROM _migrations",
        );
        const row = result.next();
        assert(!row.done);
        assert(result.next().done);
        const version = row.value.version ?? 0;
        assert(
            version <= databaseDurableObjectSqlMigrations.length,
            `database durable object SQL migration version (${version}) is ahead of known migrations (${databaseDurableObjectSqlMigrations.length})`,
        );

        for (let i = version; i < databaseDurableObjectSqlMigrations.length; i++) {
            databaseDurableObjectSqlMigrations[i]!(storage.sql);
            storage.sql.exec("INSERT INTO _migrations (version) VALUES (?)", i + 1);
        }

        // Refresh query-planner statistics when migrations changed the schema.
        if (version < databaseDurableObjectSqlMigrations.length) {
            storage.sql.exec("PRAGMA optimize");
        }
    });
}
