import {CalendarDate} from "@internationalized/date";
import {addHours, addMonths, differenceInMonths} from "date-fns";
import murmurhash from "murmurhash";
import {Step} from "prosemirror-transform";
import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSessionActionContextModules,
} from "~/server/context/server_action_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {authorizeSpaceAccess, isAccountMemberOfSpace} from "~/server/spaces/spaces_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {withSendTaskIndexSearchEntityJobIfNeeded} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc, isTaskIndexDocDeleted} from "~/server/tasks/data/task_index_doc.js";
import {CacheContextModule, ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {isVtencBigInt64SetEmpty} from "~/shared/helpers/number/vtenc_big_uint_64_set.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {decodeIdInto, encodeId, generateId, getMinId, idByteLength} from "~/shared/id/id.js";
import {
    AccountId,
    BrowserId,
    SpaceId,
    TaskActionTransactionId,
    TaskActionTransactionLeaseId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {createSchemaLazyTransformClass} from "~/shared/schema/helpers/create_schema_lazy_transform_class.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {IdByteSetSchema} from "~/shared/schema/helpers/id_byte_set_schema.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";
import {
    TaskAction,
    TaskActionSchema,
    TaskUpdateTaskAction,
    getTaskActionLabel,
} from "~/shared/tasks/actions/task_action.js";
import {TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_task_action.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {
    TaskCollectionAccessLevel,
    TaskCollectionAccessPolicy,
    TaskCollectionAccessPolicyRegister,
    hasTaskCollectionAccessLevel,
} from "~/shared/tasks/task_collection_access_policy.js";
import {
    addTaskToCollectionAffinityPoints,
    createTaskCollectionAffinityPoints,
} from "~/shared/tasks/task_collection_affinity_constants.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {
    TaskGridViewExpansionState,
    TaskGridViewExpansionStateSchema,
} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotepadPageIdCompressedSet,
    generateTaskNotepadPageId,
} from "~/shared/tasks/task_notepad_page_id.js";
import {
    TaskNotesContent,
    TaskNotesContentSchema,
    TaskNotesContentWithReferences,
    emptyTaskNotesContent,
    isTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";

/**
 * The task actions table is the canonical representation of the data in our
 * task system. Everything else is derived from task actions. We should be able
 * to rebuild any of our structures from the task actions table. When an action
 * commits to this table it has been accepted by our system and should
 * propagate to all realtime clients.
 *
 * In practice, we only end up reading the last ~24 hours of task actions as we
 * incrementally keep other databases, like OpenSearch, up-to-date. Eventually
 * we should find a way to archive old actions. We MUST keep old actions around
 * since we consider actions to be the canonical representation of data in our
 * task system but DynamoDB storage is expensive. Realistically old actions
 * are basically only accessed in disaster recovery scenarios so they can go
 * into low cost S3 storage.
 */
const TaskActionTable = DynamoTableSchema.new({
    name: "TaskActions",
    partitions: [
        {
            name: "TaskActions",
            partitionKeyAttributes: {
                /**
                 * The space who's tasks this action affected.
                 */
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "ActionTransaction",
                    sortKeyAttributes: {
                        /**
                         * The time at which the action was accepted. May be different from whatever
                         * `createdTime` or `updatedTime` is reported in the action itself.
                         */
                        committedTime: DynamoKeyAttributeSchema.date,

                        /**
                         * An `Id` for uniquely representing an action. Also used to disambiguate
                         * actions with identical `committedTime`s.
                         */
                        actionTransactionId: DynamoKeyAttributeSchema.id<TaskActionTransactionId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * Actions which should always be atomically applied together.
                         */
                        actions: Schema.array(TaskActionSchema),

                        /**
                         * Has this action transaction been processed? To consider an action
                         * transaction processed we must have:
                         *
                         * 1. Indexed the transaction in OpenSearch
                         * 2. Applied the transaction on all relevant task realtime servers
                         *
                         * We maintain an index of all actions across all spaces that haven't been
                         * processed so we can retry if necessary.
                         */
                        wasProcessed: Schema.boolean,

                        /**
                         * The account who committed this action.
                         *
                         * Nullable since action transactions before 2023-01-02 did not save
                         * the `actorId`.
                         */
                        actorId: Schema.id<AccountId>().nullable().default(null),

                        /**
                         * An optional identifier provided by the client who committed this action.
                         */
                        clientId: Schema.id<TaskRealtimeClientId>().nullable().default(null),
                    }),
                },
            ],
        },
    ],
});

// Allow querying unprocessed action transactions across all spaces.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const UnprocessedActionTransactionsIndex = TaskActionTable.addIndex({
    name: "UnprocessedActionTransactions",
    itemTypes: [{partitionType: "TaskActions", sortRangeType: "ActionTransaction"}],
    partitionKeyAttributes: {
        wasProcessed: DynamoKeyAttributeSchema.boolean,
    },
    sortKeyAttributes: {
        committedTime: DynamoKeyAttributeSchema.date,
    },
    filter: item => !item.wasProcessed,
});

const TaskStatusTypeRegister = createCrdtRegister(
    Schema.enum<TaskStatus["type"]>(["Open", "Closed"]),
);

const TaskAssigneeAccountIdRegister = createCrdtRegister(Schema.id<AccountId>().nullable());

export type TaskStepCountByAccountId = InstanceType<typeof TaskStepCountByAccountId>;

export const TaskStepCountByAccountId = createSchemaLazyTransformClass<
    Uint8Array,
    ReadonlyMap<AccountId, number>
>(Schema.bytes, {
    serialize: stepCountByAccountId => {
        const bytes = new Uint8Array(stepCountByAccountId.size * (idByteLength + 4));
        const view = new DataView(bytes.buffer);

        let byteOffset = 0;
        for (const [accountId, stepCount] of stepCountByAccountId) {
            decodeIdInto(accountId, bytes, byteOffset);
            byteOffset += idByteLength;

            view.setUint32(byteOffset, stepCount);
            byteOffset += 4;
        }

        return bytes;
    },
    deserialize: bytes => {
        const view = new DataView(bytes.buffer);
        const stepCountByAccountId = new Map<AccountId, number>();

        let byteOffset = 0;
        while (byteOffset + idByteLength + 4 <= bytes.byteLength) {
            const accountId = encodeId<AccountId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const stepCount = view.getUint32(byteOffset);
            byteOffset += 4;

            stepCountByAccountId.set(accountId, stepCount);
        }

        return stepCountByAccountId;
    },
});

/**
 * Data related to tasks. Contains some views of task actions (e.g. the
 * `EssentialAttributes` items) and some data unrelated to task fields which
 * don't participate in querying (like notes, comments, revision history).
 */
const TaskTable = DynamoTableSchema.new({
    name: "Tasks",
    partitions: [
        {
            name: "Account",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Notepad",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        pageIds: TaskNotepadPageIdCompressedSet.schema,
                    }),
                },

                /**
                 * The collection affinity system helps us know what collections are most
                 * important to an account. When an account takes actions against a collection
                 * they add points to their affinity score for that collection. We apply an
                 * [exponential decay][1] function to the account's affinity score. If they
                 * stop interacting with one collection and start interacting with another then
                 * the new collection should have a higher affinity score. We round scores of
                 * less than <0.05 to zero. That gives 1 point 3 months (a quarter) to decay.
                 * When a score reaches zero it's expired and we can remove it from our table
                 * to save storage space.
                 *
                 * This system is definitely more art than science and should be tweaked over
                 * time. Eventually we also want an account affinity score (so we know who an
                 * account's "friends" are) and affinity scores for all kinds of other things.
                 * We prioritized affinity scores for collections because we anticipate many
                 * collections will be created in a space and we need a way to make them
                 * manageable.
                 *
                 * [1]: https://en.wikipedia.org/wiki/Exponential_decay#Natural_sciences
                 */
                // TODO(calebmer): Get rid of custom task collection affinity and search and replace
                // with our search system.
                {
                    name: "TaskCollectionAffinity",
                    sortKeyAttributes: {
                        collectionId: DynamoKeyAttributeSchema.id<TaskCollectionId>(),
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        /**
                         * The number of affinity points this account has.
                         */
                        points: Schema.float,

                        /**
                         * The last time we updated `points`. Used to determine how much decay we need
                         * to apply to `points`.
                         */
                        lastUpdatedTime: Schema.integer,
                    }),
                },

                /**
                 * When an account performs an action that causes them to lose access to some
                 * task, we grant them temporary permission to execute some actions that will
                 * undo that change in case they made a mistake. The account's permission to do
                 * so is represented by a "lease". Given the ability to take action on a task
                 * you no longer have access to is powerful in the hands of an attacker, leases
                 * have the following restrictions:
                 *
                 * 1. You must be allowed to commit the actions at the time the lease is created
                 * 2. Leases live for a short time (<1 day)
                 * 3. If another account updates a task you have a lease for, your lease is
                 *    invalidated
                 *
                 * ## Creating a lease
                 *
                 * You create a lease alongside some other action transaction you're trying to
                 * commit. For efficiency, we only create the lease if the action transaction
                 * you're committing causes the action transaction you're leasing to not be
                 * allowed. If you don't _need_ a lease, we don't bother creating one.
                 *
                 * The client only asks to create a lease if the task it's updating leaves its
                 * view. Then it tries to create a lease with the action transaction that
                 * caused the task to leave.
                 *
                 * We don't check that the actions you're leasing are an inversion of the
                 * actions you're committing (even though that's what we expect from the
                 * client). If an attack provides an unrelated set of actions that's ok. Leases
                 * extend how long you can commit actions that were valid at the time of lease
                 * creation. So actions must be safe when leased in the first place.
                 *
                 * ## Why restriction 3?
                 *
                 * Updating a task in any way invalidates any lease currently held on
                 * the task. Example attack this protects against:
                 *
                 * 1. Manager assigns a task to their report asking them to fill out their
                 *    performance self review
                 * 2. Report fills out the self review section and assigns it back to the
                 *    manager (creating a lease to add them back as the assignee)
                 * 3. After the manager fills out their notes, the report executes the lease.
                 *    Bringing the task back to them so they can see the private notes.
                 *
                 * By invalidating a lease after an update sophisticated users can't do this
                 * attack.
                 *
                 * In principle, a user could be allowed to permanently view a task at the
                 * moment they lost access. Since a user could trivially copy the task down to
                 * their computer while they have access. However a user is not allowed to see
                 * new updates after they lose access. (In practice, a user can see updates
                 * until `WebSocketServer` reauthorizes their WebSocket connection which may
                 * take a couple minutes.) Invalidating leases prevents the user from seeing
                 * new updates after they lose access.
                 *
                 * (In the example attack we propose, a regular user could still add the task
                 * to a private collection of theirs to retain access, this is expected. This
                 * case shouldn't weaken our security posture elsewhere. We may need protection
                 * against retaining access with a private collection someday.)
                 */
                {
                    name: "TaskActionTransactionLease",
                    sortKeyAttributes: {
                        leaseId: DynamoKeyAttributeSchema.id<TaskActionTransactionLeaseId>(),
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        actions: Schema.array(TaskActionSchema),
                    }),
                },
            ],
        },
        {
            name: "TaskCollection",
            partitionKeyAttributes: {
                collectionId: DynamoKeyAttributeSchema.id<TaskCollectionId>(),
            },
            sortRanges: [
                {
                    name: "EssentialAttributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        createdTime: HybridLogicalTimeSchema,

                        /**
                         * The account who created this collection. Unlike tasks, the `creatorId` does
                         * not influence permissions. Only the `accessPolicy` influences permissions.
                         * The collection creator may lose access if they are removed from the
                         * `accessPolicy`.
                         */
                        creatorId: Schema.id<AccountId>().nullable().default(null),

                        // We keep track of both `rawDeletedTime` and `rawUndeletedTime` for our
                        // collection in DynamoDB so we can create a full `TaskCollectionModel`. The
                        // collection is considered deleted if `rawDeletedTime` is null or
                        // `rawUndeletedTime` is larger than `rawDeletedTime`.
                        rawDeletedTime: HybridLogicalTimeSchema.nullable(),
                        rawUndeletedTime: HybridLogicalTimeSchema.nullable(),

                        // We include the `name` and `color` of our collection in its
                        // `EssentialAttributes` since we load the `EssentialAttributes` object to
                        // render searched collections.
                        name: LabelStringRegister.schema,
                        color: TaskCollectionColorRegister.schema,

                        /**
                         * Who is allowed to access the collection and with what permission
                         * level.
                         */
                        accessPolicy: TaskCollectionAccessPolicyRegister.schema,

                        /**
                         * The total number of tasks in the collection. Open and closed. Not
                         * including deleted tasks.
                         *
                         * Doesn't use the same `addedChildTaskCount`/`removedChildTaskCount` format
                         * as a task since these numbers aren't shared over realtime (since they would
                         * update so frequently). Though if we wanted to migrate to that format it
                         * should be pretty easy: rename this property to `addedTaskCount` and add a
                         * `removedTaskCount` property that defaults to 0.
                         */
                        taskCount: Schema.integer,

                        /**
                         * The number of open tasks in the collection. Not including deleted tasks. You
                         * can figure out the number of closed tasks with `taskCount - openTaskCount`.
                         */
                        openTaskCount: Schema.integer,

                        /**
                         * The last time a task was added to this collection.
                         *
                         * We present this to users as the task's last updated time.
                         *
                         * Unfortunately, DynamoDB doesn't have a `max()` function in update
                         * expressions so we can't update this perfectly atomically. This value may not
                         * monotonically go forwards and instead temporarily go backwards if we commit
                         * an action with an older time than an action we previously committed.
                         */
                        lastTaskAddedTime: HybridLogicalTimeSchema.nullable(),
                    }),
                },
            ],
        },
        {
            name: "Task",
            partitionKeyAttributes: {
                taskId: DynamoKeyAttributeSchema.id<TaskId>(),
            },
            sortRanges: [
                {
                    name: "EssentialAttributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * The account who created this task. The creator of a task always has edit
                         * level permission to the task.
                         */
                        creatorId: Schema.id<AccountId>(),

                        /**
                         * The time this task was created.
                         */
                        createdTime: HybridLogicalTimeSchema,

                        /**
                         * The time this task was deleted. We keep a record of deleted tasks so they
                         * may be undeleted. It's critical to check this property when looking at task
                         * items so you know whether it's been deleted or not.
                         */
                        deletedTime: HybridLogicalTimeSchema.nullable(),

                        /**
                         * The status of this task. Either `Open` or `Closed`.
                         */
                        statusType: TaskStatusTypeRegister.schema,

                        /**
                         * The parent of this task.
                         *
                         * ## Permissions
                         *
                         * We inherit permissions from this task. So if you have edit access to the
                         * parent task then you also have edit access to this task.
                         *
                         * You may have broader permissions to a child task. For example, you can edit
                         * a child task but not its parent task. Or view a child task but not its
                         * parent task.
                         *
                         * ## Parent deletion
                         *
                         * When a parent task is deleted we don't update the `parentTaskId` attribute
                         * of child tasks. You must be careful to check that the `parentTaskId` task
                         * actually exists and is not deleted. We leave gravestones around for deleted
                         * tasks so you should always be able to find a task object even if it's
                         * deleted.
                         *
                         * If the parent task is undeleted the child task is again unaffected.
                         *
                         * ## Depth and circular dependency restrictions
                         *
                         * There is no restriction on how deep you can nest child tasks.
                         *
                         * Task circular dependencies are not allowed. Though clients may temporarily
                         * have circular dependencies. This is because:
                         *
                         * - Task actions may be applied out-of-order
                         * - We may not load the entire task parent hierarchy so we won't know to
                         *   reject an operation that creates a circular dependency
                         *
                         * So clients should be careful not to crash on circular dependencies. However,
                         * a canonical task representation will never have circular dependencies.
                         *
                         * There may also be items in this table that have a circular dependency
                         * because deleted tasks do not count in a dependency chain. If you are
                         * iterating through a parent task chain, make sure to `break` if you see a
                         * deleted parent task.
                         */
                        parentTaskId: TaskParentTaskIdRegister.schema,

                        // See the documentation of `TaskUpdateChildrenCountsAction` for more
                        // information.
                        addedChildTaskCount: Schema.integer,
                        removedChildTaskCount: Schema.integer,
                        addedClosedChildTaskCount: Schema.integer,
                        removedClosedChildTaskCount: Schema.integer,

                        /**
                         * All of this task's current children.
                         *
                         * Stored in binary since that's much more space efficient than storing as
                         * strings. 1kb (used by 1 WCU) costs ~64 128 bit `Id`s.
                         *
                         * Unlike `addedChildTaskCount` these are our current child tasks. If a child
                         * task is removed then we remove it from the set. If a child task is deleted
                         * it stays in the set, though.
                         */
                        childTaskIds: IdByteSetSchema.get<TaskId>(),

                        /**
                         * The collections this task is a part of. A task inherits the highest access
                         * level from its collections.
                         */
                        collections: TaskCollectionSet.schema,

                        /**
                         * The account which was assigned this task.
                         */
                        assigneeId: TaskAssigneeAccountIdRegister.schema,

                        /**
                         * Leases are valid as long as the task is unmodified. This is how we keep
                         * track of that. When we create a lease it's set here. When the task is
                         * modified this is set to null.
                         */
                        validLeaseId: Schema.id<TaskActionTransactionLeaseId>()
                            .nullable()
                            .default(null),
                    }),
                },

                /**
                 * All queryable task data is updated through `TaskAction`s and indexed in
                 * OpenSearch. Task notes are a freeform, collaborative, text area that's not
                 * queryable. We store task notes in DynamoDB which is a completely separate
                 * read/write path for task notes to avoid paying the storage cost of putting
                 * notes in OpenSearch and the load cost of frequent writes on
                 * `TaskRealtimeService`.
                 *
                 * Reading and writing task notes needs basically the same implementation as
                 * document content. However, since we expect task notes to be shorter, less
                 * collaborative, and unlikely to be edited after they're initially written
                 * we're going for a simpler implementation of realtime content editing.
                 *
                 * A notable difference between this collaborative content implementation and
                 * our document collaborative content implementation is we don't keep track of
                 * all steps ever applied to the task. Since we don't care about showing a full
                 * content version history for task notes (like we want to show for documents).
                 * We do want to have a task activity feed but that's a separate system.
                 *
                 * Using Y.js would be nice. However, Y.js replaces the whole document whenever
                 * a change occurs which doesn't play nice with [ProseMirror decorations and
                 * other plugins][1]. Having a single collaborative framework to deal with for
                 * `<ContentEditor>` simplifies developing out our editor.
                 *
                 * [1]: https://discuss.prosemirror.net/t/offline-peer-to-peer-collaborative-editing-using-yjs/2488/5
                 */
                {
                    name: "Notes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The space the task is in. Copied from our `EssentialAttributes` item to
                         * avoid an extra fetch when we just need the `SpaceId`.
                         */
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * The current content version. Keeps track of the number of steps taken
                         * against this content.
                         */
                        version: Schema.integer,

                        /**
                         * The current notes content.
                         */
                        content: TaskNotesContentSchema,

                        /**
                         * Keep track of the number of steps contributed by various `AccountId`s after
                         * `version` 0. Excluding steps contributed by `creatorId`. You can compute
                         * `creatorId`'s `stepCount` by adding all step counts in this map then
                         * subtracting that from `version`.
                         *
                         * This is a simple way to determine who's contributed to the task and by
                         * what amount. However, this is only a valid measure of the amount each
                         * account has contributed assuming the relative added content size of each
                         * step is the same. It's possible an account pastes a lot of content and
                         * that's only counted as one step. Approaches of measuring contribution that
                         * take pastes into effect would be less efficient and more prone to error.
                         *
                         * We serialize the map to binary. An `Id` is 128 bits in binary and 208 bits
                         * in UTF-8. That means for one 4kb DynamoDB read unit we can fit 250 `Id`s in
                         * binary but only 153 `Id`s in UTF-8.
                         *
                         * This map was not around prior to 2024-01-01. So documents created before
                         * then (and until this deploys) will not have an accurate step count map. All
                         * steps will be counted towards the `creatorId`.
                         *
                         * You can add this to the `continuousActionCount` property of
                         * `approximateActionCountByAccountId` to get an overall relative measure of
                         * contribution for the task.
                         */
                        stepCountByAccountId: TaskStepCountByAccountId.schema.default(
                            new TaskStepCountByAccountId(new Map()),
                        ),
                    }),
                },
            ],
        },
        {
            name: "TaskGridViewExpansionState",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                browserId: DynamoKeyAttributeSchema.id<BrowserId>(),
                viewKey: DynamoKeyAttributeSchema.labelString,
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        // Store state as a string in DynamoDB to get around DynamoDB's object nesting
                        // limits since this is a recursive data type. (Ideally binary someday.)
                        state: Schema.unknown.transform<TaskGridViewExpansionState>({
                            serialize: state =>
                                JSON.stringify(TaskGridViewExpansionStateSchema.serialize(state)),
                            deserialize: state =>
                                typeof state === "string"
                                    ? TaskGridViewExpansionStateSchema.deserialize(
                                          JSON.parse(state),
                                      )
                                    : TaskGridViewExpansionStateSchema.deserialize(state),
                        }),
                    }),
                },
            ],
        },
    ],
});

