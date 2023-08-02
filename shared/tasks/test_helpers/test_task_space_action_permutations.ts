import {CalendarDate} from "@internationalized/date";
import chalk from "chalk";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {stableShuffleArray} from "~/shared/helpers/array/stable_shuffle_array.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskSpaceAction} from "~/shared/tasks/actions/task_space_action.js";
import {TaskAssignee} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatus} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionAccessPolicy} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskNotepadPageId, generateTaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
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
    collectionPositions: Map<TaskCollectionId, TaskPosition>;
    notepadPagePositions: Map<`${AccountId}-${TaskNotepadPageId}`, TaskPosition>;
    status: TaskStatus;
    assignee: TaskAssignee | null;
    assigneeStatus: TaskAssigneeStatus;
    title: TaskTitle;
    dueDate: CalendarDate | null;
    priority: TaskPriority | null;
};

export type TaskCollectionTestInterface = {
    createdTime: Date;
    isDeleted: boolean;
    name: string;
    accessPolicy: TaskCollectionAccessPolicy;
};

type TaskSpaceActionTestScenario = {
    creator: TaskSortableAccount;
    createdTime: TaskFilterableTime;
    account2: TaskSortableAccount;
    collectionId1: TaskCollectionId;
    collectionId2: TaskCollectionId;
    getNextTime: () => Date;
    getNextFilterableTime: () => TaskFilterableTime;
};

