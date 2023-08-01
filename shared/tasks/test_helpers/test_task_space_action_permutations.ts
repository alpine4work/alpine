import {CalendarDate} from "@internationalized/date";
import chalk from "chalk";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {shuffleArray} from "~/shared/helpers/array/shuffle_array.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskSpaceAction} from "~/shared/tasks/actions/task_space_action.js";
import {TaskAssignee} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatus} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";
import {TaskTitle, emptyTaskTitle, getTaskTitleProsemirrorNode} from "~/shared/tasks/task_title.js";
import {taskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_helpers.js";

// These test cases should only be used in Jest tests.
assert(import.meta.jest);

export type TaskTestInterface = {
    creator: TaskSortableAccount;
    createdTime: TaskFilterableTime;
    isDeleted: boolean;
    parent: {taskId: TaskId; position: TaskPosition} | null;
    collections: TaskCollectionSet;
    status: TaskStatus;
    assignee: TaskAssignee | null;
    assigneeStatus: TaskAssigneeStatus;
    title: TaskTitle;
    dueDate: CalendarDate | null;
    priority: TaskPriority | null;
};

const taskActionTestCases: Array<{
    name: string;
    create: (scenario: {
        creator: TaskSortableAccount;
        createdTime: TaskFilterableTime;
        account2: TaskSortableAccount;
        collectionId1: TaskCollectionId;
        collectionId2: TaskCollectionId;
        getNextTime: () => Date;
        getNextFilterableTime: () => TaskFilterableTime;
    }) => {
        actions: Array<TaskAction>;
        task: Partial<TaskTestInterface> | {new (...args: Array<any>): Error};
    };
}> = [
    {
        name: "create task",
        create: ({creator, createdTime}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
                },
            ],
            task: {},
        }),
    },
    {
        name: "create task incompatible accounts",
        create: ({creator, createdTime, account2}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
                },
                {
                    type: "Create",
                    creator: account2,
                    createdTime,
                },
            ],
            task: FailedPreconditionError,
        }),
    },
    {
        name: "create task incompatible absolute created time",
        create: ({creator, createdTime, getNextFilterableTime}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
                },
                {
                    type: "Create",
                    creator,
                    createdTime: getNextFilterableTime(),
                },
            ],
            task: FailedPreconditionError,
        }),
    },
    {
        name: "create task incompatible setter created time zone",
        create: ({creator, createdTime}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
                },
                {
                    type: "Create",
                    creator,
                    createdTime: new TaskFilterableTime({
                        absoluteTime: createdTime.absoluteTime,
                        setterTimeZone: assertTimeZone("America/Denver"),
                    }),
                },
            ],
            task: FailedPreconditionError,
        }),
    },
    {
        name: "update task title (1x)",
        create: ({creator, createdTime}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
                },
                {
                    type: "UpdateTitle",
                    titleUpdate: taskTitleTestScenario.update0,
                },
            ],
            task: {
                title: taskTitleTestScenario.title1,
            },
        }),
    },
    {
        name: "update task title (2x)",
        create: ({creator, createdTime}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
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
            task: {
                title: taskTitleTestScenario.title2,
            },
        }),
    },
    {
        name: "update task title (4x)",
        create: ({creator, createdTime}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
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
            task: {
                title: taskTitleTestScenario.title4,
            },
        }),
    },
    {
        name: "add and remove collection",
        create: ({creator, createdTime, collectionId1, collectionId2}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId1,
                        value: assertOrderKey("a0"),
                        updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                    },
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId2,
                        value: assertOrderKey("a1"),
                        updatedTime: new Date("2023-07-13T15:22:45.430Z"),
                    },
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Delete",
                        key: collectionId1,
                        deletedTime: new Date("2023-07-13T15:23:45.430Z"),
                    },
                },
            ],
            task: {
                collections: TaskCollectionSet.schema.deserialize([
                    [
                        collectionId1,
                        {
                            value: null,
                            updatedTime: "2023-07-13T15:23:45.430Z",
                        },
                    ],
                    [
                        collectionId2,
                        {
                            value: "a1",
                            updatedTime: "2023-07-13T15:22:45.430Z",
                        },
                    ],
                ]),
            },
        }),
    },
    {
        name: "add, remove, and add collection",
        create: ({creator, createdTime, collectionId1}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId1,
                        value: assertOrderKey("a0"),
                        updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                    },
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Delete",
                        key: collectionId1,
                        deletedTime: new Date("2023-07-13T15:22:45.430Z"),
                    },
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId1,
                        value: assertOrderKey("a0"),
                        updatedTime: new Date("2023-07-13T15:23:45.430Z"),
                    },
                },
            ],
            task: {
                collections: TaskCollectionSet.schema.deserialize([
                    [
                        collectionId1,
                        {
                            value: "a0",
                            updatedTime: "2023-07-13T15:23:45.430Z",
                        },
                    ],
                ]),
            },
        }),
    },
    {
        name: "collection updated time conflict, remove wins",
        create: ({creator, createdTime, collectionId1}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId1,
                        value: assertOrderKey("a0"),
                        updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                    },
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Delete",
                        key: collectionId1,
                        deletedTime: new Date("2023-07-13T15:21:45.430Z"),
                    },
                },
            ],
            task: {
                collections: TaskCollectionSet.schema.deserialize([
                    [
                        collectionId1,
                        {
                            value: null,
                            updatedTime: "2023-07-13T15:21:45.430Z",
                        },
                    ],
                ]),
            },
        }),
    },
    {
        name: "collection updated time conflict, higher order key wins",
        create: ({creator, createdTime, collectionId1}) => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    createdTime,
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId1,
                        value: assertOrderKey("a0"),
                        updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                    },
                },
                {
                    type: "UpdateCollections",
                    collectionsAction: {
                        type: "Set",
                        key: collectionId1,
                        value: assertOrderKey("a1"),
                        updatedTime: new Date("2023-07-13T15:21:45.430Z"),
                    },
                },
            ],
            task: {
                collections: TaskCollectionSet.schema.deserialize([
                    [
                        collectionId1,
                        {
                            value: "a1",
                            updatedTime: "2023-07-13T15:21:45.430Z",
                        },
                    ],
                ]),
            },
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