type TaskActionTransactionItem = DynamoTableItemType<
    typeof TaskActionTable,
    "TaskActions",
    "ActionTransaction"
>;

type TaskAccountNotepadItem = DynamoTableItemType<typeof TaskTable, "Account", "Notepad">;

type TaskAccountActionTransactionLeaseItem = DynamoTableItemType<
    typeof TaskTable,
    "Account",
    "TaskActionTransactionLease"
>;

export type TaskEssentialAttributesItem = DynamoTableItemType<
    typeof TaskTable,
    "Task",
    "EssentialAttributes"
>;

type TaskEssentialAttributesItemBase = Omit<
    TaskEssentialAttributesItem,
    "childTaskIds" | "validLeaseId"
>;

export type TaskCollectionEssentialAttributesItem = DynamoTableItemType<
    typeof TaskTable,
    "TaskCollection",
    "EssentialAttributes"
>;

type TaskCollectionEssentialAttributesItemBase = Omit<
    TaskCollectionEssentialAttributesItem,
    "taskCount" | "openTaskCount" | "lastTaskAddedTime"
>;

type TaskNotesItem = DynamoTableItemType<typeof TaskTable, "Task", "Notes">;

/**
 * Scan every task and task collection in our database. Use when
 * migrating data.
 */
export async function* expensiveScanEveryTaskAndTaskCollectionForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<
    | {type: "Task"; spaceId: SpaceId; taskId: TaskId}
    | {type: "TaskCollection"; spaceId: SpaceId; collectionId: TaskCollectionId}
> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    for await (const item of TaskTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Task", sortRangeType: "EssentialAttributes"},
            {partitionType: "TaskCollection", sortRangeType: "EssentialAttributes"},
        ],
    })) {
        if (item.partitionType === "Task") {
            if (item.sortRangeType !== "EssentialAttributes") continue;
            yield {type: "Task", spaceId: item.spaceId, taskId: item.taskId};
        } else if (item.partitionType === "TaskCollection") {
            if (item.sortRangeType !== "EssentialAttributes") continue;
            yield {type: "TaskCollection", spaceId: item.spaceId, collectionId: item.collectionId};
        }
    }
}

/**
 * Get the item representing a task in unit tests.
 */
export async function getTaskItemForTest(
    context: DynamoContext,
    taskId: TaskId,
): Promise<TaskEssentialAttributesItem> {
    assert(import.meta.jest);

    return TaskTable.getItem(context, {
        partitionType: "Task",
        sortRangeType: "EssentialAttributes",
        taskId,
    });
}

/**
 * Get the item representing a task collection in unit tests.
 */
export async function getTaskCollectionItemForTest(
    context: DynamoContext,
    collectionId: TaskCollectionId,
): Promise<TaskCollectionEssentialAttributesItem> {
    assert(import.meta.jest);

    return TaskTable.getItem(context, {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId,
    });
}

function isTaskCollectionItemDeleted(
    collectionItem: Pick<
        TaskCollectionEssentialAttributesItem,
        "rawDeletedTime" | "rawUndeletedTime"
    >,
): boolean {
    return (
        !!collectionItem.rawDeletedTime &&
        (!collectionItem.rawUndeletedTime ||
            compareHybridLogicalTimes(
                collectionItem.rawDeletedTime,
                collectionItem.rawUndeletedTime,
            ) > 0)
    );
}

export const commitTaskActionTransactionBeforeExecuteTestCheckpoint =
    new TestCheckpoint<AccountId>();

/**
 * Allow tests to subscribe to committed action transactions
 */
export const afterCommitTaskActionTransactionEventEmitterForTest = import.meta.jest
    ? new EventEmitter<{
          spaceId: SpaceId;
          committedTime: Date;
          actions: ReadonlyArray<TaskAction>;
          clientId: TaskRealtimeClientId | null;
          processPromise: Promise<void>;
      }>()
    : null;

/**
 * Commit a transaction of `TaskAction`s. Authorizes that each action is
 * valid before committing it.
 *
 * When actions are applied to some view they are commutative and idempotent.
 * That means you can apply them in any order and you can apply them multiple
 * times. However, this function is not commutative and idempotent.
 *
 * To successfully commit an action you need to be allowed to modify the data
 * specified in the action. This means committing actions depends on the
 * current state, hence this function can't be commutative.
 *
 * However, because we implement authorization here it means once an action is
 * committed any downstream consumers don't need to factor in authorization
 * rules at all. Downstream consumers can apply actions in any order (thanks to
 * their commutative property) multiple times (thanks to their idempotent
 * property).
 */
export function commitTaskActionTransaction(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    spaceId: SpaceId,
    actions: ReadonlyArray<TaskAction>,
    options: {
        clientId?: TaskRealtimeClientId | null;
        leaseId?: TaskActionTransactionLeaseId;
        createLeaseIfLostAccess?: {
            id: TaskActionTransactionLeaseId;
            actions: ReadonlyArray<TaskUpdateTaskAction>;
        };
        withoutAddingAffinityPoints?: boolean;
    } = {},
): Promise<{
    extraActions: ReadonlyArray<TaskAction>;
}> {
    return context.tracer.withSpan("Commit task action transaction", async (context, span) => {
        span.addData({
            tasks: {
                actions: actions.map(getTaskActionLabel).join(","),
                actionCount: actions.length,
            },
        });

        const {actionTransactionItem, extraActions} = await TaskActionTransactionCommitState.commit(
            context,
            spaceId,
            actions,
            options,
        );

        span.addData({
            tasks: {
                actionTransactionId: actionTransactionItem.actionTransactionId,
            },
        });

        // Make sure we include extra actions in our `TracerSpan` if there were any.
        if (actionTransactionItem.actions.length > 0) {
            span.addData({
                tasks: {
                    actions: actionTransactionItem.actions.map(getTaskActionLabel).join(","),
                    actionCount: actionTransactionItem.actions.length,
                },
            });
        }

        const {processPromise} = afterCommitTaskActionTransaction(context, actionTransactionItem);

        // Update relevant affinity scores.
        //
        // Unlike `afterCommitTaskActionTransaction()` the updates we make here are not
        // idempotent. It's also not essential that we make these updates. If the
        // process crashes it doesn't really matter to users that affinity scores don't
        // update. Whereas it's critical we eventually index actions in OpenSearch.
        //
        // So we don't put this logic in `afterCommitTaskActionTransaction()` and
        // instead call `context.process.waitUntil()` directly.
        // `afterCommitTaskActionTransaction()` is reserved for idempotent, critical,
        // work.
        if (!options.withoutAddingAffinityPoints) {
            const addAffinityPointsByCollectionId = new Map<TaskCollectionId, number>();

            for (const action of actions) {
                if (action.type === "UpdateTask" && action.taskAction.type === "AddCollection") {
                    addAffinityPointsByCollectionId.set(
                        action.taskAction.collectionId,
                        (addAffinityPointsByCollectionId.get(action.taskAction.collectionId) ?? 0) +
                            addTaskToCollectionAffinityPoints,
                    );
                }

                if (
                    action.type === "UpdateCollection" &&
                    action.collectionAction.type === "Create"
                ) {
                    addAffinityPointsByCollectionId.set(
                        action.collectionId,
                        (addAffinityPointsByCollectionId.get(action.collectionId) ?? 0) +
                            createTaskCollectionAffinityPoints,
                    );
                }
            }

            for (const [collectionId, addAffinityPoints] of addAffinityPointsByCollectionId) {
                context.process.waitUntil(
                    addTaskCollectionAffinityPoints(context, {
                        spaceId,
                        collectionId,
                        points: addAffinityPoints,
                    }),
                );
            }
        }

        // Try and wait until the transaction is processed before returning to the
        // client. We only wait up to 100ms then let the transaction processing
        // finish in the background.
        //
        // Given the client only sends one `commitTaskActionTransaction()` request at a
        // time, this helps reduce conflicts when indexing many sequential actions on
        // the same task (e.g. from typing in the title). And helps other users
        // connected to realtime see these actions in the same order they were made.
        await Promise.race([processPromise.catch(() => {}), wait(100)]);

        return {extraActions};
    });
}

function afterCommitTaskActionTransaction(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    actionTransactionItem: TaskActionTransactionItem,
) {
    const processPromise = context.tracer.withSpan(
        "Process task action transaction",
        async (context, span) => {
            span.addData({
                tasks: {
                    actions: actionTransactionItem.actions.map(getTaskActionLabel).join(","),
                    actionCount: actionTransactionItem.actions.length,
                    actionTransactionId: actionTransactionItem.actionTransactionId,
                },
            });

            // Process the action transaction in the background.
            //
            // TODO(calebmer): We need some way to recover if processing fails! Right now
            // maybe we can rely on a manual process where we look at the database for
            // unprocessed transactions and manually retry them. However, it's important
            // actions are processed in a timely manner so we should have some service
            // that's constantly querying the `TaskActions` table and retrying transactions
            // that are taking a while to process.
            await context.tasks.processActionTransactionAfterCommit(actionTransactionItem);

            // Once we've finished processing, flip the `wasProcessed` flag to true which
            // will also remove this transaction from our unprocessed transactions index.
            await TaskActionTable.createOrReplaceItem(context, {
                ...actionTransactionItem,
                wasProcessed: true,
            });
        },
    );

    context.process.waitUntil(processPromise);

    afterCommitTaskActionTransactionEventEmitterForTest?.emit({
        spaceId: actionTransactionItem.spaceId,
        committedTime: actionTransactionItem.committedTime,
        actions: actionTransactionItem.actions,
        clientId: actionTransactionItem.clientId,
        processPromise,
    });

    return {processPromise};
}

const taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression =
    "SET updateLockVersion = if_not_exists(updateLockVersion, :zero) + :one, taskCount = taskCount + :taskCountDelta, openTaskCount = openTaskCount + :openTaskCountDelta";

/**
 * Abstraction for managing state during a `commitTaskActionTransaction()`
 * call. A task may be updated multiple times within a transaction so we need
 * to keep track of previous writes and return them if another action in the
 * transaction attempts to read again.
 */
class TaskActionTransactionCommitState {
    private readonly _context: ServerSessionActionContext;
    private readonly _spaceId: SpaceId;
    private readonly _leaseId: TaskActionTransactionLeaseId | null;
    private _startTime = Date.now();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByTaskId = new Map<
        TaskId,
        {
            action: "CreateItem" | "DirectlyUpdateItem" | "DirectlyUpdateItemLockVersion";
            taskItem: TaskEssentialAttributesItem;
            shouldCommitExtraUpdateChildrenCountAction: boolean;
        }
    >();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByCollectionId = new Map<
        TaskCollectionId,
        | {action: "CreateItem"; collectionItem: TaskCollectionEssentialAttributesItem}
        | {action: "DirectlyUpdateItem"; collectionItem: TaskCollectionEssentialAttributesItem}
        | {
              action: "AtomicallyUpdateItemAttributes";
              taskCountDelta: number;
              openTaskCountDelta: number;
              lastTaskAddedTime: HybridLogicalTime | null;
          }
    >();

    private _actorNotepadItemTransactionEntry: TaskAccountNotepadItem | null = null;

    private readonly _actionTransactionLeaseTransactionEntries: Array<TaskAccountActionTransactionLeaseItem> =
        [];

    private readonly _taskItemById = new Map<TaskId, Promise<TaskEssentialAttributesItem | null>>();
    private readonly _collectionItemById = new Map<
        TaskCollectionId,
        Promise<TaskCollectionEssentialAttributesItem | null>
    >();
    private _actorNotepadItemPromise: Promise<TaskAccountNotepadItem> | null = null;

    private constructor(
        context: ServerSessionActionContext,
        {spaceId, leaseId}: {spaceId: SpaceId; leaseId: TaskActionTransactionLeaseId | null},
    ) {
        this._context = context;
        this._spaceId = spaceId;
        this._leaseId = leaseId;
    }

