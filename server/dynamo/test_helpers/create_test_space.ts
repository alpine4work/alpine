import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {createSpaceForTest} from "~/server/spaces/spaces_actions.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export type TestSpaceItem = {
    readonly id: SpaceId;
};

/**
 * Creates a test space for use in tests.
 *
 * The ID is generated synchronously but the space is actually created in a
 * `beforeAll()` hook.
 *
 * @deprecated Use `TestSpace` in the body of a test instead
 */
export function createTestSpace(context: TestContext): TestSpaceItem {
    const spaceId = generateId<SpaceId>();

    testSharedHooks.beforeAll(async () => {
        await createSpaceForTest(context, {
            id: spaceId,
            name: "Test",
        });
    });

    return {
        id: spaceId,
    };
}
