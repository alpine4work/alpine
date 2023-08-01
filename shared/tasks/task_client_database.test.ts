import {AccountModel} from "~/shared/accounts/account_model.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskActionModel} from "~/shared/tasks/task_action_model.js";
import {TaskClientDatabase} from "~/shared/tasks/task_client_database.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskAccountModel, TaskModel} from "~/shared/tasks/task_model.js";
import {emptyTaskTitle, getTaskTitleProsemirrorNode} from "~/shared/tasks/task_title.js";
import {taskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_helpers.js";

const accountCreatedTime = new Date("2023-07-10T21:06:29.897Z");

function asTaskAccountModel(account: AccountModel): TaskAccountModel {
    return new TaskAccountModel({
        staleAccount: account,
        accountName: account.name,
    });
}

const account1 = asTaskAccountModel(
    new AccountModel({id: generateId(), name: "Test 1", createdTime: accountCreatedTime}),
);
const account2 = asTaskAccountModel(
    new AccountModel({id: generateId(), name: "Test 2", createdTime: accountCreatedTime}),
);

const createdTime1 = new TaskFilterableTime({
    absoluteTime: new Date("2023-07-12T21:06:52.460Z"),
    setterTimeZone: defaultTimeZone,
});

const createdTime2 = new TaskFilterableTime({
    absoluteTime: new Date("2023-07-11T21:07:11.096Z"),
    setterTimeZone: defaultTimeZone,
});

const createdTime3 = new TaskFilterableTime({
    absoluteTime: createdTime1.absoluteTime,
    setterTimeZone: assertTimeZone("America/Denver"),
});

const taskId = generateId<TaskId>();
const taskCollectionId1 = generateId<TaskCollectionId>();
const taskCollectionId2 = generateId<TaskCollectionId>();

const testCases: Array<{
    name: string;
    actions: Array<TaskActionModel>;
    task: TaskModel | {new (...args: Array<any>): Error};
}> = [
    {
        name: "create task",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.empty,
        }),
    },
    {
        name: "create task incompatible accounts",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "Create",
                creator: account2,
                createdTime: createdTime1,
            },
        ],
        task: FailedPreconditionError,
    },
    {
        name: "create task incompatible absolute created time",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime2,
            },
        ],
        task: FailedPreconditionError,
    },
    {
        name: "create task incompatible setter created time zone",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime3,
            },
        ],
        task: FailedPreconditionError,
    },
    {
        name: "update task title (1x)",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: taskTitleTestScenario.title1,
            collections: TaskCollectionSet.empty,
        }),
    },
    {
        name: "update task title (2x)",
        actions: [
            {
                type: "Create",
                creator: account2,
                createdTime: createdTime1,
            },
            {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
            {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update1,
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account2,
            createdTime: createdTime1,
            title: taskTitleTestScenario.title2,
            collections: TaskCollectionSet.empty,
        }),
    },
    {
        name: "update task title (4x)",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime2,
            },
            {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update0,
            },
            {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update1,
            },
            {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update2,
            },
            {
                type: "UpdateTitle",
                titleUpdate: taskTitleTestScenario.update3,
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime2,
            title: taskTitleTestScenario.title4,
            collections: TaskCollectionSet.empty,
        }),
    },
    {
        name: "add and remove collection",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId2,
                    orderKey: assertOrderKey("a1"),
                    updatedTime: new Date("2023-07-13T15:22:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Delete",
                    collectionId: taskCollectionId1,
                    updatedTime: new Date("2023-07-13T15:23:45.430Z"),
                },
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.schema.deserialize([
                [
                    taskCollectionId1,
                    {
                        type: "Absent",
                        updatedTime: "2023-07-13T15:23:45.430Z",
                    },
                ],
                [
                    taskCollectionId2,
                    {
                        type: "Present",
                        updatedTime: "2023-07-13T15:22:45.430Z",
                        orderKey: "a1",
                    },
                ],
            ]),
        }),
    },
    {
        name: "add, remove, and add collection",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Delete",
                    collectionId: taskCollectionId1,
                    updatedTime: new Date("2023-07-13T15:22:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:23:45.430Z"),
                },
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.schema.deserialize([
                [
                    taskCollectionId1,
                    {
                        type: "Present",
                        updatedTime: "2023-07-13T15:23:45.430Z",
                        orderKey: "a0",
                    },
                ],
            ]),
        }),
    },
    {
        name: "collection updated time conflict, remove wins",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Delete",
                    collectionId: taskCollectionId1,
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.schema.deserialize([
                [
                    taskCollectionId1,
                    {
                        type: "Absent",
                        updatedTime: "2023-07-13T15:21:45.430Z",
                    },
                ],
            ]),
        }),
    },
    {
        name: "collection updated time conflict, higher order key wins",
        actions: [
            {
                type: "Create",
                creator: account1,
                createdTime: createdTime1,
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a0"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
            {
                type: "UpdateCollections",
                action: {
                    type: "Set",
                    collectionId: taskCollectionId1,
                    orderKey: assertOrderKey("a1"),
                    updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                },
            },
        ],
        task: new TaskModel({
            id: taskId,
            creator: account1,
            createdTime: createdTime1,
            title: emptyTaskTitle.get(),
            collections: TaskCollectionSet.schema.deserialize([
                [
                    taskCollectionId1,
                    {
                        type: "Present",
                        updatedTime: "2023-07-13T15:21:45.430Z",
                        orderKey: "a1",
                    },
                ],
            ]),
        }),
    },
];

