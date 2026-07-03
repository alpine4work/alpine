import {getApiTaskCollectionItems} from "~/server/api/internal/tasks/internal/get_api_task_collection_items.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

const baseContext = createTestContext({
    shouldStartOpensearch: true,
    tasksInjection,
});

const context = TestTaskRealtimeServer.with(baseContext);

test("returns collection items in input order", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith"});

    const firstCollection = await TestTaskCollection.create(session, {name: "First"});
    const secondCollection = await TestTaskCollection.create(session, {name: "Second"});

    await ProcessContextModule.waitForTestTasks();

    await expect(
        getApiTaskCollectionItems(context.getTaskRealtimeServer().action(session), space.id, [
            secondCollection.id,
            firstCollection.id,
        ]),
    ).resolves.toEqual([
        {collection: {id: secondCollection.id}},
        {collection: {id: firstCollection.id}},
    ]);
});

test("filters deleted collections", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Alice Smith"});

    const activeCollection = await TestTaskCollection.create(session, {name: "Active"});
    const deletedCollection = await TestTaskCollection.create(session, {name: "Deleted"});

    await deletedCollection.delete(session);
    await ProcessContextModule.waitForTestTasks();

    await expect(
        getApiTaskCollectionItems(context.getTaskRealtimeServer().action(session), space.id, [
            activeCollection.id,
            deletedCollection.id,
        ]),
    ).resolves.toEqual([{collection: {id: activeCollection.id}}]);
});

test("filters missing and unauthorized collections", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({name: "Alice Smith"});
    const session2 = await space.createSession({name: "Bob Johnson"});

    const visibleCollection = await TestTaskCollection.create(session1, {name: "Visible"});
    const privateCollection = await TestTaskCollection.create(session2, {name: "Private"});

    await ProcessContextModule.waitForTestTasks();

    await expect(
        getApiTaskCollectionItems(context.getTaskRealtimeServer().action(session1), space.id, [
            visibleCollection.id,
            privateCollection.id,
            generateId<TaskCollectionId>(),
        ]),
    ).resolves.toEqual([{collection: {id: visibleCollection.id}}]);
});
