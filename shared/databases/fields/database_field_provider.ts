import type {SqlQuery} from "~/shared/databases/sql.js";
import type {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";

// -- SQLite storage type mapping ----------------------------------------------

/**
 * Maps SQLite column type affinities to the TypeScript
 * types they produce when read back via the WASM API.
 */
type SqliteTypeMap = {
    TEXT: string;
    INTEGER: number;
    REAL: number;
    BLOB: Uint8Array;
};

export type SqliteStorageType = keyof SqliteTypeMap;
export type SqliteValue = SqliteTypeMap[SqliteStorageType];

// -- Factory ------------------------------------------------------------------

/**
 * Define a field provider. All generic parameters are
 * inferred:
 *
 * - `Value` from `valueSchema`
 * - `Config` from `configSchema`
 * - SQL value types from `sqliteType` (e.g. `"TEXT"` →
 *   `toSqlValue` must return `string`)
 *
 * Returns a frozen provider object including a derived
 * `sqlValueSchema` that converts between `Value` and
 * the SQLite storage type.
 */
export function defineDatabaseFieldProvider<
    const Type extends string,
    Value,
    Config extends {type: Type},
    const SqlType extends SqliteStorageType,
>(options: {
    readonly type: Type;
    readonly valueSchema: Schema<Value>;
    readonly configSchema: Schema<Config>;
    readonly sqliteType: SqlType;
    readonly defaultValue: string;
    readonly generateCheckConstraint: (columnName: string) => SqlQuery;
    readonly toSqlValue: (value: Value) => SqliteTypeMap[SqlType];
    readonly fromSqlValue: (sqlValue: SqliteTypeMap[SqlType]) => Value;
}) {
    const sqlValueSchema = options.valueSchema.migration({
        serialize: (serializedValue: SchemaSerializedValue) =>
            options.toSqlValue(serializedValue as Value) as SchemaSerializedValue,
        deserialize: (sqlValue: SchemaSerializedValue) =>
            options.fromSqlValue(sqlValue as SqliteTypeMap[SqlType]) as SchemaSerializedValue,
    });
    return {...options, sqlValueSchema};
}
