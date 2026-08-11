import {databaseFieldValueToString} from "~/shared/databases/fields/all_database_field_providers.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import type {DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

describe("databaseRelationField", () => {
    test("formats linked record names", () => {
        const value = [
            {
                id: generateChronologicalId<DatabaseRowId>(),
                name: "Alpha",
                position: assertOrderKey("a0"),
            },
            {
                id: generateChronologicalId<DatabaseRowId>(),
                name: null,
                position: assertOrderKey("a1"),
            },
            {
                id: generateChronologicalId<DatabaseRowId>(),
                name: "Beta",
                position: assertOrderKey("a2"),
            },
        ];

        const config = {
            type: "relation" as const,
            joinTableId: generateChronologicalId<DatabaseTableId>(),
            side: "source" as const,
            cardinality: "many" as const,
            linkedTableId: generateChronologicalId<DatabaseTableId>(),
        };

        expect(databaseFieldValueToString(config, value)).toBe("Alpha, Untitled, Beta");
    });
});
