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
import {createCrdtRegisterOpensearchType} from "~/server/tasks/data/internal/create_crdt_register_opensearch_type.js";
import {
    HybridLogicalTimeType,
    SortableHybridLogicalTimeType,
} from "~/server/tasks/data/internal/hybrid_logical_time_type.js";
import {AccessPolicyRegister, AccessPolicySchema} from "~/shared/access/access_policy.js";
import {CrdtRegister} from "~/shared/crdt/crdt_register.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {initialOrderKey, isOrderKey} from "~/shared/helpers/sort/order_key.js";
import {createEnumIntegerMapping} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {decodeIdInto, encodeId, idByteLength, isId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {createSchemaLazyTransformClass} from "~/shared/schema/helpers/create_schema_lazy_transform_class.js";
import {
    HybridLogicalTimeSchema,
    serializeHybridLogicalTime,
} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    TaskDueDateRegister,
    TaskParentTaskIdRegister,
} from "~/shared/tasks/actions/task_task_action.js";
import {TaskAssigneeWithSortableAccountRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneePositionRegister} from "~/shared/tasks/task_assignee_position.js";
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
import {
    TaskLayout,
    TaskLayoutIntegerMapping,
    TaskLayoutRegister,
} from "~/shared/tasks/task_layout.js";
import {
    TaskPosition,
    TaskPositionRegister,
    TaskPositionSchema,
} from "~/shared/tasks/task_position.js";
import {TaskPositionByCollectionIdMap} from "~/shared/tasks/task_position_by_collection_id_map.js";
import {
    TaskPriority,
    TaskPriorityIntegerMapping,
    TaskPriorityRegister,
} from "~/shared/tasks/task_priority.js";
import {TaskStatus, TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {TaskTitle, getTaskTitleText} from "~/shared/tasks/title/task_title.js";

/**
 * Indexes an account and inlines the account's name and the account's
 * name version.
 *
 * We inline the account name into this object so we can sort by account
 * name. When the account name changes we run a
 * [`/:index/_search` request][1] to find all tasks we need to update.
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
            Open: cast<OpensearchIndexObjectType<{readonly closer?: undefined}, "this", {}>>(
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
            "this",
            {}
        > as OpensearchIndexTypeBase<TaskTitle, "this", {}>,
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

const TaskIndexLayoutType = createCrdtRegisterOpensearchType(
    TaskLayoutRegister,
    new OpensearchIndexByteType({
        isFilterable: true,
        isSortable: true,
    })
        .transform<TaskLayout>({
            serialize: layout => TaskLayoutIntegerMapping.into(layout),
            deserialize: layout =>
                TaskLayoutIntegerMapping.from(TaskLayoutIntegerMapping.assert(layout)),
        })
        .nullable(),
);

export type TaskIndexSearchEntityJob = SchemaType<typeof TaskIndexSearchEntityJobSchema>;

const TaskIndexSearchEntityJobSchema = Schema.object({
    sendTime: Schema.date,
    // NOTE(calebmer, 2025-01-31): Prior to this date we didn't have a generation
    // number for this object.
    generation: Schema.integer.min(0).default(0),
    // NOTE(calebmer, 2025-01-31): We used to always use 60 as the job's
    // `delaySeconds` prior to this date.
    delaySeconds: Schema.integer.default(60),
    updatedTraits: Schema.union({
        Any: Schema.object({type: Schema.value("Any")}),
        None: Schema.object({type: Schema.value("None")}),
        Some: Schema.object({
            type: Schema.value("Some"),
            traits: Schema.array(Schema.enum(["Authorization", "Title"])),
        }),
    }),
});

/**
 * The type of a document in our tasks index. Can be used to execute arbitrary
 * queries against tasks efficiently.
 *
 * This type is customized for use in `TaskRealtimeService` for representing
 * tasks in-memory. So OpenSearch bookkeeping fields have been removed. For the
 * actual type we get from OpenSearch see `TaskIndexActualDoc`.
 */
export type TaskIndexDoc = MergeObjectIntersection<
    {
        readonly id: TaskId;
    } & Omit<
        OpensearchIndexTypeType<typeof TaskIndexDocType>,
        "lastIndexSearchEntityJob" | "approximateActionCountByAccountId"
    > & {
            // This type is used throughout `TaskRealtimeService` to represent a task. It
            // should not include bookkeeping properties from OpenSearch that won't be
            // updated in-memory.
            readonly version?: undefined;
            readonly lastIndexSearchEntityJob?: undefined;
            readonly approximateActionCountByAccountId?: undefined;
        }
>;

/**
 * The actual type of a doc in the OpenSearch task index. `TaskIndexDoc` is a
 * more refined type where some OpenSearch bookkeeping has been removed.
 */
export type TaskIndexActualDoc = OpensearchIndexTypeType<typeof TaskIndexDocType>;

/**
 * Both `TaskIndexDoc` and `TaskIndexActualDoc` are assignable to this type.
 */
export type TaskIndexDocBase = Omit<
    TaskIndexActualDoc,
    "lastIndexSearchEntityJob" | "approximateActionCountByAccountId"
>;

assertAssignableTypes<TaskIndexDoc, TaskIndexDocBase>();
assertAssignableTypes<TaskIndexActualDoc, TaskIndexDocBase>();

export type TaskApproximateActionCountByAccountId = InstanceType<
    typeof TaskApproximateActionCountByAccountId
>;

export const TaskApproximateActionCountByAccountId = createSchemaLazyTransformClass<
    Uint8Array,
    ReadonlyMap<
        AccountId,
        {readonly continuousActionCount: number; readonly discreteActionCount: number}
    >
>(Schema.bytes, {
    serialize: actionCountByAccountId => {
        const bytes = new Uint8Array(actionCountByAccountId.size * (idByteLength + 8));
        const view = new DataView(bytes.buffer);

        let byteOffset = 0;
        for (const [
            accountId,
            {continuousActionCount, discreteActionCount},
        ] of actionCountByAccountId) {
            decodeIdInto(accountId, bytes, byteOffset);
            byteOffset += idByteLength;

            view.setUint32(byteOffset, continuousActionCount);
            byteOffset += 4;

            view.setUint32(byteOffset, discreteActionCount);
            byteOffset += 4;
        }

        return bytes;
    },
    deserialize: bytes => {
        const view = new DataView(bytes.buffer);
        const actionCountByAccountId = new Map<
            AccountId,
            {continuousActionCount: number; discreteActionCount: number}
        >();

        let byteOffset = 0;
        while (byteOffset + idByteLength + 8 <= bytes.byteLength) {
            const accountId = encodeId<AccountId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const continuousActionCount = view.getUint32(byteOffset);
            byteOffset += 4;

            const discreteActionCount = view.getUint32(byteOffset);
            byteOffset += 4;

            actionCountByAccountId.set(accountId, {
                continuousActionCount,
                discreteActionCount,
            });
        }

        return actionCountByAccountId;
    },
});

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

        accessPolicy: createCrdtRegisterOpensearchType(
            AccessPolicyRegister,
            new OpensearchIndexIgnoredObjectType(AccessPolicySchema),
        )
            .nullable()
            .default(null),

        collections: TaskIndexCollectionsType,

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
        // The actual value of this register on the task is null if the `AccountId` in
        // this register is different from the assignee then the value is also null.
        //
        // However, if the actual value of this register is null and the task is
        // assigned then we default the position to be based on the assignee register's
        // `version`.
        rawAssigneePosition: new OpensearchIndexIgnoredObjectType(
            Schema.object({
                value: Schema.object({
                    accountId: Schema.id<AccountId>(),
                    position: TaskPositionSchema,
                }).nullable(),
                version: HybridLogicalTimeSchema,
            }),
        )
            .transform<TaskAssigneePositionRegister>({
                serialize: register => register,
                deserialize: register =>
                    new TaskAssigneePositionRegister(register.value, register.version),
            })
            // NOTE(calebmer, 2025-03-10): This property didn't exist on tasks until this
            // date. Provide a default that can be overridden by any action.
            .default(new TaskAssigneePositionRegister(null, zeroHybridLogicalTime)),

        title: TaskIndexTitleType,
        dueDate: TaskIndexDueDateType,
        priority: TaskIndexPriorityType,

        layout: TaskIndexLayoutType
            // NOTE(calebmer, 2026-02-20): This property didn't exist on tasks until this
            // date. Represent default layout as null for old docs.
            .nullable()
            .default(null),

        /**
         * Information about the last time we sent an `IndexSearchEntity` job for this
         * `TaskIndexDoc`. Since tasks may be updated many times in quick succession we
         * want to throttle how often we reindex the task to capture many changes
         * at once.
         *
         * We throttle task notes and `TaskIndexDoc` changes separately. That's because
         * we update the data in entirely different databases. Which makes having shared
         * throttling state more difficult.
         */
        lastIndexSearchEntityJob: new OpensearchIndexIgnoredObjectType(
            TaskIndexSearchEntityJobSchema,
        ).default({
            // NOTE(calebmer): Tasks created/updated before this date did not have this
            // property. This default should cause us to always schedule new indexing jobs
            // when updating those tasks.
            sendTime: new Date("2023-12-07T16:35:04.622Z"),
            generation: 0,
            delaySeconds: 60,
            updatedTraits: {type: "Any"},
        }),

        /**
         * Keep track of the number of actions contributed by various `AccountId`s.
         * This is an approximate count since we only count an action if it changed the
         * task. So if two actions A and B update the same `dueDate` property but are
         * committed out-of-order (B then A) we only increment the action count for B,
         * not A, since A is a noop because B has a later action time.
         *
         * This is similar to `stepCountByAccountId` in the document DynamoDB table
         * except it's approximate and not exact.
         *
         * This is a simple way to determine who's contributed to the task and by
         * what amount. We split actions into two kinds. "Continuous" actions and
         * "discrete" actions. Continuous actions are ones where the user makes many
         * edits over a short period of time. For example typing in the task title.
         * Discrete actions happen once and the update is saved. For example, updating
         * the task priority.
         *
         * However, action count is only a valid measure of task contribution if you
         * assume the relative weight of each action is the same. For example, when
         * updating a task title a user could paste a lot of content in a single
         * action. Task title update actions are also throttled by network speed on the
         * client so users with a faster network count more actions. Approaches that
         * measure granular contribution of actions would be less efficient and more
         * prone to error.
         *
         * The two important things we want this field to measure are:
         *
         * 1. Everyone who contributed at least one action to the task
         * 2. Divide contributors into "primary" contributors and everyone else (e.g. a
         *    one-action contributor should be weighted less)
         *
         * It's ok to approximate for the purpose of 2.
         *
         * We serialize the map to binary. An `Id` is 128 bits in binary and 208 bits
         * in UTF-8. That means for 4kb we can fit 250 `Id`s in binary but only 153
         * `Id`s in UTF-8.
         *
         * This map was not around prior to 2024-01-02. So tasks created before
         * then (and until this deploys) will not have an accurate action count map.
         */
        approximateActionCountByAccountId: new OpensearchIndexBinaryType()
            .transform<TaskApproximateActionCountByAccountId>({
                serialize: value => value.serialize(),
                deserialize: value => TaskApproximateActionCountByAccountId.fromSerialized(value),
            })
            .default(new TaskApproximateActionCountByAccountId(new Map())),
    },
    computed: {
        fields: {
            isDeleted: new OpensearchIndexBooleanType({isFilterable: true, isSortable: true}),
            displayStatus: TaskIndexDisplayStatusType,
            assigneeStatus: TaskIndexAssigneeStatusType.nullable(),
            assigneePosition: TaskIndexPositionType.nullable(),
        },
        compute: task => {
            return {
                isDeleted: isTaskIndexDocDeleted(task),
                displayStatus: getTaskIndexDocDisplayStatus(task),
                assigneeStatus:
                    task.status.value.type === "Open" && task.assignee.value
                        ? task.rawAssigneeStatus
                        : null,
                assigneePosition: getTaskIndexDocAssigneePosition(task),
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

export function getTaskIndexDocAssigneePosition(task: {
    assignee: TaskAssigneeWithSortableAccountRegister;
    rawAssigneePosition: TaskAssigneePositionRegister;
}): TaskPosition | null {
    return task.assignee.value
        ? task.rawAssigneePosition.value?.accountId === task.assignee.value.assignee.accountId
            ? task.rawAssigneePosition.value.position
            : {orderTime: task.assignee.version, orderKey: initialOrderKey}
        : null;
}
