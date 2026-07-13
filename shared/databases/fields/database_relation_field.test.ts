import {databaseRelationFieldProvider} from "~/shared/databases/fields/database_relation_field.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseRowId} from "~/shared/id/types/id_types.js";

describe("databaseRelationFieldProvider", () => {
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

        expect(databaseRelationFieldProvider.valueToString(value)).toBe("Alpha, Untitled, Beta");
    });
});