    public static commit(
        context: ServerSessionActionContext,
        spaceId: SpaceId,
        actions: ReadonlyArray<TaskAction>,
        {
            clientId = null,
            leaseId = null,
            createLeaseIfLostAccess,
        }: {
            clientId?: TaskRealtimeClientId | null;
            leaseId?: TaskActionTransactionLeaseId | null;
            createLeaseIfLostAccess?: {
                id: TaskActionTransactionLeaseId;
                actions: ReadonlyArray<TaskUpdateTaskAction>;
            };
        },
    ): Promise<{
        actionTransactionItem: TaskActionTransactionItem;
        extraActions: ReadonlyArray<TaskAction>;
    }> {
        return context.dynamo.retryTransaction(async context => {
            await authorizeSpaceAccess(context, spaceId);

            if (!actions[0]) {
                throw new InvalidArgumentError("Must commit at least one action");
            }

            // If the actor is trying to use a lease to authorize their action transaction,
            // make sure the lease is valid before continuing.
            if (leaseId !== null) {
                const leaseItem = await TaskTable.getItemIfExists(context, {
                    partitionType: "Account",
                    sortRangeType: "TaskActionTransactionLease",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                    leaseId,
                });

                // If we can't find the lease we attempt to commit without it.
                //
                // - The lease may have expired. In that case the user should get an
                //   authorization failure.
                // - The client may have asked us to create a lease but we detected they don't
                //   need one so we didn't create a lease.
                if (!leaseItem || leaseItem.expirationTime.getTime() < Date.now()) {
                    leaseId = null;
                } else {
                    if (
                        !isDeepEqual(
                            actions.map(action =>
                                omitObject(TaskActionSchema.serialize(action), ["time"]),
                            ),
                            leaseItem.actions.map(action =>
                                omitObject(TaskActionSchema.serialize(action), ["time"]),
                            ),
                        )
                    ) {
                        throw new PermissionDeniedError(
                            "When using a lease, actions must exactly match the previously leased actions (excluding time)",
                        );
                    }
                }
            }

            const state = new TaskActionTransactionCommitState(context, {spaceId, leaseId});
            await state._prepareCommit(actions);

            if (createLeaseIfLostAccess) {
                // The client tries to create a lease when a task leaves its view. If the
                // actions that cause the task to leave would cause the undo actions to fail
                // then we create a lease.
                //
                // This is an optimization. All the data needed to execute this should be
                // cached. Allows us to avoid creating leases when they're unnecessary.
                let hasLostAccess = false;
                try {
                    const forkedState = state._fork();
                    await forkedState._prepareCommit(createLeaseIfLostAccess.actions);
                } catch (error) {
                    if (error instanceof PermissionDeniedError) {
                        hasLostAccess = true;
                    } else {
                        throw error;
                    }
                }

                if (hasLostAccess) {
                    // Create a new state object and make sure we're allowed to commit the actions
                    // we want a lease for BEFORE the actions that cause us to lose access.
                    const testState = new TaskActionTransactionCommitState(context, {
                        spaceId,
                        leaseId: null,
                    });
                    try {
                        await testState._prepareCommit(createLeaseIfLostAccess.actions);
                    } catch (error) {
                        if (error instanceof PermissionDeniedError) {
                            throw PermissionDeniedError.from(error, "Couldn't apply lease actions");
                        } else {
                            throw error;
                        }
                    }

                    // Mark our lease as valid for all tasks in the transaction...
                    await runAllPromises(
                        createLeaseIfLostAccess.actions.map(async leaseAction => {
                            const task = await state.getTaskItem(leaseAction.taskId);

                            state.updateTaskItem({
                                ...task,
                                validLeaseId: createLeaseIfLostAccess.id,
                            });
                        }),
                    );

                    state._actionTransactionLeaseTransactionEntries.push({
                        partitionType: "Account",
                        sortRangeType: "TaskActionTransactionLease",
                        spaceId,
                        accountId: context.actor.getAccountId(),
                        leaseId: createLeaseIfLostAccess.id,
                        actions: createLeaseIfLostAccess.actions,
                        // Leases have a short expiration time. You may not use a lease after
                        // two hours.
                        expirationTime: addHours(new Date(state._startTime), 2),
                    });
                }
            }

            return state._applyCommit(actions, {clientId});
        });
    }

    private async _prepareCommit(actions: ReadonlyArray<TaskAction>): Promise<void> {
        await actuallyCommitTaskActionTransaction(this, this._spaceId, actions);
    }

    private async _applyCommit(
        actions: ReadonlyArray<TaskAction>,
        {clientId}: {clientId: TaskRealtimeClientId | null},
    ) {
        let maxActionTime = actions[0]!.time;
        for (let i = 1; i < actions.length; i++) {
            maxActionTime = maxHybridLogicalTime(maxActionTime, actions[i]!.time);
        }

        const transactionEntries: Array<DynamoTransactionEntry> = [];
        const extraActions: Array<TaskAction> = [];

        for (const transactionEntry of this._transactionEntryByTaskId.values()) {
            switch (transactionEntry.action) {
                case "CreateItem": {
                    transactionEntries.push(
                        TaskTable.transactionCreateItem(transactionEntry.taskItem),
                    );
                    break;
                }
                case "DirectlyUpdateItem": {
                    transactionEntries.push(
                        TaskTable.transactionDirectlyUpdateItem(transactionEntry.taskItem),
                    );
                    break;
                }
                case "DirectlyUpdateItemLockVersion": {
                    transactionEntries.push(
                        TaskTable.transactionDirectlyUpdateItemLockVersion(
                            transactionEntry.taskItem,
                            transactionEntry.taskItem.updateLockVersion,
                        ),
                    );
                    break;
                }
                default:
                    throw exhaustive(transactionEntry.action);
            }

            // If children counts were updated then we want to commit an extra action with
            // the authoritative child counts so all other clients have the correct
            // children count.
            if (transactionEntry.shouldCommitExtraUpdateChildrenCountAction) {
                extraActions.push({
                    type: "UpdateTask",
                    // For our extra action's time, add a tick to the max action time.
                    time: [maxActionTime[0], maxActionTime[1] + 1],
                    taskId: transactionEntry.taskItem.taskId,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: transactionEntry.taskItem.addedChildTaskCount,
                        removedChildTaskCount: transactionEntry.taskItem.removedChildTaskCount,
                        addedClosedChildTaskCount:
                            transactionEntry.taskItem.addedClosedChildTaskCount,
                        removedClosedChildTaskCount:
                            transactionEntry.taskItem.removedClosedChildTaskCount,
                    },
                });
            }
        }

        for (const [collectionId, transactionEntry] of this._transactionEntryByCollectionId) {
            switch (transactionEntry.action) {
                case "CreateItem": {
                    transactionEntries.push(
                        TaskTable.transactionCreateItem(transactionEntry.collectionItem),
                    );
                    break;
                }
                case "DirectlyUpdateItem": {
                    transactionEntries.push(
                        TaskTable.transactionDirectlyUpdateItem(transactionEntry.collectionItem),
                    );
                    break;
                }
                case "AtomicallyUpdateItemAttributes": {
                    const updateExpression =
                        taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression +
                        (transactionEntry.lastTaskAddedTime
                            ? ", lastTaskAddedTime = :lastTaskAddedTime"
                            : "");

                    const expressionAttributeValues: {[key: string]: SchemaSerializedValue} = {
                        ":zero": 0,
                        ":one": 1,
                        ":taskCountDelta": transactionEntry.taskCountDelta,
                        ":openTaskCountDelta": transactionEntry.openTaskCountDelta,
                    };

                    if (transactionEntry.lastTaskAddedTime) {
                        expressionAttributeValues[":lastTaskAddedTime"] =
                            HybridLogicalTimeSchema.serialize(transactionEntry.lastTaskAddedTime);
                    }

                    transactionEntries.push(
                        // We use a custom atomic update expression to update our collection without:
                        //
                        // 1. Needing to read the current collection item (costing additional RCUs)
                        // 2. Creating condition expression conflicts with other updates on the task
                        //    collection
                        TaskTable.dangerousTransactionUpdateItemWithCustomUpdateExpression(
                            {
                                partitionType: "TaskCollection",
                                sortRangeType: "EssentialAttributes",
                                collectionId,
                            },
                            {
                                updateExpression,
                                expressionAttributeValues,
                            },
                        ),
                    );
                    break;
                }
                default:
                    throw exhaustive(transactionEntry);
            }
        }

        if (this._actorNotepadItemTransactionEntry) {
            transactionEntries.push(
                TaskTable.transactionDirectlyUpdateItem(this._actorNotepadItemTransactionEntry),
            );
        }

        for (const transactionEntry of this._actionTransactionLeaseTransactionEntries) {
            transactionEntries.push(TaskTable.transactionCreateItem(transactionEntry));
        }

