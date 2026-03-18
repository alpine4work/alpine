/* eslint-disable cyberworlds/string-quotes -- SQL literals */

/** Returns all user-facing tables with display name and internal name. */
export function databaseTablesQuery(): string {
    return "SELECT name, table_name FROM _alpine_tables ORDER BY id";
}

/** Returns the internal name of the first table, for redirect logic. */
export function databaseFirstTableQuery(): string {
    return "SELECT table_name FROM _alpine_tables ORDER BY id LIMIT 1";
}

/** Returns all rows from a given table. */
export function databaseTableDataQuery(tableName: string): string {
    return `SELECT * FROM "${tableName}"`;
}
