import {CalendarDate} from "@internationalized/date";
import chalk from "chalk";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {stableShuffleArray} from "~/shared/helpers/array/stable_shuffle_array.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
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
import {serializeHybridLogicalTime} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
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
    addedChildTaskCount: number;
    removedChildTaskCount: number;
    addedClosedChildTaskCount: number;
    removedClosedChildTaskCount: number;
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
    getNextTime: () => HybridLogicalTime;
    getNextFilterableTime: () => TaskFilterableTime;
};

type TaskActionTestArtifacts =
    | {
          actions: Array<TaskAction & {time?: HybridLogicalTime}>;
          task: Partial<TaskTestInterface>;
          error?: undefined;
      }
    | {
          actions: Array<TaskAction & {time?: HybridLogicalTime}>;
          error: {new (...args: Array<any>): Error};
          task?: undefined;
      };

const taskActionTestCases: Array<{
    name: string;
    create: (scenario: TaskSpaceActionTestScenario) => TaskActionTestArtifacts;
}> = [
    {
        name: "create task",
        create: ({creator}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
                },
            ],
            task: {},
        }),
    },
    {
        name: "create task incompatible accounts",
        create: ({creator, account2}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "Create",
                    creator: account2,
                    creatorTimeZone: defaultTimeZone,
                },
            ],
            error: FailedPreconditionError,
        }),
    },
    {
        name: "create task incompatible setter created time zone",
        create: ({creator}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: assertTimeZone("America/Denver"),
                },
            ],
            error: FailedPreconditionError,
        }),
    },
    {
        name: "add and remove collection",
        create: ({creator, collectionId1, collectionId2}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "AddCollection",
                    time: [new Date("2023-07-13T15:21:45.430Z").getTime(), 0],
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
                {
                    type: "AddCollection",
                    time: [new Date("2023-07-13T15:22:45.430Z").getTime(), 0],
                    collectionId: collectionId2,
                    orderKey: assertOrderKey("a1"),
                },
                {
                    type: "RemoveCollection",
                    time: [new Date("2023-07-13T15:23:45.430Z").getTime(), 0],
                    collectionId: collectionId1,
                },
            ],
            task: {
                collections: TaskCollectionSet.schema.deserialize([
                    [
                        collectionId1,
                        {
                            value: null,
                            version: String(
                                serializeHybridLogicalTime([
                                    new Date("2023-07-13T15:23:45.430Z").getTime(),
                                    0,
                                ]),
                            ),
                        },
                    ],
                    [
                        collectionId2,
                        {
                            value: "a1",
                            version: String(
                                serializeHybridLogicalTime([
                                    new Date("2023-07-13T15:22:45.430Z").getTime(),
                                    0,
                                ]),
                            ),
                        },
                    ],
                ]),
            },
        }),
    },
    {
        name: "add, remove, and add collection",
        create: ({creator, collectionId1}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "AddCollection",
                    time: [new Date("2023-07-13T15:21:45.430Z").getTime(), 0],
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
                {
                    type: "RemoveCollection",
                    time: [new Date("2023-07-13T15:22:45.430Z").getTime(), 0],
                    collectionId: collectionId1,
                },
                {
                    type: "AddCollection",
                    time: [new Date("2023-07-13T15:23:45.430Z").getTime(), 0],
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
            ],
            task: {
                collections: TaskCollectionSet.schema.deserialize([
                    [
                        collectionId1,
                        {
                            value: "a0",
                            version: String(
                                serializeHybridLogicalTime([
                                    new Date("2023-07-13T15:23:45.430Z").getTime(),
                                    0,
                                ]),
                            ),
                        },
                    ],
                ]),
            },
        }),
    },
    {
        name: "collection updated time conflict, remove wins",
        create: ({creator, collectionId1}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "AddCollection",
                    time: [new Date("2023-07-13T15:21:45.430Z").getTime(), 0],
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
                {
                    type: "RemoveCollection",
                    time: [new Date("2023-07-13T15:21:45.430Z").getTime(), 0],
                    collectionId: collectionId1,
                },
            ],
            task: {
                collections: TaskCollectionSet.schema.deserialize([
                    [
                        collectionId1,
                        {
                            value: null,
                            version: String(
                                serializeHybridLogicalTime([
                                    new Date("2023-07-13T15:21:45.430Z").getTime(),
                                    0,
                                ]),
                            ),
                        },
                    ],
                ]),
            },
        }),
    },
    {
        name: "collection updated time conflict, higher order key wins",
        create: ({creator, collectionId1}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "AddCollection",
                    time: [new Date("2023-07-13T15:21:45.430Z").getTime(), 0],
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
                {
                    type: "AddCollection",
                    time: [new Date("2023-07-13T15:21:45.430Z").getTime(), 0],
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a1"),
                },
            ],
            task: {
                collections: TaskCollectionSet.schema.deserialize([
                    [
                        collectionId1,
                        {
                            value: "a1",
                            version: String(
                                serializeHybridLogicalTime([
                                    new Date("2023-07-13T15:21:45.430Z").getTime(),
                                    0,
                                ]),
                            ),
                        },
                    ],
                ]),
            },
        }),
    },
    {
        name: "delete",
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "Delete",
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
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "Delete",
                    },
                    {
                        type: "Undelete",
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
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateTitle",
                        titleUpdate: taskTitleTestScenario.update0,
                    },
                    {
                        type: "Delete",
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
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "Delete",
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
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "Delete",
                    },
                    {
                        type: "Undelete",
                    },
                    {
                        type: "Delete",
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
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "Undelete",
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
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "Delete",
                        time: deletedTime,
                    },
                    {
                        type: "Undelete",
                        time: deletedTime,
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
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "Undelete",
                    },
                    {
                        type: "Delete",
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
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateParentTaskId",
                        time: time2,
                        parentTaskId,
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId,
                        position: {orderTime: time2, orderKey: initialOrderKey},
                    },
                },
            };
        },
    },
    {
        name: "update parent then unset parent",
        create: ({creator}): TaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();

            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskId,
                    },
                    {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
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
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateParentTaskId",
                        time: time2,
                        parentTaskId: null,
                    },
                    {
                        type: "UpdateParentTaskId",
                        time: time3,
                        parentTaskId,
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId,
                        position: {orderTime: time3, orderKey: initialOrderKey},
                    },
                },
            };
        },
    },
    {
        name: "update parent then update parent position",
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateParentTaskId",
                        time: time2,
                        parentTaskId,
                    },
                    {
                        type: "UpdateParentPosition",
                        time: time3,
                        parentPosition: {orderTime: time2, orderKey: assertOrderKey("a42")},
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId,
                        position: {orderTime: time2, orderKey: assertOrderKey("a42")},
                    },
                },
            };
        },
    },
    {
        name: "update parent position then update parent",
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateParentPosition",
                        time: time2,
                        parentPosition: {orderTime: time2, orderKey: assertOrderKey("a42")},
                    },
                    {
                        type: "UpdateParentTaskId",
                        time: time3,
                        parentTaskId,
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId,
                        position: {orderTime: time3, orderKey: initialOrderKey},
                    },
                },
            };
        },
    },
    {
        name: "update parent resets position",
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const parentTaskId1 = generateId<TaskId>();
            const parentTaskId2 = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateParentTaskId",
                        time: time2,
                        parentTaskId: parentTaskId1,
                    },
                    {
                        type: "UpdateParentPosition",
                        time: time3,
                        parentPosition: {orderTime: time2, orderKey: assertOrderKey("a42")},
                    },
                    {
                        type: "UpdateParentTaskId",
                        time: time4,
                        parentTaskId: parentTaskId2,
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId2,
                        position: {orderTime: time4, orderKey: initialOrderKey},
                    },
                },
            };
        },
    },
    {
        name: "update status",
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateStatus",
                        time: time2,
                        status: {
                            type: "Closed",
                            closedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                            closer: account2,
                        },
                    },
                ],
                task: {
                    status: {
                        type: "Closed",
                        closedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time2[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                        closer: account2,
                    },
                },
            };
        },
    },
    {
        name: "update status twice",
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateStatus",
                        time: time2,
                        status: {
                            type: "Closed",
                            closedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                            closer: account2,
                        },
                    },
                    {
                        type: "UpdateStatus",
                        time: time3,
                        status: {type: "Open"},
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
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assignee: account2,
                            assigner: creator,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time2[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                },
            };
        },
    },
    {
        name: "update assignee twice",
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assignee: account2,
                            assigner: creator,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssignee",
                        time: time3,
                        assignee: null,
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
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assignee: account2,
                            assigner: creator,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            position: {
                                orderTime: time3,
                                orderKey: initialOrderKey,
                            },
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time3[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time2[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {
                        type: "Active",
                        position: {
                            orderTime: time3,
                            orderKey: initialOrderKey,
                        },
                        activatedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time3[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                },
            };
        },
    },
    {
        name: "update assignee status twice",
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assignee: account2,
                            assigner: creator,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            position: {
                                orderTime: time3,
                                orderKey: initialOrderKey,
                            },
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time3[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time4,
                        assigneeStatus: {type: "Inactive"},
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time2[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "updating status resets assignee status",
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assignee: account2,
                            assigner: creator,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            position: {
                                orderTime: time3,
                                orderKey: initialOrderKey,
                            },
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time3[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateStatus",
                        time: time4,
                        status: {
                            type: "Closed",
                            closedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time4[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                            closer: account2,
                        },
                    },
                ],
                task: {
                    status: {
                        type: "Closed",
                        closedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time4[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                        closer: account2,
                    },
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time2[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "updating status resets assignee status even if status doesn't change",
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assignee: account2,
                            assigner: creator,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            position: {
                                orderTime: time3,
                                orderKey: initialOrderKey,
                            },
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time3[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateStatus",
                        time: time4,
                        status: {type: "Open"},
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time2[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "updating assignee resets assignee status",
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assignee: account2,
                            assigner: creator,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            position: {
                                orderTime: time3,
                                orderKey: initialOrderKey,
                            },
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time3[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssignee",
                        time: time4,
                        assignee: {
                            assignee: creator,
                            assigner: account2,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time4[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: creator,
                        assigner: account2,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time4[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "updating assignee resets assignee status even if assignee doesn't change",
        create: ({creator, account2, getNextTime}): TaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assignee: account2,
                            assigner: creator,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time2[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            position: {
                                orderTime: time3,
                                orderKey: initialOrderKey,
                            },
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time3[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssignee",
                        time: time4,
                        assignee: {
                            assignee: account2,
                            assigner: creator,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: new Date(time4[0]),
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: new Date(time4[0]),
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                },
            };
        },
    },
    {
        name: "update due date",
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateDueDate",
                        dueDate: new CalendarDate(2023, 7, 12),
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
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateDueDate",
                        dueDate: new CalendarDate(2023, 7, 12),
                    },
                    {
                        type: "UpdateDueDate",
                        dueDate: null,
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
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdatePriority",
                        priority: "High",
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
        create: ({creator}): TaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creator,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdatePriority",
                        priority: "High",
                    },
                    {
                        type: "UpdatePriority",
                        priority: null,
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
        create: ({creator}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
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
        create: ({creator}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
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
        create: ({creator}): TaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creator,
                    creatorTimeZone: defaultTimeZone,
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
                    time: action.time ?? scenario.getNextTime(),
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
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time1,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time3,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: time3, orderKey: initialOrderKey},
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
                                    {orderTime: time3, orderKey: initialOrderKey},
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
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time1,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time3,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: time3, orderKey: initialOrderKey},
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time4,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "RemoveTask",
                            taskId,
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
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time1,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time3,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "RemoveTask",
                            taskId,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time4,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: time4, orderKey: initialOrderKey},
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
                                    {orderTime: time4, orderKey: initialOrderKey},
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
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        time: getNextTime(),
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        time: getNextTime(),
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "RemoveTask",
                            taskId,
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
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const notepadPageId = generateTaskNotepadPageId();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time1,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "Create",
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time3,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: time3, orderKey: initialOrderKey},
                        },
                    },
                    {
                        type: "UpdateTaskNotepadPage",
                        time: time4,
                        accountId: creator.accountId,
                        notepadPageId,
                        notepadPageAction: {
                            type: "AddTask",
                            taskId,
                            position: {orderTime: time3, orderKey: assertOrderKey("a42")},
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
                                    {orderTime: time3, orderKey: assertOrderKey("a42")},
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            name: "New Collection Name",
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            name: "New Collection Name",
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
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
                        time: createdTime,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: deletedTime,
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: deletedTime,
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
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
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time3,
                        taskId,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collectionId,
                            orderKey: initialOrderKey,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: time4,
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: time3, orderKey: assertOrderKey("a42")},
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
                                        version: String(serializeHybridLogicalTime(time3)),
                                    },
                                ],
                            ]),
                            collectionPositions: new Map([
                                [collectionId, {orderTime: time3, orderKey: assertOrderKey("a42")}],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "move task in collection twice",
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time3,
                        taskId,
                        taskAction: {
                            type: "AddCollection",
                            collectionId: collectionId,
                            orderKey: initialOrderKey,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: time4,
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: time3, orderKey: assertOrderKey("a42")},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: time4,
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: time3, orderKey: assertOrderKey("a43")},
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
                                        version: String(serializeHybridLogicalTime(time3)),
                                    },
                                ],
                            ]),
                            collectionPositions: new Map([
                                [collectionId, {orderTime: time3, orderKey: assertOrderKey("a43")}],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "move then remove task in collection",
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();
            const time5 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time3,
                        taskId,
                        taskAction: {
                            type: "AddCollection",
                            collectionId,
                            orderKey: initialOrderKey,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: time4,
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: time3, orderKey: assertOrderKey("a42")},
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time5,
                        taskId,
                        taskAction: {
                            type: "RemoveCollection",
                            collectionId,
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
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();
            const time5 = getNextTime();
            const time6 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time3,
                        taskId,
                        taskAction: {
                            type: "AddCollection",
                            collectionId,
                            orderKey: initialOrderKey,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: time4,
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: time4, orderKey: assertOrderKey("a42")},
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time5,
                        taskId,
                        taskAction: {
                            type: "RemoveCollection",
                            collectionId: collectionId,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time6,
                        taskId,
                        taskAction: {
                            type: "AddCollection",
                            collectionId,
                            orderKey: assertOrderKey("a2"),
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
                                        version: String(serializeHybridLogicalTime(time6)),
                                    },
                                ],
                            ]),
                            collectionPositions: new Map([
                                [collectionId, {orderTime: time4, orderKey: assertOrderKey("a42")}],
                            ]),
                        },
                    },
                ],
            };
        },
    },
    {
        name: "move task before adding to collection",
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: time3,
                        collectionId,
                        collectionAction: {
                            type: "UpdateTaskPosition",
                            taskId,
                            position: {orderTime: time3, orderKey: assertOrderKey("a42")},
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time4,
                        taskId,
                        taskAction: {
                            type: "AddCollection",
                            collectionId,
                            orderKey: initialOrderKey,
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
                                        version: String(serializeHybridLogicalTime(time4)),
                                    },
                                ],
                            ]),
                            collectionPositions: new Map([
                                [collectionId, {orderTime: time3, orderKey: assertOrderKey("a42")}],
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            name: "New Collection Name",
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            name: "New Collection Name 1",
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            name: "New Collection Name 2",
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicy: {
                                accountGrantById: new Map(),
                                defaultGrant: {type: "Space", level: "View"},
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

            return {
                actions: [
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            accessPolicy: {accountGrantById: new Map(), defaultGrant: null},
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicy: {
                                accountGrantById: new Map(),
                                defaultGrant: {type: "Space", level: "View"},
                            },
                        },
                    },
                    {
                        type: "UpdateTaskCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicy: {
                                accountGrantById: new Map(),
                                defaultGrant: {type: "Space", level: "Edit"},
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
    {
        name: "updating task children counts",
        create: ({creator, getNextTime}): TaskSpaceActionTestArtifacts => {
            const taskId = generateId<TaskId>();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId,
                        taskAction: {
                            type: "Create",
                            creator,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId,
                        taskAction: {
                            type: "UpdateChildrenCounts",
                            addedChildTaskCount: 1,
                            removedChildTaskCount: 0,
                            addedClosedChildTaskCount: 0,
                            removedClosedChildTaskCount: 0,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId,
                        taskAction: {
                            type: "UpdateChildrenCounts",
                            addedChildTaskCount: 1,
                            removedChildTaskCount: 0,
                            addedClosedChildTaskCount: 1,
                            removedClosedChildTaskCount: 1,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId,
                        taskAction: {
                            type: "UpdateChildrenCounts",
                            addedChildTaskCount: 0,
                            removedChildTaskCount: 1,
                            addedClosedChildTaskCount: 2,
                            removedClosedChildTaskCount: 0,
                        },
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            addedChildTaskCount: 1,
                            removedChildTaskCount: 1,
                            addedClosedChildTaskCount: 2,
                            removedClosedChildTaskCount: 1,
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
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);

        // Make sure this function returns a monotonically increasing date to
        // avoid flaky errors.
        function getNextTime() {
            return clock.now();
        }

        function getNextFilterableTime() {
            return new TaskFilterableTime({
                absoluteTime: new Date(getNextTime()[0]),
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
                                                ? {time: action.time, taskAction: action.taskAction}
                                                : null,
                                        ),
                                    );

                                    const expectedTask: TaskTestInterface = {
                                        isDeleted: false,
                                        parent: null,
                                        addedChildTaskCount: 0,
                                        removedChildTaskCount: 0,
                                        addedClosedChildTaskCount: 0,
                                        removedClosedChildTaskCount: 0,
                                        collections: TaskCollectionSet.empty,
                                        collectionPositions: new Map(
                                            (
                                                expectation.task.collections ??
                                                TaskCollectionSet.empty
                                            )
                                                .getArray()
                                                .map(({collectionId, version}) => [
                                                    collectionId,
                                                    {
                                                        orderTime: version,
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
                                                createAction?.taskAction.creator,
                                                "Expected `Create` task action when `creator` is not provided",
                                            ),
                                        createdTime:
                                            expectation.task.createdTime ??
                                            new TaskFilterableTime({
                                                absoluteTime: new Date(
                                                    assertExists(
                                                        createAction?.time,
                                                        "Expected `Create` task action when `createdTime` is not provided",
                                                    )[0],
                                                ),
                                                setterTimeZone: assertExists(
                                                    createAction?.taskAction.creatorTimeZone,
                                                    "Expected `Create` task action when `createdTime` is not provided",
                                                ),
                                            }),
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
                                                ? {
                                                      time: action.time,
                                                      collectionAction: action.collectionAction,
                                                  }
                                                : null,
                                        ),
                                    );

                                    const expectedCollection: TaskCollectionTestInterface = {
                                        isDeleted: false,
                                        name: "",
                                        ...expectation.collection,
                                        createdTime:
                                            expectation.collection.createdTime ??
                                            new Date(
                                                assertExists(
                                                    createAction?.time,
                                                    "Expected `Create` task collection action when `createdTime` is not provided",
                                                )[0],
                                            ),
                                        accessPolicy:
                                            expectation.collection.accessPolicy ??
                                            assertExists(
                                                createAction?.collectionAction.accessPolicy,
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
                            console.error((result.error as Error).stack);
                        }
                    }),
                );
            }
        });
    }
}
