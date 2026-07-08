import {databaseRelationFieldProvider} from "~/shared/databases/fields/database_relation_field.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseRowId} from "~/shared/id/types/id_types.js";

describe("databaseRelationFieldProvider", () => {
    test("formats linked record names", () => {
        const value = [
            {id: generateChronologicalId<DatabaseRowId>(), name: "Alpha", noAccess: false},
            {id: generateChronologicalId<DatabaseRowId>(), name: null, noAccess: false},
            {id: generateChronologicalId<DatabaseRowId>(), name: "Beta", noAccess: false},
        ];

        expect(databaseRelationFieldProvider.valueToString(value)).toBe("Alpha, Untitled, Beta");
    });

    test("formats links to an unreadable table as no access", () => {
        const value = [
            {id: generateChronologicalId<DatabaseRowId>(), name: "Alpha", noAccess: false},
            {id: generateChronologicalId<DatabaseRowId>(), name: null, noAccess: true},
        ];

        expect(databaseRelationFieldProvider.valueToString(value)).toBe("Alpha, No access");
    });
});
