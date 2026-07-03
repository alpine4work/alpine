import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {DatabaseFieldType} from "~/shared/databases/fields/all_database_field_providers.js";
import type {DatabaseFieldProviderBase} from "~/shared/databases/fields/base/database_field_provider_base.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {Schema} from "~/shared/schema/schema.js";

const sqlite3Promise = sqlite3InitModule();

export async function expectDatabaseFieldProviderString<
    Type extends DatabaseFieldType,
    Value,
    Config extends {type: Type},
>({
    provider,
    value,
    config,
    expected,
}: {
    provider: DatabaseFieldProviderBase<Type, Value, Config>;
    value: Value;
    config: Config;
    expected: string;
}) {
    expect(provider.valueToString(value, config)).toBe(expected);

    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(":memory:", "c");
    try {
        sql`
            CREATE TABLE t (v)
        `.exec(db);
        const schema = provider.sqlValueSchema ?? provider.valueSchema;
        sql`
            INSERT INTO
                t (v)
            VALUES
                (${schema.serialize(value)})
        `.exec(db);

        const field = createTestField(config);
        const actual = sql`
            SELECT
                ${provider.selectColumnAsString(field, sql.identifier("t"))}
            FROM
                t
        `.selectValue(db, Schema.string.nullable());

        expect(actual).toBe(expected);
    } finally {
        db.close();
    }
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
