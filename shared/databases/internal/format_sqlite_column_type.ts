import {SqliteStorageType} from "~/shared/databases/fields/base/database_field_provider_base.js";
import {DatabaseFieldId, DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * SQLite accepts anything as the 'type' of a columm, and will return it through
 * queries. Here, we encode the actual column type (which SQLite detects and uses
 * as the storage type) but also include the table and field ids. When users write
 * custom SQL queries, we can use the resulting type information to tie selected
 * columns back to our datamodel for richer rendering.
 */
export function formatSqliteColumnType(
    type: SqliteStorageType,
    tableId: DatabaseTableId,
    fieldId: DatabaseFieldId,
): string {
    return `${type}_alpine_${tableId}_${fieldId}`;
}