/**
 * We have a library of `TaskSpaceAction` test cases. This function will run
 * each of our test cases. It will run the test case in every possible order
 * and with duplicates. This way we can test the commutativity and idempotency
 * properties of `TaskSpaceAction`s.
 *
 * This is in a shared file so we can run it with our OpenSearch
 * `TaskSpaceAction` implementation and our client database `TaskSpaceAction`
 * implementation to verify they have the same implementations.
 *
 * We do not use this to test committing `TaskSpaceAction`s. The
 * `TaskSpaceAction` commit function is not commutative or idempotent. Once an
 * action has been committed, then we may apply it in any order.
 */
export function testTaskSpaceActionPermutations({
    account1,
    account2,
    applyTaskSpaceAction,
    getTask,
}: {
    account1: AccountModel;
    account2: AccountModel;
    applyTaskSpaceAction: (action: TaskSpaceAction, next: () => void) => MaybePromise<void>;
    getTask: (taskId: TaskId) => Promise<TaskTestInterface>;
}) {
    for (const testCase of taskActionTestCases) {
        describe(`${testCase.name}`, () => {
            let lastTime = Date.now();

            // Make sure this function returns a monotonically increasing date to
            // avoid flaky errors.
            function getNextTime() {
                const currentTime = Math.max(Date.now(), lastTime + 1);
                lastTime = currentTime;
                return new Date(currentTime);
            }

            function getNextFilterableTime() {
                return new TaskFilterableTime({
                    absoluteTime: getNextTime(),
                    setterTimeZone: defaultTimeZone,
                });
            }

            const collectionId1 = generateId<TaskCollectionId>();
            const collectionId2 = generateId<TaskCollectionId>();

            const testCaseArtifacts = testCase.create({
                creator: new TaskSortableAccount({
                    accountId: account1.id,
                    workingAccountName: account1.name,
                }),
                createdTime: getNextFilterableTime(),
                account2: new TaskSortableAccount({
                    accountId: account2.id,
                    workingAccountName: account2.name,
                }),
                collectionId1,
                collectionId2,
                getNextTime,
                getNextFilterableTime,
            });

            const actionIndexes = testCaseArtifacts.actions.map((action, index) => index);
            const actionIndexesWithDuplicates = actionIndexes.map(index => [
                ...actionIndexes,
                index,
            ]);

            function uniquePermutations(permutations: Array<Array<number>>): Array<Array<number>> {
                return Array.from(
                    new Set(permutations.map(permutation => JSON.stringify(permutation))),
                    permutationString => JSON.parse(permutationString),
                );
            }

            const permutationsWithDuplicates = uniquePermutations(
                actionIndexesWithDuplicates.flatMap(permutator),
            );

            const permutations = [
                ...uniquePermutations(permutator(actionIndexes)),

                // Don't include more than 240 permutations with duplicate actions. We test in
                // every order (above) then randomly sample permutations with duplicates.
                //
                // 240 is the length of `permutationsWithDuplicates` when we have 4 actions.
                ...(permutationsWithDuplicates.length > 240
                    ? shuffleArray(permutationsWithDuplicates).slice(0, 240)
                    : permutationsWithDuplicates),
            ];

            for (const permutation of permutations) {
                // Run tests concurrently to improve performance.
                test.concurrent(`[${permutation.join(", ")}]`, async () => {
                    try {
                        const taskId = generateId<TaskId>();

                        const actions: Array<TaskSpaceAction> = permutation.map(actionIndex => ({
                            type: "UpdateTask",
                            taskId,
                            taskAction: testCaseArtifacts.actions[actionIndex]!,
                        }));

                        const run = async () => {
                            const promises = [];

                            // Run our actions in sequence. If an action calls `next()` that means it needs
                            // to retry. It might need to retry because it's waiting on a later action. So
                            // go apply the next action.
                            for (const action of actions) {
                                const nextPromiseResolver = createPromiseResolver();

                                const promise = applyTaskSpaceAction(
                                    action,
                                    nextPromiseResolver.resolve,
                                );
                                promises.push(promise);

                                await Promise.race([promise, nextPromiseResolver.promise]);
                            }

                            await runAllPromises(promises);
                        };

                        if (
                            "prototype" in testCaseArtifacts.task &&
                            testCaseArtifacts.task.prototype instanceof Error
                        ) {
                            await expect(run).rejects.toThrow(testCaseArtifacts.task);
                        } else {
                            await run();

                            const actualTask = await getTask(taskId);
                            const expectedPartialTask =
                                testCaseArtifacts.task as Partial<TaskTestInterface>;

                            const createAction = iterableFirst(
                                filterMapIterable(actions, action =>
                                    action.type === "UpdateTask" &&
                                    action.taskId === taskId &&
                                    action.taskAction.type === "Create"
                                        ? action.taskAction
                                        : null,
                                ),
                            );

                            const expectedTask: TaskTestInterface = {
                                isDeleted: false,
                                parent: null,
                                collections: TaskCollectionSet.empty,
                                status: {type: "Open"},
                                assignee: null,
                                assigneeStatus: {type: "Inactive"},
                                title: emptyTaskTitle.get(),
                                dueDate: null,
                                priority: null,
                                ...expectedPartialTask,
                                creator:
                                    expectedPartialTask.creator ??
                                    assertExists(
                                        createAction?.creator,
                                        "Expected `Create` task action when `creator` is not provided",
                                    ),
                                createdTime:
                                    expectedPartialTask.createdTime ??
                                    assertExists(
                                        createAction?.createdTime,
                                        "Expected `Create` task action when `createdTime` is not provided",
                                    ),
                            };

                            expect({
                                ...actualTask,
                                title: getTaskTitleProsemirrorNode(actualTask.title).toJSON(),
                                collections: actualTask.collections.getArray(),
                            }).toEqual({
                                ...expectedTask,
                                title: getTaskTitleProsemirrorNode(expectedTask.title).toJSON(),
                                collections: actualTask.collections.getArray(),
                            });
                        }

                        // Since this test takes a while to run, it's really useful to have the test
                        // name printed out as we go. Ideally we'd have a Jest streaming reporter but
                        // for now it's only really essential for this test.
                        // eslint-disable-next-line no-console
                        console.log(
                            `${chalk.green("✔")} ${chalk.dim(
                                `${testCase.name} \u203A [${permutation.join(", ")}]`,
                            )}`,
                        );
                    } catch (error) {
                        // Since this test takes a while to run, it's really useful to have the test
                        // name printed out as we go. Ideally we'd have a Jest streaming reporter but
                        // for now it's only really essential for this test.
                        // eslint-disable-next-line no-console
                        console.log(
                            `${chalk.red(`✘ ${testCase.name} \u203A [${permutation.join(", ")}]`)}`,
                        );
                        // eslint-disable-next-line no-console
                        console.error(error);

                        throw error;
                    }
                });
            }
        });
    }
}
