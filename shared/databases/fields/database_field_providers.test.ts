import {
    DatabaseFieldConfigSchema,
    DatabaseFieldConfigSqlSchema,
    DatabaseFieldTypeSchema,
    databaseFieldProviders,
    getDatabaseFieldProvider,
} from "~/shared/databases/fields/database_field_providers.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

describe("databaseFieldProviders registry", () => {
    test("registers plainText, checkbox, number, and relation", () => {
        expect([...databaseFieldProviders.keys()].sort()).toEqual([
            "checkbox",
            "number",
            "plainText",
            "relation",
        ]);
    });

    test("getDatabaseFieldProvider returns the matching provider", () => {
        expect(getDatabaseFieldProvider("plainText").type).toBe("plainText");
        expect(getDatabaseFieldProvider("checkbox").type).toBe("checkbox");
        expect(getDatabaseFieldProvider("number").type).toBe("number");
        expect(getDatabaseFieldProvider("relation").type).toBe("relation");
    });

    test("getDatabaseFieldProvider asserts on unknown type", () => {
        expect(() => getDatabaseFieldProvider("bogus" as never)).toThrow("unknown field type");
    });
});

describe("DatabaseFieldTypeSchema", () => {
    test("accepts each registered discriminant", () => {
        expect(DatabaseFieldTypeSchema.deserialize("plainText")).toBe("plainText");
        expect(DatabaseFieldTypeSchema.deserialize("checkbox")).toBe("checkbox");
        expect(DatabaseFieldTypeSchema.deserialize("number")).toBe("number");
        expect(DatabaseFieldTypeSchema.deserialize("relation")).toBe("relation");
    });
});

describe("DatabaseFieldConfigSqlSchema", () => {
    test("round-trips a number config with decimalPlaces", () => {
        const config = {type: "number" as const, decimalPlaces: 2};
        const serialized = DatabaseFieldConfigSqlSchema.serialize(config);
        expect(typeof serialized).toBe("string");
        const deserialized = DatabaseFieldConfigSqlSchema.deserialize(serialized);
        expect(deserialized).toEqual(config);
    });

    test("round-trips a number config with null decimalPlaces", () => {
        const config = {type: "number" as const, decimalPlaces: null};
        const deserialized = DatabaseFieldConfigSqlSchema.deserialize(
            DatabaseFieldConfigSqlSchema.serialize(config),
        );
        expect(deserialized).toEqual(config);
    });

    test("round-trips plainText and checkbox configs", () => {
        const plain = {type: "plainText" as const};
        const checkbox = {type: "checkbox" as const};
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
            type: "relation" as const,
            joinTableId: generateChronologicalId<DatabaseTableId>(),
            side: "source" as const,
            cardinality: "many" as const,
            linkedTableId: generateChronologicalId<DatabaseTableId>(),
        };
        const deserialized = DatabaseFieldConfigSqlSchema.deserialize(
            DatabaseFieldConfigSqlSchema.serialize(config),
        );
        expect(deserialized).toEqual(config);
    });
});

describe("each provider\u2019s getDefaultConfig is valid against DatabaseFieldConfigSchema", () => {
    for (const provider of databaseFieldProviders.values()) {
        if (provider.storage === "virtual") continue;

        test(`provider type ${provider.type}`, () => {
            const config = provider.getDefaultConfig();
            // Round-trip through the union schema.
            const serialized = DatabaseFieldConfigSchema.serialize(config);
            const deserialized = DatabaseFieldConfigSchema.deserialize(serialized);
            expect(deserialized).toEqual(config);
        });
    }
});
