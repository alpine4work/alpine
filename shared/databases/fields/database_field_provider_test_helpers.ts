import type {DatabaseFieldType} from "~/shared/databases/fields/all_database_field_providers.js";
import type {DatabaseFieldProviderBase} from "~/shared/databases/fields/base/database_field_provider_base.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {sql} from "~/shared/databases/sql.js";
import type {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {Schema} from "~/shared/schema/schema.js";

export function databaseFieldProviderStrings<
    Type extends DatabaseFieldType,
    Value,
    Config extends {type: Type},
>({
    db,
    provider,
    value,
    config,
}: {
    db: SqliteDatabase;
    provider: DatabaseFieldProviderBase<Type, Value, Config>;
    value: Value;
    config: Config;
}): {valueToString: string; selectColumnAsString: string | null} {
    sql` CREATE TEMP TABLE _field_provider_string_test (v) `.exec(db);
    const schema = provider.sqlValueSchema ?? provider.valueSchema;
    sql`
        INSERT INTO
            _field_provider_string_test (v)
        VALUES
            (${schema.serialize(value)})
    `.exec(db);

    const field = createTestField(config);
    const actual = sql`
        SELECT
            ${provider.selectColumnAsString(field, sql.identifier("_field_provider_string_test"))}
        FROM
            _field_provider_string_test
    `.selectValue(db, Schema.string.nullable());

    return {valueToString: provider.valueToString(value, config), selectColumnAsString: actual};
}

function createTestField<Type extends DatabaseFieldType, Config extends {type: Type}>(
    config: Config,
): DatabaseFieldModel {
    return {
        config,
        column() {
            return sql.identifier("v");
        },
        isType(type: DatabaseFieldType) {
            return type === config.type;
        },
    } as DatabaseFieldModel;
}
