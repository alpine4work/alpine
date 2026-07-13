import {assert} from "~/shared/helpers/control/assert.js";

type DatabaseDurableObjectSqlMigration = (sql: SqlStorage) => void;

/**
 * Ordered migrations for the database-group durable object's built-in SQLite.
 */
export const databaseDurableObjectSqlMigrations: ReadonlyArray<DatabaseDurableObjectSqlMigration> =
    [
        sql => {
            sql.exec(`CREATE TABLE database_tables (
            sqlite_id INTEGER PRIMARY KEY,
            table_id TEXT NOT NULL UNIQUE,
            access_policy TEXT
        )`);
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
    });
}