        await commitTaskActionTransactionBeforeExecuteTestCheckpoint.waitForTest(
            this._context.actor.getAccountId(),
        );

        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId: this._spaceId,
            committedTime: new Date(),
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [...actions, ...extraActions],
            wasProcessed: false,
            actorId: this._context.actor.getAccountId(),
            clientId,
        };

        if (transactionEntries.length > 0) {
            transactionEntries.push(
                TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem),
            );

            await DynamoTableSchema.executeTransaction(this._context, transactionEntries);
        } else {
            await TaskActionTable.createOrReplaceItem(this._context, actionTransactionItem);
        }

        return {
            actionTransactionItem,
            extraActions,
        };
    }

    /**
     * Fork this commit state object so you can attempt to prepare more actions
     * based on the updates we've already made to the state without affecting the
     * original state's committed data.
     */
    private _fork() {
        const newState = new TaskActionTransactionCommitState(this._context, {
            spaceId: this._spaceId,
            // The forked state does not inherit the lease. It must authorize on its own.
            leaseId: null,
        });
        newState._startTime = this._startTime;

        for (const [taskId, taskItem] of this._taskItemById) {
            newState._taskItemById.set(taskId, taskItem);
        }

        for (const [collectionId, collectionItem] of this._collectionItemById) {
            newState._collectionItemById.set(collectionId, collectionItem);
        }

        newState._actorNotepadItemPromise = this._actorNotepadItemPromise;

        return newState;
    }

    public getActorAccountId(): AccountId {
        return this._context.actor.getAccountId();
    }

    public isAccountMemberOfSpace(accountId: AccountId): Promise<boolean> {
        return isAccountMemberOfSpace(this._context, this._spaceId, accountId);
    }

    /**
     * Clients specify change times for various properties and we use change times
     * to resolve conflicting updates. Clients may specify a change time at any
     * point in the past (maybe they are syncing offline updates) but they may not
     * specify a change time too far in the future.
     *
     * We provide some wiggle room to account for clock skew. It's required that
     * clients use NTP to get a time (through our `/api/time` route implemented in
     * `EdgeService`) that's consistent with other clients instead of relying on
     * the device clock.
     */
    public isTimeReasonable(time: number): boolean {
        return time - this._startTime < 1000 * 60 * 2;
    }

    public getTaskItemIfExists(taskId: TaskId): Promise<TaskEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._taskItemById, taskId, async () => {
            const taskItem = await TaskTable.getItemIfExists(this._context, {
                partitionType: "Task",
                sortRangeType: "EssentialAttributes",
                taskId,
            });
            if (!taskItem) return null;

            if (taskItem.spaceId !== this._spaceId)
                throw new FailedPreconditionError("Space mismatch");

            return taskItem;
        });
    }

    public async getTaskItem(taskId: TaskId): Promise<TaskEssentialAttributesItem> {
        const taskItem = await this.getTaskItemIfExists(taskId);

        // Internal error since we should keep a record of even deleted tasks.
        if (!taskItem) throw new InternalError("Task not found");

        return taskItem;
    }

    public createTaskItem(taskItem: TaskEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "CreateItem" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
                break;
            case "DirectlyUpdateItem":
            case "DirectlyUpdateItemLockVersion":
                throw new FailedPreconditionError("Can't update a task before it's created");
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
        this._taskItemById.set(taskItem.taskId, Promise.resolve(taskItem));
    }

    public updateTaskItem(
        taskItem: TaskEssentialAttributesItem,
        {
            shouldCommitExtraUpdateChildrenCountAction = false,
        }: {
            // If set to true then we will add an `UpdateChildrenCount` action to the end
            // of the current transaction before committing.
            shouldCommitExtraUpdateChildrenCountAction?: boolean;
        } = {},
    ) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "DirectlyUpdateItem" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        transactionEntry.shouldCommitExtraUpdateChildrenCountAction ||=
            shouldCommitExtraUpdateChildrenCountAction;

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem":
                break;
            case "DirectlyUpdateItemLockVersion":
                transactionEntry.action = "DirectlyUpdateItem";
                break;
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
        this._taskItemById.set(taskItem.taskId, Promise.resolve(taskItem));
    }

    public updateTaskItemLockVersion(taskItem: TaskEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "DirectlyUpdateItemLockVersion" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem":
            case "DirectlyUpdateItemLockVersion":
                break;
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
    }

    /**
     * If the action time was more than an hour in the past then we don't set it as
     * the new `lastTaskAddedTime` since it would look like the last update time
     * was skipping backwards since we can't run `max()` in a DynamoDB update
     * expression.
     */
    private _isCollectionLastTaskAddedTimeReasonable(time: HybridLogicalTime) {
        return this._startTime - time[0] < 1000 * 60;
    }

    private _applyCollectionUpdateItemAttributes(
        collectionItem: TaskCollectionEssentialAttributesItem,
        {
            taskCountDelta,
            openTaskCountDelta,
            lastTaskAddedTime,
        }: {
            taskCountDelta: number;
            openTaskCountDelta: number;
            lastTaskAddedTime: HybridLogicalTime | null;
        },
    ): TaskCollectionEssentialAttributesItem {
        return {
            ...collectionItem,
            taskCount: collectionItem.taskCount + taskCountDelta,
            openTaskCount: collectionItem.openTaskCount + openTaskCountDelta,
            lastTaskAddedTime:
                lastTaskAddedTime &&
                this._isCollectionLastTaskAddedTimeReasonable(lastTaskAddedTime)
                    ? lastTaskAddedTime
                    : collectionItem.lastTaskAddedTime,
        };
    }

    public getCollectionItemIfExists(
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._collectionItemById, collectionId, async () => {
            let collectionItem = await TaskTable.getItemIfExists(this._context, {
                partitionType: "TaskCollection",
                sortRangeType: "EssentialAttributes",
                collectionId,
            });
            if (!collectionItem) return null;

            if (collectionItem.spaceId !== this._spaceId)
                throw new FailedPreconditionError("Space mismatch");

            // If we have an atomic update transaction entry, we need to apply it when the
            // collection is loaded. Since we can't put an entry in `collectionItemById`
            // when the update is applied.
            const transactionEntry = this._transactionEntryByCollectionId.get(collectionId);
            if (transactionEntry?.action === "AtomicallyUpdateItemAttributes") {
                collectionItem = this._applyCollectionUpdateItemAttributes(
                    collectionItem,
                    transactionEntry,
                );
            }

            return collectionItem;
        });
    }

    public async getCollectionItem(
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem> {
        const collectionItem = await this.getCollectionItemIfExists(collectionId);

        // Internal error since we should keep a record of even deleted tasks.
        if (!collectionItem) throw new InternalError("Task collection not found");

        return collectionItem;
    }

    public createCollectionItem(collectionItem: TaskCollectionEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionItem.collectionId,
            () => ({
                collectionItem,
                action: "CreateItem" as const,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
                break;
            case "DirectlyUpdateItem":
            case "AtomicallyUpdateItemAttributes":
                throw new FailedPreconditionError("Can't update a collection before it's created");
            default:
                throw exhaustive(transactionEntry);
        }

        if (transactionEntry.collectionItem.updateLockVersion !== collectionItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.collectionItem = collectionItem;
        this._collectionItemById.set(collectionItem.collectionId, Promise.resolve(collectionItem));
    }

    public updateCollectionItem(collectionItem: TaskCollectionEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionItem.collectionId,
            () => ({
                action: "DirectlyUpdateItem" as const,
                collectionItem,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem": {
                if (
                    transactionEntry.collectionItem.updateLockVersion !==
                    collectionItem.updateLockVersion
                ) {
                    throw new InternalError(
                        "`updateLockVersion` should only change after we commit to the database",
                    );
                }

                transactionEntry.collectionItem = collectionItem;
                break;
            }
            case "AtomicallyUpdateItemAttributes": {
                // We don't need to apply atomic updates here since they should have already
                // been applied when the calling code read the collection from our state.

                this._transactionEntryByCollectionId.set(collectionItem.collectionId, {
                    action: "DirectlyUpdateItem",
                    collectionItem,
                });
                break;
            }
            default:
                throw exhaustive(transactionEntry);
        }

        this._collectionItemById.set(collectionItem.collectionId, Promise.resolve(collectionItem));
    }

    public updateCollectionItemAttributes(
        collectionId: TaskCollectionId,
        update: {
            taskCountDelta: number;
            openTaskCountDelta: number;
            lastTaskAddedTime: HybridLogicalTime | null;
        },
    ) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionId,
            () => ({
                action: "AtomicallyUpdateItemAttributes" as const,
                taskCountDelta: 0,
                openTaskCountDelta: 0,
                lastTaskAddedTime: null,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem": {
                transactionEntry.collectionItem = this._applyCollectionUpdateItemAttributes(
                    transactionEntry.collectionItem,
                    update,
                );

                this._collectionItemById.set(
                    collectionId,
                    Promise.resolve(transactionEntry.collectionItem),
                );
                break;
            }
            case "AtomicallyUpdateItemAttributes": {
                transactionEntry.taskCountDelta += update.taskCountDelta;
                transactionEntry.openTaskCountDelta += update.openTaskCountDelta;
                transactionEntry.lastTaskAddedTime =
                    update.lastTaskAddedTime &&
                    this._isCollectionLastTaskAddedTimeReasonable(update.lastTaskAddedTime)
                        ? update.lastTaskAddedTime
                        : transactionEntry.lastTaskAddedTime;

                // If a collection item has been loaded then we need to apply our update to
                // that item.
                const collectionItemPromise = this._collectionItemById.get(collectionId);
                if (collectionItemPromise) {
                    this._collectionItemById.set(
                        collectionId,
                        collectionItemPromise.then(collectionItem =>
                            collectionItem
                                ? this._applyCollectionUpdateItemAttributes(collectionItem, update)
                                : null,
                        ),
                    );
                }
                break;
            }
            default:
                throw exhaustive(transactionEntry);
        }
    }

    public getActorNotepadItem(): Promise<TaskAccountNotepadItem> {
        if (this._actorNotepadItemPromise === null) {
            this._actorNotepadItemPromise = (async () => {
                let notepadPagesItem = await TaskTable.getItemIfExists(this._context, {
                    partitionType: "Account",
                    sortRangeType: "Notepad",
                    accountId: this._context.actor.getAccountId(),
                    spaceId: this._spaceId,
                });

                notepadPagesItem ??= {
                    partitionType: "Account",
                    sortRangeType: "Notepad",
                    accountId: this._context.actor.getAccountId(),
                    spaceId: this._spaceId,
                    pageIds: new TaskNotepadPageIdCompressedSet(new Set()),
                };

                return notepadPagesItem;
            })();
        }

        return this._actorNotepadItemPromise;
    }

    public updateActorNotepadItem(notepadItem: TaskAccountNotepadItem) {
        assert(notepadItem.accountId === this._context.actor.getAccountId());
        assert(notepadItem.spaceId === this._spaceId);

        this._actorNotepadItemPromise = Promise.resolve(notepadItem);
        this._actorNotepadItemTransactionEntry = notepadItem;
    }

    public evaluateCollectionAccessPolicy(
        accessPolicy: TaskCollectionAccessPolicy,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        return evaluateTaskCollectionAccessPolicy(
            this._context,
            this._context.actor.getAccountId(),
            this._spaceId,
            accessPolicy,
            expectedAccessLevel,
        );
    }

    public async authorizeCollectionAccess(
        collectionId: TaskCollectionId,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        const collectionItem = await this.getCollectionItem(collectionId);

        const hasAccess = await isTaskCollectionItemAccessAuthorized(
            this._context,
            this._context.actor.getAccountId(),
            collectionItem,
            expectedAccessLevel,
        );

        if (!hasAccess) {
            throw new PermissionDeniedError(
                quote`Actor does not have ${expectedAccessLevel} access level to task collection`,
                {
                    displayMessage: getTaskCollectionItemPermissionDeniedErrorDisplayMessage(
                        collectionItem,
                        expectedAccessLevel,
                    ),
                },
            );
        }
    }

    public async authorizeCollectionAccessAllowingDeletedCollections(
        collectionId: TaskCollectionId,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        const collectionItem = await this.getCollectionItem(collectionId);

        const hasAccess = await isTaskCollectionItemAccessAuthorizedAllowingDeletedTasks(
            this._context,
            this._context.actor.getAccountId(),
            collectionItem,
            expectedAccessLevel,
        );

        if (!hasAccess) {
            throw new PermissionDeniedError(
                quote`Actor does not have ${expectedAccessLevel} access level to task collection`,
                {
                    displayMessage: getTaskCollectionItemPermissionDeniedErrorDisplayMessage(
                        collectionItem,
                        expectedAccessLevel,
                    ),
                },
            );
        }
    }

    public async authorizeTaskItemAccess(
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        // If we are using a lease and the lease is valid for this task, skip
        // authorization. The lease allows us to take otherwise disallowed actions.
        if (this._leaseId !== null && this._leaseId === taskItem.validLeaseId) return;

        const hasAccess = await isTaskItemAccessAuthorized(
            this._context,
            this._context.actor.getAccountId(),
            taskItem,
            expectedAccessLevel,
            this,
        );

        if (!hasAccess) {
            throw new PermissionDeniedError(
                quote`Actor does not have ${expectedAccessLevel} access level to task`,
                {
                    displayMessage: getTaskItemPermissionDeniedErrorDisplayMessage(
                        taskItem,
                        expectedAccessLevel,
                    ),
                },
            );
        }
    }

    public async authorizeTaskItemAccessAllowingDeletedTasks(
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        // If we are using a lease and the lease is valid for this task, skip
        // authorization. The lease allows us to take otherwise disallowed actions.
        if (this._leaseId !== null && this._leaseId === taskItem.validLeaseId) return;

        const hasAccess = await isTaskItemAccessAuthorizedAllowingDeletedTasks(
            this._context,
            this._context.actor.getAccountId(),
            taskItem,
            expectedAccessLevel,
            this,
        );

        if (!hasAccess) {
            throw new PermissionDeniedError(
                quote`Actor does not have ${expectedAccessLevel} access level to task`,
                {
                    displayMessage: getTaskItemPermissionDeniedErrorDisplayMessage(
                        taskItem,
                        expectedAccessLevel,
                    ),
                },
            );
        }
    }
}

const circularTaskDependencyErrorDisplayMessage = errorDisplayMessage`Can’t move a task to the subtasks of one of its own subtasks. Check your task’s subtasks and try removing the one you want to move your task into.`;

async function actuallyCommitTaskActionTransaction(
    // We intentionally don't pass in `context` since we want all DynamoDB access
    // to go through this `state` object. That way we force reads to go through our
    // local cache.
    state: TaskActionTransactionCommitState,
    spaceId: SpaceId,
    actionTransaction: ReadonlyArray<TaskAction>,
) {
    for (const action of actionTransaction) {
        // Make sure our action time isn't too far in the future. That would mean
        // future updates all need to use the `ticks` property of `HybridLogicalTime`
        // and couldn't express the update time with a real time.
        if (!state.isTimeReasonable(action.time[0])) {
            throw new InvalidArgumentError("Action time too far in the future");
        }

        switch (action.type) {
            case "UpdateTask": {
                const {taskId, taskAction} = action;

                switch (taskAction.type) {
                    case "Create": {
                        if (taskAction.creatorId !== state.getActorAccountId()) {
                            throw new PermissionDeniedError(
                                "Can only create a task with yourself as the creator",
                            );
                        }

                        state.createTaskItem({
                            partitionType: "Task",
                            sortRangeType: "EssentialAttributes",
                            taskId,
                            spaceId,
                            creatorId: taskAction.creatorId,
                            createdTime: action.time,
                            deletedTime: null,
                            statusType: new TaskStatusTypeRegister("Open", action.time),
                            parentTaskId: new TaskParentTaskIdRegister(null, action.time),
                            addedChildTaskCount: 0,
                            removedChildTaskCount: 0,
                            addedClosedChildTaskCount: 0,
                            removedClosedChildTaskCount: 0,
                            childTaskIds: new Set(),
                            collections: TaskCollectionSet.empty,
                            assigneeId: new TaskAssigneeAccountIdRegister(null, action.time),
                            validLeaseId: null,
                        });
                        break;
                    }
                    case "Undelete": {
                        const taskItem = await state.getTaskItemIfExists(taskId);
                        if (!taskItem) throw new NotFoundError("Task not found");
                        if (!taskItem.deletedTime)
                            throw new FailedPreconditionError("Expected task to be deleted");

                        await state.authorizeTaskItemAccessAllowingDeletedTasks(taskItem, "Edit");

                        if (compareHybridLogicalTimes(action.time, taskItem.deletedTime) <= 0) {
                            throw new FailedPreconditionError(
                                "Undelete action time is less than delete action time",
                            );
                        }

                        const seenTaskIds = new Set([taskItem.taskId]);
                        let currentParentTaskItem = taskItem;

                        while (currentParentTaskItem.parentTaskId.value !== null) {
                            // We don't allow task circular dependencies which would cause infinite
                            // looping. Deleted tasks break the circular dependency chain. So a circular
                            // dependency may exist involving a deleted task. When we undelete, we need to
                            // make sure it doesn't create a circular dependency.
                            if (seenTaskIds.has(currentParentTaskItem.parentTaskId.value)) {
                                throw new FailedPreconditionError(
                                    "Undeleting task would create a circular dependency",
                                    {
                                        // NOTE(calebmer): Ideally the error message would have a hint. This error case
                                        // seems pretty rare. I'd want to know what the UI of this looks like to write
                                        // an appropriate hint. (e.g. Can you see the old parent task?)
                                        displayMessage: errorDisplayMessage`Undoing task deletion would make the task its own subtask.`,
                                    },
                                );
                            }

                            const nextParentTaskItem = await state.getTaskItem(
                                currentParentTaskItem.parentTaskId.value,
                            );

                            // Deleted tasks do not participate in circular dependencies.
                            if (nextParentTaskItem.deletedTime) break;

                            seenTaskIds.add(nextParentTaskItem.taskId);
                            currentParentTaskItem = nextParentTaskItem;
                        }

                        // Force updates to a root task's subtask tree to be serialized. That way race
                        // conditions can't sneak a circular dependency in.
                        state.updateTaskItemLockVersion(currentParentTaskItem);

                        state.updateTaskItem({
                            ...taskItem,
                            deletedTime: null,
                            // Invalidate any leases on this task now that another user has updated it.
                            validLeaseId: null,
                        });

                        if (taskItem.parentTaskId.value !== null) {
                            // May be cached from authorization...
                            const parentTaskItem = await state.getTaskItem(
                                taskItem.parentTaskId.value,
                            );

                            state.updateTaskItem(
                                {
                                    ...parentTaskItem,
                                    addedChildTaskCount: parentTaskItem.addedChildTaskCount + 1,
                                    addedClosedChildTaskCount:
                                        parentTaskItem.addedClosedChildTaskCount +
                                        (taskItem.statusType.value === "Closed" ? 1 : 0),
                                },
                                {shouldCommitExtraUpdateChildrenCountAction: true},
                            );
                        }

                        for (const {collectionId} of taskItem.collections.getArray()) {
                            state.updateCollectionItemAttributes(collectionId, {
                                taskCountDelta: 1,
                                openTaskCountDelta: taskItem.statusType.value === "Open" ? 1 : 0,
                                lastTaskAddedTime: action.time,
                            });
                        }
                        break;
                    }
                    default: {
                        const initialTaskItem = await state.getTaskItemIfExists(taskId);
                        if (!initialTaskItem) throw new NotFoundError("Task not found");
                        let taskItem = initialTaskItem;
                        if (taskItem.deletedTime)
                            throw new FailedPreconditionError("Task was deleted");

                        await state.authorizeTaskItemAccess(taskItem, "Edit");

                        if (taskItem.validLeaseId !== null) {
                            taskItem = {
                                ...taskItem,
                                // Invalidate any leases on this task now that another user has updated it.
                                validLeaseId: null,
                            };
                            state.updateTaskItem(taskItem);
                        }

                        switch (taskAction.type) {
                            case "Delete": {
                                if (
                                    compareHybridLogicalTimes(action.time, taskItem.createdTime) <=
                                    0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    deletedTime: action.time,
                                });

                                if (taskItem.parentTaskId.value !== null) {
                                    // May be cached from authorization...
                                    const parentTaskItem = await state.getTaskItem(
                                        taskItem.parentTaskId.value,
                                    );

                                    state.updateTaskItem(
                                        {
                                            ...parentTaskItem,
                                            removedChildTaskCount:
                                                parentTaskItem.removedChildTaskCount + 1,
                                            removedClosedChildTaskCount:
                                                parentTaskItem.removedClosedChildTaskCount +
                                                (taskItem.statusType.value === "Closed" ? 1 : 0),
                                        },
                                        {shouldCommitExtraUpdateChildrenCountAction: true},
                                    );
                                }

                                for (const {collectionId} of taskItem.collections.getArray()) {
                                    state.updateCollectionItemAttributes(collectionId, {
                                        taskCountDelta: -1,
                                        openTaskCountDelta:
                                            taskItem.statusType.value === "Open" ? -1 : 0,
                                        lastTaskAddedTime: null,
                                    });
                                }
                                break;
                            }
                            case "UpdateParentTaskId": {
                                if (
                                    taskAction.parentPosition &&
                                    !state.isTimeReasonable(taskAction.parentPosition.orderTime[0])
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                // We want to prevent the creation of cycles even during race conditions. So we
                                // call `updateTaskItemLockVersion()` on critical parent tasks that can't
                                // update without us knowing about it. We call this method on:
                                //
                                // 1. The root parent task in the new parent task chain
                                // 2. The root parent task in the old parent task chain
                                //
                                // This has the effect of forcing any change to subtask structure under a root
                                // task to be committed serially. If the root task itself is made the subtask
                                // of some other task than that update too must be serialized with changes to
                                // its subtask structure. By serializing updates to subtask structure we can
                                // make sure no circular dependencies are introduced.
                                await runAllPromiseThunks(
                                    // Authorize new parent `TaskId`:
                                    async () => {
                                        if (taskAction.parentTaskId === null) return;

                                        if (taskId === taskAction.parentTaskId) {
                                            throw new FailedPreconditionError(
                                                "Updating task's `parentTaskId` would create a circular dependency",
                                                {
                                                    displayMessage:
                                                        circularTaskDependencyErrorDisplayMessage,
                                                },
                                            );
                                        }

                                        const newParentTaskItem = await state.getTaskItemIfExists(
                                            taskAction.parentTaskId,
                                        );
                                        if (!newParentTaskItem)
                                            throw new NotFoundError("Parent task not found");
                                        if (newParentTaskItem.deletedTime)
                                            throw new FailedPreconditionError(
                                                "Parent task is deleted",
                                            );

                                        // Make sure we have edit access to the parent task in order to make this task
                                        // a child of it.
                                        await state.authorizeTaskItemAccess(
                                            newParentTaskItem,
                                            "Edit",
                                        );

                                        const seenTaskIds = new Set([
                                            taskId,
                                            newParentTaskItem.taskId,
                                        ]);
                                        let currentNewParentTaskItem = newParentTaskItem;

                                        while (
                                            currentNewParentTaskItem.parentTaskId.value !== null
                                        ) {
                                            // We don't allow task circular dependencies which would cause infinite
                                            // looping. If we see that updating our `parentTaskId` would create a circular
                                            // dependency then error.
                                            if (
                                                seenTaskIds.has(
                                                    currentNewParentTaskItem.parentTaskId.value,
                                                )
                                            ) {
                                                throw new FailedPreconditionError(
                                                    "Updating task's `parentTaskId` would create a circular dependency",
                                                    {
                                                        displayMessage:
                                                            circularTaskDependencyErrorDisplayMessage,
                                                    },
                                                );
                                            }

                                            // Parent task loading may be cached by our `authorizeTaskItemAccess()`
                                            // call earlier.
                                            const nextNewParentTaskItem = await state.getTaskItem(
                                                currentNewParentTaskItem.parentTaskId.value,
                                            );

                                            // Deleted tasks do not participate in circular dependencies.
                                            if (nextNewParentTaskItem.deletedTime) break;

                                            seenTaskIds.add(nextNewParentTaskItem.taskId);
                                            currentNewParentTaskItem = nextNewParentTaskItem;
                                        }

                                        // Force updates to a root task's subtask tree to be serialized. That way race
                                        // conditions can't sneak a circular dependency in.
                                        state.updateTaskItemLockVersion(currentNewParentTaskItem);
                                    },
                                    // Authorize old parent `TaskId`:
                                    async () => {
                                        if (taskItem.parentTaskId.value === null) return;

                                        const oldParentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );
                                        if (oldParentTaskItem.deletedTime) return;

                                        // We allow you to change the parent of a task you have edit access to even if
                                        // you don't have access to the _current_ parent task. This is because we also
                                        // allow you to delete tasks even when you don't have access to the current
                                        // parent task. That operation will remove a child task from a parent task so
                                        // it follows a user is allowed to remove tasks they have access to from
                                        // unknown parents.
                                        //
                                        // Should we allow deleting a task when you don't have access to the parent?
                                        // Arguably not. But it's hard to explain a restriction like that in the UI and
                                        // the restriction is not too bad if we explain it in the revision feed.
                                        //
                                        // TODO(calebmer): When we add revision history, deleting or changing the
                                        // parent of a child task should add a revision history entry to the parent
                                        // task. That way a user who has access to the child but not the parent can
                                        // have their changes audited.

                                        let currentOldParentTaskItem = oldParentTaskItem;

                                        while (
                                            currentOldParentTaskItem.parentTaskId.value !== null
                                        ) {
                                            const nextOldParentTaskItem = await state.getTaskItem(
                                                currentOldParentTaskItem.parentTaskId.value,
                                            );

                                            // Deleted tasks do not participate in circular dependencies.
                                            if (nextOldParentTaskItem.deletedTime) break;

                                            currentOldParentTaskItem = nextOldParentTaskItem;
                                        }

                                        // Force updates to a root task's subtask tree to be serialized. That way race
                                        // conditions can't sneak a circular dependency in.
                                        state.updateTaskItemLockVersion(currentOldParentTaskItem);
                                    },
                                );

                                const oldParentTaskId = taskItem.parentTaskId;
                                const newParentTaskId = oldParentTaskId.apply({
                                    value: taskAction.parentTaskId,
                                    version: action.time,
                                });

                                state.updateTaskItem({
                                    ...taskItem,
                                    parentTaskId: newParentTaskId.apply({
                                        value: taskAction.parentTaskId,
                                        version: action.time,
                                    }),
                                });

                                // If the parent task changed then increment our counters such that we remove
                                // our task from the old parent and add our task to the new parent.
                                if (oldParentTaskId.value !== newParentTaskId.value) {
                                    await runAllPromiseThunks(
                                        async () => {
                                            if (oldParentTaskId.value === null) return;

                                            // Should be cached from authorization...
                                            const oldParentTaskItem = await state.getTaskItem(
                                                oldParentTaskId.value,
                                            );

                                            const oldParentChildTaskIds = new Set(
                                                oldParentTaskItem.childTaskIds,
                                            );
                                            oldParentChildTaskIds.delete(taskItem.taskId);

                                            state.updateTaskItem(
                                                {
                                                    ...oldParentTaskItem,
                                                    removedChildTaskCount:
                                                        oldParentTaskItem.removedChildTaskCount + 1,
                                                    removedClosedChildTaskCount:
                                                        oldParentTaskItem.removedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
                                                    childTaskIds: oldParentChildTaskIds,
                                                },
                                                {shouldCommitExtraUpdateChildrenCountAction: true},
                                            );
                                        },
                                        async () => {
                                            if (newParentTaskId.value === null) return;

                                            // Should be cached from authorization...
                                            const newParentTaskItem = await state.getTaskItem(
                                                newParentTaskId.value,
                                            );

                                            const newParentChildTaskIds = new Set(
                                                newParentTaskItem.childTaskIds,
                                            );
                                            newParentChildTaskIds.add(taskItem.taskId);

                                            state.updateTaskItem(
                                                {
                                                    ...newParentTaskItem,
                                                    addedChildTaskCount:
                                                        newParentTaskItem.addedChildTaskCount + 1,
                                                    addedClosedChildTaskCount:
                                                        newParentTaskItem.addedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
                                                    childTaskIds: newParentChildTaskIds,
                                                },
                                                {shouldCommitExtraUpdateChildrenCountAction: true},
                                            );
                                        },
                                    );
                                }
                                break;
                            }
                            case "UpdateParentPosition": {
                                if (
                                    !state.isTimeReasonable(taskAction.parentPosition.orderTime[0])
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskItem.parentTaskId.value === null) {
                                    throw new FailedPreconditionError(
                                        "Task does not have a parent",
                                    );
                                }

                                const parentTaskItem = await state.getTaskItem(
                                    taskItem.parentTaskId.value,
                                );
                                if (parentTaskItem.deletedTime)
                                    throw new FailedPreconditionError("Parent task is deleted");

                                // Make sure we have edit access to the parent task. The order key is more-so a
                                // property of the parent task than it is a property of our task.
                                await state.authorizeTaskItemAccess(parentTaskItem, "Edit");
                                break;
                            }
                            case "UpdateChildrenCounts": {
                                // These actions may only be generated by the server.
                                //
                                // See the documentation on `TaskUpdateChildrenCountsAction` for more
                                // information on why this isn't allowed.
                                throw new InvalidArgumentError(
                                    "Clients are not allowed to commit an `UpdateChildrenCounts` action",
                                );
                            }
                            case "AddCollection": {
                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );

                                state.updateTaskItem({
                                    ...taskItem,
                                    collections: taskItem.collections.apply({
                                        type: "Set",
                                        key: taskAction.collectionId,
                                        value: taskAction.orderKey,
                                        version: action.time,
                                    }),
                                });

                                state.updateCollectionItemAttributes(taskAction.collectionId, {
                                    taskCountDelta: 1,
                                    openTaskCountDelta:
                                        taskItem.statusType.value === "Open" ? 1 : 0,
                                    lastTaskAddedTime: action.time,
                                });
                                break;
                            }
                            case "RemoveCollection": {
                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );

                                state.updateTaskItem({
                                    ...taskItem,
                                    collections: taskItem.collections.apply({
                                        type: "Delete",
                                        key: taskAction.collectionId,
                                        version: action.time,
                                    }),
                                });

                                state.updateCollectionItemAttributes(taskAction.collectionId, {
                                    taskCountDelta: -1,
                                    openTaskCountDelta:
                                        taskItem.statusType.value === "Open" ? -1 : 0,
                                    lastTaskAddedTime: null,
                                });
                                break;
                            }
                            case "UpdateCollectionPosition": {
                                if (!state.isTimeReasonable(taskAction.position.orderTime[0])) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (!taskItem.collections.has(taskAction.collectionId)) {
                                    throw new FailedPreconditionError("Task is not in collection");
                                }

                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );
                                break;
                            }
                            case "UpdateNotepadPagePosition": {
                                if (
                                    taskAction.position &&
                                    !state.isTimeReasonable(taskAction.position.orderTime[0])
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskAction.accountId !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Can only access your account's notepad",
                                    );
                                }

                                if (taskItem.creatorId !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Can only add tasks you created to your account's notepad",
                                    );
                                }
                                break;
                            }
                            case "UpdateStatus": {
                                if (
                                    taskAction.status.type === "Closed" &&
                                    !state.isTimeReasonable(
                                        taskAction.status.closedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `closedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.status.type === "Closed" &&
                                    taskAction.status.closerId !== state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only close a task with yourself as the closer",
                                    );
                                }

                                if (
                                    taskAction.assigneeStatus?.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }

                                const oldStatusType = taskItem.statusType;

                                const newStatusType = oldStatusType.apply({
                                    value: taskAction.status.type,
                                    version: action.time,
                                });

                                state.updateTaskItem({
                                    ...taskItem,
                                    statusType: newStatusType,
                                });

                                if (taskItem.parentTaskId.value !== null) {
                                    if (
                                        oldStatusType.value !== "Closed" &&
                                        newStatusType.value === "Closed"
                                    ) {
                                        // May be cached from authorization...
                                        const parentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        state.updateTaskItem(
                                            {
                                                ...parentTaskItem,
                                                addedClosedChildTaskCount:
                                                    parentTaskItem.addedClosedChildTaskCount + 1,
                                            },
                                            {shouldCommitExtraUpdateChildrenCountAction: true},
                                        );
                                    }

                                    if (
                                        oldStatusType.value === "Closed" &&
                                        newStatusType.value !== "Closed"
                                    ) {
                                        // May be cached from authorization...
                                        const parentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        state.updateTaskItem(
                                            {
                                                ...parentTaskItem,
                                                removedClosedChildTaskCount:
                                                    parentTaskItem.removedClosedChildTaskCount + 1,
                                            },
                                            {shouldCommitExtraUpdateChildrenCountAction: true},
                                        );
                                    }
                                }

                                for (const {collectionId} of taskItem.collections.getArray()) {
                                    if (
                                        oldStatusType.value !== "Closed" &&
                                        newStatusType.value === "Closed"
                                    ) {
                                        state.updateCollectionItemAttributes(collectionId, {
                                            taskCountDelta: 0,
                                            openTaskCountDelta: -1,
                                            lastTaskAddedTime: null,
                                        });
                                    }

                                    if (
                                        oldStatusType.value === "Closed" &&
                                        newStatusType.value !== "Closed"
                                    ) {
                                        state.updateCollectionItemAttributes(collectionId, {
                                            taskCountDelta: 0,
                                            openTaskCountDelta: 1,
                                            lastTaskAddedTime: null,
                                        });
                                    }
                                }
                                break;
                            }
                            case "UpdateAssignee": {
                                if (
                                    taskAction.assignee &&
                                    !state.isTimeReasonable(
                                        taskAction.assignee.assignedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `assignedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.assignee &&
                                    taskAction.assignee.assignerId !== state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only assign a task with yourself as the assigner",
                                    );
                                }

                                if (
                                    taskAction.assignee &&
                                    !(await state.isAccountMemberOfSpace(
                                        taskAction.assignee.assigneeId,
                                    ))
                                ) {
                                    throw new FailedPreconditionError(
                                        "Can't assign a task to an account outside of the current space",
                                    );
                                }

                                if (
                                    taskAction.assigneeStatus?.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    assigneeId: taskItem.assigneeId.apply({
                                        value: taskAction.assignee?.assigneeId ?? null,
                                        version: action.time,
                                    }),
                                });
                                break;
                            }
                            case "UpdateAssigneeStatus": {
                                if (
                                    taskAction.assigneeStatus.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }
                                break;
                            }
                            case "UpdateAssigneeActivePosition": {
                                if (!state.isTimeReasonable(taskAction.position.orderTime[0])) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskItem.assigneeId.value !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Can only update the task's active position if you are the task's assignee",
                                    );
                                }

                                if (taskAction.accountId !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Must use the actor `AccountId` when updating the task's active position",
                                    );
                                }
                                break;
                            }
                            case "UpdateTitle": {
                                // Y.js uses Lamport timestamps which we don't need to validate for
                                // reasonableness.
                                break;
                            }
                            case "UpdateDueDate": {
                                // We don't store due date in essential attributes and action time
                                // is validated above.
                                break;
                            }
                            case "UpdatePriority": {
                                // We don't store priority in essential attributes and action time
                                // is validated above.
                                break;
                            }
                            default:
                                throw exhaustive(taskAction);
                        }
                    }
                }
                break;
            }
            case "UpdateCollection": {
                const {collectionId, collectionAction} = action;

                switch (collectionAction.type) {
                    case "Create": {
                        if (collectionAction.creatorId !== state.getActorAccountId()) {
                            throw new PermissionDeniedError(
                                "Can only create a collection with yourself as the creator",
                            );
                        }

                        const newCollectionItem: TaskCollectionEssentialAttributesItem = {
                            partitionType: "TaskCollection",
                            sortRangeType: "EssentialAttributes",
                            collectionId,
                            spaceId,
                            createdTime: action.time,
                            creatorId: collectionAction.creatorId,
                            rawDeletedTime: null,
                            rawUndeletedTime: null,
                            name: new LabelStringRegister(collectionAction.name, action.time),
                            color: new TaskCollectionColorRegister(null, action.time),
                            accessPolicy: new TaskCollectionAccessPolicyRegister(
                                collectionAction.accessPolicy,
                                action.time,
                            ),
                            taskCount: 0,
                            openTaskCount: 0,
                            lastTaskAddedTime: null,
                        };

                        if (
                            !(await state.evaluateCollectionAccessPolicy(
                                newCollectionItem.accessPolicy.value,
                                "Manage",
                            ))
                        ) {
                            throw new InvalidArgumentError(
                                'Must have the "Manage" access level on a collection you create',
                            );
                        }

                        state.createCollectionItem(newCollectionItem);
                        break;
                    }
                    case "Undelete": {
                        const collectionItem = await state.getCollectionItemIfExists(collectionId);
                        if (!collectionItem) throw new NotFoundError("Task collection not found");
                        if (!isTaskCollectionItemDeleted(collectionItem))
                            throw new FailedPreconditionError("Expected task to be deleted");

                        // If `isTaskCollectionItemDeleted()` returns true then we have
                        // `rawDeletedTime`.
                        assert(collectionItem.rawDeletedTime);

                        await state.authorizeCollectionAccessAllowingDeletedCollections(
                            collectionId,
                            "Manage",
                        );

                        if (
                            compareHybridLogicalTimes(action.time, collectionItem.rawDeletedTime) <=
                            0
                        ) {
                            throw new FailedPreconditionError(
                                "Undelete action time is less than delete action time",
                            );
                        }

                        state.updateCollectionItem({
                            ...collectionItem,
                            rawUndeletedTime: action.time,
                        });
                        break;
                    }
                    default: {
                        const collectionItem = await state.getCollectionItemIfExists(collectionId);
                        if (!collectionItem) throw new NotFoundError("Task collection not found");
                        if (isTaskCollectionItemDeleted(collectionItem))
                            throw new FailedPreconditionError("Task collection was deleted");

                        switch (collectionAction.type) {
                            case "Delete": {
                                if (
                                    compareHybridLogicalTimes(
                                        action.time,
                                        collectionItem.createdTime,
                                    ) <= 0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                if (
                                    collectionItem.rawUndeletedTime &&
                                    compareHybridLogicalTimes(
                                        action.time,
                                        collectionItem.rawUndeletedTime,
                                    ) <= 0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than undelete action time",
                                    );
                                }

                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    rawDeletedTime: action.time,
                                });
                                break;
                            }
                            case "UpdateName": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                const newName = collectionItem.name.apply({
                                    value: collectionAction.name,
                                    version: action.time,
                                });

                                if (collectionItem.name !== newName) {
                                    state.updateCollectionItem({
                                        ...collectionItem,
                                        name: newName,
                                    });
                                }
                                break;
                            }
                            case "UpdateColor": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                const newColor = collectionItem.color.apply({
                                    value: collectionAction.color,
                                    version: action.time,
                                });

                                if (collectionItem.color !== newColor) {
                                    state.updateCollectionItem({
                                        ...collectionItem,
                                        color: newColor,
                                    });
                                }
                                break;
                            }
                            case "UpdateAccessPolicy": {
                                if (
                                    iterableEvery(
                                        collectionAction.accessPolicy.accountGrantById.values(),
                                        grant =>
                                            !hasTaskCollectionAccessLevel(grant.level, "Manage"),
                                    ) &&
                                    (collectionAction.accessPolicy.defaultGrant?.type !== "Space" ||
                                        !hasTaskCollectionAccessLevel(
                                            collectionAction.accessPolicy.defaultGrant.level,
                                            "Manage",
                                        ))
                                ) {
                                    throw new InvalidArgumentError(
                                        '`accessPolicy` must grant at least one account the "Manage" access level',
                                    );
                                }

                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    accessPolicy: collectionItem.accessPolicy.apply({
                                        value: collectionAction.accessPolicy,
                                        version: action.time,
                                    }),
                                });
                                break;
                            }
                            default:
                                throw exhaustive(collectionAction);
                        }
                        break;
                    }
                }
                break;
            }
            case "UpdateNotepadPage": {
                const {notepadPageId, notepadPageAction} = action;

                if (action.accountId !== state.getActorAccountId())
                    throw new PermissionDeniedError("Can only access your account's notepad");

                const notepadItem = await state.getActorNotepadItem();

                cast<"Create">(notepadPageAction.type);

                if (notepadItem.pageIds.get().has(notepadPageId))
                    throw new FailedPreconditionError("Notepad page already exists");

                const newPageIds = new Set(notepadItem.pageIds.get());
                newPageIds.add(notepadPageId);

                state.updateActorNotepadItem({
                    ...notepadItem,
                    pageIds: new TaskNotepadPageIdCompressedSet(newPageIds),
                });
                break;
            }
            case "UpdateAccountName": {
                // Clients can't commit this action whenever they'd like by calling
                // `commitTaskActionTransaction()`. We only commit this action when updating
                // an account's name.
                throw new InvalidArgumentError(
                    "Clients are not allowed to commit an `UpdateAccountName` action",
                );
            }
            default:
                throw exhaustive(action);
        }
    }
}

