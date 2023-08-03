import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
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
import {createCrdtRegisterOpensearchType} from "~/server/tasks/index/internal/create_crdt_register_opensearch_type.js";
import {
    HybridLogicalTimeType,
    SortableHybridLogicalTimeType,
} from "~/server/tasks/index/internal/hybrid_logical_time_type.js";
import {createCrdtMap} from "~/shared/crdt/crdt_map.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {isTimeZone} from "~/shared/helpers/date/time_zone.js";
import {initialOrderKey, isOrderKey} from "~/shared/helpers/sort/order_key.js";
import {createEnumIntegerMapping} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskDueDateRegister, TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_action.js";
import {TaskAssigneeRegister} from "~/shared/tasks/task_assignee.js";
import {
    TaskAssigneeStatus,
    TaskAssigneeStatusRegister,
} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {
    TaskFilterableTime,
    getTaskFilterableTimeSetterDate,
} from "~/shared/tasks/task_filterable_time.js";
import {TaskNotepadPageId} from "~/shared/tasks/task_notepad_page_id.js";
import {TaskPositionRegister, TaskPositionSchema} from "~/shared/tasks/task_position.js";
import {TaskPriority, TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatus, TaskStatusRegister} from "~/shared/tasks/task_status.js";
import {TaskTitle, getTaskTitleText} from "~/shared/tasks/task_title.js";

/**
 * Indexes `TaskSortableAccount`.
 *
 * We denormalize the account name into this object so we can sort by account
 * name. When the account name changes we run a
 * [`/:index/_update_by_query` request][1] to update all tasks the name is
 * present in at once. Hopefully in one refresh.
 *
 * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/update-by-query/
 */
const TaskIndexSortableAccountType = OpensearchIndexObjectType.new({
    fields: {
        accountId: new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
        workingAccountName: new OpensearchIndexKeywordType({isSortable: true}),
    },
}).transform<TaskSortableAccount>({
    serialize: account => account,
    deserialize: account => new TaskSortableAccount(account),
});

/**
 * Indexes `TaskFilterableTime`.
 *
 * We index the computed `setterDate` field since we'd like to filter by that.
 */
const TaskIndexFilterableTimeType = OpensearchIndexObjectType.new({
    fields: {
        // While our task query UI filters by `setterDate` we allow the `absoluteTime`
        // to be filterable since it's very reasonable we may add a feature to turn off
        // our setter time zone filter logic in the future.
        absoluteTime: new OpensearchIndexDateType({isFilterable: true, isSortable: true}),
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
        position: createCrdtRegisterOpensearchType(TaskPositionRegister, TaskIndexPositionType),
    },
});

export const TaskPositionByCollectionIdMap = createCrdtMap(
    Schema.id<TaskCollectionId>(),
    TaskPositionSchema,
);

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
                new OpensearchIndexKeywordType({isFilterable: true}).validate<TaskCollectionId>(
                    isId,
                ),
            ),
            positionOrderTimes: new OpensearchIndexArrayType(SortableHybridLogicalTimeType),
            positionOrderKeys: new OpensearchIndexArrayType(
                new OpensearchIndexKeywordType({isSortable: true}).validate(isOrderKey),
            ),
        },
        compute: ({raw: {collections, positionById}}) => ({
            ids: collections.getArray().map(({collectionId}) => collectionId),
            positionOrderTimes: collections
                .getArray()
                .map(
                    ({collectionId, version}) =>
                        positionById.get(collectionId)?.orderTime ?? version,
                ),
            positionOrderKeys: collections
                .getArray()
                .map(
                    ({collectionId}) => positionById.get(collectionId)?.orderKey ?? initialOrderKey,
                ),
        }),
    },
});

const TaskAccountIdAndNotepadPageId =
    Schema.string as Schema<any> as Schema<`${AccountId}-${TaskNotepadPageId}`>;

export const TaskPositionByAccountIdAndNotepadPageId = createCrdtMap(
    TaskAccountIdAndNotepadPageId,
    TaskPositionSchema,
);

/**
 * Indexes the notepad pages a task is in and the position of the task in those
 * notepad pages. Uses roughly the same layout as `TaskIndexCollectionsType` so
 * see the documentation on that type.
 */
