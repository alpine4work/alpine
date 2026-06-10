import {databaseRelationFieldProvider} from "~/shared/databases/fields/database_relation_field.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.js";

describe("databaseRelationFieldProvider", () => {
    test("is virtual storage", () => {
        expect(databaseRelationFieldProvider.storage).toBe("virtual");
    });

    test("requires explicit config", () => {
        expect(() => databaseRelationFieldProvider.getDefaultConfig()).toThrow(
            "relation fields require explicit config",
        );
    });

    test("formats linked record names", () => {
        const config = {
            type: "relation" as const,
            joinTableId: generateChronologicalId<DatabaseTableId>(),
            side: "source" as const,
            cardinality: "many" as const,
            linkedTableId: generateChronologicalId<DatabaseTableId>(),
        };
        const value = [
            {id: generateChronologicalId<DatabaseRowId>(), name: "Alpha"},
            {id: generateChronologicalId<DatabaseRowId>(), name: null},
            {id: generateChronologicalId<DatabaseRowId>(), name: "Beta"},
        ];

        expect(databaseRelationFieldProvider.formatString(value, config)).toBe(
            "Alpha, Untitled, Beta",
        );
    });
});