export const deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Delete the provided `TaskId` and all children of that task in a single
 * transaction. Returns the actions we committed from this function call.
 *
 * On the client we may not know all the transitive children of a task. So this
 * functionality needs to be implemented on the server.
 */
export function deleteTaskAndAllChildren(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    taskId: TaskId,
    actionTime: HybridLogicalTime,
    options?: {clientId?: TaskRealtimeClientId},
): Promise<{
    spaceId: SpaceId;
    actions: ReadonlyArray<TaskAction>;
}> {
    let hasAlreadyAttempted = false;

    return context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAlreadyAttempted;
        hasAlreadyAttempted = true;

        const taskItem = await TaskTable.getItem(context, {
            partitionType: "Task",
            sortRangeType: "EssentialAttributes",
            taskId,
        });

        await authorizeTaskItemAccess(context, taskItem, "Edit", null);

        let rootParentTaskItem: TaskEssentialAttributesItem = taskItem;
        let parentTaskItem: TaskEssentialAttributesItem | null = null;
        while (rootParentTaskItem.parentTaskId.value) {
            const parentTaskId = rootParentTaskItem.parentTaskId.value;

            rootParentTaskItem = await ((isInitialAttempt
                ? TaskItemAuthorizationCache.getIfExists(context, parentTaskId)
                : null) ??
                TaskTable.getItem(context, {
                    partitionType: "Task",
                    sortRangeType: "EssentialAttributes",
                    taskId: parentTaskId,
                }));

            // We want to keep track of both the root parent task and the first
            // parent task.
            if (parentTaskItem === null) {
                parentTaskItem = rootParentTaskItem;
            }
        }

        const seenTaskIds = new Set([taskItem.taskId]);
        const updatedTaskItems: Array<{
            oldTaskItem: TaskEssentialAttributesItem;
            newTaskItem: TaskEssentialAttributesItem;
        }> = [];

        const updatedCollectionById = new Map<
            TaskCollectionId,
            {taskCountDelta: number; openTaskCountDelta: number}
        >();

        // Note that child tasks inherit the parent task's authorization.
        const addTaskItem = async (taskItem: TaskEssentialAttributesItem) => {
            const childTaskCount = taskItem.childTaskIds.size;
            let closedChildTaskCount = 0;

            await runAllPromises(
                Array.from(taskItem.childTaskIds, async childTaskId => {
                    const childTaskItem = await TaskTable.getItem(context, {
                        partitionType: "Task",
                        sortRangeType: "EssentialAttributes",
                        taskId: childTaskId,
                    });

                    if (childTaskItem.statusType.value === "Closed") {
                        closedChildTaskCount++;
                    }

                    // Keep track of `seenTaskIds` since while child tasks child be an acyclic tree
                    // where each node is unique, there may be concurrent task updates which cause
                    // us to observe something different.
                    if (seenTaskIds.has(childTaskItem.taskId)) return;

                    await addTaskItem(childTaskItem);
                }),
            );

            updatedTaskItems.push({
                oldTaskItem: taskItem,
                newTaskItem: {
                    ...taskItem,
                    deletedTime: actionTime,
                    removedChildTaskCount: taskItem.removedChildTaskCount + childTaskCount,
                    removedClosedChildTaskCount:
                        taskItem.removedClosedChildTaskCount + closedChildTaskCount,
                    // Invalidate any leases on this task now that another user has updated it.
                    validLeaseId: null,
                },
            });

            for (const {collectionId} of taskItem.collections.getArray()) {
                const updatedCollection = getOrSetDefaultMapValue(
                    updatedCollectionById,
                    collectionId,
                    () => ({taskCountDelta: 0, openTaskCountDelta: 0}),
                );

                updatedCollection.taskCountDelta -= 1;

                if (taskItem.statusType.value !== "Closed") {
                    updatedCollection.openTaskCountDelta -= 1;
                }
            }
        };

        await addTaskItem(taskItem);

        const transactionEntries: Array<DynamoTransactionEntry> = [];

        // Whenever we update a task's parent, we increment the `updateLockVersion` of
        // the root parent task. This way we can force updates to the child tree
        // structure to happen in sequence so we can validate there are no cycles.
        //
        // Force our recursive task deletion to be a part of this update sequence.
        if (
            rootParentTaskItem.taskId !== taskItem.taskId &&
            // We'll update `parentTaskItem` below so if it's the same as
            // `rootParentTaskItem` then we don't need to update `rootParentTaskItem`.
            rootParentTaskItem.taskId !== parentTaskItem?.taskId
        ) {
            transactionEntries.push(
                TaskTable.transactionDirectlyUpdateItemLockVersion(
                    rootParentTaskItem,
                    rootParentTaskItem.updateLockVersion,
                ),
            );
        }

        if (parentTaskItem) {
            transactionEntries.push(
                TaskTable.transactionDirectlyUpdateItem({
                    ...parentTaskItem,
                    addedChildTaskCount: parentTaskItem.addedChildTaskCount,
                    removedChildTaskCount: parentTaskItem.removedChildTaskCount + 1,
                    addedClosedChildTaskCount: parentTaskItem.addedClosedChildTaskCount,
                    removedClosedChildTaskCount:
                        parentTaskItem.removedClosedChildTaskCount +
                        (taskItem.statusType.value === "Closed" ? 1 : 0),
                }),
            );
        }

        for (const {newTaskItem} of updatedTaskItems) {
            transactionEntries.push(TaskTable.transactionDirectlyUpdateItem(newTaskItem));
        }

        for (const [collectionId, updatedCollection] of updatedCollectionById) {
            transactionEntries.push(
                TaskTable.dangerousTransactionUpdateItemWithCustomUpdateExpression(
                    {
                        partitionType: "TaskCollection",
                        sortRangeType: "EssentialAttributes",
                        collectionId,
                    },
                    {
                        updateExpression:
                            taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression,
                        expressionAttributeValues: {
                            ":zero": 0,
                            ":one": 1,
                            ":taskCountDelta": updatedCollection.taskCountDelta,
                            ":openTaskCountDelta": updatedCollection.openTaskCountDelta,
                        },
                    },
                ),
            );
        }

        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId: taskItem.spaceId,
            committedTime: new Date(),
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [
                ...updatedTaskItems.map(
                    ({newTaskItem}): TaskAction => ({
                        type: "UpdateTask",
                        time: actionTime,
                        taskId: newTaskItem.taskId,
                        taskAction: {type: "Delete"},
                    }),
                ),
                ...filterMapArray(
                    updatedTaskItems,
                    ({oldTaskItem, newTaskItem}): TaskAction | null => {
                        const countKeys = [
                            "addedChildTaskCount",
                            "removedChildTaskCount",
                            "addedClosedChildTaskCount",
                            "removedClosedChildTaskCount",
                        ] as const;

                        const oldTaskCounts = pickObject(oldTaskItem, countKeys);
                        const newTaskCounts = pickObject(newTaskItem, countKeys);

                        if (isDeepEqual(oldTaskCounts, newTaskCounts)) return null;

                        return {
                            type: "UpdateTask",
                            // Match `commitTaskActionTransaction()`. Each extra action has +1 tick above
                            // the action time.
                            time: [actionTime[0], actionTime[1] + 1],
                            taskId: newTaskItem.taskId,
                            taskAction: {
                                type: "UpdateChildrenCounts",
                                ...newTaskCounts,
                            },
                        };
                    },
                ),
                ...(parentTaskItem
                    ? cast<Array<TaskAction>>([
                          {
                              type: "UpdateTask",
                              // Match `commitTaskActionTransaction()`. Each extra action has +1 tick above
                              // the action time.
                              time: [actionTime[0], actionTime[1] + 1],
                              taskId: parentTaskItem.taskId,
                              taskAction: {
                                  type: "UpdateChildrenCounts",
                                  addedChildTaskCount: parentTaskItem.addedChildTaskCount,
                                  removedChildTaskCount: parentTaskItem.removedChildTaskCount + 1,
                                  addedClosedChildTaskCount:
                                      parentTaskItem.addedClosedChildTaskCount,
                                  removedClosedChildTaskCount:
                                      parentTaskItem.removedClosedChildTaskCount +
                                      (taskItem.statusType.value === "Closed" ? 1 : 0),
                              },
                          },
                      ])
                    : []),
            ],
            wasProcessed: false,
            actorId: context.actor.getAccountId(),
            clientId: options?.clientId ?? null,
        };

        transactionEntries.push(
            TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem),
        );

        await deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint.waitForTest(
            context.actor.getAccountId(),
        );

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        afterCommitTaskActionTransaction(context, actionTransactionItem);

        return {
            spaceId: actionTransactionItem.spaceId,
            actions: actionTransactionItem.actions,
        };
    });
}

