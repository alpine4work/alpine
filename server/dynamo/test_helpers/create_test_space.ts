import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {getSpacesTableForTest} from "~/server/spaces/spaces_table.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export type TestSpace = {
    readonly id: SpaceId;
};

/**
 * Creates a test space for use in tests.
 *
 * The ID is generated synchronously but the space is actually created in a
 * `beforeAll()` hook.
 */
export function createTestSpace(context: TestContext): TestSpace {
    const SpacesTable = getSpacesTableForTest();
    const spaceId = generateId<SpaceId>();

    testSharedHooks.beforeAll(async () => {
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
