import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {SqliteStorageType} from "~/shared/databases/fields/base/database_field_provider_base.js";
import {formatSqliteColumnType} from "~/shared/databases/internal/format_sqlite_column_type.js";
import {sql} from "~/shared/databases/sql.js";
import type {DatabaseFieldId, DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

const sqlite3Promise = sqlite3InitModule();
const tableId = "table_id" as DatabaseTableId;
const fieldId = "field_id" as DatabaseFieldId;
let dbCounter = 0;

test("formats a generated SQLite column type with the Alpine prefix", () => {
    expect(formatSqliteColumnType("TEXT", tableId, fieldId)).toBe("_alpine_TEXT_table_id_field_id");
});

test.each<[SqliteStorageType, string]>([
    ["INTEGER", "integer"],
    ["REAL", "real"],
    ["TEXT", "text"],
    ["BLOB", "text"],
])("keeps %s affinity with the Alpine prefix", async (type, expectedStorageType) => {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-column-type-${dbCounter++}.sqlite3`, "ct");
    const columnType = sql.raw(formatSqliteColumnType(type, tableId, fieldId));
    sql`CREATE TABLE t (v ${columnType})`.exec(db);

    sql`
        INSERT INTO
            t (v)
        VALUES
            ('42')
    `.exec(db);

    const {storageType} = sql`
        SELECT
            TYPEOF(v) AS storage_type
        FROM
            t
    `.selectOne(db, {storageType: Schema.string.originalPropertyKey("storage_type")});
    expect(storageType).toBe(expectedStorageType);
    db.close();
});
