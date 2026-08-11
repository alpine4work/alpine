import {
    type DatabaseFieldConfig,
    type DatabaseFieldType,
    type DatabaseFieldValue,
    databaseFieldSqlValueSchema,
    databaseFieldValueToString,
    selectDatabaseFieldColumnAsString,
} from "~/shared/databases/fields/all_database_field_providers.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {sql} from "~/shared/databases/sql.js";
import type {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export function databaseFieldProviderStrings<Type extends DatabaseFieldType>({
    db,
    config,
    value,
}: {
    db: SqliteDatabase;
    config: DatabaseFieldConfig<Type>;
    value: DatabaseFieldValue<Type>;
}): {valueToString: string; selectColumnAsString: string | null} {
    sql` CREATE TEMP TABLE _field_provider_string_test (v) `.exec(db);
    const schema = databaseFieldSqlValueSchema(config.type);
    sql`
        INSERT INTO
            _field_provider_string_test (v)
        VALUES
            (${schema.serialize(value)})
    `.exec(db);

    const field = createTestField(config);
    const actual = sql`
        SELECT
            ${selectDatabaseFieldColumnAsString(
            field,
            sql.identifier("_field_provider_string_test"),
        )}
        FROM
            _field_provider_string_test
    `.selectValue(db, Schema.string.nullable());

    return {valueToString: databaseFieldValueToString(config, value), selectColumnAsString: actual};
}

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
