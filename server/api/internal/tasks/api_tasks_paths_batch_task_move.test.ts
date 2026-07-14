import {apiTasksPaths} from "~/server/api/internal/tasks/api_tasks_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {TestTaskRealtimeServer} from "~/server/tasks/realtime/test_helpers/test_task_realtime_server.js";
import {
    ApiGetTaskCollectionTasksResponse,
    ApiTaskPatch,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {TaskId} from "~/shared/id/types/id_types.js";

const baseContext = createTestContext({
    shouldStartOpensearch: true,
    tasksInjection,
});

const context = TestTaskRealtimeServer.with(baseContext);

const server = createTestApiServer(context, apiTasksPaths);

// NOCOMMIT: Decrease to 10?
const testCaseCount = 20;
const taskCount = 8;

const testSuites: Array<{
    name: string;
    setup: (options: {
        session: TestSpaceSession;
    }) => Promise<{collection: TestTaskCollection; tasks: Array<TestTask>}>;
}> = [
    {
        name: "no tied positions",
        setup: async ({session}) => {
            const collection = await TestTaskCollection.create(session);

            const tasks = await runAllPromises(
                createArrayWithLength(taskCount, index =>
                    TestTask.create(session, {
                        title: `Test Task ${index + 1}`,
                        collections: [collection],
                    }),
                ),
            );

            return {collection, tasks};
        },
    },
    {
        name: "all tied positions",
        setup: async ({session}) => {
            const collection = await TestTaskCollection.create(session);

            const tasks = await runAllPromises(
                createArrayWithLength(taskCount, index =>
                    TestTask.create(session, {title: `Test Task ${index + 1}`}),
                ),
            );

            const addCollectionTime = testTaskClock.now();

            await runAllPromises(
                tasks.map(task =>
                    task.addCollection(session, collection, {time: addCollectionTime}),
                ),
            );

            return {collection, tasks};
        },
    },
    {
        name: "tied positions at end",
        setup: async ({session}) => {
            const collection = await TestTaskCollection.create(session);

            const tasks = await runAllPromises(
                createArrayWithLength(taskCount, index =>
                    TestTask.create(session, {title: `Test Task ${index + 1}`}),
                ),
            );

            await runAllPromises(
                tasks.slice(0, -4).map(task => task.addCollection(session, collection)),
            );

            const addCollectionTime = testTaskClock.now();

            await runAllPromises(
                tasks
                    .slice(-4)
                    .map(task =>
                        task.addCollection(session, collection, {time: addCollectionTime}),
                    ),
            );

            return {collection, tasks};
        },
    },
    {
        name: "tied positions at start",
        setup: async ({session}) => {
            const collection = await TestTaskCollection.create(session);

            const tasks = await runAllPromises(
                createArrayWithLength(taskCount, index =>
                    TestTask.create(session, {title: `Test Task ${index + 1}`}),
                ),
            );

            const addCollectionTime = testTaskClock.now();

            await runAllPromises(
                tasks
                    .slice(0, 4)
                    .map(task =>
                        task.addCollection(session, collection, {time: addCollectionTime}),
                    ),
            );

            await runAllPromises(
                tasks.slice(4).map(task => task.addCollection(session, collection)),
            );

            return {collection, tasks};
        },
    },
    {
        name: "tied positions in middle",
        setup: async ({session}) => {
            const collection = await TestTaskCollection.create(session);

            const tasks = await runAllPromises(
                createArrayWithLength(taskCount, index =>
                    TestTask.create(session, {title: `Test Task ${index + 1}`}),
                ),
            );

            await runAllPromises(
                tasks.slice(0, 3).map(task => task.addCollection(session, collection)),
            );

            const addCollectionTime = testTaskClock.now();

            await runAllPromises(
                tasks
                    .slice(3, 6)
                    .map(task =>
                        task.addCollection(session, collection, {time: addCollectionTime}),
                    ),
            );

            await runAllPromises(
                tasks.slice(6).map(task => task.addCollection(session, collection)),
            );

            return {collection, tasks};
        },
    },
    {
        name: "tied positions at start and end",
        setup: async ({session}) => {
            const collection = await TestTaskCollection.create(session);

            const tasks = await runAllPromises(
                createArrayWithLength(taskCount, index =>
                    TestTask.create(session, {title: `Test Task ${index + 1}`}),
                ),
            );

            const addCollectionTime1 = testTaskClock.now();

            await runAllPromises(
                tasks
                    .slice(0, 3)
                    .map(task =>
                        task.addCollection(session, collection, {time: addCollectionTime1}),
                    ),
            );

            await runAllPromises(
                tasks.slice(3, 6).map(task => task.addCollection(session, collection)),
            );

            const addCollectionTime2 = testTaskClock.now();

            await runAllPromises(
                tasks
                    .slice(6)
                    .map(task =>
                        task.addCollection(session, collection, {time: addCollectionTime2}),
                    ),
            );

            return {collection, tasks};
        },
    },
];

for (const testSuite of testSuites) {
    describe(`${testSuite.name}`, () => {
        for (let testCaseIndex = 0; testCaseIndex < testCaseCount; testCaseIndex++) {
            const stableRandom = new StableRandom(
                `api_tasks_paths_batch_task_move:${testSuite.name}:${testCaseIndex}`,
            );

            const moves: Array<{from: number; to: number}> = [];
            const moveCount = stableRandom.randomInteger("moveCount", 0, 1, taskCount + 1);

            for (let moveIndex = 0; moveIndex < moveCount; moveIndex++) {
                const from = stableRandom.randomInteger("from", moveIndex, 0, taskCount);
                const to = stableRandom.randomInteger("to", moveIndex, 0, taskCount + 1);
                moves.push({from, to});
            }

            const expectedOrderItems = createArrayWithLength(taskCount, index => ({
                index,
                phantom: false,
                moved: false,
            }));

            for (const move of moves) {
                const oldExpectedOrderItem = assertExists(
                    expectedOrderItems.find(item => item.index === move.from && !item.phantom),
                );

                oldExpectedOrderItem.phantom = true;

                let found = false;

                for (
                    let expectedOrderItemIndex = 0;
                    expectedOrderItemIndex < expectedOrderItems.length;
                    expectedOrderItemIndex++
                ) {
                    const expectedOrderItem = expectedOrderItems[expectedOrderItemIndex]!;

                    if (expectedOrderItem.index === move.to && !expectedOrderItem.moved) {
                        expectedOrderItems.splice(expectedOrderItemIndex, 0, {
                            index: move.from,
                            phantom: false,
                            moved: true,
                        });
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    expectedOrderItems.push({
                        index: move.from,
                        phantom: false,
                        moved: true,
                    });
                }
            }

            const expectedOrder = filterMapArray(expectedOrderItems, item => {
                if (item.phantom) return;
                return item.index;
            });

            test(`[${expectedOrder.join(", ")}] (moves: ${moves.map(move => `${move.from} -> ${move.to}`).join(", ")})`, async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession({role: "Admin"});

                const bot = await TestBot.createAndInstantiate(session);
                const apiKey = await bot.createApiKey(session);

                const {collection, tasks} = await testSuite.setup({session});

                await ProcessContextModule.waitForTestTasks();

                const {body: oldBody}: {body: ApiGetTaskCollectionTasksResponse} = await server.GET(
                    `/task-collections/${collection.id}/tasks`,
                    {
                        headers: {authorization: `bearer ${apiKey}`},
                    },
                );

                expect(oldBody.tasks).toHaveLength(tasks.length);
                expect(oldBody.nextCursor).toBeNull();

                const patches: Array<{id: TaskId; patch: ApiTaskPatch}> = [];

                for (const move of moves) {
                    const task = tasks[move.from]!;

                    if (move.to === 0) {
                        patches.push({
                            id: task.id,
                            patch: {
                                type: "MoveInCollection",
                                collectionId: collection.id,
                                position: {type: "Start"},
                            },
                        });
                    } else if (move.to === taskCount) {
                        patches.push({
                            id: task.id,
                            patch: {
                                type: "MoveInCollection",
                                collectionId: collection.id,
                                position: {type: "End"},
                            },
                        });
                    } else {
                        patches.push({
                            id: task.id,
                            patch: {
                                type: "MoveInCollection",
                                collectionId: collection.id,
                                position: {
                                    type: "Between",
                                    afterCursor: oldBody.tasks[move.to - 1]!.cursor,
                                    beforeCursor: oldBody.tasks[move.to]!.cursor,
                                },
                            },
                        });
                    }
                }

                const patchResponse = await server.PATCH("/tasks", {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {
                        spaceId: space.id,
                        patches,
                    },
                });

                expect({
                    status: patchResponse.status,
                    error: patchResponse.body.error,
                }).toEqual({
                    status: 200,
                    error: undefined,
                });

                const {body: newBody}: {body: ApiGetTaskCollectionTasksResponse} = await server.GET(
                    `/task-collections/${collection.id}/tasks`,
                    {
                        headers: {authorization: `bearer ${apiKey}`},
                    },
                );

                expect(newBody.tasks.map(({task}) => task.id)).toEqual(
                    expectedOrder.map(index => tasks[index]!.id),
                );
                expect(newBody.nextCursor).toBeNull();
            });
        }
    });
}
