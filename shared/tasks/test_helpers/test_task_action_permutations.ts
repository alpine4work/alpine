import {CalendarDate} from "@internationalized/date";
import chalk from "chalk";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {InternalError, getErrorCode} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
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
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {serializeHybridLogicalTime} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskAssigneeWithSortableAccount} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatus} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskLayout} from "~/shared/tasks/task_layout.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusWithSortableAccount} from "~/shared/tasks/task_status.js";
import {wordTaskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_scenarios.js";
import {
    TaskTitle,
    emptyTaskTitle,
    getTaskTitleProsemirrorNode,
} from "~/shared/tasks/title/task_title.js";

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
    status: TaskStatusWithSortableAccount;
    assignee: TaskAssigneeWithSortableAccount | null;
    assigneeStatus: TaskAssigneeStatus;
    assigneePosition: TaskPosition | null;
    title: TaskTitle;
    dueDate: CalendarDate | null;
    priority: TaskPriority | null;
    layout: TaskLayout | null;
};

export type TaskCollectionTestInterface = {
    createdTime: HybridLogicalTime;
    isDeleted: boolean;
    name: string;
    color: ThemeColor | null;
    accessPolicy: AccessPolicy;
};

type TaskActionTestScenario = {
    creator: TaskSortableAccount;
    createdTime: TaskFilterableTime;
    account2: TaskSortableAccount;
    collectionId1: TaskCollectionId;
    collectionId2: TaskCollectionId;
    getNextTime: () => HybridLogicalTime;
    getNextFilterableTime: () => TaskFilterableTime;
};

type TaskTaskActionTestArtifacts =
    | {
          actions: Array<TaskTaskAction & {time?: HybridLogicalTime}>;
          task: Partial<TaskTestInterface>;
          error?: undefined;
      }
    | {
          actions: Array<TaskTaskAction & {time?: HybridLogicalTime}>;
          error: ErrorCode;
          task?: undefined;
      };

let nextAccountNameVersion = 1;

