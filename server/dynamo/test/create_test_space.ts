import {getSpacesTableForTest} from "~/server/dynamo/spaces_table";
import {TestContext} from "~/server/dynamo/test/create_test_context";
import {Id, generateId} from "~/shared/id/id";

export type TestSpace = {
    readonly id: Id;
};

/**
 * Creates a test space for use in tests.
 *
 * The ID is generated synchronously but the space is actually created in a
 * `beforeAll()` hook.
 */
export function createTestSpace(context: TestContext): TestSpace {
    const SpacesTable = getSpacesTableForTest();
    const spaceId = generateId();

    beforeAll(async () => {
        await SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId,
            name: "Test",
            createdTime: new Date(),
        });
    });

    return {
        id: spaceId,
    };
}
