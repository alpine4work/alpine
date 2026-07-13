import {assert} from "~/shared/helpers/control/assert.js";

type DatabaseDurableObjectSqlMigration = (sql: SqlStorage) => void;

/** Ordered migrations for the database-group durable object's built-in SQLite. */
export const databaseDurableObjectSqlMigrations: ReadonlyArray<DatabaseDurableObjectSqlMigration> = [
    sql => {
        // These tables predate migration tracking. `IF NOT EXISTS` adopts existing
        // durable objects without rewriting their page storage.
        sql.exec(`CREATE TABLE IF NOT EXISTS database_table_ids (
            sqlite_id INTEGER PRIMARY KEY,
            database_table_id TEXT NOT NULL UNIQUE
        )`);
        sql.exec(`CREATE TABLE IF NOT EXISTS pages (
            sqlite_id INTEGER NOT NULL,
            page_index INTEGER NOT NULL,
            version INTEGER NOT NULL,
            data BLOB,
            PRIMARY KEY (sqlite_id, page_index, version)
        ) WITHOUT ROWID`);
    },
    sql => {
        sql.exec(`CREATE TABLE database_table_access_policies (
            database_table_id TEXT PRIMARY KEY,
            access_policy TEXT NOT NULL
        ) WITHOUT ROWID`);
    },
];

export function runDatabaseDurableObjectSqlMigrations(storage: DurableObjectStorage): void {
    const sql = storage.sql;
    const versionResult = sql.exec<{user_version: number}>("PRAGMA user_version");
    const versionRow = versionResult.next();
    assert(!versionRow.done);
    assert(versionResult.next().done);
    const version = versionRow.value.user_version;
    assert(
        version <= databaseDurableObjectSqlMigrations.length,
        `database durable object user_version (${version}) is ahead of known migrations (${databaseDurableObjectSqlMigrations.length})`,
    );

    for (let i = version; i < databaseDurableObjectSqlMigrations.length; i++) {
        storage.transactionSync(() => {
            databaseDurableObjectSqlMigrations[i]!(sql);
            sql.exec(`PRAGMA user_version = ${i + 1}`);
        });
    }
}