const TaskIndexNotepadPagesType = OpensearchIndexObjectType.new({
    fields: {
        raw: new OpensearchIndexIgnoredObjectType(
            Schema.object({
                positionById: TaskPositionByAccountIdAndNotepadPageId.schema,
            }),
        ),
    },
    computed: {
        fields: {
            ids: new OpensearchIndexArrayType(
                new OpensearchIndexKeywordType({isFilterable: true}).validate(
                    (value): value is `${AccountId}-${TaskNotepadPageId}` => {
                        const [value1 = "", value2 = ""] = value.split("-", 2);
                        return isId(value1) && !isNaN(parseInt(value2, 10));
                    },
                ),
            ),
            positionOrderTimes: new OpensearchIndexArrayType(SortableHybridLogicalTimeType),
            positionOrderKeys: new OpensearchIndexArrayType(
                new OpensearchIndexKeywordType({isSortable: true}).validate(isOrderKey),
            ),
        },
        compute: ({raw: {positionById}}) => ({
            ids: Array.from(positionById.keys()),
            positionOrderTimes: Array.from(positionById.values(), ({orderTime}) => orderTime),
            positionOrderKeys: Array.from(positionById.values(), ({orderKey}) => orderKey),
        }),
    },
});

const TaskStatusIntegerMapping = createEnumIntegerMapping({
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
    TaskStatusRegister,
    OpensearchIndexUnionObjectType.new({
        type: new OpensearchIndexByteType({
            isFilterable: true,
            isSortable: true,
        }).transform<TaskStatus["type"]>({
            serialize: status => TaskStatusIntegerMapping.into(status),
            deserialize: status =>
                TaskStatusIntegerMapping.from(TaskStatusIntegerMapping.assert(status)),
        }),
        variants: {
            Open: OpensearchIndexObjectType.new({fields: {}}),
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
    TaskAssigneeRegister,
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
                    position: TaskIndexPositionType,
                    activatedTime: TaskIndexFilterableTimeType,
                },
            }),
        },
    }),
);

// Leave room between enum values for more enum values to be inserted in the
// future. We may add other display statuses in the future like "expired" or
// "waiting on approval". If we do we don't yet know how we'll want these states
// to be ordered. So to start we take the max value for our field type (`byte`
// which has a max of 127), divide by 4 so we can distribute our statuses with
// room at all positions to add new statuses.
const TaskDisplayStatusIntegerMapping = createEnumIntegerMapping({
    OpenInactive: 32,
    OpenActive: 64,
    Closed: 96,
});

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

const TaskPriorityIntegerMapping = createEnumIntegerMapping({
    Low: 1,
    Medium: 2,
    High: 3,
    Urgent: 4,
});

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
export type TaskIndexDoc = OpensearchIndexTypeType<typeof TaskIndexDocType> & {
    readonly version?: {
        readonly sequenceNumber: number;
        readonly primaryTerm: number;
    };
};

export const TaskIndexDocType = OpensearchIndexObjectType.new({
    fields: {
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
        // The number of tasks with `parent.taskId` set to this task. Could be
        // determined with a search but denormalized here since we need it to render a
        // task list.
        //
        // NOCOMMIT: Update this
        childTaskCount: new OpensearchIndexIntegerType(),
        // The number of closed tasks with `parent.taskId` set to this task. Could be
        // determined with a search but denormalized here since we need it to render a
        // task list.
        //
        // NOCOMMIT: Update this
        closedChildTaskCount: new OpensearchIndexIntegerType(),

        collections: TaskIndexCollectionsType,
        notepadPages: TaskIndexNotepadPagesType,

        status: TaskIndexStatusType,
        assignee: TaskIndexAssigneeType,
        // Raw since this is a register that can independently update from `status` and
        // `assignee` but the true value depends on these fields. If `status` is closed
        // or `assignee` is null then `assigneeStatus` is always inactive. We don't
        // have a computed field with the real `assigneeStatus` since it's almost
        // always a direct copy which feels wasteful. So make sure to use
        // `rawAssigneeStatus` correctly.
        rawAssigneeStatus: TaskIndexAssigneeStatusType,

        title: TaskIndexTitleType,
        dueDate: TaskIndexDueDateType,
        priority: TaskIndexPriorityType,
    },
    computed: {
        fields: {
            isDeleted: new OpensearchIndexBooleanType({isFilterable: true, isSortable: true}),
            displayStatus: TaskIndexDisplayStatusType,
        },
        compute: task => ({
            isDeleted:
                !!task.rawDeletedTime &&
                (!task.rawUndeletedTime ||
                    compareHybridLogicalTimes(task.rawDeletedTime, task.rawUndeletedTime) > 0),

            displayStatus:
                task.status.value.type === "Closed"
                    ? ("Closed" as const)
                    : task.assignee.value && task.rawAssigneeStatus.value.type === "Active"
                    ? ("OpenActive" as const)
                    : ("OpenInactive" as const),
        }),
    },
});
