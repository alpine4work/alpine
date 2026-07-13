import {assert} from "~/shared/helpers/control/assert.js";

type DatabaseDurableObjectSqlMigration = (sql: SqlStorage) => void;

/**
 * Ordered migrations for the database-group durable object's built-in SQLite.
 */
export const databaseDurableObjectSqlMigrations: ReadonlyArray<DatabaseDurableObjectSqlMigration> =
    [
        sql => {
            // A `database_tables` row exists for every table id pages have been written for.
            // The registration columns (`kind` onward) are populated when the table is
            // registered by its create flow; they stay NULL for rows created by bare page
            // writes (the main registry file, or a policy pushed ahead of creation) and access
            // resolution fails closed on them. `source_table_id`/ `target_table_id` are the
            // join topology, set only for `kind = 'join'`; `access_policy` is the resolved
            // local policy copy, set only for `kind = 'table'`; `schema_version` mirrors the
            // file's `user_version` so server bootstrap can tell which files need migrating
            // without attaching them.
            sql.exec(`CREATE TABLE database_tables (
            sqlite_id INTEGER PRIMARY KEY,
            table_id TEXT NOT NULL UNIQUE,
            kind TEXT,
            table_name TEXT UNIQUE,
            schema_version INTEGER,
            access_policy TEXT,
            source_table_id TEXT,
            target_table_id TEXT
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
