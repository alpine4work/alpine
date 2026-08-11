import type {
    DatabaseFieldConfig,
    DatabaseFieldType,
} from "~/shared/databases/fields/database_field_config.js";
import type {DatabaseFieldValue} from "~/shared/databases/fields/database_field_value.js";
import {formatDatabaseFieldValueString} from "~/shared/databases/fields/format_database_field_value_string.js";
import {getDatabaseFieldSqlValueSchema} from "~/shared/databases/fields/get_database_field_sql_value_schema.js";
import {selectDatabaseFieldColumnAsString} from "~/shared/databases/fields/select_database_field_column_as_string.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {sql} from "~/shared/databases/sql.js";
import type {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

/**
 * Returns a field value formatted as a string both by
 * `formatDatabaseFieldValueString` and by `selectDatabaseFieldColumnAsString`
 * (evaluated in SQLite). Tests use both results to detect differences between the
 * in-memory and SQL implementations.
 */
export function getDatabaseFieldStrings<Type extends DatabaseFieldType>({
    db,
    config,
    value,
}: {
    db: SqliteDatabase;
    config: DatabaseFieldConfig<Type>;
    value: DatabaseFieldValue<Type>;
}): {valueToString: string; selectColumnAsString: string | null} {
    sql` CREATE TEMP TABLE _field_string_test (v) `.exec(db);
    const schema = getDatabaseFieldSqlValueSchema(config.type);
    sql`
        INSERT INTO
            _field_string_test (v)
        VALUES
            (${schema.serialize(value)})
    `.exec(db);

    const field = createTestField(config);
    const actual = sql`
        SELECT
            ${selectDatabaseFieldColumnAsString(field, sql.identifier("_field_string_test"))}
        FROM
            _field_string_test
    `.selectValue(db, Schema.string.nullable());

    return {
        valueToString: formatDatabaseFieldValueString(config, value),
        selectColumnAsString: actual,
    };
}

/**
 * Creates the minimum field model that the string-format tests need. This test
 * double keeps the tests independent from full database model construction.
 */
function createTestField<Type extends DatabaseFieldType>(
    config: DatabaseFieldConfig<Type>,
): DatabaseFieldModel {
    return {
        config,
        column() {
            return sql.identifier("v");
        },
        isType(type: DatabaseFieldType) {
            return type === config.type;
        },
    } as unknown as DatabaseFieldModel;
}
