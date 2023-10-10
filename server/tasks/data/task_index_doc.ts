import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {OpensearchClientDocWithVersion} from "~/server/opensearch/opensearch_client.js";
import {
    OpensearchIndexArrayType,
    OpensearchIndexBinaryType,
    OpensearchIndexBooleanType,
    OpensearchIndexByteType,
    OpensearchIndexDateType,
    OpensearchIndexIgnoredObjectType,
    OpensearchIndexIntegerType,
    OpensearchIndexKeywordType,
    OpensearchIndexObjectType,
    OpensearchIndexTextType,
    OpensearchIndexTypeBase,
    OpensearchIndexTypeType,
    OpensearchIndexUnionObjectType,
} from "~/server/opensearch/opensearch_index_type.js";
import {createCrdtRegisterOpensearchType} from "~/server/tasks/data/internal/create_crdt_register_opensearch_type.js";
import {
    HybridLogicalTimeType,
    SortableHybridLogicalTimeType,
} from "~/server/tasks/data/internal/hybrid_logical_time_type.js";
import {CrdtRegister} from "~/shared/crdt/crdt_register.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isTimeZone} from "~/shared/helpers/date/time_zone.js";
import {initialOrderKey, isOrderKey} from "~/shared/helpers/sort/order_key.js";
import {createEnumIntegerMapping} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {
    HybridLogicalTimeSchema,
    serializeHybridLogicalTime,
} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskAssigneeWithSortableAccountRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeActivePositionRegister} from "~/shared/tasks/task_assignee_active_position.js";
import {
    TaskAssigneeStatus,
    TaskAssigneeStatusRegister,
    TaskAssigneeStatusSchema,
} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {
    TaskDisplayStatus,
    TaskDisplayStatusIntegerMapping,
} from "~/shared/tasks/task_display_status.js";
import {
    TaskFilterableTime,
    getTaskFilterableTimeSetterDate,
} from "~/shared/tasks/task_filterable_time.js";
import {TaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {
    TaskPosition,
    TaskPositionRegister,
    TaskPositionSchema,
} from "~/shared/tasks/task_position.js";
import {TaskPositionByAccountIdAndNotepadPageIdMap} from "~/shared/tasks/task_position_by_account_id_and_notepad_page_id.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {
    TaskPriority,
    TaskPriorityIntegerMapping,
    TaskPriorityRegister,
} from "~/shared/tasks/task_priority.js";
import {TaskStatus, TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {TaskTitle, getTaskTitleText} from "~/shared/tasks/task_title.js";

/**
 * Indexes an account and inlines the account's name and the account's
 * name version.
 *
 * We inline the account name into this object so we can sort by account
 * name. When the account name changes we run a
 * [`/:index/_update_by_query` request][1] to update all tasks the name is
 * present in at once.
 *
 * The inlined account name/version is prefixed with "working" to denote that
 * the account is what we're currently using for sorting but it's not the
 * canonical account name source and may temporarily be out-of-date.
 *
 * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/update-by-query/
 */
const TaskIndexSortableAccountType = OpensearchIndexObjectType.new({
    fields: {
        accountId: new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
        workingAccountName: new OpensearchIndexKeywordType({isSortable: true}),
        workingAccountNameVersion: new OpensearchIndexIntegerType({isFilterable: true}),
    },
});

/**
 * Indexes `TaskFilterableTime`.
 *
 * We index the computed `setterDate` field since we'd like to filter by that.
 */
const TaskIndexFilterableTimeType = OpensearchIndexObjectType.new({
    fields: {
        absoluteTime: SortableHybridLogicalTimeType,
        setterTimeZone: new OpensearchIndexKeywordType().validate(isTimeZone),
    },
    computed: {
        fields: {
            // The task query UI filters by date in the setter's time zone since that
            // represents a logical workday that is not subject to arbitrary time zone
            // boundaries. See `TaskFilterableTime` for more reasoning behind this.
            //
            // `CalendarDate` is represented by an OpenSearch date field at midnight
            // UTC for that date.
            setterDate: new OpensearchIndexDateType({isFilterable: true}).transform<CalendarDate>({
                serialize: date => date.toDate("UTC"),
                deserialize: date => toCalendarDate(parseAbsolute(date.toISOString(), "UTC")),
            }),
        },
        compute: ({absoluteTime, setterTimeZone}) => ({
            setterDate: getTaskFilterableTimeSetterDate(absoluteTime, setterTimeZone),
        }),
    },
}).transform<TaskFilterableTime>({
    serialize: time => time,
    deserialize: time => new TaskFilterableTime(time),
});

const TaskIndexPositionType = OpensearchIndexObjectType.new({
    fields: {
        orderTime: SortableHybridLogicalTimeType,
        orderKey: new OpensearchIndexKeywordType({isSortable: true}).validate(isOrderKey),
    },
});

/**
 * Represents the parent task, if there is one, and the position of our task in
 * its parent.
 *
 * The parent `taskId` and `position` are separate registers so they may be
 * updated independently even though `position` depends on `taskId`. `position`
 * should reset whenever `taskId` changes and `position` should be considered
 * null if `taskId` is null. `position` must be set if `taskId` is non-null so
 * we consider `position` to always be non-null`.
 */
const TaskIndexParentType = OpensearchIndexObjectType.new({
    fields: {
        taskId: createCrdtRegisterOpensearchType(
            TaskParentTaskIdRegister,
            new OpensearchIndexKeywordType({isFilterable: true}).validate<TaskId>(isId).nullable(),
        ),
        rawPosition: new OpensearchIndexIgnoredObjectType(
            Schema.object({
                value: TaskPositionSchema,
                version: HybridLogicalTimeSchema,
            }),
        ).transform<TaskPositionRegister>({
            serialize: register => ({value: register.value, version: register.version}),
            deserialize: register => new TaskPositionRegister(register.value, register.version),
        }),
    },
    computed: {
        fields: {
            position: createCrdtRegisterOpensearchType(
                TaskPositionRegister,
                TaskIndexPositionType,
            ).nullable(),
        },
        compute: ({taskId, rawPosition}) => ({
            position: taskId.value ? rawPosition : null,
        }),
    },
});

/**
 * Indexes the collections a task is in and the position of the task in its
 * collections.
 *
 * We have the raw representation of our task's collections which doesn't get
 * indexed. Then we index a couple flattened array fields: `ids`,
 * `positionOrderTimes`, and `positionOrderKeys`. These arrays are correlated
 * by their position in the array. So an item at position 2 in
 * `positionOrderTimes` corresponds to item 2 in `ids`.
 *
 * We choose to use flat array fields as opposed to a nested field for
 * performance. Nested fields create separate documents (under the hood) for
 * each item in the array. This doesn't give us a speed advantage for the case
 * we need correlated `TaskCollectionId`s: sorting. So instead we sort by a
 * script. The script finds the index of the collection in `ids` and uses it to
 * get the right order time and order key.
 *
 * OpenSearch doesn't have indexes for sorting, unfortunately. If we find this
 * to be slow, we can build our own index for fast sorting outside of our tasks
 * OpenSearch index.
 */
const TaskIndexCollectionsType = OpensearchIndexObjectType.new({
    fields: {
        raw: new OpensearchIndexIgnoredObjectType(
            Schema.object({
                collections: TaskCollectionSet.schema,
                positionById: TaskPositionByCollectionIdMap.schema,
            }),
        ),
    },
    computed: {
        fields: {
            ids: new OpensearchIndexArrayType(
                new OpensearchIndexKeywordType({
                    isFilterable: true,
                }).validate<TaskCollectionId>(isId),
            ),
            // Store a map of `TaskCollectionId` to `TaskPosition` in a string array. This
            // is used by a script to sort tasks.
            positions: new OpensearchIndexArrayType(
                new OpensearchIndexKeywordType({isUsableInScripts: true}),
            ),
        },
        compute: ({raw: {collections, positionById}}) => ({
            ids: collections.getArray().map(({collectionId}) => collectionId),
            positions: collections.getArray().map(({collectionId, version}) => {
                const position = positionById.get(collectionId);
                const orderTime = position?.orderTime ?? version;
                const orderKey = position?.orderKey ?? initialOrderKey;
                return `${collectionId}:${serializeHybridLogicalTime(orderTime)
                    .toString()
                    .padStart(20, "0")}-${orderKey}`;
            }),
        }),
    },
});

/**
 * Indexes the notepad pages a task is in and the position of the task in those
 * notepad pages. Uses roughly the same layout as `TaskIndexCollectionsType` so
 * see the documentation on that type.
 */
// NOTE(calebmer, 2023-08-22): When I started writing this code any account
// could add a task to their notepad. Hence why this map is keyed by
// `${AccountId}-${TaskNotepadPageId}`. However, later I constrained notepad
// pages to only include tasks created by the page's owner. With this
// restriction I could drop `AccountId` from the key but I'll keep it for now
// to avoid a refactor and allow, hopefully, any task to be added to an
// account's notepad in the future.
const TaskIndexNotepadPagesType = OpensearchIndexObjectType.new({
    fields: {
        raw: new OpensearchIndexIgnoredObjectType(
            Schema.object({
                positionById: TaskPositionByAccountIdAndNotepadPageIdMap.schema,
            }),
        ),
    },
    computed: {
        fields: {
            ids: new OpensearchIndexArrayType(
                new OpensearchIndexKeywordType({
                    isFilterable: true,
                }).validate((value): value is `${AccountId}-${TaskNotepadPageId}` => {
                    const [value1 = "", value2 = ""] = value.split("-", 2);
                    return isId(value1) && !isNaN(parseInt(value2, 10));
                }),
            ),
            // Store a map of `${AccountId}-${TaskNotepadPageId}` to `TaskPosition` in a
            // string array. This is used by a script to sort tasks.
            positions: new OpensearchIndexArrayType(
                new OpensearchIndexKeywordType({isUsableInScripts: true}),
            ),
        },
        compute: ({raw: {positionById}}) => ({
            ids: Array.from(positionById.keys()),
            positions: Array.from(
                positionById.entries(),
                ([accountIdAndNotepadPageId, {orderTime, orderKey}]) => {
                    return `${accountIdAndNotepadPageId}:${serializeHybridLogicalTime(orderTime)
                        .toString()
                        .padStart(20, "0")}-${orderKey}`;
                },
            ),
        }),
    },
});

export const TaskStatusTypeIntegerMapping = createEnumIntegerMapping({
    Open: 1,
    Closed: 2,
});

/**
 * Indexes `TaskStatus`.
 *
 * We represent priority with an integer so it's consistent with other enums
 * in OpenSearch.
 *
 * You may filter by status but you don't sort by this status field. Instead
 * you sort by the computed field `displayStatus` which takes both `status` and
 * `assigneeStatus` into account.
 *
 * [1]: https://opensearch.org/docs/latest/search-plugins/searching-data/sort/#performance-considerations
 */
const TaskIndexStatusType = createCrdtRegisterOpensearchType(
    TaskStatusWithSortableAccountRegister,
    OpensearchIndexUnionObjectType.new({
        type: new OpensearchIndexByteType({
            isFilterable: true,
            isSortable: true,
        }).transform<TaskStatus["type"]>({
            serialize: status => TaskStatusTypeIntegerMapping.into(status),
            deserialize: status =>
                TaskStatusTypeIntegerMapping.from(TaskStatusTypeIntegerMapping.assert(status)),
        }),
        variants: {
            Open: cast<OpensearchIndexObjectType<{readonly closer?: undefined}, never>>(
                OpensearchIndexObjectType.new({fields: {}}),
            ),
            Closed: OpensearchIndexObjectType.new({
                fields: {
                    closer: TaskIndexSortableAccountType,
                    closedTime: TaskIndexFilterableTimeType,
                },
            }),
        },
    }),
);

/**
 * Indexes `TaskAssignee`.
 */
const TaskIndexAssigneeType = createCrdtRegisterOpensearchType(
    TaskAssigneeWithSortableAccountRegister,
    OpensearchIndexObjectType.new({
        fields: {
            assignee: TaskIndexSortableAccountType,
            assigner: TaskIndexSortableAccountType,
            assignedTime: TaskIndexFilterableTimeType,
        },
    }).nullable(),
);

const TaskAssigneeStatusIntegerMapping = createEnumIntegerMapping({
    Inactive: 1,
    Active: 2,
});

/**
 * Indexes `TaskAssigneeStatus`.
 *
 * Be careful when using this! This is a register that can independently update
 * from `status` and `assignee` but the true value depends on these fields.
 */
const TaskIndexAssigneeStatusType = createCrdtRegisterOpensearchType(
    TaskAssigneeStatusRegister,
    OpensearchIndexUnionObjectType.new({
        type: new OpensearchIndexByteType().transform<TaskAssigneeStatus["type"]>({
            serialize: status => TaskAssigneeStatusIntegerMapping.into(status),
            deserialize: status =>
                TaskAssigneeStatusIntegerMapping.from(
                    TaskAssigneeStatusIntegerMapping.assert(status),
                ),
        }),
        variants: {
            Inactive: OpensearchIndexObjectType.new({fields: {}}),
            Active: OpensearchIndexObjectType.new({
                fields: {
                    activatedTime: TaskIndexFilterableTimeType,
                },
            }),
        },
    }),
);

const TaskIndexDisplayStatusType = new OpensearchIndexByteType({
    isFilterable: true,
    isSortable: true,
}).transform<TaskDisplayStatus>({
    serialize: status => TaskDisplayStatusIntegerMapping.into(status),
    deserialize: status =>
        TaskDisplayStatusIntegerMapping.from(TaskDisplayStatusIntegerMapping.assert(status)),
});

/**
 * Indexes `TaskTitle`.
 *
 * Indexes both the binary Y.js form and a raw text form. That raw text form is
 * used for filtering.
 */
const TaskIndexTitleType = OpensearchIndexObjectType.new({
    fields: {
        raw: new OpensearchIndexBinaryType() as OpensearchIndexTypeBase<
            any,
            never
        > as OpensearchIndexTypeBase<TaskTitle, never>,
    },
    computed: {
        fields: {
            text: new OpensearchIndexTextType({
                // Uses the standard analyzer which is case insensitive, uses the [Unicode Text
                // Segmentation][1] algorithm to split words, and does not discard stop words.
                //
                // It's important we use an analyzer here that we can reimplement in
                // JavaScript since filtering also needs to be performed on the client.
                //
                // [1]: https://unicode.org/reports/tr29/
                analyzer: "standard",
            }),
        },
        compute: ({raw}) => ({text: getTaskTitleText(raw)}),
    },
});

/**
 * Indexes a task due date represented by a `CalendarDate`.
 *
 * `CalendarDate` is represented by an OpenSearch date field at midnight
 * UTC for that date.
 */
const TaskIndexDueDateType = createCrdtRegisterOpensearchType(
    TaskDueDateRegister,
    new OpensearchIndexDateType({
        isFilterable: true,
        isSortable: true,
    })
        .transform<CalendarDate>({
            serialize: date => date.toDate("UTC"),
            deserialize: date => toCalendarDate(parseAbsolute(date.toISOString(), "UTC")),
        })
        .nullable(),
);

/**
 * Indexes `TaskPriority`.
 *
 * Represent priority with an integer so that it's sortable. OpenSearch recommends
 * using the [smallest type possible][1] when sorting since it needs to be
 * loaded into memory.
 *
 * [1]: https://opensearch.org/docs/latest/search-plugins/searching-data/sort/#performance-considerations
 */
const TaskIndexPriorityType = createCrdtRegisterOpensearchType(
    TaskPriorityRegister,
    new OpensearchIndexByteType({
        isFilterable: true,
        isSortable: true,
    })
        .transform<TaskPriority>({
            serialize: priority => TaskPriorityIntegerMapping.into(priority),
            deserialize: priority =>
                TaskPriorityIntegerMapping.from(TaskPriorityIntegerMapping.assert(priority)),
        })
        .nullable(),
);

/**
 * The type of a document in our tasks index. Can be used to execute arbitrary
 * queries against tasks efficiently.
 */
export type TaskIndexDoc = MergeObjectIntersection<
    {readonly id: TaskId} & OpensearchIndexTypeType<typeof TaskIndexDocType>
>;

export type TaskIndexDocWithVersion = OpensearchClientDocWithVersion<TaskIndexDoc>;

export const TaskIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        // The space this task is in. We also use the `SpaceId` as the routing value
        // for `TaskIndex`. Why do we also need it here? For index sorting. We want to
        // sort the OpenSearch index by space, then deletion, then open/close status.
        // So it's efficient to filter for open, not-deleted, tasks in a space. The
        // documentation is unclear on whether the routing field is included in
        // index sorting so we manually have an identical `spaceId` field that's
        // part of index sorting.
        //
        // We recommend filtering on both `spaceId` and the routing field to make sure
        // index sorting optimizations kick in.
        spaceId: new OpensearchIndexKeywordType({
            isFilterable: true,
            isSortable: true,
        }).validate<SpaceId>(isId),

        creator: TaskIndexSortableAccountType,
        createdTime: TaskIndexFilterableTimeType,
        // The `isDeleted` computed property definitively tells us whether a task is
        // deleted or not.
        rawDeletedTime: HybridLogicalTimeType.nullable(),
        rawUndeletedTime: HybridLogicalTimeType.nullable(),

        parent: TaskIndexParentType,
        // See the documentation on `TaskUpdateChildrenCountsAction` for what these
        // fields are. They are CRDTs that allow us to figure out the task's
        // `childTaskCount` and `childClosedTaskCount`.
        //
        // We don't have `childTaskCount` or `childClosedTaskCount` computed fields
        // since we don't need to index those fields.
        addedChildTaskCount: new OpensearchIndexIntegerType(),
        removedChildTaskCount: new OpensearchIndexIntegerType(),
        addedClosedChildTaskCount: new OpensearchIndexIntegerType(),
        removedClosedChildTaskCount: new OpensearchIndexIntegerType(),

        collections: TaskIndexCollectionsType,
        notepadPages: TaskIndexNotepadPagesType,

        status: TaskIndexStatusType,
        assignee: TaskIndexAssigneeType,
        // Raw since this is a register that can independently update from `status` and
        // `assignee` but the true value depends on these fields. If `status` is closed
        // or `assignee` is null then `assigneeStatus` is always inactive.
        rawAssigneeStatus: new OpensearchIndexIgnoredObjectType(
            Schema.object({
                value: TaskAssigneeStatusSchema,
                version: HybridLogicalTimeSchema,
            }),
        ).transform<TaskAssigneeStatusRegister>({
            serialize: register => register,
            deserialize: register =>
                new TaskAssigneeStatusRegister(register.value, register.version),
        }),
        // The actual value of this register on the task is null if the task is closed,
        // inactive, or there is no assignee. Additionally if the `AccountId` in this
        // register is different from the assignee then the value is also null.
        //
        // However, if the actual value of this register is null and the task is active
        // then we default the position to be based on the assignee status register's
        // `version`.
        rawAssigneeActivePosition: new OpensearchIndexIgnoredObjectType(
            Schema.object({
                value: Schema.object({
                    accountId: Schema.id<AccountId>(),
                    position: TaskPositionSchema,
                }).nullable(),
                version: HybridLogicalTimeSchema,
            }),
        ).transform<TaskAssigneeActivePositionRegister>({
            serialize: register => register,
            deserialize: register =>
                new TaskAssigneeActivePositionRegister(register.value, register.version),
        }),

        title: TaskIndexTitleType,
        dueDate: TaskIndexDueDateType,
        priority: TaskIndexPriorityType,
    },
    computed: {
        fields: {
            isDeleted: new OpensearchIndexBooleanType({isFilterable: true, isSortable: true}),
            displayStatus: TaskIndexDisplayStatusType,
            assigneeStatus: TaskIndexAssigneeStatusType.nullable(),
            assigneeActivePosition: TaskIndexPositionType.nullable(),
        },
        compute: task => {
            return {
                isDeleted: isTaskIndexDocDeleted(task),
                displayStatus: getTaskIndexDocDisplayStatus(task),
                assigneeStatus:
                    task.status.value.type === "Open" && task.assignee.value
                        ? task.rawAssigneeStatus
                        : null,
                assigneeActivePosition: getTaskIndexDocAssigneeActivePosition(task),
            };
        },
    },
});

