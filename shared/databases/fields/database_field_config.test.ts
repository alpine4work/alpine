import {
    DatabaseFieldConfigSchema,
    DatabaseFieldConfigSqlSchema,
} from "~/shared/databases/fields/database_field_config.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

describe("DatabaseFieldConfigSqlSchema", () => {
    test("round-trips a number config with decimalPlaces", () => {
        const config = {type: "Number" as const, decimalPlaces: 2};
        const serialized = DatabaseFieldConfigSqlSchema.serialize(config);
        expect(typeof serialized).toBe("string");
        const deserialized = DatabaseFieldConfigSqlSchema.deserialize(serialized);
        expect(deserialized).toEqual(config);
    });

    test("round-trips a number config with null decimalPlaces", () => {
        const config = {type: "Number" as const, decimalPlaces: null};
        const deserialized = DatabaseFieldConfigSqlSchema.deserialize(
            DatabaseFieldConfigSqlSchema.serialize(config),
        );
        expect(deserialized).toEqual(config);
    });

    test("round-trips plainText and checkbox configs", () => {
        const plain = {type: "PlainText" as const};
        const checkbox = {type: "Checkbox" as const};
        expect(
            DatabaseFieldConfigSqlSchema.deserialize(DatabaseFieldConfigSqlSchema.serialize(plain)),
        ).toEqual(plain);
        expect(
            DatabaseFieldConfigSqlSchema.deserialize(
                DatabaseFieldConfigSqlSchema.serialize(checkbox),
            ),
        ).toEqual(checkbox);
    });

    test("round-trips relation configs", () => {
        const config = {
            type: "Relation" as const,
            joinTableId: generateId<DatabaseTableId>(),
            side: "Source" as const,
            cardinality: "Many" as const,
            linkedTableId: generateId<DatabaseTableId>(),
        };
        const deserialized = DatabaseFieldConfigSqlSchema.deserialize(
            DatabaseFieldConfigSqlSchema.serialize(config),
        );
        expect(deserialized).toEqual(config);
    });
});

describe("DatabaseFieldConfigSchema", () => {
    test("accepts concrete field configs", () => {
        const config = {type: "Checkbox" as const};
        const serialized = DatabaseFieldConfigSchema.serialize(config);
        expect(DatabaseFieldConfigSchema.deserialize(serialized)).toEqual(config);
    });
});
