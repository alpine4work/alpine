import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    assignDatabaseGroupIdForSpace,
    getDatabaseGroupIdForSpace,
    getDatabaseGroupIdForSpaceIfExists,
    getSpaceIdForDatabaseGroupId,
} from "~/server/spaces/get_database_group_id_for_space.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

const context = createTestContext();

test("reading a database group ID does not assign one", async () => {
    const space = await TestSpace.create(context);

    expect(
        await runAllPromises([
            getDatabaseGroupIdForSpaceIfExists(space.systemAction(), space.id),
            getDatabaseGroupIdForSpaceIfExists(space.systemAction(), space.id),
        ]),
    ).toEqual([null, null]);
});

test("assigning a database group ID creates both lookup directions", async () => {
    const space = await TestSpace.create(context);
    const databaseGroupId = await assignDatabaseGroupIdForSpace(space.systemAction(), space.id);

    expect(
        await runAllPromises([
            getDatabaseGroupIdForSpace(space.systemAction(), space.id),
            getSpaceIdForDatabaseGroupId(space.systemAction(), databaseGroupId),
        ]),
    ).toEqual([databaseGroupId, space.id]);
});

test("concurrent database group ID assignments converge", async () => {
    const space = await TestSpace.create(context);
    const databaseGroupIds = await runAllPromises([
        assignDatabaseGroupIdForSpace(space.systemAction(), space.id),
        assignDatabaseGroupIdForSpace(space.systemAction(), space.id),
    ]);

    expect(new Set(databaseGroupIds).size).toBe(1);
});