/**
 * Generate all the permutations of an array. Derived from [StackOverflow][1].
 *
 * [1]: https://stackoverflow.com/a/20871714/1568890
 */
function permutator<Item>(inputArray: ReadonlyArray<Item>): Array<Array<Item>> {
    const results: Array<Array<Item>> = [];

    const permute = (array: ReadonlyArray<Item>, result: Array<Item> = []) => {
        if (array.length === 0) {
            results.push(result);
        } else {
            for (let i = 0; i < array.length; i++) {
                const remainingArray = array.slice();
                const additionalResult = remainingArray.splice(i, 1);
                permute(remainingArray.slice(), result.concat(additionalResult));
            }
        }
    };

    permute(inputArray);

    return results;
}

for (const testCase of testCases) {
    describe(`${testCase.name}`, () => {
        const actionIndexes = testCase.actions.map((action, index) => index);
        const actionIndexesWithDuplicates = actionIndexes.map(index => [...actionIndexes, index]);

        const permutations = [
            ...permutator(actionIndexes),
            ...actionIndexesWithDuplicates.flatMap(permutator),
        ];

        const uniquePermutationStrings = new Set(
            permutations.map(permutation => JSON.stringify(permutation)),
        );

        for (const permutationString of uniquePermutationStrings) {
            const permutation: Array<number> = JSON.parse(permutationString);

            test(`[${permutation.join(", ")}]`, () => {
                if ("prototype" in testCase.task && testCase.task.prototype instanceof Error) {
                    expect(() => {
                        permutation.reduce(
                            (database, actionIndex) =>
                                database.applyTaskAction(taskId, testCase.actions[actionIndex]!),
                            TaskClientDatabase.empty,
                        );
                    }).toThrow(testCase.task);
                } else {
                    let database = TaskClientDatabase.empty;

                    database = permutation.reduce(
                        (database, actionIndex) =>
                            database.applyTaskAction(taskId, testCase.actions[actionIndex]!),
                        database,
                    );

                    const actualTask = database.getTask(taskId);
                    const expectedTask = testCase.task as TaskModel;

                    expect({
                        ...actualTask,
                        title: getTaskTitleProsemirrorNode(actualTask.title).toJSON(),
                    }).toEqual({
                        ...expectedTask,
                        title: getTaskTitleProsemirrorNode(expectedTask.title).toJSON(),
                    });
                }
            });
        }
    });
}