/**
 * The task part required for implementing `updateSessionActorAccountName()`.
 * Commits an `UpdateAccountName` action to every space the account is in then
 * once the transaction has committed begins indexing the action.
 */
export function internalGetUpdateSessionActorAccountNameTaskTransactionEntries(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    {
        spaceIds,
        name,
        nameVersion,
    }: {
        spaceIds: ReadonlySet<SpaceId>;
        name: string;
        nameVersion: number;
    },
): Array<DynamoTransactionEntry> {
    const currentTime = new Date();

    const actionTransactionItems = Array.from(spaceIds, spaceId => {
        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId,
            committedTime: currentTime,
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [
                {
                    type: "UpdateAccountName",
                    time: [currentTime.getTime(), 0],
                    accountId: context.actor.getAccountId(),
                    accountName: name,
                    accountNameVersion: nameVersion,
                },
            ],
            wasProcessed: false,
            actorId: context.actor.getAccountId(),
            clientId: null,
        };

        return actionTransactionItem;
    });

    return actionTransactionItems.map(actionTransactionItem =>
        TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem, {
            onAfterTransactionExecutedSuccessfully: () => {
                afterCommitTaskActionTransaction(context, actionTransactionItem);
            },
        }),
    );
}

export const backfillTaskActionTransactionHistoryTestCounter = new TestCounter<SpaceId>();

/**
 * Get all action transactions since the provided start time in the
 * provided space.
 */
export async function backfillTaskActionTransactionHistory(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        opensearch: OpensearchContextModule;
        actor: SystemActorContextModule;
    }>,
    spaceId: SpaceId,
    startCommittedTime: Date,
): Promise<
    Array<{
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }>
> {
    // Must have system access since we return all actions. We don't
    // filter out actions the current session doesn't have access to.
    context.actor.authorizeSystem();

    await authorizeSpaceAccess(context, spaceId);

    const actionTransactions: Array<{
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }> = [];

    backfillTaskActionTransactionHistoryTestCounter.incrementForTest(spaceId);

    for await (const item of TaskActionTable.query(context, {
        partitionKey: {
            partitionType: "TaskActions",
            spaceId,
        },
        startSortKey: {
            sortRangeType: "ActionTransaction",
            committedTime: startCommittedTime,
            actionTransactionId: getMinId<TaskActionTransactionId>(),
        },
        limit: "All",
        consistency: "Strong",
    })) {
        actionTransactions.push({
            spaceId: item.spaceId,
            committedTime: item.committedTime,
            actions: item.actions,
        });
    }

    return actionTransactions;
}

const TaskItemAuthorizationCache = new ContextCache<TaskId, TaskEssentialAttributesItem>();

/**
 * Gets a task to be used in authorization. If used in `TaskRealtimeService`
 * then you may provide a loader function to use an in-memory task
 * representation.
 *
 * 1. Attempts to get an in-memory task representation when used in
 *    `TaskRealtimeService` with `getTaskIndexDocIfExists`.
 *
 * 2. Otherwise loads the task from the database (cached within the action
 *    context).
 *
 * We force `getTaskIndexDocIfExists` to be synchronous. If you don't have the
 * task in memory then we should load from DynamoDB, not OpenSearch.
 */
async function getTaskItemForAuthorization(
    context: ServerActionContext,
    taskId: TaskId,
    loaders: {getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined} | null,
): Promise<TaskEssentialAttributesItemBase> {
    const taskIndexDoc = loaders?.getTaskIndexDocIfExists(taskId);
    if (taskIndexDoc) return convertTaskIndexDocToItem(taskIndexDoc);

    return TaskItemAuthorizationCache.get(context, taskId, async () => {
        const taskItem = await TaskTable.getItemIfExists(context, {
            partitionType: "Task",
            sortRangeType: "EssentialAttributes",
            taskId,
        });

        if (taskItem) return taskItem;

        return TaskTable.getItem(
            context,
            {
                partitionType: "Task",
                sortRangeType: "EssentialAttributes",
                taskId,
            },
            {
                // If we couldn't find the task, maybe it was just created. Try reading again
                // with strong read consistency. Don't want to throw an error if the task
                // actually exists.
                consistency: "Strong",
            },
        );
    });
}

const TaskCollectionItemAuthorizationCache = new ContextCache<
    TaskCollectionId,
    TaskCollectionEssentialAttributesItem
>();

/**
 * Gets a collection to be used in authorization. If used in
 * `TaskRealtimeService` then you may provide a loader function to use an
 * in-memory collection representation.
 *
 * 1. Attempts to get an in-memory collection representation when used in
 *    `TaskRealtimeService` with `getCollectionIndexDocIfExists`.
 *
 * 2. Otherwise loads the collection from the database (cached within the
 *    action context).
 *
 * We force `getCollectionIndexDocIfExists` to be synchronous. If you don't
 * have the collection in memory then we should load from DynamoDB, not
 * OpenSearch.
 */
async function getTaskCollectionItemForAuthorization(
    context: ServerSessionActionContext,
    collectionId: TaskCollectionId,
    loaders: {
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
): Promise<TaskCollectionEssentialAttributesItemBase> {
    const collectionIndexDoc = loaders?.getCollectionIndexDocIfExists(collectionId);
    if (collectionIndexDoc) return convertTaskCollectionIndexDocToItem(collectionIndexDoc);

    return TaskCollectionItemAuthorizationCache.get(context, collectionId, async () => {
        const collectionItem = await TaskTable.getItemIfExists(context, {
            partitionType: "TaskCollection",
            sortRangeType: "EssentialAttributes",
            collectionId,
        });

        if (collectionItem) return collectionItem;

        return TaskTable.getItem(
            context,
            {
                partitionType: "TaskCollection",
                sortRangeType: "EssentialAttributes",
                collectionId,
            },
            {
                // If we couldn't find the collection, maybe it was just created. Try reading
                // again with strong read consistency. Don't want to throw an error if the
                // collection actually exists.
                consistency: "Strong",
            },
        );
    });
}

/**
 * Evaluates whether the `AccountId` has access to the task collection item at
 * the provided access level.
 *
 * Returns true if the account has access.
 */
async function evaluateTaskCollectionAccessPolicy(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    spaceId: SpaceId,
    accessPolicy: TaskCollectionAccessPolicy,
    expectedAccessLevel: TaskCollectionAccessLevel,
): Promise<boolean> {
    if (accessPolicy.defaultGrant) {
        // If we ever add other default grant types then TypeScript will error here
        // forcing us to update this code.
        cast<"Space">(accessPolicy.defaultGrant.type);

        if (
            (await isAccountMemberOfSpace(context, spaceId, accountId)) &&
            hasTaskCollectionAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)
        ) {
            return true;
        }
    }

    const accountGrant = accessPolicy.accountGrantById.get(accountId);
    if (accountGrant && hasTaskCollectionAccessLevel(accountGrant.level, expectedAccessLevel)) {
        return true;
    }

    return false;
}

async function isTaskCollectionItemAccessAuthorized(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: TaskCollectionAccessLevel,
) {
    const isAuthorized = await isTaskCollectionItemAccessAuthorizedAllowingDeletedTasks(
        context,
        accountId,
        collectionItem,
        expectedAccessLevel,
    );

    // If you were authorized to view, edit, whatever, but the collection is
    // deleted then you don't have edit access anymore but you can still view the
    // collection.
    if (isTaskCollectionItemDeleted(collectionItem) && isAuthorized) {
        return hasTaskCollectionAccessLevel("View", expectedAccessLevel);
    }

    return isAuthorized;
}

async function isTaskCollectionItemAccessAuthorizedAllowingDeletedTasks(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: TaskCollectionAccessLevel,
) {
    // Check that the account has access to the space the collection is in.
    if (!(await isAccountMemberOfSpace(context, collectionItem.spaceId, accountId))) {
        return false;
    }

    return evaluateTaskCollectionAccessPolicy(
        context,
        accountId,
        collectionItem.spaceId,
        collectionItem.accessPolicy.value,
        expectedAccessLevel,
    );
}

/**
 * Tests if the context's actor is allowed to access the provided collection
 * with the provided access level. Throws an error if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
export async function authorizeTaskCollectionAccess(
    context: ServerSessionActionContext,
    collectionId: TaskCollectionId,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getCollectionIndexDocIfExists: (
            taskId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
) {
    const collectionItem = await getTaskCollectionItemForAuthorization(
        context,
        collectionId,
        loaders,
    );

    const hasAccess = await isTaskCollectionItemAccessAuthorized(
        context,
        context.actor.getAccountId(),
        collectionItem,
        expectedAccessLevel,
    );

    if (!hasAccess) {
        throw new PermissionDeniedError(
            quote`Actor does not have ${expectedAccessLevel} access level to task collection`,
            {
                displayMessage: getTaskCollectionItemPermissionDeniedErrorDisplayMessage(
                    collectionItem,
                    expectedAccessLevel,
                ),
            },
        );
    }
}

/**
 * Can the provided account access the provided collection index doc? Returns
 * false if not.
 *
 * Be careful when using this function! You are expected to provide index docs
 * from an up-to-date source. You should not directly load from OpenSearch
 * since OpenSearch is at least 30 seconds behind at all times. This function
 * is only really safely useful in `TaskRealtimeService` which maintains
 * `TaskCollectionIndexDoc`s up-to-date in-memory.
 *
 * If you use this function you are taking on your own authorization
 * responsibilities. Like properly stopping data from being sent to the client
 * when this function returns false.
 */
// TODO(calebmer, 2023-08-22, #security): For our authorization logic to
// produce the correct results, it's essential that: 1) every committed action
// is indexed in a timely fashion, 2) every committed action is seen by
// realtime servers in a timely fashion. When you remove someone's access in
// Cyberworlds it may take a little bit for them to actually lose access
// (3-5min). However we guarantee they do eventually lose access.
//
// If we fail to index in OpenSearch an `UpdateAccessPolicy` action or don't
// send it to one of our realtime servers that's a big problem! Realtime
// servers will continue returning data in the collection without considering
// that access may have been removed.
//
// We need to set up systems that guarantee every action is indexed. This is
// probably some CRON job that reapplies actions which haven't been marked as
// applied. Since actions are CRDTs reapplying is safe.
export function isTaskCollectionIndexDocAccessAuthorized(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    collectionIndexDoc: TaskCollectionIndexDoc,
    expectedAccessLevel: TaskCollectionAccessLevel,
): Promise<boolean> {
    return isTaskCollectionItemAccessAuthorized(
        context,
        accountId,
        convertTaskCollectionIndexDocToItem(collectionIndexDoc),
        expectedAccessLevel,
    );
}

async function isTaskItemAccessAuthorized(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
) {
    const isAuthorized = await isTaskItemAccessAuthorizedAllowingDeletedTasks(
        context,
        accountId,
        taskItem,
        expectedAccessLevel,
        loaders,
    );

    // If you were authorized to view, edit, whatever, but the task is deleted then
    // you don't have edit access anymore but you can still view the task.
    if (taskItem.deletedTime && isAuthorized) {
        return hasTaskCollectionAccessLevel("View", expectedAccessLevel);
    }

    return isAuthorized;
}

async function isTaskItemAccessAuthorizedAllowingDeletedTasks(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
): Promise<boolean> {
    // Check that the account has access to the space the task is in.
    if (!(await isAccountMemberOfSpace(context, taskItem.spaceId, accountId))) {
        return false;
    }

    // The task creator has edit access level on their own task.
    if (
        accountId === taskItem.creatorId &&
        hasTaskCollectionAccessLevel("Edit", expectedAccessLevel)
    ) {
        return true;
    }

    // The task assignee has edit access level on their own task.
    if (
        taskItem.assigneeId.value &&
        accountId === taskItem.assigneeId.value &&
        hasTaskCollectionAccessLevel("Edit", expectedAccessLevel)
    ) {
        return true;
    }

    // An array of `TaskCollectionId`s that authorize access to the task or `null`
    // if no `TaskCollectionId`s authorize access to the task.
    const authorizingCollectionItems = await runAllPromises(
        taskItem.collections.getArray().map(async ({collectionId}) => {
            const collectionItem = await loaders.getCollectionItem(collectionId);

            // Deleted collections don't grant any access.
            if (isTaskCollectionItemDeleted(collectionItem)) return null;

            const hasAccess = await evaluateTaskCollectionAccessPolicy(
                context,
                accountId,
                collectionItem.spaceId,
                collectionItem.accessPolicy.value,
                expectedAccessLevel,
            );

            return hasAccess ? collectionItem : null;
        }),
    );

    // We evaluate the access policies for all collections on a task but we only
    // need one passing access policy.
    if (authorizingCollectionItems.some(isNonNullable)) return true;

    if (taskItem.parentTaskId.value) {
        const parentTaskItem = await loaders.getTaskItem(taskItem.parentTaskId.value);

        // Parent tasks implicitly grant access to all of their child tasks. If we have
        // a parent task that is not deleted then check it before throwing a permission
        // denied error.
        if (!parentTaskItem.deletedTime) {
            return isTaskItemAccessAuthorized(
                context,
                accountId,
                parentTaskItem,
                expectedAccessLevel,
                loaders,
            );
        }
    }

    return false;
}

