import {databaseRelationFieldProvider} from "~/shared/databases/fields/database_relation_field.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseRowId} from "~/shared/id/types/id_types.js";

describe("databaseRelationFieldProvider", () => {
    test("formats linked record names", () => {
        const value = [
            {id: generateChronologicalId<DatabaseRowId>(), name: "Alpha"},
            {id: generateChronologicalId<DatabaseRowId>(), name: null},
            {id: generateChronologicalId<DatabaseRowId>(), name: "Beta"},
        ];

        expect(databaseRelationFieldProvider.valueToString(value)).toBe("Alpha, Untitled, Beta");
    });
});