const taskActionTestCases: Array<{
    name: string;
    create: (scenario: TaskSpaceActionTestScenario) =>
        | {
              actions: Array<TaskAction>;
              task: Partial<TaskTestInterface>;
              error?: undefined;
          }
        | {
              actions: Array<TaskAction>;
              error: {new (...args: Array<any>): Error};
              task?: undefined;
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
            error: FailedPreconditionError,
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
            error: FailedPreconditionError,
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
            error: FailedPreconditionError,
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
    {
        name: "delete",
        create: ({creator, createdTime, getNextTime}) => {
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "Delete",
                        deletedTime,
                    },
                ],
                task: {
                    isDeleted: true,
                },
            };
        },
    },
    {
        name: "undelete",
        create: ({creator, createdTime, getNextTime}) => {
            const deletedTime = getNextTime();
            const undeletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "Delete",
                        deletedTime,
                    },
                    {
                        type: "Undelete",
                        undeletedTime,
                    },
                ],
                task: {
                    isDeleted: false,
                },
            };
        },
    },
    {
        name: "update title before delete",
        create: ({creator, createdTime, getNextTime}) => {
            const deletedTime = getNextTime();

            return {
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
                        type: "Delete",
                        deletedTime,
                    },
                ],
                task: {
                    isDeleted: true,
                    title: taskTitleTestScenario.title1,
                },
            };
        },
    },
    {
        name: "update title after delete",
        create: ({creator, createdTime, getNextTime}) => {
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "Delete",
                        deletedTime,
                    },
                    {
                        type: "UpdateTitle",
                        titleUpdate: taskTitleTestScenario.update0,
                    },
                ],
                task: {
                    isDeleted: true,
                    title: taskTitleTestScenario.title1,
                },
            };
        },
    },
    {
        name: "delete, undelete, delete",
        create: ({creator, createdTime, getNextTime}) => {
            const deletedTime1 = getNextTime();
            const undeletedTime = getNextTime();
            const deletedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "Delete",
                        deletedTime: deletedTime1,
                    },
                    {
                        type: "Undelete",
                        undeletedTime,
                    },
                    {
                        type: "Delete",
                        deletedTime: deletedTime2,
                    },
                ],
                task: {
                    isDeleted: true,
                },
            };
        },
    },
    {
        name: "undelete without delete",
        create: ({creator, createdTime, getNextTime}) => {
            const undeletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "Undelete",
                        undeletedTime,
                    },
                ],
                task: {
                    isDeleted: false,
                },
            };
        },
    },
    {
        name: "delete and undelete time conflict",
        create: ({creator, createdTime, getNextTime}) => {
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "Delete",
                        deletedTime,
                    },
                    {
                        type: "Undelete",
                        undeletedTime: deletedTime,
                    },
                ],
                task: {
                    isDeleted: false,
                },
            };
        },
    },
    {
        name: "undelete before delete",
        create: ({creator, createdTime, getNextTime}) => {
            const undeletedTime = getNextTime();
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "Undelete",
                        undeletedTime,
                    },
                    {
                        type: "Delete",
                        deletedTime,
                    },
                ],
                task: {
                    isDeleted: true,
                },
            };
        },
    },
    {
        name: "update parent",
        create: ({creator, createdTime, getNextTime}) => {
            const parentTaskId = generateId<TaskId>();
            const updatedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskIdAction: {
                            value: parentTaskId,
                            updatedTime,
                        },
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId,
                        position: {orderTime: updatedTime, orderKey: initialOrderKey},
                    },
                },
            };
        },
    },
    {
        name: "update parent then unset parent",
        create: ({creator, createdTime, getNextTime}) => {
            const parentTaskId = generateId<TaskId>();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskIdAction: {
                            value: parentTaskId,
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskIdAction: {
                            value: null,
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                task: {
                    parent: null,
                },
            };
        },
    },
    {
        name: "unset parent then update parent",
        create: ({creator, createdTime, getNextTime}) => {
            const parentTaskId = generateId<TaskId>();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskIdAction: {
                            value: null,
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskIdAction: {
                            value: parentTaskId,
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId,
                        position: {orderTime: updatedTime2, orderKey: initialOrderKey},
                    },
                },
            };
        },
    },
    {
        name: "update parent then update parent position",
        create: ({creator, createdTime, getNextTime}) => {
            const parentTaskId = generateId<TaskId>();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskIdAction: {
                            value: parentTaskId,
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateParentPosition",
                        parentPositionAction: {
                            value: {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId,
                        position: {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                    },
                },
            };
        },
    },
    {
        name: "update parent position then update parent",
        create: ({creator, createdTime, getNextTime}) => {
            const parentTaskId = generateId<TaskId>();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateParentPosition",
                        parentPositionAction: {
                            value: {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskIdAction: {
                            value: parentTaskId,
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId,
                        position: {orderTime: updatedTime2, orderKey: initialOrderKey},
                    },
                },
            };
        },
    },
    {
        name: "update parent resets position",
        create: ({creator, createdTime, getNextTime}) => {
            const parentTaskId1 = generateId<TaskId>();
            const parentTaskId2 = generateId<TaskId>();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();
            const updatedTime3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskIdAction: {
                            value: parentTaskId1,
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateParentPosition",
                        parentPositionAction: {
                            value: {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                            updatedTime: updatedTime2,
                        },
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskIdAction: {
                            value: parentTaskId2,
                            updatedTime: updatedTime3,
                        },
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId2,
                        position: {orderTime: updatedTime3, orderKey: initialOrderKey},
                    },
                },
            };
        },
    },
    {
        name: "update status",
        create: ({creator, createdTime, account2, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateStatus",
                        statusAction: {
                            value: {type: "Closed", closedTime: updatedTime1, closer: account2},
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                ],
                task: {
                    status: {type: "Closed", closedTime: updatedTime1, closer: account2},
                },
            };
        },
    },
    {
        name: "update status twice",
        create: ({creator, createdTime, account2, getNextTime, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateStatus",
                        statusAction: {
                            value: {type: "Closed", closedTime: updatedTime1, closer: account2},
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateStatus",
                        statusAction: {
                            value: {type: "Open"},
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                task: {
                    status: {type: "Open"},
                },
            };
        },
    },
    {
        name: "update assignee",
        create: ({creator, createdTime, account2, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: account2,
                                assigner: creator,
                                assignedTime: updatedTime1,
                            },
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: updatedTime1,
                    },
                },
            };
        },
    },
    {
        name: "update assignee twice",
        create: ({creator, createdTime, account2, getNextTime, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: account2,
                                assigner: creator,
                                assignedTime: updatedTime1,
                            },
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: null,
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                task: {
                    assignee: null,
                },
            };
        },
    },
    {
        name: "update assignee status",
        create: ({creator, createdTime, account2, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();
            const updatedTime2 = getNextFilterableTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: account2,
                                assigner: creator,
                                assignedTime: updatedTime1,
                            },
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        assigneeStatusAction: {
                            value: {
                                type: "Active",
                                position: {
                                    orderTime: updatedTime2.absoluteTime,
                                    orderKey: initialOrderKey,
                                },
                                activatedTime: updatedTime2,
                            },
                            updatedTime: updatedTime2.absoluteTime,
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: updatedTime1,
                    },
                    assigneeStatus: {
                        type: "Active",
                        position: {orderTime: updatedTime2.absoluteTime, orderKey: initialOrderKey},
                        activatedTime: updatedTime2,
                    },
                },
            };
        },
    },
    {
        name: "update assignee status twice",
        create: ({creator, createdTime, account2, getNextTime, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();
            const updatedTime2 = getNextFilterableTime();
            const updatedTime3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: account2,
                                assigner: creator,
                                assignedTime: updatedTime1,
                            },
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        assigneeStatusAction: {
                            value: {
                                type: "Active",
                                position: {
                                    orderTime: updatedTime2.absoluteTime,
                                    orderKey: initialOrderKey,
                                },
                                activatedTime: updatedTime2,
                            },
                            updatedTime: updatedTime2.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        assigneeStatusAction: {
                            value: {type: "Inactive"},
                            updatedTime: updatedTime3,
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: updatedTime1,
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "updating status resets assignee status",
        create: ({creator, createdTime, account2, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();
            const updatedTime2 = getNextFilterableTime();
            const updatedTime3 = getNextFilterableTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: account2,
                                assigner: creator,
                                assignedTime: updatedTime1,
                            },
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        assigneeStatusAction: {
                            value: {
                                type: "Active",
                                position: {
                                    orderTime: updatedTime2.absoluteTime,
                                    orderKey: initialOrderKey,
                                },
                                activatedTime: updatedTime2,
                            },
                            updatedTime: updatedTime2.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateStatus",
                        statusAction: {
                            value: {type: "Closed", closedTime: updatedTime3, closer: account2},
                            updatedTime: updatedTime3.absoluteTime,
                        },
                    },
                ],
                task: {
                    status: {type: "Closed", closedTime: updatedTime3, closer: account2},
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: updatedTime1,
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "updating status resets assignee status even if status doesn't change",
        create: ({creator, createdTime, account2, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();
            const updatedTime2 = getNextFilterableTime();
            const updatedTime3 = getNextFilterableTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: account2,
                                assigner: creator,
                                assignedTime: updatedTime1,
                            },
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        assigneeStatusAction: {
                            value: {
                                type: "Active",
                                position: {
                                    orderTime: updatedTime2.absoluteTime,
                                    orderKey: initialOrderKey,
                                },
                                activatedTime: updatedTime2,
                            },
                            updatedTime: updatedTime2.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateStatus",
                        statusAction: {
                            value: {type: "Open"},
                            updatedTime: updatedTime3.absoluteTime,
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: updatedTime1,
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "updating assignee resets assignee status",
        create: ({creator, createdTime, account2, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();
            const updatedTime2 = getNextFilterableTime();
            const updatedTime3 = getNextFilterableTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: account2,
                                assigner: creator,
                                assignedTime: updatedTime1,
                            },
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        assigneeStatusAction: {
                            value: {
                                type: "Active",
                                position: {
                                    orderTime: updatedTime2.absoluteTime,
                                    orderKey: initialOrderKey,
                                },
                                activatedTime: updatedTime2,
                            },
                            updatedTime: updatedTime2.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: creator,
                                assigner: account2,
                                assignedTime: updatedTime3,
                            },
                            updatedTime: updatedTime3.absoluteTime,
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: creator,
                        assigner: account2,
                        assignedTime: updatedTime3,
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "updating assignee resets assignee status even if assignee doesn't change",
        create: ({creator, createdTime, account2, getNextFilterableTime}) => {
            const updatedTime1 = getNextFilterableTime();
            const updatedTime2 = getNextFilterableTime();
            const updatedTime3 = getNextFilterableTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: account2,
                                assigner: creator,
                                assignedTime: updatedTime1,
                            },
                            updatedTime: updatedTime1.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        assigneeStatusAction: {
                            value: {
                                type: "Active",
                                position: {
                                    orderTime: updatedTime2.absoluteTime,
                                    orderKey: initialOrderKey,
                                },
                                activatedTime: updatedTime2,
                            },
                            updatedTime: updatedTime2.absoluteTime,
                        },
                    },
                    {
                        type: "UpdateAssignee",
                        assigneeAction: {
                            value: {
                                assignee: account2,
                                assigner: creator,
                                assignedTime: updatedTime3,
                            },
                            updatedTime: updatedTime3.absoluteTime,
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: updatedTime3,
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "update due date",
        create: ({creator, createdTime, getNextTime}) => {
            const updatedTime1 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateDueDate",
                        dueDateAction: {
                            value: new CalendarDate(2023, 7, 12),
                            updatedTime: updatedTime1,
                        },
                    },
                ],
                task: {
                    dueDate: new CalendarDate(2023, 7, 12),
                },
            };
        },
    },
    {
        name: "update due date twice",
        create: ({creator, createdTime, getNextTime}) => {
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdateDueDate",
                        dueDateAction: {
                            value: new CalendarDate(2023, 7, 12),
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateDueDate",
                        dueDateAction: {
                            value: null,
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                task: {
                    dueDate: null,
                },
            };
        },
    },
    {
        name: "update priority",
        create: ({creator, createdTime, getNextTime}) => {
            const updatedTime1 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdatePriority",
                        priorityAction: {
                            value: "High",
                            updatedTime: updatedTime1,
                        },
                    },
                ],
                task: {
                    priority: "High",
                },
            };
        },
    },
    {
        name: "update priority twice",
        create: ({creator, createdTime, getNextTime}) => {
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        createdTime,
                    },
                    {
                        type: "UpdatePriority",
                        priorityAction: {
                            value: "High",
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdatePriority",
                        priorityAction: {
                            value: null,
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                task: {
                    priority: null,
                },
            };
        },
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
];

type TaskSpaceActionTestArtifactsExpect =
    | {
          taskId: TaskId;
          task: Partial<TaskTestInterface>;
          collectionId?: undefined;
      }
    | {
          collectionId: TaskCollectionId;
          collection: Partial<TaskCollectionTestInterface>;
          taskId?: undefined;
      };

type TaskSpaceActionTestArtifacts =
    | {
          actions: Array<TaskSpaceAction>;
          // Must not be empty.
          expect: [
              TaskSpaceActionTestArtifactsExpect,
              ...Array<TaskSpaceActionTestArtifactsExpect>,
          ];
          error?: undefined;
      }
    | {
          actions: Array<TaskSpaceAction>;
          error: {new (...args: Array<any>): Error};
          task?: undefined;
      };

const taskSpaceActionTestCases: Array<{
    name: string;
    create: (scenario: TaskSpaceActionTestScenario) => TaskSpaceActionTestArtifacts;
}> = [
    ...taskActionTestCases.map(testCase => {
        return {
            name: testCase.name,
            create: (scenario: TaskSpaceActionTestScenario): TaskSpaceActionTestArtifacts => {
                const testCaseArtifacts = testCase.create(scenario);
                const taskId = generateId<TaskId>();

                const actions: Array<TaskSpaceAction> = testCaseArtifacts.actions.map(action => ({
                    type: "UpdateTask",
                    taskId,
                    taskAction: action,
                }));

                if (testCaseArtifacts.error) {
                    return {
                        actions,
                        error: testCaseArtifacts.error,
                    };
                } else {
                    return {
                        actions,
                        expect: [{taskId, task: testCaseArtifacts.task}],
                    };
                }
            },
        };
    }),
    {
        name: "add task to notepad page",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();
            const updatedTime1 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: updatedTime1, orderKey: initialOrderKey},
                            updatedTime: updatedTime1,
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            notepadPagePositions: new Map([
                                [
                                    `${creator.accountId}-${notepadPageId}` as const,
                                    {orderTime: updatedTime1, orderKey: initialOrderKey},
                                ],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "add then remove task from notepad page",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: updatedTime1, orderKey: initialOrderKey},
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "RemoveTask",
                            taskId,
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {},
                    },
                ],
            };
        },
    },
    {
        name: "remove then add task from notepad page",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "RemoveTask",
                            taskId,
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: updatedTime2, orderKey: initialOrderKey},
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            notepadPagePositions: new Map([
                                [
                                    `${creator.accountId}-${notepadPageId}` as const,
                                    {orderTime: updatedTime2, orderKey: initialOrderKey},
                                ],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "only remove task from notepad page",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();
            const updatedTime1 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "RemoveTask",
                            taskId,
                            updatedTime: updatedTime1,
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {},
                    },
                ],
            };
        },
    },
    {
        name: "change task position in notepad page",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: updatedTime1, orderKey: initialOrderKey},
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                            updatedTime: updatedTime2,
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            notepadPagePositions: new Map([
                                [
                                    `${creator.accountId}-${notepadPageId}` as const,
                                    {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                                ],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "delete collection",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                            deletedTime,
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            isDeleted: true,
                        },
                    },
                ],
            };
        },
    },
    {
        name: "undelete collection",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const deletedTime = getNextTime();
            const undeletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                            deletedTime,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
                            undeletedTime,
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            isDeleted: false,
                        },
                    },
                ],
            };
        },
    },
    {
        name: "update name before delete collection",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const updatedTime = getNextTime();
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            nameAction: {
                                value: "New Collection Name",
                                updatedTime,
                            },
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                            deletedTime,
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            isDeleted: true,
                            name: "New Collection Name",
                        },
                    },
                ],
            };
        },
    },
    {
        name: "update name after delete collection",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const deletedTime = getNextTime();
            const updatedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                            deletedTime,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            nameAction: {
                                value: "New Collection Name",
                                updatedTime,
                            },
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            isDeleted: true,
                            name: "New Collection Name",
                        },
                    },
                ],
            };
        },
    },
    {
        name: "delete collection, undelete collection, delete collection",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const deletedTime1 = getNextTime();
            const undeletedTime = getNextTime();
            const deletedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                            deletedTime: deletedTime1,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
                            undeletedTime,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                            deletedTime: deletedTime2,
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            isDeleted: true,
                        },
                    },
                ],
            };
        },
    },
    {
        name: "undelete collection without delete collection",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const undeletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
                            undeletedTime,
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            isDeleted: false,
                        },
                    },
                ],
            };
        },
    },
    {
        name: "delete collection and undelete collection time conflict",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                            deletedTime,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
                            undeletedTime: deletedTime,
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            isDeleted: false,
                        },
                    },
                ],
            };
        },
    },
    {
        name: "undelete collection before delete collection",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const undeletedTime = getNextTime();
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
                            undeletedTime,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                            deletedTime,
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            isDeleted: true,
                        },
                    },
                ],
            };
        },
    },
    {
        name: "move task in collection",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const updatedTime1 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime: createdTime.absoluteTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "UpdateCollections",
                            collectionsAction: {
                                type: "Set",
                                key: collectionId,
                                value: initialOrderKey,
                                updatedTime: updatedTime1,
                            },
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                            updatedTime: getNextTime(),
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            collections: TaskCollectionSet.schema.deserialize([
                                [
                                    collectionId,
                                    {
                                        value: initialOrderKey,
                                        updatedTime: updatedTime1.toISOString(),
                                    },
                                ],
                            ]),
                            collectionPositions: new Map([
                                [
                                    collectionId,
                                    {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                                ],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "move task in collection twice",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const updatedTime1 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime: createdTime.absoluteTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "UpdateCollections",
                            collectionsAction: {
                                type: "Set",
                                key: collectionId,
                                value: initialOrderKey,
                                updatedTime: updatedTime1,
                            },
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                            updatedTime: getNextTime(),
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: updatedTime1, orderKey: assertOrderKey("a43")},
                            updatedTime: getNextTime(),
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            collections: TaskCollectionSet.schema.deserialize([
                                [
                                    collectionId,
                                    {
                                        value: initialOrderKey,
                                        updatedTime: updatedTime1.toISOString(),
                                    },
                                ],
                            ]),
                            collectionPositions: new Map([
                                [
                                    collectionId,
                                    {orderTime: updatedTime1, orderKey: assertOrderKey("a43")},
                                ],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "move then remove task in collection",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const updatedTime1 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime: createdTime.absoluteTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "UpdateCollections",
                            collectionsAction: {
                                type: "Set",
                                key: collectionId,
                                value: initialOrderKey,
                                updatedTime: updatedTime1,
                            },
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                            updatedTime: getNextTime(),
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "UpdateCollections",
                            collectionsAction: {
                                type: "Delete",
                                key: collectionId,
                                deletedTime: getNextTime(),
                            },
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {},
                    },
                ],
            };
        },
    },
    {
        name: "collection task position preserved after removing",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();
            const updatedTime3 = getNextTime();
            const updatedTime4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime: createdTime.absoluteTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "UpdateCollections",
                            collectionsAction: {
                                type: "Set",
                                key: collectionId,
                                value: initialOrderKey,
                                updatedTime: updatedTime1,
                            },
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                            updatedTime: updatedTime2,
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "UpdateCollections",
                            collectionsAction: {
                                type: "Delete",
                                key: collectionId,
                                deletedTime: updatedTime3,
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "UpdateCollections",
                            collectionsAction: {
                                type: "Set",
                                key: collectionId,
                                value: assertOrderKey("a2"),
                                updatedTime: updatedTime4,
                            },
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            collections: TaskCollectionSet.schema.deserialize([
                                [
                                    collectionId,
                                    {
                                        value: assertOrderKey("a2"),
                                        updatedTime: updatedTime4.toISOString(),
                                    },
                                ],
                            ]),
                            collectionPositions: new Map([
                                [
                                    collectionId,
                                    {orderTime: updatedTime1, orderKey: assertOrderKey("a42")},
                                ],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "move task before adding to collection",
        create: ({creator, createdTime, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime: createdTime.absoluteTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            createdTime,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: updatedTime2, orderKey: assertOrderKey("a42")},
                            updatedTime: updatedTime1,
                        },
                    },
                    {
                        type: "UpdateTask",
                        taskId,
                        taskAction: {
                            type: "UpdateCollections",
                            collectionsAction: {
                                type: "Set",
                                key: collectionId,
                                value: initialOrderKey,
                                updatedTime: updatedTime2,
                            },
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            collections: TaskCollectionSet.schema.deserialize([
                                [
                                    collectionId,
                                    {
                                        value: initialOrderKey,
                                        updatedTime: updatedTime2.toISOString(),
                                    },
                                ],
                            ]),
                            collectionPositions: new Map([
                                [
                                    collectionId,
                                    {orderTime: updatedTime2, orderKey: assertOrderKey("a42")},
                                ],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "update task collection name",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const updatedTime1 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            nameAction: {
                                value: "New Collection Name",
                                updatedTime: updatedTime1,
                            },
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            name: "New Collection Name",
                        },
                    },
                ],
            };
        },
    },
    {
        name: "update task collection name twice",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            nameAction: {
                                value: "New Collection Name 1",
                                updatedTime: updatedTime1,
                            },
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            nameAction: {
                                value: "New Collection Name 2",
                                updatedTime: updatedTime2,
                            },
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            name: "New Collection Name 2",
                        },
                    },
                ],
            };
        },
    },
    {
        name: "update task collection access policy",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const updatedTime1 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicyAction: {
                                value: {
                                    accountGrantById: new Map(),
                                    defaultGrant: {type: "Space", level: "View"},
                                },
                                updatedTime: updatedTime1,
                            },
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            accessPolicy: {
                                accountGrantById: new Map(),
                                defaultGrant: {type: "Space", level: "View"},
                            },
                        },
                    },
                ],
            };
        },
    },
    {
        name: "update task collection access policy twice",
        create: ({getNextTime}): TaskSpaceActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const updatedTime1 = getNextTime();
            const updatedTime2 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            createdTime,
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicyAction: {
                                value: {
                                    accountGrantById: new Map(),
                                    defaultGrant: {type: "Space", level: "View"},
                                },
                                updatedTime: updatedTime1,
                            },
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicyAction: {
                                value: {
                                    accountGrantById: new Map(),
                                    defaultGrant: {type: "Space", level: "Edit"},
                                },
                                updatedTime: updatedTime2,
                            },
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            accessPolicy: {
                                accountGrantById: new Map(),
                                defaultGrant: {type: "Space", level: "Edit"},
                            },
                        },
                    },
                ],
            };
        },
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
    partitionNumber = 1,
    partitionCount = 1,
    account1,
    account2,
    applyTaskSpaceAction,
    getTask,
    getTaskCollection,
}: {
    partitionNumber?: number;
    partitionCount?: number;
    account1: AccountModel;
    account2: AccountModel;
    applyTaskSpaceAction: (action: TaskSpaceAction, next: () => void) => MaybePromise<void>;
    getTask: (taskId: TaskId) => Promise<TaskTestInterface>;
    getTaskCollection: (collectionId: TaskCollectionId) => Promise<TaskCollectionTestInterface>;
}) {
    const tests: Array<{describeName: string; testName: string; runTest: () => Promise<void>}> = [];

    for (const testCase of taskSpaceActionTestCases) {
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
        const actionIndexesWithDuplicates = actionIndexes.map(index => [...actionIndexes, index]);

        function uniquePermutations(permutations: Array<Array<number>>): Array<Array<number>> {
            return Array.from(
                new Set(permutations.map(permutation => JSON.stringify(permutation))),
                permutationString => JSON.parse(permutationString),
            );
        }

        const permutationsWithDuplicates = uniquePermutations(
            actionIndexesWithDuplicates.flatMap(permutator),
        );

        const stableRandom = new StableRandom(describe.name);

        const permutations = [
            ...uniquePermutations(permutator(actionIndexes)),

            // Don't include more than 240 permutations with duplicate actions. We test in
            // every order (above) then randomly sample permutations with duplicates.
            //
            // 240 is the length of `permutationsWithDuplicates` when we have 4 actions.
            ...(permutationsWithDuplicates.length > 240
                ? stableShuffleArray(
                      stableRandom,
                      "permutationsWithDuplicates",
                      permutationsWithDuplicates,
                  ).slice(0, 240)
                : permutationsWithDuplicates),
        ];

        for (const permutation of permutations) {
            tests.push({
                describeName: testCase.name,
                testName: `[${permutation.join(", ")}]`,
                runTest: async () => {
                    const actions = permutation.map(
                        actionIndex => testCaseArtifacts.actions[actionIndex]!,
                    );

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

                    if (testCaseArtifacts.error) {
                        await expect(run).rejects.toThrow(testCaseArtifacts.error);
                    } else {
                        await run();

                        assert(testCaseArtifacts.expect.length > 0);

                        const taskExpectations = await runAllPromises(
                            testCaseArtifacts.expect.map(async expectation => {
                                if (expectation.taskId !== undefined) {
                                    const actualTask = await getTask(expectation.taskId);

                                    const createAction = iterableFirst(
                                        filterMapIterable(actions, action =>
                                            action.type === "UpdateTask" &&
                                            action.taskId === expectation.taskId &&
                                            action.taskAction.type === "Create"
                                                ? action.taskAction
                                                : null,
                                        ),
                                    );

                                    const expectedTask: TaskTestInterface = {
                                        isDeleted: false,
                                        parent: null,
                                        collections: TaskCollectionSet.empty,
                                        collectionPositions: new Map(
                                            (
                                                expectation.task.collections ??
                                                TaskCollectionSet.empty
                                            )
                                                .getArray()
                                                .map(({collectionId, updatedTime}) => [
                                                    collectionId,
                                                    {
                                                        orderTime: updatedTime,
                                                        orderKey: initialOrderKey,
                                                    },
                                                ]),
                                        ),
                                        notepadPagePositions: new Map(),
                                        status: {type: "Open"},
                                        assignee: null,
                                        assigneeStatus: {type: "Inactive"},
                                        title: emptyTaskTitle.get(),
                                        dueDate: null,
                                        priority: null,
                                        ...expectation.task,
                                        creator:
                                            expectation.task.creator ??
                                            assertExists(
                                                createAction?.creator,
                                                "Expected `Create` task action when `creator` is not provided",
                                            ),
                                        createdTime:
                                            expectation.task.createdTime ??
                                            assertExists(
                                                createAction?.createdTime,
                                                "Expected `Create` task action when `createdTime` is not provided",
                                            ),
                                    };

                                    return {
                                        actual: {
                                            ...actualTask,
                                            title: getTaskTitleProsemirrorNode(
                                                actualTask.title,
                                            ).toJSON(),
                                            collections: actualTask.collections.getArray(),
                                        },
                                        expected: {
                                            ...expectedTask,
                                            title: getTaskTitleProsemirrorNode(
                                                expectedTask.title,
                                            ).toJSON(),
                                            collections: actualTask.collections.getArray(),
                                        },
                                    };
                                } else {
                                    const actualCollection = await getTaskCollection(
                                        expectation.collectionId,
                                    );

                                    const createAction = iterableFirst(
                                        filterMapIterable(actions, action =>
                                            action.type === "UpdateTaskCollection" &&
                                            action.collectionId === expectation.collectionId &&
                                            action.collectionAction.type === "Create"
                                                ? action.collectionAction
                                                : null,
                                        ),
                                    );

                                    const expectedCollection: TaskCollectionTestInterface = {
                                        isDeleted: false,
                                        name: "",
                                        ...expectation.collection,
                                        createdTime:
                                            expectation.collection.createdTime ??
                                            assertExists(
                                                createAction?.createdTime,
                                                "Expected `Create` task collection action when `createdTime` is not provided",
                                            ),
                                        accessPolicy:
                                            expectation.collection.accessPolicy ??
                                            assertExists(
                                                createAction?.accessPolicy,
                                                "Expected `Create` task collection action when `accessPolicy` is not provided",
                                            ),
                                    };

                                    return {
                                        actual: actualCollection,
                                        expected: expectedCollection,
                                    };
                                }
                            }),
                        );

                        assert(taskExpectations.length > 0);

                        for (const {actual, expected} of taskExpectations) {
                            expect(actual).toEqual(expected);
                        }
                    }
                },
            });
        }
    }

    assert(Number.isInteger(partitionNumber));
    assert(Number.isInteger(partitionCount));
    assert(1 <= partitionNumber && partitionNumber <= partitionCount);

    const partitionTestCount = Math.floor(tests.length / partitionCount);
    const partitionStartTestIndex = partitionTestCount * (partitionNumber - 1);

    const partitionTests = tests.slice(
        partitionStartTestIndex,
        // The last partition gets all remaining tests.
        partitionNumber !== partitionCount
            ? partitionStartTestIndex + partitionTestCount
            : undefined,
    );

    const groupedPartitionTests: Array<{
        describeName: string;
        tests: Array<{testName: string; runTest: () => Promise<void>}>;
    }> = [];

    for (const partitionTest of partitionTests) {
        if (
            groupedPartitionTests.length === 0 ||
            groupedPartitionTests[groupedPartitionTests.length - 1]!.describeName !==
                partitionTest.describeName
        ) {
            groupedPartitionTests.push({describeName: partitionTest.describeName, tests: []});
        }

        groupedPartitionTests[groupedPartitionTests.length - 1]!.tests.push(partitionTest);
    }

    let nextPartitionTestNumber = 1;

    for (const groupedPartitionTest of groupedPartitionTests) {
        describe(`${groupedPartitionTest.describeName}`, () => {
            for (const partitionTest of groupedPartitionTest.tests) {
                async function runTestWithRetries() {
                    let attempt = 1;
                    while (true) {
                        try {
                            await partitionTest.runTest();
                            return;
                        } catch (error) {
                            // Attempt each test 3 times before throwing...
                            if (attempt >= 3) throw error;

                            attempt++;
                        }
                    }
                }

                function withLogging(
                    action: () => Promise<void>,
                    log: (result: Result<void>, durationMs: number) => void,
                ): () => Promise<void> {
                    return async () => {
                        const startTime = process.hrtime.bigint();
                        const result = await captureResultPromise(action);
                        const durationMs = Number((process.hrtime.bigint() - startTime) / 1000000n);

                        log(result, durationMs);

                        // Very important! Make sure to rethrow the error so our Jest test fails.
                        if (!result.ok) {
                            throw result.error;
                        }
                    };
                }

                test.concurrent(
                    `${partitionTest.testName}`,
                    withLogging(runTestWithRetries, (result, durationMs) => {
                        const statusMark = result.ok ? chalk.green("✔") : chalk.red("✘");

                        const partitionTestNumber = nextPartitionTestNumber++;
                        const progressString = `${partitionTestNumber
                            .toString()
                            .padStart(partitionTests.length.toString().length, " ")}/${
                            partitionTests.length
                        }`;

                        const durationString = `${durationMs} ms`;

                        const messageWithoutColor = `[${progressString}] ${groupedPartitionTest.describeName} \u203A ${partitionTest.testName} (${durationString})`;
                        const message = result.ok
                            ? chalk.dim(messageWithoutColor)
                            : chalk.red(messageWithoutColor);

                        // Given this test can take a while to execute, immediately log test results
                        // instead of waiting for Jest to print results at the end.
                        // eslint-disable-next-line no-console
                        console.log(`${statusMark} ${message}`);

                        if (!result.ok) {
                            // eslint-disable-next-line no-console
                            console.error(result.error);
                        }
                    }),
                );
            }
        });
    }
}
