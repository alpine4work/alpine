import type {DatabaseColumnBackedFieldType} from "~/shared/databases/fields/is_database_field_column_backed.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export type SqliteStorageType = "INTEGER" | "REAL" | "TEXT" | "BLOB";

/** The SQLite storage type of a column-backed field type's column. */
export function getDatabaseFieldSqliteType(type: DatabaseColumnBackedFieldType): SqliteStorageType {
    switch (type) {
        case "PlainText":
            return "TEXT";
        case "Checkbox":
            return "INTEGER";
        case "Number":
            return "REAL";
        default:
            throw exhaustive(type);
    }
}
