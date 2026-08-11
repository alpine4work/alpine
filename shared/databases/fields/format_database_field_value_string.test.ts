import {formatDatabaseFieldValueString} from "~/shared/databases/fields/format_database_field_value_string.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

describe("formatDatabaseFieldValueString", () => {
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
            type: "Relation" as const,
            joinTableId: generateId<DatabaseTableId>(),
            side: "Source" as const,
            cardinality: "Many" as const,
            linkedTableId: generateId<DatabaseTableId>(),
        };

        expect(formatDatabaseFieldValueString(config, value)).toBe("Alpha, Untitled, Beta");
    });
});