const taskTaskActionTestCases: Array<{
    only?: CommitBlocker;
    name: string;
    create: (scenario: TaskActionTestScenario) => TaskTaskActionTestArtifacts;
}> = [
    {
        name: "create task",
        create: ({creator}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
            ],
            task: {},
        }),
    },
    {
        name: "create task incompatible accounts",
        create: ({creator, account2}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "Create",
                    creatorId: account2.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
            ],
            error: ErrorCode.FailedPrecondition,
        }),
    },
    {
        name: "create task incompatible setter created time zone",
        create: ({creator}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "Create",
                    creatorId: creator.accountId,
                    creatorTimeZone: assertTimeZone("America/Denver"),
                },
            ],
            error: ErrorCode.FailedPrecondition,
        }),
    },
    {
        name: "add and remove collection",
        create: ({creator, collectionId1, collectionId2}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
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
        create: ({creator, collectionId1}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
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
        create: ({creator, collectionId1}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
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
        create: ({creator, collectionId1}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
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
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                    {
                        type: "Delete",
                    },
                ],
                task: {
                    isDeleted: true,
                    title: wordTaskTitleTestScenario.title1,
                },
            };
        },
    },
    {
        name: "update title after delete",
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "Delete",
                    },
                    {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                ],
                task: {
                    isDeleted: true,
                    title: wordTaskTitleTestScenario.title1,
                },
            };
        },
    },
    {
        name: "delete, undelete, delete",
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        create: ({creator, getNextTime}): TaskTaskActionTestArtifacts => {
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        create: ({creator, getNextTime}): TaskTaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
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
        create: ({creator}): TaskTaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();

            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        name: "update parent and parent position at the same time",
        create: ({creator, getNextTime}): TaskTaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateParentTaskId",
                        time: time2,
                        parentTaskId,
                        parentPosition: {orderTime: time1, orderKey: assertOrderKey("aZZZ")},
                    },
                ],
                task: {
                    parent: {
                        taskId: parentTaskId,
                        position: {orderTime: time1, orderKey: assertOrderKey("aZZZ")},
                    },
                },
            };
        },
    },
    {
        name: "unset parent then update parent",
        create: ({creator, getNextTime}): TaskTaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
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
        create: ({creator, getNextTime}): TaskTaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
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
        create: ({creator, getNextTime}): TaskTaskActionTestArtifacts => {
            const parentTaskId = generateId<TaskId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
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
        create: ({creator, getNextTime}): TaskTaskActionTestArtifacts => {
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
                        creatorId: creator.accountId,
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
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateStatus",
                        time: time2,
                        status: {
                            type: "Closed",
                            closedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                            closerId: account2.accountId,
                        },
                    },
                ],
                task: {
                    status: {
                        type: "Closed",
                        closedTime: new TaskFilterableTime({
                            absoluteTime: time2,
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
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateStatus",
                        time: time2,
                        status: {
                            type: "Closed",
                            closedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                            closerId: account2.accountId,
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
        name: "update status and assignee status at the same time",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateStatus",
                        time: time3,
                        status: {
                            type: "Closed",
                            closedTime: new TaskFilterableTime({
                                absoluteTime: time3,
                                setterTimeZone: defaultTimeZone,
                            }),
                            closerId: account2.accountId,
                        },
                    },
                    {
                        type: "UpdateStatus",
                        time: time4,
                        status: {type: "Open"},
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time4,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                ],
                task: {
                    status: {type: "Open"},
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: new TaskFilterableTime({
                            absoluteTime: time4,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "update assignee",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
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
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "update assignee twice",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
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
        name: "update assignee and assignee status at the same time",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time2,
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
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: new TaskFilterableTime({
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "update assignee status",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
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
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: new TaskFilterableTime({
                            absoluteTime: time3,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "update assignee status twice",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
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
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                    assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "updating status resets assignee status",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
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
                                absoluteTime: time4,
                                setterTimeZone: defaultTimeZone,
                            }),
                            closerId: account2.accountId,
                        },
                    },
                ],
                task: {
                    status: {
                        type: "Closed",
                        closedTime: new TaskFilterableTime({
                            absoluteTime: time4,
                            setterTimeZone: defaultTimeZone,
                        }),
                        closer: account2,
                    },
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                    assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "updating status resets assignee status even if status doesn\u2019t change",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
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
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                    assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "updating assignee resets assignee status",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssignee",
                        time: time4,
                        assignee: {
                            assigneeId: creator.accountId,
                            assignerId: account2.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time4,
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
                            absoluteTime: time4,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                    assigneePosition: {orderTime: time4, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "updating assignee resets assignee status even if assignee doesn\u2019t change",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssignee",
                        time: time4,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time4,
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
                            absoluteTime: time4,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                    assigneePosition: {orderTime: time4, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "update assignee position",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneePosition",
                        time: time4,
                        accountId: account2.accountId,
                        position: {orderTime: time3, orderKey: assertOrderKey("a2")},
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: new TaskFilterableTime({
                            absoluteTime: time3,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneePosition: {orderTime: time3, orderKey: assertOrderKey("a2")},
                },
            };
        },
    },
    {
        name: "update assignee position with the wrong account",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneePosition",
                        time: time4,
                        accountId: creator.accountId,
                        position: {orderTime: time3, orderKey: assertOrderKey("a2")},
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: new TaskFilterableTime({
                            absoluteTime: time3,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "updating status doesn\u2019t reset assignee position",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();
            const time5 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneePosition",
                        time: time4,
                        accountId: account2.accountId,
                        position: {orderTime: time3, orderKey: assertOrderKey("a2")},
                    },
                    {
                        type: "UpdateStatus",
                        time: time5,
                        status: {
                            type: "Closed",
                            closerId: creator.accountId,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: time5,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                ],
                task: {
                    status: {
                        type: "Closed",
                        closedTime: new TaskFilterableTime({
                            absoluteTime: time5,
                            setterTimeZone: defaultTimeZone,
                        }),
                        closer: creator,
                    },
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                    assigneePosition: {orderTime: time3, orderKey: assertOrderKey("a2")},
                },
            };
        },
    },
    {
        name: "updating assignee resets assignee position",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();
            const time5 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneePosition",
                        time: time4,
                        accountId: account2.accountId,
                        position: {orderTime: time3, orderKey: assertOrderKey("a2")},
                    },
                    {
                        type: "UpdateAssignee",
                        time: time5,
                        assignee: {
                            assigneeId: creator.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                ],
                task: {
                    assignee: {
                        assignee: creator,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                    assigneePosition: {orderTime: time5, orderKey: initialOrderKey},
                },
            };
        },
    },
    {
        name: "updating assignee status doesn\u2019t resets assignee position",
        create: ({creator, account2, getNextTime}): TaskTaskActionTestArtifacts => {
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();
            const time5 = getNextTime();

            return {
                actions: [
                    {
                        type: "Create",
                        time: time1,
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateAssignee",
                        time: time2,
                        assignee: {
                            assigneeId: account2.accountId,
                            assignerId: creator.accountId,
                            assignedTime: new TaskFilterableTime({
                                absoluteTime: time2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time3,
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: new TaskFilterableTime({
                                absoluteTime: time3,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                    {
                        type: "UpdateAssigneePosition",
                        time: time4,
                        accountId: account2.accountId,
                        position: {orderTime: time3, orderKey: assertOrderKey("a2")},
                    },
                    {
                        type: "UpdateAssigneeStatus",
                        time: time5,
                        assigneeStatus: {type: "Inactive"},
                    },
                ],
                task: {
                    assignee: {
                        assignee: account2,
                        assigner: creator,
                        assignedTime: new TaskFilterableTime({
                            absoluteTime: time2,
                            setterTimeZone: defaultTimeZone,
                        }),
                    },
                    assigneeStatus: {type: "Inactive"},
                    assigneePosition: {orderTime: time3, orderKey: assertOrderKey("a2")},
                },
            };
        },
    },
    {
        name: "update due date",
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
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
        name: "update layout",
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateLayout",
                        layout: "Project",
                    },
                ],
                task: {
                    layout: "Project",
                },
            };
        },
    },
    {
        name: "update layout twice",
        create: ({creator}): TaskTaskActionTestArtifacts => {
            return {
                actions: [
                    {
                        type: "Create",
                        creatorId: creator.accountId,
                        creatorTimeZone: defaultTimeZone,
                    },
                    {
                        type: "UpdateLayout",
                        layout: "Project",
                    },
                    {
                        type: "UpdateLayout",
                        layout: null,
                    },
                ],
                task: {
                    layout: null,
                },
            };
        },
    },
    {
        name: "update task title (1x)",
        create: ({creator}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            ],
            task: {
                title: wordTaskTitleTestScenario.title1,
            },
        }),
    },
    {
        name: "update task title (2x)",
        create: ({creator}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
                {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update1,
                },
            ],
            task: {
                title: wordTaskTitleTestScenario.title2,
            },
        }),
    },
    {
        name: "update task title (4x)",
        create: ({creator}): TaskTaskActionTestArtifacts => ({
            actions: [
                {
                    type: "Create",
                    creatorId: creator.accountId,
                    creatorTimeZone: defaultTimeZone,
                },
                {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
                {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update1,
                },
                {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update2,
                },
                {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update3,
                },
            ],
            task: {
                title: wordTaskTitleTestScenario.title4,
            },
        }),
    },
];

type TaskActionTestArtifactsExpect =
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

type TaskActionTestArtifacts =
    | {
          actions: Array<TaskAction>;
          // Must not be empty.
          expect: [TaskActionTestArtifactsExpect, ...Array<TaskActionTestArtifactsExpect>];
          error?: undefined;
      }
    | {
          actions: Array<TaskAction>;
          error: ErrorCode;
          task?: undefined;
      };

const taskActionTestCases: Array<{
    only?: CommitBlocker;
    name: string;
    create: (scenario: TaskActionTestScenario) => TaskActionTestArtifacts;
}> = [
    ...taskTaskActionTestCases.map(testCase => {
        return {
            only: testCase.only,
            name: testCase.name,
            create: (scenario: TaskActionTestScenario): TaskActionTestArtifacts => {
                const testCaseArtifacts = testCase.create(scenario);
                const taskId = generateId<TaskId>();

                const actions: Array<TaskAction> = testCaseArtifacts.actions.map(action => ({
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
        name: "delete collection",
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            name: "New Collection Name",
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();
            const createdTime = getNextTime();
            const deletedTime = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: createdTime,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: deletedTime,
                        collectionId,
                        collectionAction: {
                            type: "Delete",
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Undelete",
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
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
                        type: "UpdateTask",
                        time: time4,
                        taskId,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId,
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
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
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
                        type: "UpdateTask",
                        time: time4,
                        taskId,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId,
                            position: {orderTime: time3, orderKey: assertOrderKey("a42")},
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time4,
                        taskId,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId,
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
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
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
                        type: "UpdateCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
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
                        type: "UpdateTask",
                        time: time4,
                        taskId,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId,
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
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
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
                        type: "UpdateCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
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
                        type: "UpdateTask",
                        time: time4,
                        taskId,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId,
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
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const collectionId = generateId<TaskCollectionId>();
            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();
            const time4 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: time1,
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time3,
                        taskId,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId,
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
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateName",
                            name: "New Collection Name 1",
                        },
                    },
                    {
                        type: "UpdateCollection",
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
        name: "update task collection color",
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateColor",
                            color: "purple",
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            color: "purple",
                        },
                    },
                ],
            };
        },
    },
    {
        name: "update task collection color twice",
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateColor",
                            color: "purple",
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateColor",
                            color: "orange",
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            color: "orange",
                        },
                    },
                ],
            };
        },
    },
    {
        name: "update task collection access policy",
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: {level: "View"},
                                urlGrant: null,
                            },
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: {level: "View"},
                                urlGrant: null,
                            },
                        },
                    },
                ],
            };
        },
    },
    {
        name: "update task collection access policy twice",
        create: ({getNextTime}): TaskActionTestArtifacts => {
            const collectionId = generateId<TaskCollectionId>();

            return {
                actions: [
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "Create",
                            creatorId: null,
                            name: "Test",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: null,
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: {level: "View"},
                                urlGrant: null,
                            },
                        },
                    },
                    {
                        type: "UpdateCollection",
                        time: getNextTime(),
                        collectionId,
                        collectionAction: {
                            type: "UpdateAccessPolicy",
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: {level: "Edit"},
                                urlGrant: null,
                            },
                        },
                    },
                ],
                expect: [
                    {
                        collectionId,
                        collection: {
                            accessPolicy: {
                                type: "Local",
                                accountGrantById: new Map(),
                                defaultGrant: {level: "Edit"},
                                urlGrant: null,
                            },
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating task children counts",
        create: ({creator, getNextTime}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
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
    {
        name: "updating creator account name",
        create: ({getNextTime, creator}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;
            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: getNextTime(),
                        accountId: creator.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            creator: {
                                accountId: creator.accountId,
                                workingAccountName: accountName,
                                workingAccountNameVersion: accountNameVersion,
                            },
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating creator account name twice",
        create: ({getNextTime, creator}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const accountName1 = generateId();
            const accountNameVersion1 = nextAccountNameVersion++;
            const accountName2 = generateId();
            const accountNameVersion2 = nextAccountNameVersion++;
            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: getNextTime(),
                        accountId: creator.accountId,
                        accountName: accountName1,
                        accountNameVersion: accountNameVersion1,
                    },
                    {
                        type: "UpdateAccountName",
                        time: getNextTime(),
                        accountId: creator.accountId,
                        accountName: accountName2,
                        accountNameVersion: accountNameVersion2,
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            creator: {
                                accountId: creator.accountId,
                                workingAccountName: accountName2,
                                workingAccountNameVersion: accountNameVersion2,
                            },
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating multiple creator account names",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId1 = generateId<TaskId>();
            const taskId2 = generateId<TaskId>();
            const taskId3 = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;
            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId: taskId1,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId: taskId2,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: getNextTime(),
                        taskId: taskId3,
                        taskAction: {
                            type: "Create",
                            creatorId: account2.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: getNextTime(),
                        accountId: creator.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId: taskId1,
                        task: {
                            creator: {
                                accountId: creator.accountId,
                                workingAccountName: accountName,
                                workingAccountNameVersion: accountNameVersion,
                            },
                        },
                    },
                    {
                        taskId: taskId2,
                        task: {
                            creator: {
                                accountId: creator.accountId,
                                workingAccountName: accountName,
                                workingAccountNameVersion: accountNameVersion,
                            },
                        },
                    },
                    {
                        taskId: taskId3,
                        task: {
                            creator: account2,
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating closer account name",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "UpdateStatus",
                            status: {
                                type: "Closed",
                                closerId: account2.accountId,
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: account2.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            status: {
                                type: "Closed",
                                closer: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating closer account name and creator account name",
        create: ({getNextTime, creator}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "UpdateStatus",
                            status: {
                                type: "Closed",
                                closerId: creator.accountId,
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: creator.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            creator: {
                                accountId: creator.accountId,
                                workingAccountName: accountName,
                                workingAccountNameVersion: accountNameVersion,
                            },
                            status: {
                                type: "Closed",
                                closer: {
                                    accountId: creator.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating two closer account names",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId1 = generateId<TaskId>();
            const taskId2 = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId1,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId1,
                        taskAction: {
                            type: "UpdateStatus",
                            status: {
                                type: "Closed",
                                closerId: account2.accountId,
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId2,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId2,
                        taskAction: {
                            type: "UpdateStatus",
                            status: {
                                type: "Closed",
                                closerId: account2.accountId,
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: account2.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId: taskId1,
                        task: {
                            status: {
                                type: "Closed",
                                closer: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        taskId: taskId2,
                        task: {
                            status: {
                                type: "Closed",
                                closer: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating closer account name but not other closer",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId1 = generateId<TaskId>();
            const taskId2 = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId1,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId1,
                        taskAction: {
                            type: "UpdateStatus",
                            status: {
                                type: "Closed",
                                closerId: account2.accountId,
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId2,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId2,
                        taskAction: {
                            type: "UpdateStatus",
                            status: {
                                type: "Closed",
                                closerId: creator.accountId,
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: account2.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId: taskId1,
                        task: {
                            status: {
                                type: "Closed",
                                closer: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        taskId: taskId2,
                        task: {
                            status: {
                                type: "Closed",
                                closer: creator,
                                closedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating assignee account name",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: account2.accountId,
                                assignerId: creator.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: account2.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            assignee: {
                                assignee: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assigner: creator,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating assignee account name and creator account name",
        create: ({getNextTime, creator}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: creator.accountId,
                                assignerId: creator.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: creator.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            creator: {
                                accountId: creator.accountId,
                                workingAccountName: accountName,
                                workingAccountNameVersion: accountNameVersion,
                            },
                            assignee: {
                                assignee: {
                                    accountId: creator.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assigner: {
                                    accountId: creator.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating two assignee account names",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId1 = generateId<TaskId>();
            const taskId2 = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId1,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId1,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: account2.accountId,
                                assignerId: creator.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId2,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId2,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: account2.accountId,
                                assignerId: creator.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: account2.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId: taskId1,
                        task: {
                            assignee: {
                                assignee: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assigner: creator,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                    {
                        taskId: taskId2,
                        task: {
                            assignee: {
                                assignee: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assigner: creator,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating assignee account name but not other assignee",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId1 = generateId<TaskId>();
            const taskId2 = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId1,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId1,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: account2.accountId,
                                assignerId: creator.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId2,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId2,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: creator.accountId,
                                assignerId: creator.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: account2.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId: taskId1,
                        task: {
                            assignee: {
                                assignee: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assigner: creator,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                    {
                        taskId: taskId2,
                        task: {
                            assignee: {
                                assignee: creator,
                                assigner: creator,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating assigner account name",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: creator.accountId,
                                assignerId: account2.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: account2.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId,
                        task: {
                            assignee: {
                                assignee: creator,
                                assigner: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating two assigner account names",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId1 = generateId<TaskId>();
            const taskId2 = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId1,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId1,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: creator.accountId,
                                assignerId: account2.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId2,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId2,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: creator.accountId,
                                assignerId: account2.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: account2.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId: taskId1,
                        task: {
                            assignee: {
                                assignee: creator,
                                assigner: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                    {
                        taskId: taskId2,
                        task: {
                            assignee: {
                                assignee: creator,
                                assigner: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                ],
            };
        },
    },
    {
        name: "updating assigner account name but not other assignee",
        create: ({getNextTime, creator, account2}): TaskActionTestArtifacts => {
            const taskId1 = generateId<TaskId>();
            const taskId2 = generateId<TaskId>();
            const accountName = generateId();
            const accountNameVersion = nextAccountNameVersion++;

            const time1 = getNextTime();
            const time2 = getNextTime();
            const time3 = getNextTime();

            return {
                actions: [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId1,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId1,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: creator.accountId,
                                assignerId: account2.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: taskId2,
                        taskAction: {
                            type: "Create",
                            creatorId: creator.accountId,
                            creatorTimeZone: defaultTimeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: taskId2,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: creator.accountId,
                                assignerId: creator.accountId,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                        },
                    },
                    {
                        type: "UpdateAccountName",
                        time: time3,
                        accountId: account2.accountId,
                        accountName,
                        accountNameVersion,
                    },
                ],
                expect: [
                    {
                        taskId: taskId1,
                        task: {
                            assignee: {
                                assignee: creator,
                                assigner: {
                                    accountId: account2.accountId,
                                    workingAccountName: accountName,
                                    workingAccountNameVersion: accountNameVersion,
                                },
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
                        },
                    },
                    {
                        taskId: taskId2,
                        task: {
                            assignee: {
                                assignee: creator,
                                assigner: creator,
                                assignedTime: TaskFilterableTime.test(time2),
                            },
                            assigneePosition: {orderTime: time2, orderKey: initialOrderKey},
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
 * We have a library of `TaskAction` test cases. This function will run each of our
 * test cases. It will run the test case in every possible order and with
 * duplicates. This way we can test the commutativity and idempotency properties of
 * `TaskAction`s.
 *
 * This is in a shared file so we can run it with our OpenSearch `TaskAction`
 * implementation and our client database `TaskAction` implementation to verify
 * they have the same implementations.
 *
 * We do not use this to test committing `TaskAction`s. The `TaskAction` commit
 * function is not commutative or idempotent. Once an action has been committed,
 * then we may apply it in any order.
 */
export function testTaskActionPermutations({
    percent = 1,
    partitionNumber = 1,
    partitionCount = 1,
    account1,
    account2,
    applyTaskAction,
    getTask,
    getTaskCollection,
}: {
    percent?: number;
    partitionNumber?: number;
    partitionCount?: number;
    account1: AccountModelWithoutSpace;
    account2: AccountModelWithoutSpace;
    applyTaskAction: (action: TaskAction, next: () => void) => MaybePromise<void>;
    getTask: (taskId: TaskId) => MaybePromise<TaskTestInterface>;
    getTaskCollection: (
        collectionId: TaskCollectionId,
    ) => MaybePromise<TaskCollectionTestInterface>;
}) {
    nextAccountNameVersion = Math.max(
        nextAccountNameVersion,
        account1.initialData.nameVersion + 1,
        account2.initialData.nameVersion + 1,
    );

    const stableRandom = new StableRandom("testTaskActionPermutations");

    const allTests: Array<{
        only: boolean;
        describeName: string;
        testName: string;
        runTest: () => Promise<void>;
    }> = [];

    for (const testCase of taskActionTestCases) {
        const clock = new HybridLogicalClock(unsynchronizedSystemClock);

        // Make sure this function returns a monotonically increasing date to avoid flaky
        // errors.
        function getNextTime() {
            return clock.now();
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
            creator: {
                accountId: account1.id,
                workingAccountName: expect.any(String),
                workingAccountNameVersion: expect.any(Number),
            },
            createdTime: getNextFilterableTime(),
            account2: {
                accountId: account2.id,
                workingAccountName: expect.any(String),
                workingAccountNameVersion: expect.any(Number),
            },
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

        const permutations = [
            ...uniquePermutations(permutator(actionIndexes)),

            // Don't include more than 240 permutations with duplicate actions. We test in
            // every order (above) then randomly sample permutations with duplicates.
            //
            // 240 is the length of `permutationsWithDuplicates` when we have 4 actions.
            ...(permutationsWithDuplicates.length > 240
                ? stableShuffleArray(
                      stableRandom,
                      `${testCase.name}-permutationsWithDuplicates`,
                      permutationsWithDuplicates.map((item, i) => [item, i] as const),
                  )
                      .slice(0, 240)
                      // Sort back into the original test order.
                      .sort(([, i1], [, i2]) => i1 - i2)
                      .map(([item]) => item)
                : permutationsWithDuplicates),
        ];

        for (const permutation of permutations) {
            allTests.push({
                only: !!testCase.only,
                describeName: testCase.name,
                testName: `[${permutation.join(", ")}]`,
                runTest: async () => {
                    const actions = permutation.map(
                        actionIndex => testCaseArtifacts.actions[actionIndex]!,
                    );

                    const run = async () => {
                        const promises = [];

                        // Run our actions in sequence. If an action calls `next()` that means it needs to
                        // retry. It might need to retry because it's waiting on a later action. So go
                        // apply the next action.
                        for (const action of actions) {
                            const nextPromiseResolver = createPromiseResolver();

                            const promise = applyTaskAction(action, nextPromiseResolver.resolve);
                            promises.push(promise);

                            await Promise.race([
                                // eslint-disable-next-line @typescript-eslint/await-thenable
                                promise,
                                nextPromiseResolver.promise,
                            ]);
                        }

                        await runAllPromises(promises);
                    };

                    if (testCaseArtifacts.error) {
                        const result = await captureResultPromise(run);

                        expect(result.ok).toEqual(false);
                        assert(!result.ok);
                        expect(getErrorCode(result.error)).toEqual(testCaseArtifacts.error);
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
                                                : undefined,
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
                                        status: {type: "Open"},
                                        assignee: null,
                                        assigneeStatus: {type: "Inactive"},
                                        assigneePosition: null,
                                        title: emptyTaskTitle.get(),
                                        dueDate: null,
                                        priority: null,
                                        layout: null,
                                        ...expectation.task,
                                        creator:
                                            expectation.task.creator ??
                                            expect.objectContaining({
                                                accountId: assertExists(
                                                    createAction?.taskAction.creatorId,
                                                    "Expected `Create` task action when `creatorId` is not provided",
                                                ),
                                            }),
                                        createdTime:
                                            expectation.task.createdTime ??
                                            new TaskFilterableTime({
                                                absoluteTime: assertExists(
                                                    createAction?.time,
                                                    "Expected `Create` task action when `createdTime` is not provided",
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
                                            action.type === "UpdateCollection" &&
                                            action.collectionId === expectation.collectionId &&
                                            action.collectionAction.type === "Create"
                                                ? {
                                                      time: action.time,
                                                      collectionAction: action.collectionAction,
                                                  }
                                                : undefined,
                                        ),
                                    );

                                    const expectedCollection: TaskCollectionTestInterface = {
                                        isDeleted: false,
                                        name: "Test",
                                        color: null,
                                        ...expectation.collection,
                                        createdTime:
                                            expectation.collection.createdTime ??
                                            assertExists(
                                                createAction?.time,
                                                "Expected `Create` task collection action when `createdTime` is not provided",
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

    // If we are only running some percent of tests then randomly shuffle our tests and
    // pick the first N. That will be the set of tests we run.
    const shuffledTests =
        percent < 1
            ? stableShuffleArray(
                  stableRandom,
                  "percent",
                  allTests.map((item, i) => [item, i] as const),
              ).slice(0, Math.floor(allTests.length * percent))
            : allTests.map((item, i) => [item, i] as const);

    const partitionTestCount = Math.floor(shuffledTests.length / partitionCount);
    const partitionStartTestIndex = partitionTestCount * (partitionNumber - 1);

    const partitionTests = shuffledTests
        .slice(
            partitionStartTestIndex,
            // The last partition gets all remaining tests.
            partitionNumber !== partitionCount
                ? partitionStartTestIndex + partitionTestCount
                : undefined,
        )
        .sort(([, i1], [, i2]) => i1 - i2)
        .map(([item]) => item);

    const groupedPartitionTests: Array<{
        only: boolean;
        describeName: string;
        tests: Array<{testName: string; runTest: () => Promise<void>}>;
    }> = [];

    for (const partitionTest of partitionTests) {
        if (
            groupedPartitionTests.length === 0 ||
            groupedPartitionTests[groupedPartitionTests.length - 1]!.describeName !==
                partitionTest.describeName
        ) {
            groupedPartitionTests.push({
                only: partitionTest.only,
                describeName: partitionTest.describeName,
                tests: [],
            });
        }

        groupedPartitionTests[groupedPartitionTests.length - 1]!.tests.push(partitionTest);
    }

    let nextPartitionTestNumber = 1;

    for (const groupedPartitionTest of groupedPartitionTests) {
        describe(`${groupedPartitionTest.describeName}`, () => {
            if (groupedPartitionTest.only) {
                afterAll(() => {
                    throw new InternalError(
                        quote`Remove \`only: true\` from ${groupedPartitionTest.describeName} before committing`,
                    );
                });
            }

            for (const partitionTest of groupedPartitionTest.tests) {
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

                const testFn = groupedPartitionTest.only ? test.only : test;

                testFn(
                    `${partitionTest.testName}`,
                    withLogging(partitionTest.runTest, (result, durationMs) => {
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