export function isTaskIndexDocDeleted(task: {
    rawDeletedTime: HybridLogicalTime | null;
    rawUndeletedTime: HybridLogicalTime | null;
}): boolean {
    return (
        !!task.rawDeletedTime &&
        (!task.rawUndeletedTime ||
            compareHybridLogicalTimes(task.rawDeletedTime, task.rawUndeletedTime) > 0)
    );
}

export function getTaskIndexDocDisplayStatus(task: {
    status: TaskStatusWithSortableAccountRegister;
    assignee: TaskAssigneeWithSortableAccountRegister;
    rawAssigneeStatus: CrdtRegister<TaskAssigneeStatus>;
}): TaskDisplayStatus {
    return task.status.value.type === "Closed"
        ? "Closed"
        : task.assignee.value && task.rawAssigneeStatus.value.type === "Active"
        ? "OpenActive"
        : "OpenInactive";
}

export function getTaskIndexDocAssigneeStatus(task: {
    status: TaskStatusWithSortableAccountRegister;
    assignee: TaskAssigneeWithSortableAccountRegister;
    rawAssigneeStatus: TaskAssigneeStatusRegister;
}): TaskAssigneeStatus {
    return task.status.value.type === "Open" && task.assignee.value
        ? task.rawAssigneeStatus.value
        : {type: "Inactive"};
}

export function getTaskIndexDocAssigneeActivePosition(task: {
    status: TaskStatusWithSortableAccountRegister;
    assignee: TaskAssigneeWithSortableAccountRegister;
    rawAssigneeStatus: TaskAssigneeStatusRegister;
    rawAssigneeActivePosition: TaskAssigneeActivePositionRegister;
}): TaskPosition | null {
    return task.status.value.type === "Open" &&
        task.assignee.value &&
        task.rawAssigneeStatus?.value.type === "Active"
        ? task.rawAssigneeActivePosition.value?.accountId === task.assignee.value.assignee.accountId
            ? task.rawAssigneeActivePosition.value.position
            : {orderTime: task.rawAssigneeStatus.version, orderKey: initialOrderKey}
        : null;
}
