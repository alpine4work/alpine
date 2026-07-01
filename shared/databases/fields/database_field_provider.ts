import {DatabaseFieldModel} from "~/shared/databases/model/database_model.js";
import {DatabaseFieldRow} from "~/shared/databases/model/database_row_schemas.js";
import type {SqlQuery} from "~/shared/databases/sql.js";
import type {Result} from "~/shared/helpers/control/result.js";
import type {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";

// -- SQLite storage type mapping ----------------------------------------------

/**
 * Maps SQLite column type affinities to the TypeScript types they produce when
 * read back via the WASM API.
 */
type SqliteTypeMap = {
    TEXT: string;
    INTEGER: number;
    REAL: number;
    BLOB: Uint8Array;
};

export type SqliteStorageType = keyof SqliteTypeMap;
export type SqliteValue = SqliteTypeMap[SqliteStorageType];

// -- Column provider factory ---------------------------------------------------

/**
 * Define a field provider. All generic parameters are inferred:
 *
 * - `Value` from `valueSchema`
 * - `Config` from `configSchema`
 * - SQL value types from `sqliteType` (e.g. `"TEXT"` → `toSqlValue` must return
 *   `string`)
 *
 * Returns a frozen provider object including a derived `sqlValueSchema` that
 * converts between `Value` and the SQLite storage type.
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
    /**
     * Whether the SQL column allows `NULL`. When `true`, the column is created without
     * a `NOT NULL` clause and `generateCheckConstraint` must accept `NULL`.
     */
    readonly nullable: boolean;
    readonly defaultValue: SqlQuery;
    readonly generateCheckConstraint: (columnName: string) => SqlQuery;
    readonly toSqlValue: (value: Value) => SqliteTypeMap[SqlType] | null;
    readonly fromSqlValue: (sqlValue: SqliteTypeMap[SqlType] | null) => Value;
    /**
     * Default config used when a field of this type is created. Lets `createField`
     * produce a fully-formed config without hardcoding option defaults at the call
     * site.
     */
    readonly getDefaultConfig: () => Config;
    /**
     * Parse a string (typically from an input element) into a cell value. Config-aware
     * so types can apply configured precision, etc.
     */
    readonly parseString: (input: string, config: Config) => Result<Value, void>;
    /**
     * Format a cell value as a string for display, given the field's config.
     */
    readonly formatString: (value: Value, config: Config) => string;
}) {
    const sqlValueSchema = options.valueSchema.migration({
        serialize: (serializedValue: SchemaSerializedValue) =>
            options.toSqlValue(serializedValue as Value) as SchemaSerializedValue,
        deserialize: (sqlValue: SchemaSerializedValue) =>
            options.fromSqlValue(
                sqlValue as SqliteTypeMap[SqlType] | null,
            ) as SchemaSerializedValue,
    });
    return {...options, storage: "column" as const, sqlValueSchema};
}

// -- Virtual provider factory --------------------------------------------------

/**
 * Define a virtual field provider. Virtual fields have metadata and values, but no
 * physical data-table column; their values are materialized by action-specific
 * query code.
 */
export function defineVirtualDatabaseFieldProvider<
    const Type extends string,
    Value,
    Config extends {type: Type},
>(options: {
    readonly type: Type;
    readonly valueSchema: Schema<Value>;
    readonly configSchema: Schema<Config>;
    /**
     * Default config used when a field of this type is created. Virtual providers may
     * throw here if they require action-minted ids and must only be created through a
     * dedicated action.
     */
    readonly getDefaultConfig: () => Config;
    /**
     * Parse a string into a cell value. Not all virtual fields expose text entry, but
     * the provider keeps the same display/editing surface as column fields.
     */
    readonly parseString: (input: string, config: Config) => Result<Value, void>;
    /**
     * Format a cell value as a string for display, given the field's config.
     */
    readonly formatString: (value: Value, config: Config) => string;
}) {
    return {...options, storage: "virtual" as const};
}