/**
 * Tests if the context's actor is allowed to access the provided task with the
 * provided access level. Returns true or false depending on whether task
 * access is authorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
async function isTaskAccessAuthorized(
    context: ServerSessionActionContext,
    taskId: TaskId,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
): Promise<{spaceId: SpaceId; hasAccess: boolean}> {
    const taskItem = await getTaskItemForAuthorization(context, taskId, loaders);

    return {
        spaceId: taskItem.spaceId,
        hasAccess: await isTaskItemAccessAuthorized(
            context,
            context.actor.getAccountId(),
            taskItem,
            expectedAccessLevel,
            {
                getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, loaders),
                getCollectionItem: collectionId =>
                    getTaskCollectionItemForAuthorization(context, collectionId, loaders),
            },
        ),
    };
}

/**
 * Tests if the context's actor is allowed to access the provided task with the
 * provided access level. Throws an error if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
export async function authorizeTaskAccess(
    context: ServerActionContext,
    taskId: TaskId,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
): Promise<{spaceId: SpaceId}> {
    switch (context.actor.type) {
        case "System": {
            const taskItem = await getTaskItemForAuthorization(context, taskId, loaders);
            await authorizeSpaceAccess(context, taskItem.spaceId);
            return {spaceId: taskItem.spaceId};
        }
        case "Session": {
            const {spaceId, hasAccess} = await isTaskAccessAuthorized(
                context as ServerSessionActionContext,
                taskId,
                expectedAccessLevel,
                loaders,
            );

            if (!hasAccess) {
                throw new PermissionDeniedError(
                    quote`Actor does not have ${expectedAccessLevel} access level to task`,
                    {
                        displayMessage: getTaskItemPermissionDeniedErrorDisplayMessage(
                            await getTaskItemForAuthorization(context, taskId, loaders),
                            expectedAccessLevel,
                        ),
                    },
                );
            }

            return {spaceId};
        }
        default:
            throw exhaustive(context.actor);
    }
}

/**
 * Tests if the context's actor is allowed to access the provided task item
 * with the provided access level. Throws an error if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
async function authorizeTaskItemAccess(
    context: ServerSessionActionContext,
    taskItem: TaskEssentialAttributesItem,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
) {
    const hasAccess = await isTaskItemAccessAuthorized(
        context,
        context.actor.getAccountId(),
        taskItem,
        expectedAccessLevel,
        {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, loaders),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, loaders),
        },
    );

    if (!hasAccess) {
        throw new PermissionDeniedError(
            quote`Actor does not have ${expectedAccessLevel} access level to task`,
            {
                displayMessage: getTaskItemPermissionDeniedErrorDisplayMessage(
                    taskItem,
                    expectedAccessLevel,
                ),
            },
        );
    }
}

function getTaskItemPermissionDeniedErrorDisplayMessage(
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: TaskCollectionAccessLevel,
) {
    // If the user can't view a deleted task it's because they don't have view
    // access. If a task is deleted, you can still view it but you can't edit it.
    if (taskItem.deletedTime && hasTaskCollectionAccessLevel(expectedAccessLevel, "Edit")) {
        // TODO(calebmer): In the future we should have some kind of task trash
        // feature. When we add trash we should direct the user to restore tasks from
        // their trash in the "hint" part of the error message.
        return errorDisplayMessage`This task was deleted.`;
    }

    return errorDisplayMessage`You aren’t allowed to access this task. Ask someone with access share it with you.`;
}

function getTaskCollectionItemPermissionDeniedErrorDisplayMessage(
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: TaskCollectionAccessLevel,
) {
    // If the user can't view a deleted collection it's because they don't have
    // view access. If a task is deleted, you can still view it but you can't
    // edit it.
    if (
        isTaskCollectionItemDeleted(collectionItem) &&
        hasTaskCollectionAccessLevel(expectedAccessLevel, "Edit")
    ) {
        // TODO(calebmer): In the future we should have some kind of task trash
        // feature. When we add trash we should direct the user to restore tasks from
        // their trash in the "hint" part of the error message.
        return errorDisplayMessage`This collection was deleted.`;
    }

    return errorDisplayMessage`You aren’t allowed to access this collection. Ask someone with access to share it with you.`;
}

/**
 * Can the provided account access the provided task index doc? Returns false
 * if not.
 *
 * Be careful when using this function! You are expected to provide index docs
 * from an up-to-date source. You should not directly load from OpenSearch
 * since OpenSearch is at least 30 seconds behind at all times. This function
 * is only really safely useful in `TaskRealtimeService` which maintains
 * `TaskIndexDoc`s up-to-date in-memory.
 *
 * If you use this function you are taking on your own authorization
 * responsibilities. Like properly stopping data from being sent to the client
 * when this function returns false.
 */
// TODO(calebmer, 2023-08-22, #security): For our authorization logic to
// produce the correct results, it's essential that: 1) every committed action
// is indexed in a timely fashion, 2) every committed action is seen by
// realtime servers in a timely fashion. When you remove someone's access in
// Cyberworlds it may take a little bit for them to actually lose access
// (3-5min). However we guarantee they do eventually lose access.
//
// If we fail to index in OpenSearch an `UpdateAccessPolicy` action or don't
// send it to one of our realtime servers that's a big problem! Realtime
// servers will continue returning data in the collection without considering
// that access may have been removed.
//
// We need to set up systems that guarantee every action is indexed. This is
// probably some CRON job that reapplies actions which haven't been marked as
// applied. Since actions are CRDTs reapplying is safe.
export function isTaskIndexDocAccessAuthorized(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    taskIndexDoc: TaskIndexDoc,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskIndexDoc: (taskId: TaskId) => Promise<TaskIndexDoc>;
        getCollectionIndexDoc: (taskId: TaskCollectionId) => Promise<TaskCollectionIndexDoc>;
    },
): Promise<boolean> {
    return isTaskItemAccessAuthorized(
        context,
        accountId,
        convertTaskIndexDocToItem(taskIndexDoc),
        expectedAccessLevel,
        {
            getTaskItem: async taskId => {
                const taskIndexDoc = await loaders.getTaskIndexDoc(taskId);
                return convertTaskIndexDocToItem(taskIndexDoc);
            },
            getCollectionItem: async collectionId => {
                const collectionIndexDoc = await loaders.getCollectionIndexDoc(collectionId);
                return convertTaskCollectionIndexDocToItem(collectionIndexDoc);
            },
        },
    );
}

/**
 * Tests if we are allowed to execute a query with the provided filters and
 * sorts. Throws an error if unauthorized. If authorized then that means all
 * tasks in the query are also authorized and we don't need to check each task
 * individually.
 *
 * Consults DynamoDB by default but if you're in `TaskRealtimeService` and have
 * an up-to-date in-memory representation of tasks then you may provide the
 * `getTaskIndexDocIfExists` function and `getCollectionIndexDocIfExists`
 * function to skip making network requests for tasks/collections that exist in
 * memory.
 *
 * Be careful using `getTaskIndexDocIfExists` and
 * `getCollectionIndexDocIfExists`! Data loaded from the OpenSearch task index
 * is at least 30sec behind since that's the refresh interval. Only use those
 * options if you're in `TaskRealtimeService` and have an up-to-date in-memory
 * representation of tasks.
 */
// TODO(calebmer, 2023-08-22, #security): For our authorization logic to
// produce the correct results, it's essential that: 1) every committed action
// is indexed in a timely fashion, 2) every committed action is seen by
// realtime servers in a timely fashion. When you remove someone's access in
// Cyberworlds it may take a little bit for them to actually lose access
// (3-5min). However we guarantee they do eventually lose access.
//
// If we fail to index in OpenSearch an `UpdateAccessPolicy` action or don't
// send it to one of our realtime servers that's a big problem! Realtime
// servers will continue returning data in the collection without considering
// that access may have been removed.
//
// We need to set up systems that guarantee every action is indexed. This is
// probably some CRON job that reapplies actions which haven't been marked as
// applied. Since actions are CRDTs reapplying is safe.
export async function authorizeTaskQueryAccess(
    context: ServerSessionActionContext,
    {
        filters,
        sorts,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    },
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
) {
    let hasAccess = false;

    // Account has edit access to all tasks they created. So authorize if we have
    // an exclusive creator filter for our session account.
    if (
        filters.creatorFilter?.accountIds.size === 1 &&
        filters.creatorFilter.type === "OneOf" &&
        filters.creatorFilter.accountIds.has(context.actor.getAccountId())
    ) {
        hasAccess = true;
    }

    // Account has edit access to tasks it is assigned to. So authorize if we have
    // an exclusive assignee filter for our session account.
    if (
        filters.assigneeFilter?.accountIds.size === 1 &&
        filters.assigneeFilter.type === "OneOf" &&
        filters.assigneeFilter.accountIds.has(context.actor.getAccountId())
    ) {
        hasAccess = true;
    }

    // You can only add tasks you created to your notepad. So a notepad filter for
    // an account implies a task creator filter.
    if (filters.notepadPageFilter?.accountId === context.actor.getAccountId()) {
        hasAccess = true;
    }

    await runAllPromiseThunks(
        async () => {
            if (!filters.collectionsFilter) return;

            await runAllPromises(
                filters.collectionsFilter.map(async clause => {
                    // Make sure we're authorized to view every referenced collection...
                    await runAllPromises(
                        Array.from(clause.keys(), async term => {
                            if (term === "IsEmpty") return;
                            await authorizeTaskCollectionAccess(context, term, "View", loaders);
                        }),
                    );

                    // For this filter to grant access, we need to guarantee the query only returns
                    // tasks that have at least one collection we can view.
                    //
                    // A normalized collections filter is in [conjunctive normal form][1]. That
                    // means if one of the "AND"ed clauses narrows down to only viewable collections
                    // this filter can grant access. That's what we check here.
                    //
                    // [1]: https://en.wikipedia.org/wiki/Conjunctive_normal_form
                    if (iterableEvery(clause, ([term, not]) => term !== "IsEmpty" && !not)) {
                        hasAccess = true;
                    }
                }),
            );
        },
        async () => {
            if (!filters.parentFilter) return;

            // View access on the parent task is inherited to child tasks.
            await authorizeTaskAccess(context, filters.parentFilter.parentTaskId, "View", loaders);

            hasAccess = true;
        },
        async () => {
            await runAllPromises(
                sorts.map(async sort => {
                    switch (sort.type) {
                        case "ParentPosition": {
                            // You are not allowed to sort by parent position unless you are also filtering
                            // by the parent task. This is because sorting by parent position reveals
                            // information about the parent task which might not be visible to you.
                            if (filters.parentFilter) break;

                            throw new PermissionDeniedError(
                                "Must filter by a parent task to sort by parent position",
                            );
                        }
                        case "CollectionPosition": {
                            // Optimization: If our filter contains the collection then we will authorize
                            // view access above.
                            if (
                                filters.collectionsFilter?.some(clause =>
                                    clause.has(sort.collectionId),
                                )
                            ) {
                                break;
                            }

                            await authorizeTaskCollectionAccess(
                                context,
                                sort.collectionId,
                                "View",
                                loaders,
                            );
                            break;
                        }
                        case "NotepadPagePosition": {
                            if (sort.accountId === context.actor.getAccountId()) break;

                            throw new PermissionDeniedError(
                                "Can't sort by notepad page that's not yours",
                            );
                        }
                        case "AssigneeActivePosition": {
                            // A task's active position is private to the account whom the task is
                            // assigned. Only allow sorting by active position when also filtering for
                            // tasks assigned to you.
                            if (
                                filters.assigneeFilter?.accountIds.size === 1 &&
                                filters.assigneeFilter.accountIds.has(context.actor.getAccountId())
                            ) {
                                break;
                            }

                            throw new PermissionDeniedError(
                                "Must filter assignee to session account to sort by active position",
                            );
                        }
                        default:
                            break;
                    }
                }),
            );
        },
    );

    if (!hasAccess) {
        throw new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        );
    }
}

/**
 * If you have a `TaskIndexDoc` then you have all the data that's in a
 * `TaskEssentialAttributesItem`. This function converts between the two
 * formats.
 *
 * Be careful when using this function! Loading a `TaskIndexDoc` from
 * OpenSearch is at least 30sec behind a `TaskEssentialAttributesItem` loaded
 * from DynamoDB since 30sec is our OpenSearch refresh rate. If you're in
 * `TaskRealtimeService` then you have up-to-date `TaskIndexDoc`s in
 * `TaskRealtimeStore` so those are ok to use with this function.
 */
function convertTaskIndexDocToItem(task: TaskIndexDoc): TaskEssentialAttributesItemBase {
    return {
        partitionType: "Task",
        sortRangeType: "EssentialAttributes",
        taskId: task.id,
        spaceId: task.spaceId,
        creatorId: task.creator.accountId,
        createdTime: task.createdTime.absoluteTime,
        deletedTime: isTaskIndexDocDeleted(task) ? task.rawDeletedTime : null,
        statusType: new TaskStatusTypeRegister(task.status.value.type, task.status.version),
        parentTaskId: task.parent.taskId,
        addedChildTaskCount: task.addedChildTaskCount,
        removedChildTaskCount: task.removedChildTaskCount,
        addedClosedChildTaskCount: task.addedClosedChildTaskCount,
        removedClosedChildTaskCount: task.removedClosedChildTaskCount,
        collections: task.collections.raw.collections,
        assigneeId: new TaskAssigneeAccountIdRegister(
            task.assignee.value?.assignee.accountId ?? null,
            task.assignee.version,
        ),
    };
}

/**
 * If you have a `TaskCollectionIndexDoc` then you have all the data that's in
 * a `TaskCollectionEssentialAttributesItem`. This function converts between
 * the two formats.
 *
 * Be careful when using this function! See the disclaimer on
 * `convertTaskIndexDocToItem()`.
 */
function convertTaskCollectionIndexDocToItem(
    collection: TaskCollectionIndexDoc,
): TaskCollectionEssentialAttributesItemBase {
    return {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId: collection.id,
        spaceId: collection.spaceId,
        createdTime: collection.createdTime,
        creatorId: collection.creatorId,
        rawDeletedTime: collection.rawDeletedTime,
        rawUndeletedTime: collection.rawUndeletedTime,
        name: collection.name,
        color: collection.color,
        accessPolicy: collection.accessPolicy,
    };
}

/**
 * Get the account's task notepad pages for the space. We will always return at
 * least one notepad page. If the user hasn't create a notepad page yet then
 * we'll create their first page.
 */
export async function getTaskNotepadPageIds(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    spaceId: SpaceId,
): Promise<TaskNotepadPageIdCompressedSet> {
    const notepadItem = await TaskTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Notepad",
        accountId: context.actor.getAccountId(),
        spaceId,
    });

    let notepadPageIds = notepadItem?.pageIds;
    const actualNotepadPageIds = notepadPageIds?.getAvailable();

    if (
        !notepadPageIds ||
        !actualNotepadPageIds ||
        // Is the notepad page id set empty?
        (actualNotepadPageIds instanceof Uint8Array &&
            isVtencBigInt64SetEmpty(actualNotepadPageIds)) ||
        (!(actualNotepadPageIds instanceof Uint8Array) && actualNotepadPageIds.size === 0)
    ) {
        const notepadPageId = generateTaskNotepadPageId(unsynchronizedSystemClock);

        await commitTaskActionTransaction(context, spaceId, [
            {
                type: "UpdateNotepadPage",
                time: [unsynchronizedSystemClock.now(), 0],
                accountId: context.actor.getAccountId(),
                notepadPageId,
                notepadPageAction: {type: "Create"},
            },
        ]);

        notepadPageIds = new TaskNotepadPageIdCompressedSet(new Set([notepadPageId]));
    }

    return notepadPageIds;
}

/**
 * Get the current notes content for some task without the `ContentReferences`
 * needed to render.
 */
export async function getTaskNotesContentWithoutReferences(
    context: ServerActionContext,
    taskId: TaskId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: TaskNotesContent;
    stepCountByNonCreatorAccountId: TaskStepCountByAccountId;
}> {
    const [{spaceId}, notesItem] = await runAllPromises([
        authorizeTaskAccess(context, taskId, "View", null),
        TaskTable.getItemIfExists(
            context,
            {
                partitionType: "Task",
                sortRangeType: "Notes",
                taskId,
            },
            {consistency},
        ),
    ]);

    return {
        spaceId,
        version: notesItem?.version ?? 0,
        content: notesItem?.content ?? emptyTaskNotesContent,
        stepCountByNonCreatorAccountId:
            notesItem?.stepCountByAccountId ?? new TaskStepCountByAccountId(new Map()),
    };
}

/**
 * Get the current notes content for some task.
 */
export async function getTaskNotesContent(
    context: ServerActionContext,
    taskId: TaskId,
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: TaskNotesContentWithReferences;
}> {
    const {spaceId, version, content} = await getTaskNotesContentWithoutReferences(context, taskId);

    const contentReferences = await getContentReferencesForNode(context, spaceId, content);

    return {
        spaceId,
        version,
        content: {
            doc: content,
            references: contentReferences,
        },
    };
}

/**
 * Updates the task's notes with the provided steps. Uses optimistic
 * concurrency control so rejects any updates that have `version` set to the
 * wrong value.
 *
 * It's important that task note updating should be solely managed by the
 * `TaskNotesCollaborationService` Durable Object. If you get an incorrect
 * version error, we don't know what steps you're missing since we don't keep
 * track of old steps (unlike document content). There's no way to recover!
 */
