/* eslint-disable cyberworlds/string-quotes -- SQL literals */

/** Returns all rows from a given table. */
export function databaseTableDataQuery(tableName: string): string {
    return `SELECT * FROM "${tableName}"`;
}