export function updateTaskNotesContent(
    context: ServerSessionActionContext,
    {
        spaceId,
        taskId,
        version,
        steps,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        version: number;
        steps: ReadonlyArray<Step>;
    },
) {
    return withSendTaskIndexSearchEntityJobIfNeeded(context, {spaceId, taskId}, () => {
        return context.dynamo.retryTransaction(async context => {
            const [taskItem, notesItem] = await runAllPromises([
                (async () => {
                    const taskItem = await TaskTable.getItem(context, {
                        partitionType: "Task",
                        sortRangeType: "EssentialAttributes",
                        taskId,
                    });

                    const expectedAccessLevel = "Edit";

                    const hasAccess = await isTaskItemAccessAuthorized(
                        context,
                        context.actor.getAccountId(),
                        taskItem,
                        expectedAccessLevel,
                        {
                            getTaskItem: taskId =>
                                getTaskItemForAuthorization(context, taskId, null),
                            getCollectionItem: collectionId =>
                                getTaskCollectionItemForAuthorization(context, collectionId, null),
                        },
                    );

                    if (!hasAccess) {
                        throw new PermissionDeniedError(
                            quote`Actor does not have ${expectedAccessLevel} access level to task`,
                            {
                                displayMessage: getTaskItemPermissionDeniedErrorDisplayMessage(
                                    taskItem,
                                    expectedAccessLevel,
                                ),
                            },
                        );
                    }

                    if (taskItem.spaceId !== spaceId) {
                        throw new FailedPreconditionError("Task is in unexpected space");
                    }

                    return taskItem;
                })(),
                TaskTable.getItemIfExists(context, {
                    partitionType: "Task",
                    sortRangeType: "Notes",
                    taskId,
                }),
            ]);

            let newStepCountByAccountId =
                notesItem?.stepCountByAccountId ?? new TaskStepCountByAccountId(new Map());

            // Keep track of how much each account contributed to the task's notes.
            if (context.actor.getAccountId() !== taskItem.creatorId) {
                const actualNewStepCountByAccountId = new Map(newStepCountByAccountId.get());

                const stepCount =
                    actualNewStepCountByAccountId.get(context.actor.getAccountId()) ?? 0;

                actualNewStepCountByAccountId.set(
                    context.actor.getAccountId(),
                    stepCount + steps.length,
                );

                newStepCountByAccountId = new TaskStepCountByAccountId(
                    actualNewStepCountByAccountId,
                );
            }

            let newNotesItem: TaskNotesItem;

            // If the notes item doesn't exist yet then create it.
            if (!notesItem) {
                if (version !== 0) throw new FailedPreconditionError("Incorrect version");

                let content = emptyTaskNotesContent;

                for (const step of steps) {
                    const stepResult = step.apply(content);
                    if (!stepResult.doc)
                        throw new FailedPreconditionError("Couldn't apply step to content");

                    assert(isTaskNotesContent(stepResult.doc));
                    content = stepResult.doc;
                }

                newNotesItem = {
                    partitionType: "Task",
                    sortRangeType: "Notes",
                    spaceId: taskItem.spaceId,
                    taskId,
                    version: steps.length,
                    content,
                    stepCountByAccountId: newStepCountByAccountId,
                };
            } else {
                if (version !== notesItem.version)
                    throw new FailedPreconditionError("Incorrect version");

                let content = notesItem.content;

                for (const step of steps) {
                    const stepResult = step.apply(content);
                    if (!stepResult.doc)
                        throw new FailedPreconditionError("Couldn't apply step to content");

                    assert(isTaskNotesContent(stepResult.doc));
                    content = stepResult.doc;
                }

                newNotesItem = {
                    ...notesItem,
                    version: notesItem.version + steps.length,
                    content,
                    stepCountByAccountId: newStepCountByAccountId,
                };
            }

            // If a task's notes changed and there's a lease, invalidate the lease so the
            // account who owns the lease can't see changes to a task they shouldn't have
            // access to.
            if (taskItem.validLeaseId === null) {
                if (notesItem === null) {
                    await TaskTable.createItem(context, newNotesItem);
                } else {
                    await TaskTable.directlyUpdateItem(context, newNotesItem);
                }
            } else {
                await DynamoTableSchema.executeTransaction(context, [
                    TaskTable.transactionDirectlyUpdateItem({
                        ...taskItem,
                        // Invalidate any leases on this task now that another user has updated it.
                        validLeaseId: null,
                    }),
                    notesItem === null
                        ? TaskTable.transactionCreateItem(newNotesItem)
                        : TaskTable.transactionDirectlyUpdateItem(newNotesItem),
                ]);
            }
        });
    });
}

// After how many months should our expansion state expire?
//
// We expire expansion state to not incur storage costs for dead views,
// accounts, or browsers.
//
// The expiration time should be long enough that the user doesn't remember or
// doesn't care about losing any expansion state.
//
// We pick this value so that if a user looks at a grid view once a quarter,
// expanded task state is maintained.
const taskGridViewExpansionStateExpirationMonths = 4;

// After how many months should we renew expansion state expiration times?
//
// We renew expansion state items that are close to expiring if the user
// accesses them so we don't expire expansion states that are actively being
// used.
const taskGridViewExpansionStateExpirationRenewalMonths = 2;

/**
 * Get the key we use for storing the expansion state of a grid view.
 *
 * Uniqueness is not guaranteed! We hash `filters` and `sorts` to avoid storing
 * the entire query definition. However as with any hash function collisions
 * are very unlikely but possible.
 *
 * For the purpose of grid view expansion state we find collisions acceptable
 * given expansion state is also partitioned by `SpaceId`, `AccountId`, and
 * `BrowserId`.
 */
function getTaskGridViewExpansionStateKey({
    filters,
    sorts,
}: {
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
}) {
    const queryKey = stringifyForDeepEqualCheck<CalendarDate>({filters, sorts}, date =>
        date.toString(),
    );

    const queryKeyMidpointIndex = Math.floor(queryKey.length / 2);

    const queryKey1 = queryKey.slice(0, queryKeyMidpointIndex);
    const queryKey2 = queryKey.slice(queryKeyMidpointIndex);

    // We use two hashes (one on the first half of the key, one on the second half)
    // as any easy way to reduce collision chance. However collisions are still not
    // impossible.
    //
    // Thread describing this issue:
    // https://contributors.scala-lang.org/t/murmur-hash-conflicts-when-hashing-many-items/1506
    const queryKeyHash1 = murmurhash.v3(queryKey1).toString(16).padStart(8, "0");
    const queryKeyHash2 = murmurhash.v3(queryKey2).toString(16).padStart(8, "0");

    return `${queryKeyHash1}${queryKeyHash2}`;
}

/**
 * Update the `TaskGridViewExpansionState` for this browser.
 */
export async function updateTaskGridViewExpansionState(
    context: ServerSessionActionContext,
    {
        spaceId,
        browserId,
        filters,
        sorts,
        state,
    }: {
        spaceId: SpaceId;
        browserId: BrowserId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        state: TaskGridViewExpansionState;
    },
) {
    await authorizeSpaceAccess(context, spaceId);

    if (state === null) {
        await TaskTable.deleteItemWithKeyIfExists(context, {
            partitionType: "TaskGridViewExpansionState",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            browserId,
            viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
        });
    } else {
        await TaskTable.createOrReplaceItem(context, {
            partitionType: "TaskGridViewExpansionState",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            browserId,
            viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
            state,
            expirationTime: addMonths(new Date(), taskGridViewExpansionStateExpirationMonths),
        });
    }
}

/**
 * Get the `TaskGridViewExpansionState` for this browser. If the state hasn't
 * been updated in a while and is about to expire then we extend the expiration
 * time.
 */
export async function getTaskGridViewExpansionState(
    context: ServerSessionActionContext,
    {
        spaceId,
        browserId,
        filters,
        sorts,
    }: {
        spaceId: SpaceId;
        browserId: BrowserId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    },
): Promise<TaskGridViewExpansionState> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await TaskTable.getItemIfExists(context, {
        partitionType: "TaskGridViewExpansionState",
        sortRangeType: "Attributes",
        spaceId,
        accountId: context.actor.getAccountId(),
        browserId,
        viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
    });

    // If the grid view's expansion state hasn't been updated in a while but is
    // still being read then we want to extend its expiration time.
    if (
        item &&
        differenceInMonths(item.expirationTime, new Date()) <=
            taskGridViewExpansionStateExpirationRenewalMonths
    ) {
        const newExpirationTime = addMonths(new Date(), taskGridViewExpansionStateExpirationMonths);

        context.process.waitUntil(
            TaskTable.createOrReplaceItem(context, {
                ...item,
                expirationTime: newExpirationTime,
            }),
        );
    }

    return item?.state ?? null;
}

function createTaskCollectionModelSearchResultFromItem(
    score: number,
    collectionItem: TaskCollectionEssentialAttributesItem,
): TaskCollectionModelSearchResult {
    return {
        score,
        openTaskCount: collectionItem.openTaskCount,
        lastTaskAddedTime: collectionItem.lastTaskAddedTime,
        collection: new TaskCollectionModel({
            id: collectionItem.collectionId,
            spaceId: collectionItem.spaceId,
            createdTime: collectionItem.createdTime,
            creatorId: collectionItem.creatorId,
            deletedTime: collectionItem.rawDeletedTime,
            undeletedTime: collectionItem.rawUndeletedTime,
            name: collectionItem.name,
            color: collectionItem.color,
            accessPolicy: collectionItem.accessPolicy,
        }),
    };
}

/**
 * Assembles the result objects for `searchTaskCollections()`. Our
 * collection index doesn't have access to all the data we need to return
 * collection objects (e.g. `openTaskCount`). We get that here from DynamoDB.
 *
 * May return fewer collections than the `TaskCollectionId`s that were passed
 * in. Happens when the collection search index thinks our actor has access to
 * the collection but in fact the actor recently lost access and our search
 * index hasn't been refreshed.
 *
 * If a collection is required you may set the `isRequired` flag to true. Then
 * we'll return the collection even if it's deleted and we'll throw if you
 * don't have access to the collection.
 */
export async function assembleTaskCollectionSearchResults(
    context: ServerSessionActionContext,
    hits: Array<{score: number; id: TaskCollectionId; isRequired?: boolean}>,
): Promise<Array<TaskCollectionModelSearchResult>> {
    const collectionItems = await runAllPromises(
        hits.map(async ({score, id: collectionId, isRequired = false}) => {
            const collectionItem = await TaskTable.getItem(context, {
                partitionType: "TaskCollection",
                sortRangeType: "EssentialAttributes",
                collectionId,
            });

            // Don't include deleted collections in results.
            if (!isRequired && isTaskCollectionItemDeleted(collectionItem)) return null;

            const expectedAccessLevel = "View";

            // We need to double check that we have access to this collection. Since the
            // collection search index might be out of date.
            const hasAccess = await isTaskCollectionItemAccessAuthorized(
                context,
                context.actor.getAccountId(),
                collectionItem,
                expectedAccessLevel,
            );

            if (!hasAccess) {
                // If the collection is required, throw an error if the user doesn't
                // have access.
                if (isRequired) {
                    throw new PermissionDeniedError(
                        quote`Actor does not have ${expectedAccessLevel} access level to task collection`,
                        {
                            displayMessage:
                                getTaskCollectionItemPermissionDeniedErrorDisplayMessage(
                                    collectionItem,
                                    expectedAccessLevel,
                                ),
                        },
                    );
                }

                return null;
            }

            return createTaskCollectionModelSearchResultFromItem(score, collectionItem);
        }),
    );

    return collectionItems.filter(isNonNullable);
}

/**
 * Add some points to an account's affinity score for a task collection. 1
 * point will decay to 0 after 3 months (more accurately, 90 days).
 *
 * We have constants for how many points correspond to which actions in
 * `task_collection_affinity_constants.ts`.
 *
 * @deprecated Should migrate to search entity affinity.
 */
export async function addTaskCollectionAffinityPoints(
    context: ServerSessionActionContext,
    {
        spaceId,
        collectionId,
        points,
    }: {
        spaceId: SpaceId;
        collectionId: TaskCollectionId;
        points: number;
    },
) {
    if (points <= 0.05) throw new InvalidArgumentError("Invalid points");

    // We don't authorize whether the actor has access to the collection since
    // it's efficient. Since this is a personal score it doesn't really matter
    // if the user gives themselves affinity points to a collection they don't have
    // access to.

    const currentTime = Date.now();

    await TaskTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "TaskCollectionAffinity",
            spaceId,
            accountId: context.actor.getAccountId(),
            collectionId,
        },
        affinityItem => {
            let newPoints = affinityItem
                ? getCurrentTaskCollectionAccountAffinityPoints(currentTime, affinityItem)
                : 0;

            newPoints += points;

            const expirationDuration = Math.ceil(
                getTaskCollectionAccountAffinityExpirationDuration(newPoints),
            );
            const expirationTime = new Date(currentTime + expirationDuration);

            return {
                ...affinityItem,
                partitionType: "Account",
                sortRangeType: "TaskCollectionAffinity",
                spaceId,
                accountId: context.actor.getAccountId(),
                collectionId,
                points: newPoints,
                lastUpdatedTime: currentTime,
                expirationTime,
            };
        },
    );
}

/**
 * Get the collections our session actor has the highest affinity score with.
 * If the user has never interacted with any collections or all their
 * collection affinity scores have expired then this will return an empty
 * array.
 *
 * Affinitive is the adjective form of "affinity". I learned this from ChatGPT,
 * thanks! (Though ChatGPT did warn me that affinitive is an uncommon word
 * people may not be familiar with.)
 *
 * @deprecated Should migrate to search entity affinity.
 */
export async function getAffinitiveTaskCollections(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<Array<TaskCollectionModelSearchResult>> {
    const currentTime = Date.now();

    // We hope the number of collections a user reasonably interacts with over
    // three months is reasonably low (less than 1000). Then it makes sense to
    // query all their collection affinities and sort them in memory.
    //
    // If we find some users with too many affinities then we can delete their
    // lowest affinities.
    const affinityItems = await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            TaskTable.query(context, {
                partitionKey: {
                    partitionType: "Account",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                startSortKey: {
                    sortRangeType: "TaskCollectionAffinity",
                    collectionId: DynamoKeyAttributeSchema.id.getMinValue<TaskCollectionId>(),
                },
                endSortKey: {
                    sortRangeType: "TaskCollectionAffinity",
                    collectionId: DynamoKeyAttributeSchema.id.getMaxValue<TaskCollectionId>(),
                },
                limit: "All",
            }),
            affinityItem => ({
                collectionId: affinityItem.collectionId,
                points: getCurrentTaskCollectionAccountAffinityPoints(currentTime, affinityItem),
            }),
        ),
    );

    affinityItems.sort(
        (affinityItem1, affinityItem2) => affinityItem2.points - affinityItem1.points,
    );

    let startAffinityItemIndex = 0;
    const collectionResults = [];

    // Take a slice of length `limit` from our affinity items and fetch those
    // collections. If some of the collections the account no longer has access to
    // then we want to fetch some more collections from our affinity items until
    // we've satisfied `limit`.
    while (collectionResults.length < limit && startAffinityItemIndex < affinityItems.length) {
        const affinityItemsSlice = affinityItems.slice(
            startAffinityItemIndex,
            startAffinityItemIndex + (limit - collectionResults.length),
        );
        startAffinityItemIndex += limit - collectionResults.length;

        const collectionResultsSlice = await runAllPromises(
            affinityItemsSlice.map(async ({points, collectionId}) => {
                const collectionItem = await TaskTable.getItemIfExists(context, {
                    partitionType: "TaskCollection",
                    sortRangeType: "EssentialAttributes",
                    collectionId,
                });
                if (!collectionItem) return null;

                // Don't include deleted collections in results.
                if (isTaskCollectionItemDeleted(collectionItem)) return null;

                // We need to double check that we have access to this collection. Since
                // affinity scores might be out of date.
                const hasAccess = await isTaskCollectionItemAccessAuthorized(
                    context,
                    context.actor.getAccountId(),
                    collectionItem,
                    "View",
                );

                if (!hasAccess) return null;
                return createTaskCollectionModelSearchResultFromItem(points, collectionItem);
            }),
        );

        for (const collectionResult of collectionResultsSlice) {
            if (!collectionResult) continue;
            collectionResults.push(collectionResult);
        }
    }

    return collectionResults;
}

/**
 * Apply our exponential decay function to figure out how many affinity points
 * we currently have.
 *
 * Our function is `f(t) = e^-t` where `t` is measured in months. This function
 * will decay 1 point to 0.05 (which we round down to 0) in 3 months.
 */
export function getCurrentTaskCollectionAccountAffinityPoints(
    currentTime: number,
    {points, lastUpdatedTime}: {points: number; lastUpdatedTime: number},
): number {
    // 30 days (~1 month) in milliseconds
    const monthTime = 1000 * 60 * 60 * 24 * 30;

    const elapsedTime = currentTime - lastUpdatedTime;

    return points * Math.exp(-(elapsedTime / monthTime));
}

/**
 * Return the time in milliseconds for `points` to decay to 0.05 (which we
 * round down to 0). We set an expiration time on our item with this number.
 */
export function getTaskCollectionAccountAffinityExpirationDuration(points: number): number {
    // Any number less than this is negative.
    assert(points > 0.05);

    // 30 days (~1 month) in milliseconds
    const monthTime = 1000 * 60 * 60 * 24 * 30;

    return Math.log(points / 0.05) * monthTime;
}
